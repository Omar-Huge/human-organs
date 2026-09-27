import test from 'node:test';
import assert from 'node:assert/strict';

import { parseConceptNames, parseElementMap, resolveElements, isSubsetOf } from '../scripts/atlas.mjs';
import { groupElements, mergeObj } from '../scripts/build-organs.mjs';

// Shared by every test below that needs two hotspots sharing one boundary element — the
// tricuspid-ring shape (FJ2418 claimed by both right-atrium and right-ventricle).
const OVERLAPPING_ELEMENTS = [
  'concept id\tname\telement file id',
  'FMA7088\theart\tFJ2417',
  'FMA7088\theart\tFJ2418',
  'FMA7088\theart\tFJ2419',
  'FMA0001\tright-atrium\tFJ2417',
  'FMA0001\tright-atrium\tFJ2418',
  'FMA0002\tright-ventricle\tFJ2418',
  'FMA0002\tright-ventricle\tFJ2419',
].join('\n');
const OVERLAPPING_HOTSPOTS = [
  { id: 'right-atrium', fmaId: 'FMA0001' },
  { id: 'right-ventricle', fmaId: 'FMA0002' },
];

// Real format: tab-separated, one header line.
const NAMES = ['concept id\trepresentation id\ten', 'FMA7088\tBP9305\theart', 'FMA7101\tBP9310\tleft ventricle'].join('\n');

const ELEMENTS = [
  'concept id\tname\telement file id',
  'FMA7088\theart\tFJ2417',
  'FMA7088\theart\tFJ2418',
  'FMA7088\theart\tFJ2419',
  'FMA7101\tleft ventricle\tFJ2418',
  'FMA7101\tleft ventricle\tFJ2419',
].join('\n');

test('concept names parse, skipping the header', () => {
  const names = parseConceptNames(NAMES);
  assert.equal(names.get('FMA7088'), 'heart');
  assert.equal(names.size, 2);
});

test('element ids collapse into one set per concept', () => {
  const map = parseElementMap(ELEMENTS);
  assert.deepEqual([...map.get('FMA7088')].sort(), ['FJ2417', 'FJ2418', 'FJ2419']);
});

test('resolveElements unions several concepts and sorts, for paired organs', () => {
  const map = parseElementMap(ELEMENTS);
  assert.deepEqual(resolveElements(map, ['FMA7101', 'FMA7088']), ['FJ2417', 'FJ2418', 'FJ2419']);
});

test('a sub-structure is recognised as a subset of its organ', () => {
  const map = parseElementMap(ELEMENTS);
  assert.equal(isSubsetOf(map, 'FMA7101', 'FMA7088'), true);
  assert.equal(isSubsetOf(map, 'FMA7088', 'FMA7101'), false);
});

test('an unknown concept resolves to nothing rather than throwing', () => {
  const map = parseElementMap(ELEMENTS);
  assert.deepEqual(resolveElements(map, ['FMA999999']), []);
  assert.equal(isSubsetOf(map, 'FMA999999', 'FMA7088'), false);
});

test('elements claimed by a hotspot leave the rest group', () => {
  const map = parseElementMap(ELEMENTS);
  const groups = groupElements(map, {
    concepts: ['FMA7088'],
    hotspots: [{ id: 'left-ventricle', fmaId: 'FMA7101' }],
  });

  assert.deepEqual(groups, [
    { group: 'left-ventricle', elements: ['FJ2418', 'FJ2419'] },
    { group: 'rest', elements: ['FJ2417'] },
  ]);
});

test('an organ with no hotspots is a single rest group', () => {
  const map = parseElementMap(ELEMENTS);
  const groups = groupElements(map, { concepts: ['FMA7088'], hotspots: [] });
  assert.deepEqual(groups, [{ group: 'rest', elements: ['FJ2417', 'FJ2418', 'FJ2419'] }]);
});

test('a hotspot claiming nothing is rejected rather than emitting an empty node', () => {
  const map = parseElementMap(ELEMENTS);
  assert.throws(
    () => groupElements(map, { concepts: ['FMA7088'], hotspots: [{ id: 'bogus', fmaId: 'FMA999999' }] }),
    /bogus/,
  );
});

test('an element claimed by two hotspots lands in the first-listed one, and both groups stay non-empty', (t) => {
  // Mirrors a real atlas shape: a boundary mesh (FJ2418) that two adjacent structures
  // both list, the way BodyParts3D assigns valve-boundary faces to both chambers. The
  // shared element must go to whichever hotspot is listed first, not vanish or throw.
  const warn = t.mock.method(console, 'warn', () => {});
  const map = parseElementMap(OVERLAPPING_ELEMENTS);

  const groups = groupElements(map, { concepts: ['FMA7088'], hotspots: OVERLAPPING_HOTSPOTS });

  assert.deepEqual(groups, [
    { group: 'right-atrium', elements: ['FJ2417', 'FJ2418'] },
    { group: 'right-ventricle', elements: ['FJ2419'] },
  ]);

  // The "must not be silent" requirement: a warning naming both hotspots and the shared
  // count has to fire, or the tie-break above is happening invisibly.
  assert.equal(warn.mock.calls.length, 1);
  const [message] = warn.mock.calls[0].arguments;
  assert.match(message, /right-ventricle/);
  assert.match(message, /right-atrium/);
  assert.match(message, /shares 1 element/);
});

test('a hotspot whose elements are entirely claimed by earlier hotspots throws, naming it', (t) => {
  // Mirrors the tricuspid valve: both its elements already belong to the chambers listed
  // before it, so after the tie-break its own claim is empty — that's the real failure,
  // not the sharing itself.
  t.mock.method(console, 'warn', () => {}); // the two pre-claims below are expected overlaps
  const elements = [
    'concept id\tname\telement file id',
    'FMA7088\theart\tFJ2417',
    'FMA7088\theart\tFJ2418',
    'FMA0001\tright-atrium\tFJ2417',
    'FMA0002\tright-ventricle\tFJ2418',
    'FMA0003\ttricuspid-valve\tFJ2417',
    'FMA0003\ttricuspid-valve\tFJ2418',
  ].join('\n');
  const map = parseElementMap(elements);

  assert.throws(
    () =>
      groupElements(map, {
        concepts: ['FMA7088'],
        hotspots: [
          { id: 'right-atrium', fmaId: 'FMA0001' },
          { id: 'right-ventricle', fmaId: 'FMA0002' },
          { id: 'tricuspid-valve', fmaId: 'FMA0003' },
        ],
      }),
    /tricuspid-valve/,
  );
});

test('each element belongs to exactly one group', (t) => {
  // Must run against the overlapping fixture: the non-overlapping one makes disjointness
  // trivially true and would pass even against an implementation with no tie-break at all.
  t.mock.method(console, 'warn', () => {});
  const map = parseElementMap(OVERLAPPING_ELEMENTS);
  const groups = groupElements(map, { concepts: ['FMA7088'], hotspots: OVERLAPPING_HOTSPOTS });
  const all = groups.flatMap((g) => g.elements);
  assert.equal(new Set(all).size, all.length, 'an element appeared in two groups');
});

test('mergeObj threads vertex/normal bases across groups instead of resetting per call', () => {
  // Regression for the cross-group corruption: `main` calls mergeObj once per *group* and
  // concatenates the results into one .obj file, but OBJ v/vn indices are global to the
  // whole file (an `o` line does not reset them). If mergeObj resets its bases to 0 on
  // every call, every group after the first resolves its faces against the wrong vertices.
  const groupA = ['v 0 0 0', 'v 1 0 0', 'vn 0 1 0', 'f 1//1 2//1 1//1'].join('\n');
  const groupB = ['v 2 0 0', 'v 3 0 0', 'v 4 0 0', 'vn 0 0 1', 'f 1//1 2//1 3//1'].join('\n');

  const first = mergeObj([groupA], 'first');
  assert.deepEqual(first.text.split('\n'), [
    'o first',
    'v 0 0 0',
    'v 1 0 0',
    'vn 0 1 0',
    'f 1//1 2//1 1//1',
  ]);
  assert.equal(first.vertexBase, 2);
  assert.equal(first.normalBase, 1);

  const second = mergeObj([groupB], 'second', first.vertexBase, first.normalBase);
  assert.deepEqual(second.text.split('\n'), [
    'o second',
    'v 2 0 0',
    'v 3 0 0',
    'v 4 0 0',
    'vn 0 0 1',
    // Second group's face indices offset by the first group's vertex/normal counts (2, 1).
    'f 3//2 4//2 5//2',
  ]);
  assert.equal(second.vertexBase, 5);
  assert.equal(second.normalBase, 2);
});

test('mergeObj throws on a negative (relative) OBJ index rather than silently corrupting it', () => {
  const part = ['v 0 0 0', 'vn 0 1 0', 'f -1//1'].join('\n');
  assert.throws(() => mergeObj([part], 'g'), /negative/);
});
