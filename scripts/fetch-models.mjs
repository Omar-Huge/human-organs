/**
 * Downloads the BodyParts3D atlas into models-src/.
 *
 * Raw sources are gitignored — §7 keeps them out of the repository and commits only the
 * optimised output. One 65 MB archive plus two small index files are the whole
 * download: the atlas is distributed whole, and the indices are what turn
 * an FMA concept into a list of meshes.
 *
 * Run: npm run fetch:models
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ATLAS_ZIP_URL, CONCEPT_LIST_URL, ELEMENT_MAP_URL } from './models.manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'models-src');
const force = process.argv.includes('--force');

const TARGETS = [
  { name: 'atlas.zip', url: ATLAS_ZIP_URL, magic: 'PK' },
  { name: 'concepts.txt', url: CONCEPT_LIST_URL, magic: 'conc' },
  { name: 'elements.txt', url: ELEMENT_MAP_URL, magic: 'conc' },
];

await mkdir(DEST, { recursive: true });

for (const target of TARGETS) {
  const file = path.join(DEST, target.name);

  if (existsSync(file) && !force) {
    console.log(`  skip      ${target.name} (already present, --force to refetch)`);
    continue;
  }

  const response = await fetch(target.url);
  if (!response.ok) {
    console.error(`  FAILED    ${target.name}: HTTP ${response.status} for ${target.url}`);
    process.exitCode = 1;
    continue;
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  // An HTML error page would download happily and fail much later, deep inside the zip
  // reader, with a confusing error. Check the magic instead.
  if (bytes.subarray(0, target.magic.length).toString('ascii') !== target.magic) {
    console.error(`  FAILED    ${target.name}: unexpected content (${bytes.length} bytes)`);
    process.exitCode = 1;
    continue;
  }

  await writeFile(file, bytes);
  console.log(`  fetched   ${target.name.padEnd(14)} ${(statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
}

console.log('\nfetch-models: atlas ready in models-src/');
