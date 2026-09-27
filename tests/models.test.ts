/**
 * Asset pipeline output tests.
 *
 * Parses every optimised model and checks it is something three.js could actually
 * render. This is the cheap half of "do the models work" — it catches a pipeline that
 * silently emitted an empty scene, stripped every material, or blew the size budget,
 * without needing a GPU. The expensive half, a real WebGL load, is covered once in the
 * Playwright suite rather than eight times.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

import { MODELS, PER_MODEL_BUDGET, TOTAL_BUDGET } from '../scripts/models.manifest.mjs';
import { ENTITIES } from '../app/lib/subject-data.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(REPO_ROOT, 'public', 'models');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

test('the manifest and the content model describe the same organs', () => {
  const manifestIds = MODELS.map((model) => model.id).sort();
  const contentIds = ENTITIES.map((entity) => entity.id).sort();
  assert.deepEqual(
    manifestIds,
    contentIds,
    'scripts/models.manifest.mjs and app/lib/subject-data.ts have drifted apart',
  );
});

test('the total payload is within budget', () => {
  let total = 0;
  for (const model of MODELS) {
    const file = path.join(MODEL_DIR, `${model.id}.glb`);
    assert.ok(existsSync(file), `missing optimised model: ${model.id}.glb`);
    total += statSync(file).size;
  }
  assert.ok(
    total <= TOTAL_BUDGET,
    `total payload ${(total / 1024 / 1024).toFixed(2)} MB exceeds ${(TOTAL_BUDGET / 1024 / 1024).toFixed(0)} MB`,
  );
});

for (const model of MODELS) {
  const file = path.join(MODEL_DIR, `${model.id}.glb`);

  test(`${model.id}: within the per-model budget`, () => {
    const size = statSync(file).size;
    assert.ok(
      size <= PER_MODEL_BUDGET,
      `${model.id}.glb is ${(size / 1024).toFixed(0)} KB, over the ${(PER_MODEL_BUDGET / 1024).toFixed(0)} KB budget`,
    );
  });

  test(`${model.id}: parses and contains renderable geometry`, async () => {
    const doc = await io.read(file);
    const root = doc.getRoot();

    const meshes = root.listMeshes();
    assert.ok(meshes.length > 0, `${model.id} has no meshes — the pipeline emptied it`);

    let triangles = 0;
    let primitives = 0;
    for (const mesh of meshes) {
      for (const primitive of mesh.listPrimitives()) {
        primitives += 1;
        assert.ok(
          primitive.getAttribute('POSITION'),
          `${model.id} has a primitive with no POSITION attribute`,
        );
        const indices = primitive.getIndices();
        triangles += indices ? indices.getCount() / 3 : 0;
      }
    }

    assert.ok(primitives > 0, `${model.id} has meshes but no primitives`);
    assert.ok(triangles > 100, `${model.id} has only ${triangles} triangles — geometry was lost`);
    assert.ok(
      root.listMaterials().length > 0,
      `${model.id} has no materials and would render untextured`,
    );
    assert.ok(root.listScenes().length > 0, `${model.id} has no scene`);
  });

  // The viewer colours and highlights parts by node name, so the optimiser must not
  // join the per-hotspot nodes build-organs emitted. A joined model still renders —
  // this is the only place the loss shows up.
  test(`${model.id}: keeps one named node per hotspot group`, async () => {
    const doc = await io.read(file);
    const names = new Set(doc.getRoot().listNodes().map((node) => node.getName()));
    for (const hotspot of model.hotspots) {
      assert.ok(names.has(hotspot.id), `${model.id}.glb has no node named "${hotspot.id}"`);
    }
  });
}
