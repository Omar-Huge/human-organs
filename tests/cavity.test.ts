/**
 * Cavity-shading tests.
 *
 * Folds and grooves — brain sulci, the gaps between loops of intestine — read as
 * realistic mostly because they are darker than the surface around them. cavityShade
 * measures that per vertex from the mesh itself; these check the sign is right: a pit is
 * darkened, a bump is not, and a flat sheet is left alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BufferAttribute, BufferGeometry, PlaneGeometry } from 'three';

import { cavityShade } from '../app/lib/three/cavity.ts';

/** A flat grid with its centre vertex pushed along z by `depth`. */
function dimpled(depth: number) {
  const geometry = new PlaneGeometry(2, 2, 2, 2);
  const position = geometry.getAttribute('position');
  position.setZ(4, depth); // index 4 is the centre of a 3x3 grid
  geometry.computeVertexNormals();
  return geometry;
}

const shadeAt = (geometry: BufferGeometry, index: number) =>
  (geometry.getAttribute('color') as BufferAttribute).getX(index);

test('a flat surface keeps full brightness', () => {
  const geometry = new PlaneGeometry(2, 2, 2, 2);
  cavityShade(geometry, 1);
  assert.ok(Math.abs(shadeAt(geometry, 4) - 1) < 1e-6);
});

test('a pit is darker than the surface around it', () => {
  const geometry = dimpled(-0.5);
  cavityShade(geometry, 1);
  assert.ok(shadeAt(geometry, 4) < 0.95, `pit shade ${shadeAt(geometry, 4)}`);
});

test('a bump is not darkened', () => {
  const geometry = dimpled(0.5);
  cavityShade(geometry, 1);
  assert.ok(shadeAt(geometry, 4) >= 0.999, `bump shade ${shadeAt(geometry, 4)}`);
});

test('strength 0 leaves every vertex at full brightness', () => {
  const geometry = dimpled(-0.5);
  cavityShade(geometry, 0);
  assert.ok(Math.abs(shadeAt(geometry, 4) - 1) < 1e-6);
});

test('works on non-indexed geometry by welding shared positions', () => {
  const geometry = dimpled(-0.5).toNonIndexed();
  geometry.computeVertexNormals();
  cavityShade(geometry, 1);
  const shades = (geometry.getAttribute('color') as BufferAttribute).array;
  assert.ok(Math.min(...Array.from(shades)) < 0.95);
});
