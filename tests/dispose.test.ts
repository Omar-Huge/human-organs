/**
 * Teardown tests.
 *
 * These run in Node with no GPU, which shapes what they can assert. three.js only
 * increments renderer.info.memory when a resource is uploaded to a real WebGL context,
 * so that counter is unavailable here and is asserted in the browser instead (Phase 7
 * Playwright suite, which reads Viewer.stats()).
 *
 * What runs here is the part that actually breaks: ownership. Every leak in a three.js
 * app traces back to a resource nobody disposed, and that is a scene-graph question,
 * not a GPU one. These tests build a realistic subtree — shared materials, shared
 * textures, nested groups — and prove the teardown path reaches all of it exactly once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Texture,
  Vector3,
} from 'three';

import { DisposalRegistry, disposeObject3D, texturesOf } from '../app/lib/three/dispose.ts';
import { MODEL_FIT_SIZE, normaliseModel } from '../app/lib/three/loaders.ts';

type Disposable = { dispose: () => void };

/** Wraps dispose() to count calls without changing behaviour. */
function countDisposals(target: Disposable, counter: Map<object, number>): void {
  const original = target.dispose.bind(target);
  target.dispose = () => {
    counter.set(target, (counter.get(target) ?? 0) + 1);
    original();
  };
}

test('DisposalRegistry disposes everything it tracks and then holds nothing', () => {
  const registry = new DisposalRegistry();
  const counter = new Map<object, number>();

  const items = [new BoxGeometry(), new SphereGeometry(), new MeshStandardMaterial()];
  for (const item of items) {
    countDisposals(item, counter);
    registry.track(item);
  }

  assert.equal(registry.size, 3);
  const failures = registry.disposeAll();

  assert.deepEqual(failures, []);
  assert.equal(registry.size, 0, 'registry still holds resources after disposeAll');
  for (const item of items) {
    assert.equal(counter.get(item), 1, 'each tracked resource disposes exactly once');
  }
});

test('DisposalRegistry.track returns its argument so it can wrap an expression', () => {
  const registry = new DisposalRegistry();
  const geometry = new BoxGeometry();
  assert.equal(registry.track(geometry), geometry);
  registry.disposeAll();
});

test('DisposalRegistry.release drops a resource without disposing it', () => {
  const registry = new DisposalRegistry();
  const counter = new Map<object, number>();
  const geometry = new BoxGeometry();
  countDisposals(geometry, counter);

  registry.track(geometry);
  registry.release(geometry);
  registry.disposeAll();

  assert.equal(registry.size, 0);
  assert.equal(counter.get(geometry), undefined, 'released resource must not be disposed');
  geometry.dispose();
});

test('one throwing resource does not strand the rest', () => {
  const registry = new DisposalRegistry();
  const counter = new Map<object, number>();

  const good = new BoxGeometry();
  countDisposals(good, counter);

  registry.track({
    dispose() {
      throw new Error('simulated driver failure');
    },
  });
  registry.track(good);

  const failures = registry.disposeAll();

  assert.equal(failures.length, 1);
  assert.match(failures[0]!.message, /simulated driver failure/);
  assert.equal(counter.get(good), 1, 'a failing dispose must not prevent later ones');
  assert.equal(registry.size, 0);
});

test('texturesOf finds every texture slot on a material', () => {
  const material = new MeshStandardMaterial();
  material.map = new Texture();
  material.normalMap = new Texture();
  material.roughnessMap = new Texture();

  const found = texturesOf(material);

  assert.equal(found.length, 3);
  assert.ok(found.includes(material.map));
  assert.ok(found.includes(material.normalMap));
  assert.ok(found.includes(material.roughnessMap));

  for (const texture of found) texture.dispose();
  material.dispose();
});

test('disposeObject3D reaches a nested subtree and disposes shared resources once', () => {
  const counter = new Map<object, number>();

  // Deliberately realistic: one material shared by three meshes, two textures shared
  // by that material, plus a second material used once. This is the shape glTF files
  // actually produce, and naive teardown disposes the shared material three times.
  const sharedMaterial = new MeshStandardMaterial();
  sharedMaterial.map = new Texture();
  sharedMaterial.normalMap = new Texture();
  const loneMaterial = new MeshStandardMaterial();

  const geometries = [new BoxGeometry(), new BoxGeometry(), new SphereGeometry(), new BoxGeometry()];

  const root = new Group();
  const inner = new Group();
  root.add(inner);

  root.add(new Mesh(geometries[0], sharedMaterial));
  inner.add(new Mesh(geometries[1], sharedMaterial));
  inner.add(new Mesh(geometries[2], sharedMaterial));
  inner.add(new Mesh(geometries[3], loneMaterial));

  for (const item of [sharedMaterial, loneMaterial, ...geometries]) {
    countDisposals(item, counter);
  }
  const textures = texturesOf(sharedMaterial);
  for (const texture of textures) countDisposals(texture, counter);

  const parent = new Object3D();
  parent.add(root);

  disposeObject3D(root);

  for (const geometry of geometries) {
    assert.equal(counter.get(geometry), 1, 'every geometry disposes exactly once');
  }
  assert.equal(counter.get(sharedMaterial), 1, 'a shared material must not be disposed per-mesh');
  assert.equal(counter.get(loneMaterial), 1);
  for (const texture of textures) {
    assert.equal(counter.get(texture), 1, 'textures on a shared material dispose once');
  }

  assert.equal(root.parent, null, 'disposed subtree must detach from its parent');
  assert.equal(root.children.length, 0, 'disposed subtree must release its children');
  assert.equal(parent.children.length, 0);
});

test('mount → load → unmount → remount leaves nothing tracked', () => {
  // Stands in for the Strict Mode double-mount: build, tear down, build again, tear
  // down again. A registry that ends non-empty either way is a leak.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const registry = new DisposalRegistry();
    const model = new Group();
    const material = new MeshStandardMaterial();
    material.map = new Texture();

    for (let i = 0; i < 5; i += 1) {
      model.add(new Mesh(new BoxGeometry(), material));
    }
    registry.track({ dispose: () => disposeObject3D(model) });

    assert.equal(registry.size, 1);
    assert.deepEqual(registry.disposeAll(), []);
    assert.equal(registry.size, 0, `cycle ${cycle}: registry not drained`);
    assert.equal(model.children.length, 0, `cycle ${cycle}: model still holds children`);
  }
});

test('normaliseModel centres on the origin and fits the constant cube', () => {
  const mesh = new Mesh(new BoxGeometry(40, 10, 20), new MeshStandardMaterial());
  // Offset far from the origin — atlas models sit wherever they fall in the body's
  // coordinate space, not centred on anything in particular.
  mesh.position.set(137, -42, 9);

  const { object, scale, radius } = normaliseModel(mesh);

  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());

  const largest = Math.max(size.x, size.y, size.z);
  assert.ok(
    Math.abs(largest - MODEL_FIT_SIZE) < 1e-6,
    `widest axis is ${largest}, expected ${MODEL_FIT_SIZE}`,
  );
  for (const axis of [centre.x, centre.y, centre.z]) {
    assert.ok(Math.abs(axis) < 1e-6, `model centre is off origin: ${centre.x},${centre.y},${centre.z}`);
  }
  assert.ok(Math.abs(scale - MODEL_FIT_SIZE / 40) < 1e-9, 'scale factor is wrong');
  assert.ok(radius > 0 && Number.isFinite(radius), 'radius must be a positive finite number');

  disposeObject3D(object);
});

test('normaliseModel survives a degenerate model instead of producing Infinity', () => {
  const empty = new Object3D();
  const { scale, radius } = normaliseModel(empty);

  assert.ok(Number.isFinite(scale), 'scale must stay finite for an empty model');
  assert.equal(scale, 1, 'degenerate models fall back to scale 1');
  assert.ok(Number.isFinite(radius), 'radius must stay finite for an empty model');
});
