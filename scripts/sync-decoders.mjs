/**
 * Copies the Draco decoder binaries out of the installed three.js distribution into
 * public/draco, so GLTFLoader never fetches a decoder from a CDN at runtime.
 *
 * three ships these files but does not publish them to a stable URL, and the versions
 * must match the three.js release the app is built against. Copying them at setup time
 * — rather than committing a snapshot — keeps them in lockstep with package.json.
 *
 * Run: npm run sync:decoders   (also runs automatically after npm install)
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const DEST = path.join(ROOT, 'public', 'draco');

if (!existsSync(SOURCE)) {
  console.error(`sync-decoders: three.js Draco decoders not found at ${SOURCE}`);
  console.error('Run npm install first.');
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SOURCE, DEST, { recursive: true });

const copied = await readdir(DEST);
console.log(`sync-decoders: copied ${copied.length} file(s) to public/draco`);
for (const name of copied.sort()) console.log(`  ${name}`);
