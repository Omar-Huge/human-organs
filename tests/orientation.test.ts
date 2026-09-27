/**
 * Orientation tests.
 *
 * BodyParts3D is Z-up (z is height in millimetres, front is -y); glTF and the viewer
 * are Y-up. build-organs converts the geometry, and derived hotspot centroids must be
 * converted the same way or every marker lands beside the structure it names.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanObj, computePartCentroids, parseVertices } from '../scripts/build-organs.mjs';

// One element high up (head), one low down (feet), one out front.
const vertexMap = new Map([
  ['top', [0, 0, 100]],
  ['bottom', [0, 0, -100]],
  ['front', [0, -100, 0]],
]);
const groups = [
  { group: 'top', elements: ['top'] },
  { group: 'bottom', elements: ['bottom'] },
  { group: 'front', elements: ['front'] },
];

// build-organs is plain JS, so its return type has to be stated here.
type Centroids = Record<string, { centroid: number[] }>;
const centroids = () => computePartCentroids(vertexMap, groups) as Centroids;

test('atlas height becomes viewer +y', () => {
  const result = centroids();
  assert.ok(result.top.centroid[1] > 0.9, `top centroid ${result.top.centroid}`);
  assert.ok(result.bottom.centroid[1] < -0.9, `bottom centroid ${result.bottom.centroid}`);
});

test("the atlas front (-y) faces the viewer's default camera (+z)", () => {
  const result = centroids();
  assert.ok(result.front.centroid[2] > 0.4, `front centroid ${result.front.centroid}`);
});

// The atlas scatters specks — triangles a hundredth of a millimetre across — away from
// the surface they belong to (the eyeball has some where the other eye would be). They
// draw nothing but still widen the bounding box the viewer frames and centres on.
test('cleanObj drops speck faces and the vertices only they used', () => {
  const text = [
    '# header',
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0', // a real triangle
    'v 50 0 0', 'v 50 0 0', 'v 50 0.01 0', // a stray speck, not quite zero-area
    'vn 0 0 1', 'vn 0 0 1', 'vn 0 0 1', 'vn 0 0 1', 'vn 0 0 1', 'vn 0 0 1',
    'f 1//1 2//2 3//3',
    'f 4//4 5//5 6//6',
  ].join('\n');

  const cleaned = cleanObj(text);
  const xs = parseVertices(cleaned).filter((_, i) => i % 3 === 0);
  assert.deepEqual(xs, [0, 1, 0]);
  assert.deepEqual(
    cleaned.split('\n').filter((line) => line.startsWith('f ')),
    ['f 1//1 2//2 3//3'],
  );
  assert.equal(cleaned.split('\n').filter((line) => line.startsWith('vn ')).length, 3);
});

test('cleanObj renumbers faces after dropping vertices ahead of them', () => {
  const text = [
    'v 9 9 9', 'v 9 9 9', 'v 9 9 9',
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
    'f 1 2 3',
    'f 4 5 6',
  ].join('\n');
  const cleaned = cleanObj(text);
  assert.deepEqual(cleaned.split('\n').filter((line) => line.startsWith('f ')), ['f 1 2 3']);
  assert.deepEqual(parseVertices(cleaned), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('cleanObj keeps small triangles that are part of a larger surface', () => {
  // A 0.02 mm triangle sharing a vertex with a 10 mm one: fine detail, not a speck.
  const text = [
    'v 0 0 0', 'v 10 0 0', 'v 0 10 0',
    'v 0.02 0 0', 'v 0 0.02 0',
    'f 1 2 3',
    'f 1 4 5',
  ].join('\n');
  const faces = cleanObj(text).split('\n').filter((line) => line.startsWith('f '));
  assert.equal(faces.length, 2);
});
