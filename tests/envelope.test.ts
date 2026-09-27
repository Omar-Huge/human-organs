/**
 * Envelope tests.
 *
 * The lungs' surface is generated, not taken from the atlas, so what is checked is that
 * the generated sheet actually encloses the points it was built around, and that the
 * build measures hotspot centroids in a box that includes it — otherwise the viewer,
 * which fits the whole model, would place every lung marker off by the sheet's margin.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { envelope, trianglesToObj } from '../scripts/envelope.mjs';
import { computePartCentroids, parseVertices } from '../scripts/build-organs.mjs';

/** Points along two parallel rods 8 mm apart — like neighbouring bronchi. */
function rods() {
  const points: number[] = [];
  for (let z = 0; z <= 40; z += 1) points.push(0, 0, z, 8, 0, z);
  return points;
}

test('the envelope encloses its points with a margin', () => {
  const { positions } = envelope(rods(), { radius: 6, resolution: 48 });
  assert.ok(positions.length > 0, 'no surface was produced');
  const xs = positions.filter((_, i) => i % 3 === 0);
  const zs = positions.filter((_, i) => i % 3 === 2);
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 8, 'surface does not wrap both rods');
  assert.ok(Math.min(...zs) < 0 && Math.max(...zs) > 40, 'surface does not cap the ends');
});

test('rods closer than the kernel merge into one sheet', () => {
  const { positions } = envelope(rods(), { radius: 6, resolution: 48 });
  // A single merged sheet crosses the midline between the rods; two separate tubes don't.
  const crossesMidline = positions.some((v, i) => i % 3 === 0 && Math.abs(v - 4) < 1);
  assert.ok(crossesMidline);
});

test('trianglesToObj round-trips vertex positions', () => {
  const surface = envelope(rods(), { radius: 6, resolution: 32 });
  const obj = trianglesToObj(surface);
  assert.equal(parseVertices(obj).length, surface.positions.length);
  const faces = obj.split('\n').filter((line) => line.startsWith('f ')).length;
  assert.equal(faces, surface.positions.length / 9);
});

test('computePartCentroids normalises against extra geometry when given it', () => {
  const vertexMap = new Map([['a', [0, 0, 0, 10, 0, 0]]]);
  const groups = [{ group: 'a', elements: ['a'] }];
  type Centroids = Record<string, { centroid: number[] }>;
  const plain = computePartCentroids(vertexMap, groups) as Centroids;
  assert.equal(plain.a.centroid[0], 0);
  // A surface reaching out to x = -30 moves the box to -30..10: centre -10, scale 2/40,
  // so the element's centroid at x = 5 lands at (5 + 10) * 0.05.
  const wider = computePartCentroids(vertexMap, groups, [-30, 0, 0]) as Centroids;
  assert.ok(Math.abs(wider.a.centroid[0] - 0.75) < 1e-9, `got ${wider.a.centroid[0]}`);
});

test('a detached fragment does not get its own bubble', () => {
  // The two rods, plus a lone point 60 mm below them.
  const points = [...rods(), 4, 0, -60];
  const { positions } = envelope(points, { radius: 6, resolution: 64 });
  const zs = positions.filter((_, i) => i % 3 === 2);
  assert.ok(Math.min(...zs) > -20, `surface reaches down to ${Math.min(...zs)}`);
});
