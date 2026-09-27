/**
 * Turns the atlas into one glTF per organ.
 *
 * Each organ is a compound of element meshes (the heart is 83, the lungs 280). Elements
 * are grouped by which hotspot claims them, merged within a group, and emitted as one
 * named node per group. Nothing merges across a group boundary.
 *
 * That constraint is the whole reason this stage exists. Joining everything would produce
 * models that look identical and render identically, and would make `isolate` impossible —
 * a failure that is invisible until someone tries to use the feature.
 *
 * Run: npm run build:organs
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import obj2gltf from 'obj2gltf';
import yauzl from 'yauzl';

import { parseElementMap, resolveElements } from './atlas.mjs';
import { envelope, trianglesToObj } from './envelope.mjs';
import { MODELS, ZIP_PREFIX } from './models.manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'models-src');
const OUT = path.join(SRC, 'organs');
const WORK = path.join(SRC, 'work');
const PARTS_OUT = path.join(ROOT, 'app', 'lib', 'generated', 'anatomy-parts.json');

/**
 * Must equal `MODEL_FIT_SIZE` in app/lib/three/loaders.ts.
 *
 * Not imported from there: that module pulls in three's GLTFLoader/DRACOLoader/
 * MeshoptDecoder, which assume a browser-ish environment, and this script runs under
 * plain Node with no bundler to shim that. Duplicating one constant is cheaper than
 * making loaders.ts import-safe from a build script, but it does mean the two values
 * must be kept in sync by hand — a mismatch here would silently mis-place every
 * derived hotspot.
 */
const MODEL_FIT_SIZE = 2;

/**
 * Partitions an organ's elements into hotspot groups plus `rest`.
 *
 * Exported for test: this is the logic isolate depends on, and it is far cheaper to
 * verify here than by inspecting a built GLB.
 *
 * `all` is the union across every concept the organ lists — paired organs (lungs, kidneys,
 * intestine) list two, so a hotspot must be validated against the combined set, not just
 * concepts[0]. Validating only the first concept would silently skip validation for every
 * paired organ.
 */
export function groupElements(map, model) {
  const all = new Set(resolveElements(map, model.concepts));
  const groups = [];
  // Maps element -> the hotspot id that claimed it, so a later overlap can name the
  // earlier claimant in its warning.
  const claimed = new Map();

  for (const hotspot of model.hotspots) {
    const hotspotElements = resolveElements(map, [hotspot.fmaId]);
    const isSubsetOfOrgan = hotspotElements.length > 0 && hotspotElements.every((e) => all.has(e));
    if (!isSubsetOfOrgan) {
      throw new Error(`hotspot ${hotspot.id} (${hotspot.fmaId}) is not a subset of its organ`);
    }

    // Adjacent anatomical structures in this atlas genuinely share boundary meshes — the
    // tricuspid ring belongs to both the right atrium and right ventricle, the mitral ring
    // to both left chambers. That overlap is a property of the data, not an authoring
    // mistake, so it can't be rejected outright. But groups still have to be a disjoint
    // partition: each element becomes exactly one named node, and `isolate` shows exactly
    // one group. The tie-break is first-claim-wins — a shared element goes to whichever
    // hotspot is listed first in the manifest — and it's made loudly, not silently: any
    // overlap prints a warning naming both hotspots and the shared count, so whoever orders
    // the hotspot list can see the tie-break happening. This guarantees every element ends
    // up in exactly one group.
    const overlaps = new Map(); // other hotspot id -> shared element count
    for (const e of hotspotElements) {
      const claimant = claimed.get(e);
      if (claimant) overlaps.set(claimant, (overlaps.get(claimant) ?? 0) + 1);
    }
    for (const [otherId, count] of overlaps) {
      console.warn(
        `  warning   hotspot ${hotspot.id} (${hotspot.fmaId}) shares ${count} element(s) with ` +
          `${otherId} — first-claimed wins, so they stay with ${otherId}`,
      );
    }

    const elements = hotspotElements.filter((e) => !claimed.has(e));
    if (elements.length === 0) {
      throw new Error(`hotspot ${hotspot.id} (${hotspot.fmaId}) claims no elements`);
    }
    elements.forEach((e) => claimed.set(e, hotspot.id));
    groups.push({ group: hotspot.id, elements });
  }

  const rest = [...all].filter((e) => !claimed.has(e)).sort();
  if (rest.length > 0) groups.push({ group: 'rest', elements: rest });
  return groups;
}

/**
 * Drops speck fragments from one element's OBJ text — connected groups of faces less
 * than SPECK_MM across that touch nothing else — plus the vertices and normals only they
 * referenced, renumbering what is left. Comments and other lines are dropped too.
 *
 * The atlas scatters specks — near-degenerate triangles a few hundredths of a
 * millimetre across, far below the ~1 mm triangles of real surface — away from
 * the surface they belong to. They draw nothing, but every bounding box counts them: the
 * eyeball has some where the other eye would be, which doubled its width and left the
 * viewer framing empty space. Cleaning here, before both the centroid pass and the
 * merge, keeps the measured centroids and the emitted geometry in the same box.
 */
/** Key for extra, non-element vertices inside computePartCentroids' bounding box. */
const EXTRA = Symbol('extra');

/**
 * Suffix for the node holding a group's generated surface. Must match SURFACE_SUFFIX in
 * app/lib/three/tint.ts, which strips it to find the part a surface belongs to.
 */
export const SURFACE_SUFFIX = '--surface';

/** A fragment smaller than this across is a speck, not anatomy. */
const SPECK_MM = 1;

export function cleanObj(text) {
  const positions = [];
  const normals = [];
  const faces = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) positions.push(line);
    else if (line.startsWith('vn ')) normals.push(line);
    else if (line.startsWith('f ')) faces.push(line.slice(2).trim().split(/\s+/).map((ref) => ref.split('/')));
  }

  const point = (index) => positions[index - 1].slice(2).trim().split(/\s+/).map(Number);
  // Union-find over vertex indices: faces sharing a vertex belong to one fragment.
  const parent = positions.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const face of faces) {
    const [first, ...others] = face.map(([v]) => Number(v) - 1);
    for (const other of others) parent[find(other)] = find(first);
  }

  const extent = new Map();
  for (const face of faces) {
    for (const [v] of face) {
      const root = find(Number(v) - 1);
      const p = point(Number(v));
      const box = extent.get(root) ?? { min: [...p], max: [...p] };
      for (let axis = 0; axis < 3; axis += 1) {
        box.min[axis] = Math.min(box.min[axis], p[axis]);
        box.max[axis] = Math.max(box.max[axis], p[axis]);
      }
      extent.set(root, box);
    }
  }
  const isSpeck = (face) => {
    const { min, max } = extent.get(find(Number(face[0][0]) - 1));
    return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) < SPECK_MM;
  };
  const kept = faces.filter((face) => !isSpeck(face));

  // Old 1-based index -> new 1-based index, assigned in original order.
  const renumber = (count, used) => {
    const map = new Map();
    for (let old = 1; old <= count; old += 1) if (used.has(old)) map.set(old, map.size + 1);
    return map;
  };
  const vertexMap = renumber(positions.length, new Set(kept.flatMap((f) => f.map(([v]) => Number(v)))));
  const normalMap = renumber(normals.length, new Set(kept.flatMap((f) => f.filter(([, , n]) => n).map(([, , n]) => Number(n)))));

  const out = [];
  for (const [old] of vertexMap) out.push(positions[old - 1]);
  for (const [old] of normalMap) out.push(normals[old - 1]);
  for (const face of kept) {
    const refs = face.map(([v, t, n]) =>
      n ? `${vertexMap.get(Number(v))}/${t ?? ''}/${normalMap.get(Number(n))}` : `${vertexMap.get(Number(v))}`,
    );
    out.push(`f ${refs.join(' ')}`);
  }
  return out.join('\n');
}

/** Parses `v x y z` lines out of raw OBJ text into a flat [x0,y0,z0,x1,y1,z1,...] array. */
export function parseVertices(text) {
  const vertices = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('v ')) continue;
    const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
    vertices.push(x, y, z);
  }
  return vertices;
}

/**
 * The bounding box across every vertex in `vertexMap`, keyed by whichever element ids
 * are passed in `elements` — normally the organ's full element set, so this matches
 * what `Box3.setFromObject` sees over the merged model at load time.
 */
function boundingBox(vertexMap, elements) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of elements) {
    const vertices = vertexMap.get(id);
    for (let i = 0; i < vertices.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = vertices[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  return { min, max };
}

/** Arithmetic mean of every vertex across a set of elements, unweighted by face area. */
function rawCentroid(vertexMap, elements) {
  const sum = [0, 0, 0];
  let count = 0;
  for (const id of elements) {
    const vertices = vertexMap.get(id);
    for (let i = 0; i < vertices.length; i += 3) {
      sum[0] += vertices[i];
      sum[1] += vertices[i + 1];
      sum[2] += vertices[i + 2];
      count += 1;
    }
  }
  if (count === 0) throw new Error('rawCentroid: no vertices in element set');
  return sum.map((s) => s / count);
}

/**
 * Per-group centroids for one organ, in the same normalised model space the viewer
 * fits models into at load time (see `normaliseModel` in app/lib/three/loaders.ts).
 *
 * That function centres the whole loaded object on its bounding-box centre and scales
 * it uniformly so the longest axis spans `MODEL_FIT_SIZE`. To land a marker in the same
 * place, the transform has to be derived from the *organ's* full bounding box — every
 * element across every group, not just the group being positioned — and then applied
 * to each group's own raw centroid. Deriving the box per-group instead would give each
 * group its own centre and scale, which is a different, wrong transform: it's how the
 * whole model gets fitted into the unit cube, not how any one part of it does.
 */
/**
 * The atlas is Z-up (z is height, the body's front is -y); glTF is Y-up. This is the
 * same -90° turn about X that obj2gltf applies to the geometry with inputUpAxis 'Z', so
 * centroids and meshes stay in the same frame. A 90° turn maps an axis-aligned box onto
 * an axis-aligned box, so normalising before or after rotating gives the same result.
 */
export function zUpToYUp([x, y, z]) {
  return [x, z, -y];
}

export function computePartCentroids(vertexMap, groups, extraVertices = []) {
  const allElements = groups.flatMap((g) => g.elements);
  // Generated surfaces are part of the emitted model, so the box the viewer fits must
  // include them — they are passed in as a flat vertex list under a reserved key.
  const box = boundingBox(new Map([...vertexMap, [EXTRA, extraVertices]]), [...allElements, EXTRA]);
  const centre = box.min.map((lo, axis) => (lo + box.max[axis]) / 2);
  const size = box.min.map((lo, axis) => box.max[axis] - lo);
  const largestAxis = Math.max(...size);
  // Mirrors loaders.ts's own fallback: a degenerate box would otherwise divide by zero.
  const scale = largestAxis > 0 && Number.isFinite(largestAxis) ? MODEL_FIT_SIZE / largestAxis : 1;

  const result = {};
  for (const g of groups) {
    const raw = rawCentroid(vertexMap, g.elements);
    result[g.group] = {
      elements: g.elements,
      centroid: zUpToYUp(raw.map((v, axis) => (v - centre[axis]) * scale)),
    };
  }
  return result;
}

/** Reads only the entries we need out of the archive, keyed by element id. */
function readEntries(zipPath, wanted) {
  return new Promise((resolve, reject) => {
    const found = new Map();
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', (entry) => {
        const id = path.basename(entry.fileName, '.obj');
        if (!entry.fileName.startsWith(ZIP_PREFIX) || !wanted.has(id)) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            found.set(id, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
          // Without this, a corrupt entry crashes the process instead of rejecting the
          // promise the rest of the build is awaiting.
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(found));
      zip.on('error', reject);
    });
  });
}

/**
 * Concatenates OBJ text for one group, rebasing face indices, and returns the running
 * vertex/normal counts so the caller can chain groups together.
 *
 * OBJ vertex indices are absolute within a *file*, not within an `o` object — confirmed
 * against the installed converter (node_modules/obj2gltf/lib/loadObj.js), which keeps one
 * file-global positions/normals store and never resets it on an `o` line. `main` calls this
 * once per group and concatenates every group's text into a single .obj file, so the bases
 * must be threaded across calls rather than reset to 0 each time — otherwise every group
 * after the first resolves its faces against an earlier group's vertices, silently, because
 * obj2gltf only throws when an index exceeds the *whole file's* vertex count and a group's
 * local indices are always below that. `vertexBase`/`normalBase` default to 0 so the first
 * call in a chain doesn't need a special case.
 *
 * Only `v`, `vn`, `f` lines are rebased; `vt` lines would need the same treatment but
 * sampled atlas entries contain none (only `v`, `vn`, and `f` in `v//vn` form), so the `t`
 * slot of a face ref is passed through unrebased rather than handled — this is latent, not
 * live, and would need revisiting if a `vt` line ever shows up in the source data.
 */
export function mergeObj(parts, groupName, vertexBase = 0, normalBase = 0) {
  const out = [`o ${groupName}`];

  // A negative OBJ index is relative-to-current-position addressing, which this function
  // does not implement. Left alone, `Number(v) + vertexBase` would silently produce a
  // plausible-looking but wrong index instead of failing loudly.
  const rebase = (ref, base) => {
    const n = Number(ref);
    if (n < 0) throw new Error(`mergeObj: negative (relative) OBJ index "${ref}" is not supported`);
    return n + base;
  };

  for (const text of parts) {
    let vertices = 0;
    let normals = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('v ')) { out.push(line); vertices += 1; }
      else if (line.startsWith('vn ')) { out.push(line); normals += 1; }
      else if (line.startsWith('f ')) {
        const shifted = line
          .slice(2)
          .trim()
          .split(/\s+/)
          .map((ref) => {
            const [v, t, n] = ref.split('/');
            const vi = rebase(v, vertexBase);
            const ni = n ? rebase(n, normalBase) : '';
            return n ? `${vi}/${t ?? ''}/${ni}` : `${vi}`;
          })
          .join(' ');
        out.push(`f ${shifted}`);
      }
    }
    vertexBase += vertices;
    normalBase += normals;
  }
  return { text: out.join('\n'), vertexBase, normalBase };
}

/**
 * Runs the real build across every organ.
 *
 * Kept out of module-load scope and behind the direct-execution guard below: this module
 * is imported by tests to reach `groupElements`, and importing it must not trigger a
 * multi-minute pass over the 65 MB archive as a side effect.
 */
async function main() {
  if (!existsSync(path.join(SRC, 'atlas.zip'))) {
    console.error('build-organs: no atlas at models-src/atlas.zip — run `npm run fetch:models`');
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  await mkdir(WORK, { recursive: true });

  const map = parseElementMap(await readFile(path.join(SRC, 'elements.txt'), 'utf8'));

  // Accumulated across every organ and written once, after the loop, to
  // app/lib/generated/anatomy-parts.json — the sidecar `subject-data.ts` derived
  // hotspots resolve their positions from.
  const parts = {};

  for (const model of MODELS) {
    const groups = groupElements(map, model);
    const wanted = new Set(groups.flatMap((g) => g.elements));
    const entries = await readEntries(path.join(SRC, 'atlas.zip'), wanted);
    for (const [id, text] of entries) entries.set(id, cleanObj(text));

    const missing = [...wanted].filter((id) => !entries.has(id));
    if (missing.length > 0) {
      console.error(`  FAILED    ${model.id}: ${missing.length} element(s) not in the archive`);
      process.exitCode = 1;
      continue;
    }

    // Parsed once per element and shared between the centroid pass and the merge pass
    // below — `mergeObj` needs the same raw text but rebases and concatenates it, which
    // would make vertex extraction after the fact needlessly re-parse rebased indices.
    const vertexMap = new Map([...wanted].map((id) => [id, parseVertices(entries.get(id))]));

    // Organs whose atlas entry lacks an outer surface (the lungs are only airway and
    // vessel trees) get one generated around each group — see scripts/envelope.mjs.
    const surfaces = model.envelope
      ? groups
          .filter((g) => g.group !== 'rest')
          .map((g) => ({
            group: g.group,
            obj: trianglesToObj(envelope(g.elements.flatMap((id) => vertexMap.get(id)), model.envelope)),
          }))
      : [];

    parts[model.id] = computePartCentroids(
      vertexMap,
      groups,
      surfaces.flatMap((s) => parseVertices(s.obj)),
    );

    const objPath = path.join(WORK, `${model.id}.obj`);
    // Threaded, not mapped: each group's vertex/normal base must continue from where the
    // previous group left off (see mergeObj's doc comment) since all of this ends up in one
    // .obj file.
    const merged = [];
    let vertexBase = 0;
    let normalBase = 0;
    for (const g of groups) {
      const result = mergeObj(g.elements.map((id) => entries.get(id)), g.group, vertexBase, normalBase);
      merged.push(result.text);
      vertexBase = result.vertexBase;
      normalBase = result.normalBase;
    }
    for (const s of surfaces) {
      const result = mergeObj([s.obj], `${s.group}${SURFACE_SUFFIX}`, vertexBase, normalBase);
      merged.push(result.text);
      vertexBase = result.vertexBase;
      normalBase = result.normalBase;
    }
    await writeFile(objPath, merged.join('\n'), 'utf8');

    // The atlas is Z-up; without this every organ arrives lying on its back.
    const gltf = await obj2gltf(objPath, { unlit: false, inputUpAxis: 'Z', outputUpAxis: 'Y' });
    await writeFile(path.join(OUT, `${model.id}.gltf`), JSON.stringify(gltf), 'utf8');

    console.log(
      `  built     ${model.id.padEnd(12)} ${String(wanted.size).padStart(4)} elements → ` +
        `${groups.length} group(s): ${groups.map((g) => g.group).join(', ')}` +
        (surfaces.length > 0 ? ` + ${surfaces.length} generated surface(s)` : ''),
    );
  }

  await rm(WORK, { recursive: true, force: true });

  // Committed, unlike everything else this script writes — it's the input subject-data.ts's
  // derived hotspots and tests/parts.test.ts read, not an intermediate the optimise stage
  // consumes.
  await mkdir(path.dirname(PARTS_OUT), { recursive: true });
  await writeFile(PARTS_OUT, JSON.stringify(parts, null, 2) + '\n', 'utf8');

  console.log('\nbuild-organs: models-src/organs/ ready for optimize:models');
  console.log(`build-organs: wrote ${path.relative(ROOT, PARTS_OUT)}`);
}

// Direct-execution guard (the ESM equivalent of `if __name__ == "__main__"`) so `npm test`
// importing groupElements doesn't also run the real build.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  await main();
}
