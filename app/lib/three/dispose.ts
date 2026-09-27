/**
 * Teardown helpers.
 *
 * three.js allocates GPU resources that JavaScript's garbage collector cannot reach.
 * A dropped reference to a BufferGeometry does not free the vertex buffer; only an
 * explicit .dispose() does. React Strict Mode double-mounts every effect in
 * development, so a viewer that leaks even slightly will burn through WebGL contexts
 * within a few navigations and the canvas will go blank with no error.
 *
 * The strategy here is a registry rather than ad-hoc cleanup. Every disposable the
 * viewer creates is handed to a DisposalRegistry at creation time, and teardown drains
 * the registry. That inverts the usual failure mode: instead of hoping the teardown
 * function remembers each resource, forgetting to register is the only way to leak,
 * and the registry's size is directly assertable in a test with no GPU present.
 */

import type { BufferGeometry, Material, Object3D, Texture, WebGLRenderTarget } from 'three';

/** Anything three.js exposes a .dispose() on. */
export type Disposable = { dispose: () => void };

export class DisposalRegistry {
  readonly #items = new Set<Disposable>();

  /** Registers a resource and returns it, so it can wrap an expression inline. */
  track<T extends Disposable>(item: T): T {
    this.#items.add(item);
    return item;
  }

  /** Drops a resource without disposing it — used when ownership moves elsewhere. */
  release(item: Disposable): void {
    this.#items.delete(item);
  }

  /** Number of resources still held. Zero after a complete teardown. */
  get size(): number {
    return this.#items.size;
  }

  /**
   * Disposes everything, tolerating individual failures. One throwing material must
   * not strand the remaining resources — a partial teardown is the leak we're trying
   * to prevent.
   */
  disposeAll(): Error[] {
    const failures: Error[] = [];
    for (const item of this.#items) {
      try {
        item.dispose();
      } catch (cause) {
        failures.push(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
    this.#items.clear();
    return failures;
  }
}

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isTexture' in value &&
    (value as { isTexture?: boolean }).isTexture === true
  );
}

/**
 * Collects every texture hanging off a material.
 *
 * Materials expose textures as plain named properties (map, normalMap, aoMap,
 * emissiveMap, and a dozen more that vary by material type and by what the glTF
 * happened to define). Enumerating the object is more robust than maintaining a list
 * of slot names that silently goes stale when three.js adds one.
 */
export function texturesOf(material: Material): Texture[] {
  const found: Texture[] = [];
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (isTexture(value)) found.push(value);
  }
  return found;
}

/** Disposes a material and every texture it references. */
export function disposeMaterial(material: Material): void {
  for (const texture of texturesOf(material)) texture.dispose();
  material.dispose();
}

/**
 * Recursively disposes a subtree's geometries, materials and textures, then detaches
 * it from its parent.
 *
 * Geometries and materials are deduplicated: glTF files routinely share one material
 * across many meshes, and disposing the same material twice is wasteful at best.
 */
export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  root.traverse((node) => {
    const mesh = node as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) {
      for (const entry of mesh.material) materials.add(entry);
    } else if (mesh.material) {
      materials.add(mesh.material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) disposeMaterial(material);

  root.removeFromParent();
  root.clear();
}

/** Disposes a render target and the textures it owns. */
export function disposeRenderTarget(target: WebGLRenderTarget): void {
  target.dispose();
}
