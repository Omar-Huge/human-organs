/**
 * Entity-switch cross-fade.
 *
 * Split out of viewer.ts when that file passed its 700-line budget. It is a good seam:
 * the fade owns exactly one thing — the model on its way out — and the viewer needs
 * only to ask whether it is still running and hand it a frame to draw.
 *
 * The naive way to fade a model out is to set opacity on its materials and render
 * normally. That looks wrong: an organ is a shell of many overlapping
 * surfaces, so a semi-transparent pass shows its own backfaces, inner parts, and
 * the far side of every fold — the model appears to turn inside out on the way out.
 *
 * A depth prepass fixes it. Pass one draws depth only, with colour writes disabled,
 * establishing the nearest surface at every pixel. Pass two draws colour with depth
 * writes off, which — since three's default depth function is less-or-equal — shades
 * exactly the surfaces the prepass recorded and nothing behind them. The result reads
 * as one solid object dissolving, which is what a viewer expects.
 */

import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';

import type { LoadedModel } from './loaders.ts';

/** Cross-fade duration when switching entities. */
export const FADE_MS = 420;

export type FadeFrame = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  /** The arriving model, hidden while the outgoing one is drawn. */
  incoming: Object3D | null;
};

export class CrossFade {
  #outgoing: LoadedModel | null = null;
  #startedAt = 0;

  get active(): boolean {
    return this.#outgoing !== null;
  }

  get outgoing(): LoadedModel | null {
    return this.#outgoing;
  }

  /** Puts a model into the retiring state and starts the clock. */
  begin(model: LoadedModel, now: number): void {
    this.#outgoing = model;
    this.#startedAt = now;

    // `transparent` is the only property here that forces a shader recompile, so it is
    // set once at the start rather than toggled per pass.
    for (const material of model.materials) {
      material.transparent = true;
      material.needsUpdate = true;
    }
  }

  /**
   * Clears the fade and hands back the model that was retiring, so the caller can
   * release its cache reference. Returns null if nothing was fading.
   */
  end(): LoadedModel | null {
    const outgoing = this.#outgoing;
    if (outgoing) outgoing.object.visible = true;
    this.#outgoing = null;
    return outgoing;
  }

  /**
   * Draws one frame of the fade. Returns true when the fade has finished, so the
   * caller can retire the model.
   */
  render(frame: FadeFrame, now: number): boolean {
    const outgoing = this.#outgoing;
    if (!outgoing) return true;

    const { renderer, scene, camera, incoming } = frame;
    const progress = Math.min(1, (now - this.#startedAt) / FADE_MS);

    // Pass 1: the incoming model and the rest of the scene, outgoing withheld.
    outgoing.object.visible = false;
    renderer.autoClear = true;
    renderer.render(scene, camera);

    // Passes 2 and 3 draw the outgoing model alone, on top of the depth buffer pass 1
    // left behind — so the retiring model is still correctly occluded by the new one.
    outgoing.object.visible = true;
    if (incoming) incoming.visible = false;
    renderer.autoClear = false;

    for (const material of outgoing.materials) {
      material.colorWrite = false;
      material.depthWrite = true;
    }
    renderer.render(scene, camera);

    for (const material of outgoing.materials) {
      material.colorWrite = true;
      material.depthWrite = false;
      material.opacity = 1 - progress;
    }
    renderer.render(scene, camera);

    renderer.autoClear = true;
    if (incoming) incoming.visible = true;

    return progress >= 1;
  }
}
