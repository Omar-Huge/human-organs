/**
 * Asset manager: decoders, normalisation, an LRU cache, in-flight deduplication and
 * prefetch-on-intent.
 *
 * The cache holds *parsed* models, not bytes. Parsing a glTF is the expensive half of
 * a switch — the browser's HTTP cache already handles the bytes — so keeping a small
 * number of live scene graphs is what makes going back to a previously viewed
 * organ instant.
 *
 * Lifetime is reference-counted rather than "whatever is on screen". During a
 * cross-fade two models are live at once, and a naive LRU would happily dispose the
 * one still being drawn.
 */

import { Box3, Group, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { disposeObject3D } from './dispose.ts';

/**
 * Edge length of the cube every model is fitted into at load time.
 *
 * This constant is the contract that lets hotspot coordinates in subject-data.ts be
 * authored by hand and mean the same thing on every model. The raw glTF files differ
 * wildly in scale — some are authored in metres, some in centimetres, some in
 * arbitrary units — so without a normalisation step a coordinate would be meaningless
 * across entities. Fitted models span roughly -1..1 on their widest axis.
 *
 * Changing this invalidates every authored hotspot position.
 */
export const MODEL_FIT_SIZE = 2;

/** How many parsed models stay resident. Three covers a back-and-forth comparison. */
const CACHE_CAPACITY = 3;

export type NormalisedModel = {
  object: Object3D;
  /** Uniform scale factor applied, useful for sizing markers in world units. */
  scale: number;
  /** Radius of the fitted model's bounding sphere, for framing the camera. */
  radius: number;
  /**
   * Where the model's bounding-box centre sat in its own glTF units before centring.
   * Every organ shares the atlas's coordinate space, so this is what lets the body view
   * put them back where they belong relative to one another.
   */
  centre: Vector3;
};

export type LoadedModel = NormalisedModel & {
  url: string;
  /** Every distinct material in the subtree, collected once so the fade can mutate them. */
  materials: Material[];
};

/**
 * The material properties a cross-fade mutates.
 *
 * Cached models are handed out repeatedly, and a fade leaves its materials
 * half-transparent with depth writing off. Without restoring this snapshot on every
 * acquire, the second viewing of an organ renders as a ghost — a bug that only
 * appears on the third or fourth entity switch, which is exactly the kind that ships.
 */
type MaterialSnapshot = {
  material: Material;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
};

type CacheEntry = {
  model: LoadedModel;
  snapshots: MaterialSnapshot[];
};

/**
 * A least-recently-used cache whose entries can be pinned by outstanding references.
 *
 * Split out from ModelLoader because this is the part with the subtle policy — and
 * the only part that can be tested without a GPU, a network, or a glTF file. The
 * reference counting is what a plain LRU gets wrong here: during a cross-fade two
 * models are live simultaneously, and evicting on recency alone would dispose the one
 * still being drawn, mid-frame.
 */
export class RefCountedCache<T> {
  /** Insertion-ordered, so the first key is the least recently used. */
  readonly #entries = new Map<string, { value: T; refCount: number }>();

  readonly capacity: number;
  readonly onEvict: (value: T) => void;

  // Written out rather than declared as constructor parameter properties: those emit
  // assignments, and Node's strip-only TypeScript support — which is what runs the
  // test suite — rejects any syntax that is not purely erasable.
  constructor(capacity: number, onEvict: (value: T) => void) {
    this.capacity = capacity;
    this.onEvict = onEvict;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  /** Reads without affecting recency. */
  peek(key: string): T | undefined {
    return this.#entries.get(key)?.value;
  }

  /** Takes a reference and marks the entry most-recently-used. */
  acquire(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    entry.refCount += 1;
    return entry.value;
  }

  /**
   * Adds an unreferenced entry, then trims to capacity.
   *
   * The new entry is protected from this trim. Without that, inserting while every
   * older entry is pinned evicts the newcomer immediately — and the caller is handed
   * back a value that has already been disposed.
   */
  insert(key: string, value: T): void {
    this.#entries.set(key, { value, refCount: 0 });
    this.#trim(key);
  }

  /** Drops a reference. Never goes below zero, so a stray release is harmless. */
  release(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    this.#trim();
  }

  refCount(key: string): number {
    return this.#entries.get(key)?.refCount ?? 0;
  }

  get size(): number {
    return this.#entries.size;
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  /** Evicts everything regardless of references. Only valid during teardown. */
  clear(): void {
    for (const entry of this.#entries.values()) this.onEvict(entry.value);
    this.#entries.clear();
  }

  /**
   * Evicts least-recently-used unreferenced entries until at capacity.
   *
   * Referenced entries are skipped rather than counted as evictable, so the cache can
   * legitimately exceed its capacity while several models are pinned. That is the
   * correct trade: briefly holding one model too many is survivable, disposing a model
   * that is still on screen is not.
   */
  #trim(protectedKey?: string): void {
    if (this.#entries.size <= this.capacity) return;
    for (const [key, entry] of this.#entries) {
      if (this.#entries.size <= this.capacity) break;
      if (entry.refCount > 0 || key === protectedKey) continue;
      this.#entries.delete(key);
      this.onEvict(entry.value);
    }
  }
}

export function normaliseModel(object: Object3D): NormalisedModel {
  // The model goes inside a wrapper rather than being transformed in place. Writing
  // the centring offset onto the model's own position would *overwrite* whatever
  // transform the glTF author already put there, which silently mis-centres any model
  // not authored at the origin. Separating the two concerns — the model keeps its own
  // transform, the wrapper carries normalisation — makes both composable.
  const wrapper = new Group();
  wrapper.name = 'normalised-model';
  wrapper.add(object);
  wrapper.updateMatrixWorld(true);

  const box = new Box3().setFromObject(object);
  const isEmpty = box.isEmpty();
  const size = isEmpty ? new Vector3() : box.getSize(new Vector3());
  const centre = isEmpty ? new Vector3() : box.getCenter(new Vector3());

  const largestAxis = Math.max(size.x, size.y, size.z);
  // A degenerate or empty model would produce Infinity here; fall back to 1 so a bad
  // asset renders wrong rather than taking the whole scene graph with it.
  const scale = largestAxis > 0 && Number.isFinite(largestAxis) ? MODEL_FIT_SIZE / largestAxis : 1;

  object.position.sub(centre);
  wrapper.scale.setScalar(scale);
  wrapper.updateMatrixWorld(true);

  const fitted = new Box3().setFromObject(wrapper);
  const radius = fitted.isEmpty() ? 0 : fitted.getSize(new Vector3()).length() / 2;

  return { object: wrapper, scale, radius, centre };
}

/** Collects the distinct materials in a subtree, in traversal order. */
export function collectMaterials(root: Object3D): Material[] {
  const seen = new Set<Material>();
  root.traverse((node) => {
    const mesh = node as Object3D & { material?: Material | Material[] };
    if (Array.isArray(mesh.material)) {
      for (const entry of mesh.material) seen.add(entry);
    } else if (mesh.material) {
      seen.add(mesh.material);
    }
  });
  return [...seen];
}

function snapshot(materials: Material[]): MaterialSnapshot[] {
  return materials.map((material) => ({
    material,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    colorWrite: material.colorWrite,
  }));
}

function restore(snapshots: MaterialSnapshot[]): void {
  for (const entry of snapshots) {
    entry.material.opacity = entry.opacity;
    entry.material.transparent = entry.transparent;
    entry.material.depthWrite = entry.depthWrite;
    entry.material.colorWrite = entry.colorWrite;
    entry.material.needsUpdate = true;
  }
}

export class ModelLoader {
  readonly #gltf: GLTFLoader;
  readonly #draco: DRACOLoader;

  readonly #cache = new RefCountedCache<CacheEntry>(CACHE_CAPACITY, (entry) =>
    // Full disposal, not just a map delete — the whole point of the cache is that it
    // holds GPU resources, and dropping the reference would leak every one of them.
    disposeObject3D(entry.model.object),
  );
  readonly #inflight = new Map<string, Promise<CacheEntry>>();
  readonly #prefetched = new Set<string>();

  /** Runs once per parse, before materials are collected — see the constructor. */
  readonly #prepare?: (object: Object3D, url: string) => void;

  #disposed = false;

  /**
   * `prepare` may swap a freshly parsed model's materials. It runs before the fade's
   * material snapshot is taken, so whatever it installs is what the cache restores.
   */
  constructor(prepare?: (object: Object3D, url: string) => void) {
    this.#prepare = prepare;
    this.#draco = new DRACOLoader();
    // Decoder binaries are copied out of three's distribution into /public/draco by
    // `npm run sync:decoders`, so the app never reaches out to a CDN at runtime.
    this.#draco.setDecoderPath('/draco/');

    this.#gltf = new GLTFLoader();
    this.#gltf.setDRACOLoader(this.#draco);
    this.#gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /**
   * Warms the browser's HTTP cache for a model that the user has signalled interest in
   * but not yet chosen.
   *
   * Fired on pointerenter and focus. Deliberately fetch() rather than a parse: the
   * point is to have the bytes local by the time a click lands, without spending main
   * thread time parsing a model that may never be shown. Low priority so it cannot
   * contend with the model actually being displayed.
   */
  prefetch(url: string): void {
    if (this.#disposed) return;
    if (this.#prefetched.has(url) || this.#cache.has(url) || this.#inflight.has(url)) return;
    this.#prefetched.add(url);

    const init: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {
      priority: 'low',
      credentials: 'same-origin',
    };
    // A failed prefetch is not an error worth surfacing — the real load will report it.
    void fetch(url, init).catch(() => this.#prefetched.delete(url));
  }

  /**
   * Returns a parsed model and takes a reference on it. Every acquire must be paired
   * with a release, or the cache will never evict.
   */
  async acquire(url: string, signal?: AbortSignal): Promise<LoadedModel> {
    if (this.#disposed) throw new Error('ModelLoader has been disposed');

    const cached = this.#cache.acquire(url);
    if (cached) {
      restore(cached.snapshots);
      return cached.model;
    }

    // Deduplicate concurrent requests for the same URL. Without this, a user clicking
    // the same library row twice — or hovering then clicking — parses the file twice
    // and leaks one of the results.
    let pending = this.#inflight.get(url);
    if (!pending) {
      pending = this.#parse(url);
      this.#inflight.set(url, pending);
    }

    await pending;

    if (signal?.aborted) {
      // The entry sits in the cache unreferenced; the next trim will collect it.
      throw new DOMException('Model load aborted', 'AbortError');
    }

    const entry = this.#cache.acquire(url);
    if (!entry) throw new Error(`Model evicted before it could be shown: ${url}`);
    restore(entry.snapshots);
    return entry.model;
  }

  /** Drops a reference, allowing the model to be evicted once over capacity. */
  release(url: string): void {
    this.#cache.release(url);
  }

  async #parse(url: string): Promise<CacheEntry> {
    try {
      const gltf = await this.#gltf.loadAsync(url);
      this.#prepare?.(gltf.scene, url);
      const normalised = normaliseModel(gltf.scene);
      const materials = collectMaterials(normalised.object);

      const entry: CacheEntry = {
        model: { ...normalised, url, materials },
        snapshots: snapshot(materials),
      };

      if (this.#disposed) {
        disposeObject3D(entry.model.object);
        throw new Error('ModelLoader has been disposed');
      }

      this.#cache.insert(url, entry);
      return entry;
    } finally {
      this.#inflight.delete(url);
    }
  }

  /** Diagnostics for tests. */
  stats(): { cached: number; inflight: number; prefetched: number } {
    return {
      cached: this.#cache.size,
      inflight: this.#inflight.size,
      prefetched: this.#prefetched.size,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    this.#cache.clear();
    this.#inflight.clear();
    this.#prefetched.clear();
    this.#draco.dispose();
  }
}
