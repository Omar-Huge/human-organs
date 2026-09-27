/**
 * The asset pipeline.
 *
 * Runs every raw source model through @gltf-transform/cli's `optimize` command, which
 * chains the operations §7 of the brief calls for: dedupe and join, weld, simplify,
 * texture recompression, prune, and Meshopt compression.
 *
 * Meshopt is chosen over Draco deliberately. Draco decoding is comparatively slow on
 * the main thread — which matters here because a decode happens on every uncached
 * entity switch, in front of the user. Meshopt decodes far faster for a similar
 * transmission size. The Draco decoder stays wired in the loader regardless, so a
 * Draco-compressed input still loads.
 *
 * Run: npm run optimize:models
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

import { MODELS, PER_MODEL_BUDGET, TEXTURE_SIZE, TOTAL_BUDGET } from './models.manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'models-src');
const OUT = path.join(ROOT, 'public', 'models');
const CLI = path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

if (!existsSync(SRC)) {
  console.error(`optimize-models: no sources at ${SRC}`);
  console.error('Run `npm run build:organs` first.');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  // Registered so a Draco-compressed input can still be read, independent of what we
  // compress with on the way out.
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

/**
 * Downsizes oversized textures, writing an intermediate for the CLI to consume.
 *
 * This is done here with sharp rather than through the CLI's `--texture-compress`
 * because that path asks libvips for a colourspace some builds reject outright, and
 * failing the whole pipeline on an image-library quirk is not acceptable. Running
 * before the optimize pass — rather than rewriting its output — also avoids a
 * compress/decompress round trip on the geometry.
 *
 * Returns the path to feed the CLI, and how many textures were touched.
 */
async function prepareTextures(input, intermediate, maxSize) {
  const doc = await io.read(input);
  doc.createExtension(EXTTextureWebP).setRequired(false);

  let resized = 0;
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;

    const meta = await sharp(image).metadata();
    const largest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (largest <= maxSize) continue;

    const encoded = await sharp(image)
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    texture.setImage(encoded).setMimeType('image/webp');
    resized += 1;
  }

  if (resized === 0) return { path: input, resized: 0, maxSize };

  // The intermediate is a throwaway that the CLI immediately recompresses with
  // Meshopt, so it is written uncompressed. Dropping the Draco extension here avoids
  // pulling in the Draco *encoder* purely to re-encode geometry that is about to be
  // thrown away and encoded again a different way.
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }

  await io.write(intermediate, doc);
  return { path: intermediate, resized, maxSize };
}

const results = [];

for (const model of MODELS) {
  // build-organs writes one .gltf per organ under models-src/organs.
  const input = path.join(SRC, 'organs', `${model.id}.gltf`);
  const output = path.join(OUT, `${model.id}.glb`);

  if (!existsSync(input)) {
    console.error(`  MISSING   organs/${model.id}.gltf — run \`npm run build:organs\``);
    process.exitCode = 1;
    continue;
  }

  const before = statSync(input).size;

  const intermediate = path.join(SRC, `${model.id}.resized.glb`);
  const prepared = await prepareTextures(input, intermediate, model.textureSize ?? TEXTURE_SIZE);

  const args = [
    CLI,
    'optimize',
    prepared.path,
    output,
    '--compress',
    'meshopt',
    // Texture recompression is off deliberately. Every source model already ships
    // WebP textures at or below TEXTURE_SIZE, so re-encoding them saves nothing
    // measurable — the weight in these files is geometry, not images. It is also the
    // one step that is not portable: gltf-transform asks libvips for a colourspace
    // that some sharp/libvips pairings reject outright. Turning it off removes a
    // fragile dependency for no cost. Revisit if a future source ships PNG textures.
    '--texture-compress',
    'false',
    '--simplify',
    'true',
    // build-organs emits one named node per hotspot group, and the viewer colours and
    // highlights parts by those names. The default join merges them into one mesh.
    '--join-named',
    'false',
  ];

  // Only models that overshoot the budget get an explicit vertex ratio; the rest are
  // left to the default error tolerance, which removes far less detail.
  if (model.simplifyRatio > 0) {
    args.push('--simplify-ratio', String(model.simplifyRatio));
  }

  // The CLI's entry point is invoked directly rather than through npx: this project
  // path contains a space, and spawning through a shell concatenates arguments without
  // escaping them, which silently mangles every path.
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (existsSync(intermediate)) await rm(intermediate);

  if (run.status !== 0) {
    console.error(`  FAILED    ${model.id}`);
    console.error((run.stderr || run.stdout || '(no output)').slice(-2000));
    process.exitCode = 1;
    continue;
  }

  const after = statSync(output).size;
  const overBudget = after > PER_MODEL_BUDGET;
  results.push({ id: model.id, before, after, overBudget });

  const note = prepared.resized > 0 ? `  [${prepared.resized} textures → ${prepared.maxSize}px]` : '';
  console.log(
    `  ${overBudget ? 'OVER' : 'ok  '}      ${model.id.padEnd(20)} ${kb(before).padStart(9)} → ${kb(after).padStart(9)}` +
      `  (${(100 - (after / before) * 100).toFixed(0)}% smaller)${note}`,
  );
}

// Anything left in public/models that no longer corresponds to a manifest entry is a
// stale artifact from a previous run, and would silently inflate the payload.
const known = new Set(MODELS.map((model) => `${model.id}.glb`));
for (const file of await readdir(OUT)) {
  if (file.endsWith('.glb') && !known.has(file)) {
    await rm(path.join(OUT, file));
    console.log(`  removed   ${file} (not in manifest)`);
  }
}

const total = results.reduce((sum, entry) => sum + entry.after, 0);
const over = results.filter((entry) => entry.overBudget);

console.log(`\n  total     ${mb(total)} of ${mb(TOTAL_BUDGET)} budget`);

if (over.length > 0) {
  console.error(`\n  ${over.length} model(s) over the ${mb(PER_MODEL_BUDGET)} per-model budget:`);
  for (const entry of over) console.error(`    ${entry.id}  ${kb(entry.after)}`);
  console.error('  Lower simplifyRatio for these in scripts/models.manifest.mjs, or accept the size.');
  process.exitCode = 1;
}

if (total > TOTAL_BUDGET) {
  console.error(`\n  total payload ${mb(total)} exceeds the ${mb(TOTAL_BUDGET)} budget`);
  process.exitCode = 1;
}
