import type { Entity } from './subject-data.ts';

/**
 * Searches the fields a visitor would actually type into.
 *
 * Facts are included because the useful queries here are things like "chambers" or
 * "10 oz" — which live in the data, not in the name. Notes are deliberately
 * excluded: they are long enough that matching them returns almost everything for
 * common words, which reads as a filter that does not work.
 *
 * Kept out of the component so it can be tested directly, without pulling React and
 * an icon library into the test process.
 */
export function matchesQuery(entity: Entity, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  const haystack = [
    entity.name,
    entity.formalName,
    entity.category,
    ...entity.facts.flatMap((fact) => [fact.label, fact.value]),
    ...entity.hotspots.map((hotspot) => hotspot.label),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}
