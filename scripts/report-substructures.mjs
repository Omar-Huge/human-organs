/**
 * Lists sub-structures that are exact subsets of each organ, largest first.
 *
 * A hotspot may only name a concept whose elements all belong to its organ — otherwise
 * isolate would show geometry from outside the model. This report is the authoring input
 * for the hotspot lists in models.manifest.mjs. Run it; do not guess FMA ids.
 *
 * Run: node scripts/report-substructures.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConceptNames, parseElementMap, resolveElements } from './atlas.mjs';
import { MODELS } from './models.manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'models-src');

const names = parseConceptNames(await readFile(path.join(SRC, 'concepts.txt'), 'utf8'));
const map = parseElementMap(await readFile(path.join(SRC, 'elements.txt'), 'utf8'));

for (const model of MODELS) {
  const own = new Set(resolveElements(map, model.concepts));
  const candidates = [];

  for (const [fma, name] of names) {
    if (model.concepts.includes(fma)) continue;
    const elements = map.get(fma);
    if (!elements || elements.size === 0) continue;
    if ([...elements].every((e) => own.has(e))) candidates.push({ fma, name, size: elements.size });
  }

  candidates.sort((a, b) => b.size - a.size);
  console.log(`\n${model.id}  (${own.size} elements, ${candidates.length} sub-structures)`);
  for (const c of candidates.slice(0, 12)) {
    console.log(`  ${c.fma.padEnd(10)} ${String(c.size).padStart(4)} elements  ${c.name}`);
  }
}
