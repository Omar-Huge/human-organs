/**
 * The body view: every organ at once, where it sits in the body, inside a ghosted skin.
 *
 * All nine organs come from one atlas and share its coordinate space, but the loader
 * centres and scales each model on its own so any one of them fills the viewer. This
 * reverses that per model — each organ's clone goes back to its original centre — and
 * then fits the reassembled body as a whole.
 *
 * Clones share geometry and materials with the loader's cached models, which own them.
 * The only things this creates, and therefore the only things it disposes, are the
 * skin's ghost materials — the skin needs to be see-through here and solid in its own
 * view, so it cannot share.
 */

import { Box3, FrontSide, Group, Raycaster } from 'three';
import type { Camera, Material, Mesh, MeshStandardMaterial, Object3D, Vector2 } from 'three';

import { normaliseModel } from './loaders.ts';
import type { NormalisedModel } from './loaders.ts';
import type { EntityId } from '../subject-data.ts';

const SKIN: EntityId = 'skin';
const SKIN_OPACITY = 0.14;
/** Emissive strength on the hovered organ, in the organ's own colour. */
const HOVER_GLOW = 0.45;

export type BodyEntry = { id: EntityId; model: NormalisedModel };

function isMesh(node: Object3D): node is Mesh {
  return (node as Mesh).isMesh === true;
}

function materialsOf(root: Object3D): MeshStandardMaterial[] {
  const found = new Set<MeshStandardMaterial>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if ((material as MeshStandardMaterial).emissive) found.add(material as MeshStandardMaterial);
    }
  });
  return [...found];
}

export class BodyScene {
  /** The fitted body, ready to add to a scene. */
  readonly group: Group;
  /** Everything but the skin: what the camera frames, since the skin is mostly empty. */
  readonly organs = new Group();
  readonly radius: number;

  readonly #byId = new Map<EntityId, Object3D>();
  readonly #owned: Material[] = [];
  readonly #raycaster = new Raycaster();
  #hovered: EntityId | null = null;

  constructor(entries: BodyEntry[]) {
    const assembly = new Group();
    assembly.add(this.organs);

    for (const { id, model } of entries) {
      // normaliseModel moved the model's root by -centre inside its wrapper; a clone of
      // that root with centre added back sits exactly where the atlas put it.
      const copy = model.object.children[0].clone();
      copy.position.add(model.centre);
      const holder = new Group();
      holder.name = id;
      holder.add(copy);
      this.#byId.set(id, holder);

      if (id === SKIN) {
        this.#ghost(holder);
        assembly.add(holder);
      } else {
        this.organs.add(holder);
      }
    }

    const fitted = normaliseModel(assembly);
    this.group = fitted.object as Group;
    this.group.name = 'body';
    this.radius = fitted.radius;
  }

  organ(id: EntityId): Object3D | undefined {
    return this.#byId.get(id);
  }

  /** The bounding box of the organs alone, in world space. */
  organsBox(): Box3 {
    this.group.updateMatrixWorld(true);
    return new Box3().setFromObject(this.organs);
  }

  /**
   * The organ under the pointer. The skin encloses everything, so it is only the answer
   * when the ray meets nothing else — otherwise no organ could ever be clicked.
   */
  pick(ndc: Vector2, camera: Camera): EntityId | null {
    this.#raycaster.setFromCamera(ndc, camera);
    const hits = this.#raycaster.intersectObject(this.group, true);
    let skin = false;
    for (const hit of hits) {
      const id = this.#entityOf(hit.object);
      if (id === SKIN) skin = true;
      else if (id) return id;
    }
    return skin ? SKIN : null;
  }

  /** Lights the hovered organ. Returns whether anything changed, as HotspotLayer does. */
  setHovered(id: string | null): boolean {
    const next = (id as EntityId | null) ?? null;
    if (next === this.#hovered) return false;
    if (this.#hovered) this.#glow(this.#hovered, false);
    this.#hovered = next;
    if (next) this.#glow(next, true);
    return true;
  }

  get hoveredId(): EntityId | null {
    return this.#hovered;
  }

  dispose(): void {
    if (this.#hovered) this.#glow(this.#hovered, false);
    this.#hovered = null;
    for (const material of this.#owned) material.dispose();
    this.#owned.length = 0;
    this.group.clear();
  }

  #entityOf(node: Object3D | null): EntityId | null {
    for (let current = node; current; current = current.parent) {
      if (this.#byId.get(current.name as EntityId) === current) return current.name as EntityId;
    }
    return null;
  }

  #glow(id: EntityId, on: boolean): void {
    const holder = this.#byId.get(id);
    if (!holder) return;
    for (const material of materialsOf(holder)) {
      if (on) material.emissive.copy(material.color).multiplyScalar(HOVER_GLOW);
      else material.emissive.setHex(0);
    }
  }

  /** Swaps the skin's materials for see-through copies this scene owns. */
  #ghost(holder: Object3D): void {
    const copies = new Map<Material, Material>();
    holder.traverse((node) => {
      if (!isMesh(node)) return;
      const swap = (material: Material) => {
        let copy = copies.get(material);
        if (!copy) {
          copy = material.clone();
          copy.transparent = true;
          copy.opacity = SKIN_OPACITY;
          copy.depthWrite = false;
          copy.side = FrontSide;
          copies.set(material, copy);
          this.#owned.push(copy);
        }
        return copy;
      };
      node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
    });
  }
}

