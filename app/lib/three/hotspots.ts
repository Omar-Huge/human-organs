/**
 * Hotspot marker layer.
 *
 * Markers are billboarded sprites placed in normalised model space (see loaders.ts) at
 * a position resolved by resolveHotspotPosition — a measured mesh centroid for most
 * hotspots, a hand-authored coordinate for skin's. Three things make them read
 * correctly against a complex mesh rather than floating over it like a HUD:
 *
 * 1. They keep depth testing on, so real geometry in front genuinely occludes them.
 *    A marker on the far side of an organ disappears behind it, which is the whole
 *    reason a 3D marker beats an overlay.
 *
 * 2. They are lifted twice — a little along the surface normal, and a little along the
 *    view ray. The view-ray lift is the important one: moving a point directly toward
 *    the camera does not change where it lands on screen, but it does buy depth
 *    clearance, so local surface relief cannot nibble away at the billboard's edges.
 *
 * 3. They fade by facing angle, so a marker wrapping around the silhouette softens out
 *    instead of popping.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Camera, PerspectiveCamera, Texture } from 'three';

import type { EntityId, Hotspot } from '../subject-data.ts';
import { resolveHotspotPosition } from '../hotspot-position.ts';
import { DisposalRegistry } from './dispose.ts';

/** Offset along the approximated surface normal, in normalised model units. */
const NORMAL_LIFT = 0.035;

/** Offset along the view ray. Does not move the marker on screen — only in depth. */
const VIEW_LIFT = 0.06;

/** Marker size as a fraction of its distance from the camera, giving constant screen size. */
const SIZE_FACTOR = 0.055;

/** How long the selection pulse runs before resting. */
export const PULSE_MS = 2600;

const BASE_OPACITY = 0.72;

export type HotspotVisual = {
  hotspot: Hotspot;
  sprite: Sprite;
  /** Authored position, in normalised model space. */
  base: Vector3;
  /** Approximated outward normal — the direction from the model centre to the marker. */
  normal: Vector3;
};

export type Projection = { id: string; x: number; y: number; visible: boolean };

/**
 * Opacity from facing angle.
 *
 * Hotspots carry no normal of their own — they are three authored numbers — so the
 * outward direction is approximated as centre-to-marker. That is a good enough proxy
 * on convex-ish hardware, and it degrades gracefully: a marker authored at the model's
 * centre has no meaningful outward direction, so it simply never fades.
 */
export function facingOpacity(normal: Vector3, toCamera: Vector3): number {
  if (normal.lengthSq() === 0) return 1;
  const facing = normal.dot(toCamera);
  // Full strength when facing the camera, fading out as it turns past the silhouette.
  // The band is deliberately wide so markers dissolve rather than blink.
  return clamp01((facing + 0.35) / 0.75);
}

/** Moves a marker off the surface and toward the camera without changing where it lands. */
export function liftedPosition(
  base: Vector3,
  normal: Vector3,
  cameraPosition: Vector3,
  target: Vector3,
): Vector3 {
  target.copy(base).addScaledVector(normal, NORMAL_LIFT);
  const toCamera = target.clone().sub(cameraPosition).normalize().multiplyScalar(-VIEW_LIFT);
  return target.add(toCamera);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Draws the marker glyph once, shared by every sprite and tinted per hotspot.
 *
 * A ring with a centre dot rather than a filled pin: it reads as a registration mark
 * on a technical drawing, and the hollow centre lets the hardware underneath show
 * through, which keeps the marker feeling attached to the surface.
 */
function createMarkerTexture(): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for hotspot marker');

  const centre = size / 2;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.055;
  ctx.beginPath();
  ctx.arc(centre, centre, size * 0.3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centre, centre, size * 0.1, 0, Math.PI * 2);
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class HotspotLayer {
  readonly group = new Group();

  readonly #registry = new DisposalRegistry();
  readonly #raycaster = new Raycaster();
  readonly #texture: Texture;
  #visuals: HotspotVisual[] = [];

  #hoveredId: string | null = null;
  #selectedId: string | null = null;
  #pulseStartedAt = 0;

  readonly #scratch = new Vector3();
  readonly #toCamera = new Vector3();

  constructor() {
    this.group.name = 'hotspots';
    this.#texture = this.#registry.track(createMarkerTexture());
  }

  /** While a part is isolated, only its marker shows. */
  #only: string | null = null;

  setOnly(id: string | null): void {
    this.#only = id;
  }

  get selectedId(): string | null {
    return this.#selectedId;
  }

  get hoveredId(): string | null {
    return this.#hoveredId;
  }

  /** True while the selection pulse is still animating. */
  isPulsing(now: number): boolean {
    return this.#selectedId !== null && now - this.#pulseStartedAt < PULSE_MS;
  }

  /**
   * Replaces the marker set. Safe to call on every entity switch.
   *
   * Takes `entityId` alongside the hotspots because a `derived` hotspot's position
   * isn't self-contained — it's looked up from the generated sidecar by entity and
   * hotspot id (see resolveHotspotPosition). `authored` hotspots ignore the id.
   */
  setHotspots(entityId: EntityId, hotspots: Hotspot[]): void {
    this.clear();

    for (const hotspot of hotspots) {
      const material = new SpriteMaterial({
        map: this.#texture,
        color: hotspot.color,
        transparent: true,
        opacity: BASE_OPACITY,
        // Depth testing stays ON — that is what makes real geometry occlude a marker
        // on the far side. Depth *writing* stays off so markers never occlude each
        // other or the model.
        depthTest: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      // Not registry-tracked: clear() owns these, because the marker set is replaced
      // on every entity switch while the shared texture outlives all of them.
      const sprite = new Sprite(material);
      sprite.name = `hotspot:${hotspot.id}`;
      sprite.userData.hotspotId = hotspot.id;
      sprite.renderOrder = 10;

      const base = new Vector3(...resolveHotspotPosition(entityId, hotspot));
      // Model space is centred on the origin by normalisation, so the resolved
      // position doubles as the outward direction.
      const normal = base.lengthSq() > 0 ? base.clone().normalize() : new Vector3();

      this.group.add(sprite);
      this.#visuals.push({ hotspot, sprite, base, normal });
    }
  }

  /**
   * Repositions and fades every marker for the current camera.
   *
   * Called once per rendered frame, which — because the render loop is on demand —
   * means it only runs when something actually moved.
   */
  update(camera: PerspectiveCamera, now: number): void {
    for (const visual of this.#visuals) {
      const { sprite, base, normal, hotspot } = visual;

      liftedPosition(base, normal, camera.position, this.#scratch);
      sprite.position.copy(this.#scratch);

      this.#toCamera.copy(camera.position).sub(this.#scratch).normalize();
      const facing = facingOpacity(normal, this.#toCamera);

      const isSelected = hotspot.id === this.#selectedId;
      const isHovered = hotspot.id === this.#hoveredId;

      const distance = camera.position.distanceTo(this.#scratch);
      let scale = distance * SIZE_FACTOR;
      let opacity = this.#only !== null && hotspot.id !== this.#only ? 0 : BASE_OPACITY * facing;

      if (isHovered) {
        scale *= 1.25;
        opacity = Math.min(1, opacity * 1.6);
      }

      if (isSelected) {
        opacity = Math.min(1, opacity * 1.8);
        const elapsed = now - this.#pulseStartedAt;
        if (elapsed < PULSE_MS) {
          // A pulse that decays to nothing. Once it reaches zero the layer stops
          // reporting itself as animating, so the render loop is allowed to idle —
          // an open callout must not hold a frame request open forever.
          const t = elapsed / PULSE_MS;
          const decay = 1 - t;
          scale *= 1 + Math.sin(t * Math.PI * 6) * 0.16 * decay;
        } else {
          scale *= 1.18;
        }
      }

      sprite.scale.setScalar(scale);
      sprite.material.opacity = opacity;
      // Fully faded markers are skipped by the picker as well as the eye.
      sprite.visible = opacity > 0.02;
    }
  }

  /** Returns the id of the marker under a normalised device coordinate, if any. */
  pick(ndc: Vector2, camera: Camera): string | null {
    this.#raycaster.setFromCamera(ndc, camera);
    const targets = this.#visuals.filter((visual) => visual.sprite.visible).map((v) => v.sprite);
    const hits = this.#raycaster.intersectObjects(targets, false);
    const first = hits[0]?.object;
    return typeof first?.userData.hotspotId === 'string' ? first.userData.hotspotId : null;
  }

  /** Returns true if the hover actually changed, so callers can avoid a redraw. */
  setHovered(id: string | null): boolean {
    if (this.#hoveredId === id) return false;
    this.#hoveredId = id;
    return true;
  }

  setSelected(id: string | null, now: number): boolean {
    if (this.#selectedId === id) return false;
    this.#selectedId = id;
    this.#pulseStartedAt = now;
    return true;
  }

  /** Screen position of the selected marker, for anchoring the DOM callout. */
  projectSelected(camera: PerspectiveCamera, width: number, height: number): Projection | null {
    const visual = this.#visuals.find((entry) => entry.hotspot.id === this.#selectedId);
    if (!visual) return null;

    this.#scratch.copy(visual.sprite.position).project(camera);

    return {
      id: visual.hotspot.id,
      x: (this.#scratch.x * 0.5 + 0.5) * width,
      y: (-this.#scratch.y * 0.5 + 0.5) * height,
      // z beyond 1 means behind the camera; the marker's own opacity covers the rest.
      visible: this.#scratch.z < 1 && visual.sprite.visible,
    };
  }

  /** Removes every marker and releases its material. */
  clear(): void {
    for (const visual of this.#visuals) {
      this.group.remove(visual.sprite);
      visual.sprite.material.dispose();
    }
    this.#visuals = [];
    this.#hoveredId = null;
    this.#selectedId = null;
  }

  dispose(): void {
    this.clear();
    this.#registry.disposeAll();
    this.group.removeFromParent();
  }
}
