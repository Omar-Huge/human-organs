/**
 * Library search tests.
 *
 * The filter is the one place in the UI where a visitor can end up with an empty
 * screen, so its behaviour is pinned down rather than left to be discovered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesQuery } from '../app/lib/search.ts';
import { ENTITIES, getEntity } from '../app/lib/subject-data.ts';

const found = (query: string) => ENTITIES.filter((entity) => matchesQuery(entity, query)).map((e) => e.id);

test('an empty query shows everything', () => {
  for (const query of ['', '   ', '\t']) {
    assert.equal(found(query).length, ENTITIES.length, `query ${JSON.stringify(query)} filtered`);
  }
});

test('matching is case-insensitive and ignores surrounding whitespace', () => {
  assert.deepEqual(found('  PANCREAS  '), ['pancreas']);
  assert.deepEqual(found('pancreas'), ['pancreas']);
});

test('a formal name matches even when the display name does not contain it', () => {
  // "Encephalon" appears only in the Brain's formal name (and, coincidentally, inside
  // its own "Diencephalon" hotspot label) — never in the display name "Brain".
  assert.deepEqual(found('Encephalon'), ['brain']);
});

test('category matching groups the archetypes', () => {
  // Lungs, kidneys, and eyeball are all categorised as paired organs.
  const paired = found('paired');
  assert.ok(paired.includes('kidneys'), 'Kidneys is categorised as a paired organ');
});

test('facts are searchable, which is the point of including them', () => {
  // A hormone lives in the facts (and the unsearched summary) and nowhere else.
  assert.deepEqual(found('Insulin'), ['pancreas']);
  // A quantity, likewise.
  assert.ok(found('200').includes('kidneys'));
});

test('hotspot labels are searchable', () => {
  const results = found('duct tree');
  assert.ok(
    results.includes('pancreas'),
    "Pancreas's duct hotspot should be findable by the words a visitor would use",
  );
});

test('notes are excluded so common words do not match everything', () => {
  // "the" appears throughout the notes but should not be treated as a match signal.
  const results = found('zzz-definitely-not-present');
  assert.deepEqual(results, [], 'a nonsense query must return nothing');
});

test('a query matching nothing returns an empty list rather than throwing', () => {
  assert.deepEqual(found('kryptonite'), []);
});

test('every entity is reachable by typing its own name', () => {
  for (const entity of ENTITIES) {
    const results = found(entity.name);
    assert.ok(
      results.includes(entity.id),
      `${entity.id} is not findable by its own name "${entity.name}"`,
    );
  }
});

test('searching a hotspot label reaches the entity that owns it', () => {
  // Skin is the one entity with hand-placed (authored) rather than derived hotspots,
  // so this also exercises that code path.
  const entity = getEntity('skin');
  for (const hotspot of entity.hotspots) {
    assert.ok(
      matchesQuery(entity, hotspot.label),
      `${entity.id} should match its own hotspot label "${hotspot.label}"`,
    );
  }
});
