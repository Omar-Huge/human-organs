/**
 * BodyParts3D index parsing.
 *
 * The atlas ships meshes named FJ####.obj, which match neither the FMA concept ids nor
 * the BP ids anyone would look up. partof_element_parts.txt is the required indirection:
 * concept id -> the element files that make up that concept. An organ is a compound of
 * many elements (the heart is 83), and a sub-structure is an exact subset of its parent's
 * elements — which is what makes both derived hotspots and isolate possible.
 *
 * Pure functions over text so the resolution logic is testable without the 65 MB archive.
 */

const rows = (text) =>
  text
    .split(/\r?\n/)
    .slice(1) // header
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t'));

/** concept id -> English name, from partof_parts_list_e.txt. */
export function parseConceptNames(text) {
  const names = new Map();
  for (const [fma, , name] of rows(text)) {
    if (fma && name) names.set(fma, name);
  }
  return names;
}

/** concept id -> set of element file ids, from partof_element_parts.txt. */
export function parseElementMap(text) {
  const map = new Map();
  for (const [fma, , element] of rows(text)) {
    if (!fma || !element) continue;
    if (!map.has(fma)) map.set(fma, new Set());
    map.get(fma).add(element);
  }
  return map;
}

/** Union of several concepts' elements, sorted. Paired organs need this. */
export function resolveElements(map, fmaIds) {
  const out = new Set();
  for (const fma of fmaIds) {
    for (const element of map.get(fma) ?? []) out.add(element);
  }
  return [...out].sort();
}

/** True when every element of `child` also belongs to `parent`, and child is non-empty. */
export function isSubsetOf(map, childFma, parentFma) {
  const child = map.get(childFma);
  const parent = map.get(parentFma);
  if (!child || !parent || child.size === 0) return false;
  for (const element of child) {
    if (!parent.has(element)) return false;
  }
  return true;
}
