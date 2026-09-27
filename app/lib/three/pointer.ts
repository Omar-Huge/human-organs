/**
 * Pointer input for the canvas.
 *
 * Split out of viewer.ts to keep that file inside its size budget. It is a coherent
 * unit: everything here is about turning raw pointer events into two questions —
 * which marker is under the cursor, and did the user click or orbit?
 */

import { Vector2 } from 'three';
import type { Camera, PerspectiveCamera } from 'three';

/** Something under the pointer that can be hovered and clicked: markers, or organs. */
export type Pickable = {
  pick(ndc: Vector2, camera: Camera): string | null;
  /** Returns whether the hovered id actually changed. */
  setHovered(id: string | null): boolean;
};

/**
 * How far the pointer may travel between down and up and still count as a click.
 *
 * OrbitControls and hotspot selection share one surface, so without a threshold an
 * orbit that happens to finish over a marker would select it.
 */
const CLICK_SLOP_PX = 4;

export type PointerControllerOptions = {
  canvas: HTMLCanvasElement;
  camera: PerspectiveCamera;
  /** What the pointer picks from. Swappable with setTarget. */
  hotspots: Pickable;
  /** Called only when the hovered marker actually changes. */
  onHoverChange: (id: string | null) => void;
  /** Called on a click that was not an orbit. Null means "clicked empty space". */
  onSelect: (id: string | null) => void;
};

export class PointerController {
  readonly #options: PointerControllerOptions;
  #target: Pickable;
  #downAt: { x: number; y: number } | null = null;
  #disposed = false;

  constructor(options: PointerControllerOptions) {
    this.#options = options;
    this.#target = options.hotspots;
    const { canvas } = options;
    canvas.addEventListener('pointermove', this.#handleMove);
    canvas.addEventListener('pointerleave', this.#handleLeave);
    canvas.addEventListener('pointerdown', this.#handleDown);
    canvas.addEventListener('pointerup', this.#handleUp);
  }

  /** Points the controller at a different set of pickable things, clearing the hover. */
  setTarget(target: Pickable): void {
    if (target === this.#target) return;
    this.#target.setHovered(null);
    this.#options.canvas.style.cursor = '';
    this.#target = target;
  }

  /** Converts a pointer event to normalised device coordinates on the canvas. */
  #toNdc(event: PointerEvent): Vector2 {
    const rect = this.#options.canvas.getBoundingClientRect();
    return new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  #handleMove = (event: PointerEvent): void => {
    if (this.#disposed) return;
    const { camera, canvas, onHoverChange } = this.#options;
    const hotspots = this.#target;
    const id = hotspots.pick(this.#toNdc(event), camera);
    // Only report when the hover actually changed. Pointer moves fire far faster than
    // frames, and repainting on every one would defeat render-on-demand entirely.
    if (!hotspots.setHovered(id)) return;
    canvas.style.cursor = id ? 'pointer' : '';
    onHoverChange(id);
  };

  #handleLeave = (): void => {
    if (this.#disposed) return;
    const { canvas, onHoverChange } = this.#options;
    if (!this.#target.setHovered(null)) return;
    canvas.style.cursor = '';
    onHoverChange(null);
  };

  #handleDown = (event: PointerEvent): void => {
    this.#downAt = { x: event.clientX, y: event.clientY };
  };

  #handleUp = (event: PointerEvent): void => {
    if (this.#disposed) return;
    const down = this.#downAt;
    this.#downAt = null;
    if (!down) return;

    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) return;

    // Clicking empty space dismisses the callout, which is what a viewer expects and
    // gives the selection an obvious escape hatch alongside Escape.
    this.#options.onSelect(this.#target.pick(this.#toNdc(event), this.#options.camera));
  };

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const { canvas } = this.#options;
    canvas.removeEventListener('pointermove', this.#handleMove);
    canvas.removeEventListener('pointerleave', this.#handleLeave);
    canvas.removeEventListener('pointerdown', this.#handleDown);
    canvas.removeEventListener('pointerup', this.#handleUp);
  }
}
