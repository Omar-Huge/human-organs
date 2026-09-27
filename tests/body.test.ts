/**
 * Body-view tests.
 *
 * The body view reassembles organs that were each centred and scaled on their own, so
 * the thing most worth checking is that the undoing is right: two organs a known
 * distance apart in atlas space must end up that distance apart, relative to each other,
 * after the whole body is fitted. Picking is checked too — the translucent skin encloses
 * everything, and a click must reach the organ behind it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, Box3, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector2, Vector3 } from 'three';

import { normaliseModel } from '../app/lib/three/loaders.ts';
import { BodyScene } from '../app/lib/three/body.ts';
import type { EntityId } from '../app/lib/subject-data.ts';

/** A box of the given size centred at `at`, in atlas-like units, normalised as the loader would. */
function organ(size: number, at: [number, number, number]) {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial());
  mesh.position.set(...at);
  return normaliseModel(mesh);
}

function scene() {
  return new BodyScene([
    { id: 'heart' as EntityId, model: organ(10, [0, 0, 0]) },
    { id: 'brain' as EntityId, model: organ(10, [0, 100, 0]) },
    // Skin: a big shell around both.
    { id: 'skin' as EntityId, model: organ(300, [0, 50, 0]) },
  ]);
}

const centreOf = (body: BodyScene, id: EntityId) =>
  new Box3().setFromObject(body.organ(id)!).getCenter(new Vector3());

test('organs return to their atlas positions relative to one another', () => {
  const body = scene();
  body.group.updateMatrixWorld(true);
  const heart = centreOf(body, 'heart' as EntityId);
  const brain = centreOf(body, 'brain' as EntityId);
  // 100 units apart along y in the atlas; the body is scaled as a whole, so the
  // direction survives exactly and the distance scales with it.
  const gap = brain.clone().sub(heart);
  assert.ok(Math.abs(gap.x) < 1e-6 && Math.abs(gap.z) < 1e-6, `gap ${gap.toArray()}`);
  assert.ok(gap.y > 0);
});

test('the organs, not the skin, are what the camera frames', () => {
  const body = scene();
  body.group.updateMatrixWorld(true);
  const organs = new Box3().setFromObject(body.organs);
  const all = new Box3().setFromObject(body.group);
  assert.ok(organs.getSize(new Vector3()).y < all.getSize(new Vector3()).y);
});

test('a click through the skin picks the organ behind it', () => {
  const body = scene();
  body.group.updateMatrixWorld(true);
  const heart = centreOf(body, 'heart' as EntityId);
  const camera = new PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.set(heart.x, heart.y, heart.z + 5);
  camera.lookAt(heart);
  camera.updateMatrixWorld(true);
  assert.equal(body.pick(new Vector2(0, 0), camera), 'heart');
});

test('a click that only meets skin picks the skin', () => {
  const body = scene();
  body.group.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(38, 1, 0.01, 100);
  // Aimed well to the side of both organs, but still into the skin shell.
  const heart = centreOf(body, 'heart' as EntityId);
  camera.position.set(heart.x + 0.3, heart.y, heart.z + 5);
  camera.lookAt(heart.x + 0.3, heart.y, heart.z);
  camera.updateMatrixWorld(true);
  assert.equal(body.pick(new Vector2(0, 0), camera), 'skin');
});

test('hovering reports changes only, and lights just the hovered organ', () => {
  const body = scene();
  assert.equal(body.setHovered('heart' as EntityId), true);
  assert.equal(body.setHovered('heart' as EntityId), false);
  const glow = (id: EntityId) => {
    let lit = false;
    body.organ(id)!.traverse((node) => {
      const material = (node as Mesh).material as MeshStandardMaterial | undefined;
      if (material?.emissive && material.emissive.getHex() !== 0) lit = true;
    });
    return lit;
  };
  assert.equal(glow('heart' as EntityId), true);
  assert.equal(glow('brain' as EntityId), false);
  body.setHovered(null);
  assert.equal(glow('heart' as EntityId), false);
});

test('dispose releases only what the body view created, not the shared organ geometry', () => {
  const heart = organ(10, [0, 0, 0]);
  const body = new BodyScene([{ id: 'heart' as EntityId, model: heart }]);
  let disposed = false;
  const mesh = heart.object.children[0] as Mesh;
  mesh.geometry.addEventListener('dispose', () => (disposed = true));
  body.dispose();
  assert.equal(disposed, false);
});
