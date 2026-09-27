/**
 * Hotspot geometry tests.
 *
 * Only the pure maths is exercised here — building a HotspotLayer needs a 2D canvas
 * for the marker glyph, so the layer itself belongs to the browser suite. What is
 * tested is the part that is easy to get subtly wrong and impossible to eyeball: the
 * claim that lifting a marker toward the camera changes its depth without changing
 * where it lands on screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { facingOpacity, liftedPosition } from '../app/lib/three/hotspots.ts';

const NORMAL_LIFT = 0.035;

test('a marker facing the camera is at full strength', () => {
  const normal = new Vector3(0, 0, 1);
  const toCamera = new Vector3(0, 0, 1);
  assert.equal(facingOpacity(normal, toCamera), 1);
});

test('a marker facing directly away is fully faded', () => {
  const normal = new Vector3(0, 0, 1);
  const toCamera = new Vector3(0, 0, -1);
  assert.equal(facingOpacity(normal, toCamera), 0);
});

test('facing opacity falls off monotonically as a marker turns away', () => {
  const normal = new Vector3(0, 0, 1);
  let previous = Infinity;

  for (let angle = 0; angle <= Math.PI; angle += Math.PI / 12) {
    const toCamera = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const opacity = facingOpacity(normal, toCamera);
    assert.ok(opacity <= previous + 1e-9, `opacity rose at ${angle} rad: ${opacity} > ${previous}`);
    assert.ok(opacity >= 0 && opacity <= 1, `opacity out of range: ${opacity}`);
    previous = opacity;
  }
});

test('a marker authored at the model centre never fades', () => {
  // A marker at the model centre, [0, 0, 0], has no meaningful outward
  // direction, and the fade must degrade to "always visible" rather than to NaN.
  const degenerate = new Vector3(0, 0, 0);
  for (const direction of [new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(1, 0, 0)]) {
    assert.equal(facingOpacity(degenerate, direction), 1);
  }
});

test('the view-ray lift does not move the marker on screen', () => {
  // This is the whole justification for the technique, so it gets a real assertion
  // rather than a comment. A point moved directly toward the camera stays on the same
  // view ray, so it projects to the same pixel — only its depth changes.
  const base = new Vector3(0.6, 0.2, -0.35);
  const normal = base.clone().normalize();
  const camera = new Vector3(2.4, 1.6, 3.1);

  const afterNormalLift = base.clone().addScaledVector(normal, NORMAL_LIFT);
  const lifted = liftedPosition(base, normal, camera, new Vector3());

  const rayToSurface = afterNormalLift.clone().sub(camera);
  const rayToLifted = lifted.clone().sub(camera);

  // Parallel rays from the camera means an identical screen position.
  const cross = rayToSurface.clone().cross(rayToLifted).length();
  assert.ok(cross < 1e-9, `lift moved the marker off its view ray (cross = ${cross})`);

  // And it moved toward the camera, not away — otherwise it would sink into the mesh.
  assert.ok(
    rayToLifted.length() < rayToSurface.length(),
    'the lifted marker must be nearer the camera than the surface point',
  );
});

test('the lift moves the marker off the surface along its normal', () => {
  const base = new Vector3(0, 1, 0);
  const normal = new Vector3(0, 1, 0);
  const camera = new Vector3(0, 1, 5);

  const lifted = liftedPosition(base, normal, camera, new Vector3());

  assert.ok(lifted.y > base.y, 'marker should sit above the surface it annotates');
  assert.ok(lifted.z > base.z, 'marker should also sit nearer the camera');
});

test('liftedPosition writes into the target vector and returns it', () => {
  // The layer reuses one scratch vector per frame rather than allocating per marker.
  const target = new Vector3(99, 99, 99);
  const result = liftedPosition(
    new Vector3(1, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(4, 0, 0),
    target,
  );

  assert.equal(result, target, 'must return the same object it was given');
  assert.notEqual(target.x, 99, 'target must be overwritten, not appended to');
});
