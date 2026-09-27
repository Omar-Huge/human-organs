/**
 * Asset cache policy tests.
 *
 * RefCountedCache is deliberately generic so this can run in Node with no GPU, no
 * network and no glTF file. What is under test is the eviction policy, which is the
 * part with real consequences: evicting a model that is still being drawn disposes
 * GPU resources mid-frame and blanks the viewer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RefCountedCache, collectMaterials } from '../app/lib/three/loaders.ts';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

/** Builds a cache that records what it evicted, in order. */
function makeCache(capacity: number) {
  const evicted: string[] = [];
  const cache = new RefCountedCache<string>(capacity, (value) => evicted.push(value));
  return { cache, evicted };
}

test('an unreferenced cache evicts least-recently-used first', () => {
  const { cache, evicted } = makeCache(3);

  for (const key of ['a', 'b', 'c']) cache.insert(key, key);
  assert.equal(cache.size, 3);
  assert.deepEqual(evicted, []);

  cache.insert('d', 'd');

  assert.equal(cache.size, 3);
  assert.deepEqual(evicted, ['a'], 'oldest entry should go first');
  assert.deepEqual(cache.keys(), ['b', 'c', 'd']);
});

test('acquiring an entry makes it most-recently-used', () => {
  const { cache, evicted } = makeCache(3);

  for (const key of ['a', 'b', 'c']) cache.insert(key, key);

  // Touch 'a' so it is no longer the eviction candidate, then release the reference so
  // it is still eligible on recency grounds alone.
  cache.acquire('a');
  cache.release('a');

  cache.insert('d', 'd');

  assert.deepEqual(evicted, ['b'], "'a' was touched, so 'b' is now oldest");
  assert.deepEqual(cache.keys(), ['c', 'a', 'd']);
});

test('a referenced entry is never evicted, even when oldest', () => {
  const { cache, evicted } = makeCache(2);

  cache.insert('pinned', 'pinned');
  cache.acquire('pinned');

  cache.insert('b', 'b');
  cache.insert('c', 'c');
  cache.insert('d', 'd');

  assert.ok(cache.has('pinned'), 'a referenced entry must survive eviction pressure');
  assert.ok(!evicted.includes('pinned'));
  assert.equal(cache.refCount('pinned'), 1);
});

test('the cache may exceed capacity while everything is referenced', () => {
  const { cache, evicted } = makeCache(2);

  for (const key of ['a', 'b', 'c', 'd']) {
    cache.insert(key, key);
    cache.acquire(key);
  }

  // This is the correct trade: briefly holding too many models is survivable,
  // disposing one that is still on screen is not.
  assert.equal(cache.size, 4);
  assert.deepEqual(evicted, []);
});

test('releasing the last reference makes an entry evictable again', () => {
  const { cache, evicted } = makeCache(1);

  cache.insert('a', 'a');
  cache.acquire('a');
  cache.insert('b', 'b');

  assert.equal(cache.size, 2, "'a' is pinned so 'b' cannot displace it");

  cache.release('a');

  assert.deepEqual(evicted, ['a'], 'release triggers the deferred eviction');
  assert.equal(cache.size, 1);
});

test('nested references need matching releases', () => {
  const { cache, evicted } = makeCache(1);

  // A cross-fade back to the model already displayed takes a second reference.
  cache.insert('a', 'a');
  cache.acquire('a');
  cache.acquire('a');
  assert.equal(cache.refCount('a'), 2);

  cache.insert('b', 'b');
  cache.release('a');

  // 'b' is legitimately evictable here — it is unreferenced and the cache is over
  // capacity. The claim under test is only about 'a'.
  assert.ok(!evicted.includes('a'), 'one release is not enough to unpin');
  assert.equal(cache.refCount('a'), 1);
  assert.ok(cache.has('a'));

  cache.release('a');
  assert.equal(cache.refCount('a'), 0);

  // Unreferenced means *evictable*, not evicted — an idle entry stays cached until
  // something actually needs the room. Create that pressure to prove it is no longer
  // pinned.
  cache.insert('c', 'c');

  assert.ok(evicted.includes('a'), 'the matching release makes it evictable');
  assert.ok(!cache.has('a'));
});

test('a stray release cannot drive the count negative', () => {
  const { cache } = makeCache(4);
  cache.insert('a', 'a');

  cache.release('a');
  cache.release('a');

  assert.equal(cache.refCount('a'), 0);
  assert.ok(cache.has('a'));
});

test('release of an unknown key is a no-op', () => {
  const { cache, evicted } = makeCache(2);
  cache.release('never-inserted');
  assert.equal(cache.size, 0);
  assert.deepEqual(evicted, []);
});

test('peek reads without disturbing recency', () => {
  const { cache, evicted } = makeCache(2);

  cache.insert('a', 'a');
  cache.insert('b', 'b');
  cache.peek('a');
  cache.insert('c', 'c');

  assert.deepEqual(evicted, ['a'], 'peek must not count as a use');
});

test('clear disposes everything, references or not', () => {
  const { cache, evicted } = makeCache(3);

  cache.insert('a', 'a');
  cache.insert('b', 'b');
  cache.acquire('b');

  cache.clear();

  assert.equal(cache.size, 0);
  assert.deepEqual(evicted.sort(), ['a', 'b'], 'teardown ignores references');
});

test('collectMaterials deduplicates materials shared across meshes', () => {
  const shared = new MeshStandardMaterial();
  const lone = new MeshStandardMaterial();

  const root = new Group();
  const inner = new Group();
  root.add(inner);
  root.add(new Mesh(new BoxGeometry(), shared));
  inner.add(new Mesh(new BoxGeometry(), shared));
  inner.add(new Mesh(new BoxGeometry(), lone));

  const materials = collectMaterials(root);

  assert.equal(materials.length, 2, 'a material used three times must appear once');
  assert.ok(materials.includes(shared));
  assert.ok(materials.includes(lone));

  shared.dispose();
  lone.dispose();
});
