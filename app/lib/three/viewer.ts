/**
 * The 3D viewer.
 *
 * This is a plain TypeScript class, not a React component tree. React owns state and
 * chrome; this owns the canvas. See ARCHITECTURE.md for the reasoning — briefly, a
 * scene graph is long-lived mutable state with an imperative lifecycle, and modelling
 * it as reconciled components means fighting the reconciler for control of object
 * identity on every render.
 *
 * The central contract is RENDER ON DEMAND. There is no permanent animation frame
 * loop. A frame is drawn only when something has actually changed, and the loop stops
 * entirely when the canvas is off-screen or the tab is hidden. `drawCount` is exposed
 * so this is testable rather than merely claimed.
 */

import {
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { WebGLRenderTarget } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';

import { CrossFade, FADE_MS } from './crossfade.ts';
import { DisposalRegistry, disposeObject3D } from './dispose.ts';
import { HotspotLayer, PULSE_MS } from './hotspots.ts';
import type { Projection } from './hotspots.ts';
import { ModelLoader, MODEL_FIT_SIZE } from './loaders.ts';
import { PointerController } from './pointer.ts';
import { applyTissue, setHighlight, setIsolated } from './tint.ts';
import { cavityShade } from './cavity.ts';
import { paletteForModel } from '../tissue.ts';
import type { LoadedModel, NormalisedModel } from './loaders.ts';
import type { EntityId, Hotspot } from '../subject-data.ts';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ViewerOptions = {
  /**
   * Element the viewer renders into. The Viewer creates and owns the canvas itself
   * and appends it here.
   *
   * This is deliberate rather than accepting a canvas from React. A canvas element can
   * only ever hand out one WebGL context; once that context is lost — which teardown
   * forces, to release it promptly — the same element can never produce another. React
   * Strict Mode double-mounts every effect in development, so a canvas owned by React
   * and reused across two Viewer instances gives the second instance a dead context and
   * a null-dereference crash. Owning the element makes lifetime match the context.
   */
  container: HTMLElement;
  onStatusChange?: (status: ViewerStatus, detail?: string) => void;
  /** Fires when the selected hotspot changes, including when cleared. */
  onHotspotSelect?: (id: string | null) => void;
  /** Fires when the hovered hotspot changes, for cursor affordance. */
  onHotspotHover?: (id: string | null) => void;
  /**
   * Screen position of the selected marker, emitted after every rendered frame.
   *
   * This fires at frame rate while the camera moves, so consumers must apply it
   * imperatively — routing it through React state would re-render the tree on every
   * frame of an orbit.
   */
  onHotspotProject?: (projection: Projection | null) => void;
  /** When true, camera tweens resolve instantly and auto-rotate never starts. */
  reducedMotion?: boolean;
};

/** Vertical field of view. Narrow enough to keep perspective distortion off the models. */
const FOV = 38;

/**
 * Empty space left around a framed model, as a multiple of its largest half-extent.
 * Enough that orbiting never clips a corner, without stranding the subject in a void.
 */
const FRAMING_MARGIN = 1.35;

/** Duration of the reset-to-home tween. */
const HOME_TWEEN_SECONDS = 0.75;

/**
 * Extra frames to keep drawing after an interaction ends, in milliseconds.
 *
 * Damped orbit controls coast after the pointer is released. OrbitControls.update()
 * reports whether it moved the camera, which covers most of the tail, but tween
 * callbacks and material transitions need a window that outlives a single frame.
 */
const BUSY_TAIL_MS = 120;

export class Viewer {
  readonly #canvas: HTMLCanvasElement;
  readonly #container: HTMLElement;
  readonly #registry = new DisposalRegistry();
  readonly #onStatusChange?: (status: ViewerStatus, detail?: string) => void;
  readonly #onHotspotSelect?: (id: string | null) => void;
  readonly #onHotspotHover?: (id: string | null) => void;
  readonly #onHotspotProject?: (projection: Projection | null) => void;
  readonly #reducedMotion: boolean;
  readonly #hotspots = new HotspotLayer();

  #pointer: PointerController | null = null;

  /**
   * Cross-section plane. Normal points down -X, so the kept half is x <= constant and
   * sliding the constant sweeps the cut across the model.
   */
  readonly #clipPlane = new Plane(new Vector3(-1, 0, 0), 0);
  #clipEnabled = false;
  #clipPosition = 0.5;

  readonly #renderer: WebGLRenderer;
  readonly #scene: Scene;
  readonly #camera: PerspectiveCamera;
  readonly #controls: OrbitControls;
  readonly #loader: ModelLoader;
  readonly #environment: WebGLRenderTarget;
  /** Soft contact shadow under the model, so it sits on something rather than floats. */
  readonly #shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Accent per hotspot id, for tinting the selected part. */
  #accents = new Map<string, string>();

  readonly #resizeObserver: ResizeObserver;
  readonly #intersectionObserver: IntersectionObserver;

  #current: LoadedModel | null = null;
  /** Owns the model on its way out, and the three-pass render that dissolves it. */
  readonly #fade = new CrossFade();
  #loadToken = 0;
  #abort: AbortController | null = null;

  #frame: number | null = null;
  #dirty = true;
  #busyUntil = 0;
  #onScreen = true;
  #pageVisible = true;
  #disposed = false;

  /** Home camera pose, recomputed whenever a model is framed. */
  #home = { position: new Vector3(0, 0, 6), target: new Vector3(0, 0, 0) };

  /** Frames actually drawn. Read by tests to prove the loop idles at zero. */
  drawCount = 0;

  constructor(options: ViewerOptions) {
    this.#container = options.container;
    this.#canvas = document.createElement('canvas');
    this.#container.appendChild(this.#canvas);
    this.#onStatusChange = options.onStatusChange;
    this.#onHotspotSelect = options.onHotspotSelect;
    this.#onHotspotHover = options.onHotspotHover;
    this.#onHotspotProject = options.onHotspotProject;
    this.#reducedMotion = options.reducedMotion ?? false;

    this.#renderer = new WebGLRenderer({
      canvas: this.#canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.#renderer.setPixelRatio(this.#resolvePixelRatio());
    this.#renderer.outputColorSpace = SRGBColorSpace;
    // Neutral rather than ACES: ACES shifts saturated reds toward orange and crushes
    // them, and nearly every organ here is some shade of red.
    this.#renderer.toneMapping = NeutralToneMapping;
    this.#renderer.toneMappingExposure = 0.9;

    this.#scene = new Scene();
    this.#scene.background = this.#registry.track(backdropTexture(readVoidColour()));

    this.#camera = new PerspectiveCamera(FOV, 1, 0.05, 200);
    this.#camera.position.copy(this.#home.position);

    this.#controls = new OrbitControls(this.#camera, this.#canvas);
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.075;
    this.#controls.enablePan = false;
    this.#controls.minDistance = MODEL_FIT_SIZE * 0.6;
    this.#controls.maxDistance = MODEL_FIT_SIZE * 6;
    this.#controls.autoRotate = false;
    this.#controls.addEventListener('change', this.#markDirty);

    this.#addLights();

    // Image-based lighting. Without an environment map, metallic-roughness materials —
    // which every one of these glTF files uses — resolve to near-black, because a
    // mirror with nothing to reflect is black. RoomEnvironment is a cheap synthetic
    // studio that gives the foil and painted surfaces something to pick up.
    const pmrem = new PMREMGenerator(this.#renderer);
    const room = new RoomEnvironment();
    this.#environment = pmrem.fromScene(room, 0.04);
    this.#scene.environment = this.#environment.texture;
    // Strong enough for the clearcoat on wet tissue to pick up highlights.
    this.#scene.environmentIntensity = 0.6;
    disposeObject3D(room);
    pmrem.dispose();
    this.#registry.track(this.#environment);

    this.#loader = new ModelLoader((object, url) => {
      const palette = paletteForModel(url);
      if (!palette) return;
      // Folds and grooves first, so applyTissue sees the colour attribute and turns
      // vertex colours on.
      object.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh) cavityShade(mesh.geometry, palette.detail.cavity);
      });
      applyTissue(object, palette);
    });

    this.#shadow = new Mesh(
      this.#registry.track(new PlaneGeometry(1, 1)),
      this.#registry.track(
        new MeshBasicMaterial({
          map: this.#registry.track(shadowTexture()),
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    this.#shadow.rotation.x = -Math.PI / 2;
    this.#shadow.renderOrder = -1;
    this.#scene.add(this.#shadow);

    this.#resizeObserver = new ResizeObserver(this.#handleResize);
    this.#resizeObserver.observe(this.#container);

    // A canvas scrolled out of view must not draw. Paired with the visibilitychange
    // listener below, this is what makes a backgrounded tab cost nothing.
    this.#intersectionObserver = new IntersectionObserver(this.#handleIntersection, {
      threshold: 0.01,
    });
    this.#intersectionObserver.observe(this.#container);

    document.addEventListener('visibilitychange', this.#handleVisibility);

    this.#scene.add(this.#hotspots.group);
    this.#pointer = new PointerController({
      canvas: this.#canvas,
      camera: this.#camera,
      hotspots: this.#hotspots,
      onHoverChange: (id) => {
        this.#onHotspotHover?.(id);
        this.#markDirty();
      },
      onSelect: (id) => this.selectHotspot(id),
    });

    this.#handleResize();
    this.#emit('idle');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Warms the cache for a model the user has signalled interest in. Safe to call
   * repeatedly; the loader guards against refetching.
   */
  prefetch(url: string): void {
    if (this.#disposed) return;
    this.#loader.prefetch(url);
  }

  /** Loads and displays a model, cross-fading out whatever is currently shown. */
  async showModel(url: string): Promise<void> {
    if (this.#disposed) return;
    if (this.#current?.url === url && !this.#fade.active) return;

    const token = ++this.#loadToken;
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;

    this.#emit('loading');

    try {
      const model = await this.#loader.acquire(url, abort.signal);

      // A newer request landed while this one was in flight, or the viewer was torn
      // down. Release rather than dispose — the cache owns the model now, and another
      // request for the same URL should still get a cache hit.
      if (token !== this.#loadToken || this.#disposed) {
        this.#loader.release(url);
        return;
      }

      // A fade already running is resolved immediately rather than stacked. Two
      // simultaneous fades would need two depth prepasses and would look like a smear.
      this.#endFade();

      // A cached model may still carry the highlight or isolation from its last viewing.
      setHighlight(model.object, null, '#000000');
      setIsolated(model.object, null);
      this.#hotspots.setOnly(null);

      const previous = this.#current;
      this.#current = model;
      this.#scene.add(model.object);
      this.#frameModel(model);
      // The cut is expressed as a fraction of the model's width, so a new model with a
      // different radius needs the plane constant recomputed or the section jumps.
      this.setCrossSection(this.#clipEnabled);

      if (previous && previous.url !== url) {
        if (this.#reducedMotion) {
          this.#retire(previous);
        } else {
          this.#beginFade(previous);
        }
      } else if (previous) {
        this.#retire(previous);
      }

      this.#emit('ready');
      this.#markDirty();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (token !== this.#loadToken || this.#disposed) return;
      this.#emit('error', cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * Replaces the marker set. Call whenever the displayed entity changes.
   *
   * `entityId` is threaded through to the layer rather than resolved here: it is the
   * key a `derived` hotspot's centroid is looked up under, and the Viewer otherwise has
   * no reason to know anything about how a hotspot's position is determined.
   */
  setHotspots(entityId: EntityId, hotspots: Hotspot[]): void {
    if (this.#disposed) return;
    this.#hotspots.setHotspots(entityId, hotspots);
    this.#accents = new Map(hotspots.map((hotspot) => [hotspot.id, hotspot.color]));
    if (this.#current) {
      setHighlight(this.#current.object, null, '#000000');
      setIsolated(this.#current.object, null);
    }
    this.#hotspots.setOnly(null);
    this.#onHotspotSelect?.(null);
    this.#markDirty();
  }

  /**
   * Selects a marker, or clears the selection with null.
   *
   * Exposed so the text-equivalent list can drive the same state the canvas does —
   * the accessible path and the pointer path must not be two different features.
   */
  selectHotspot(id: string | null): void {
    if (this.#disposed) return;
    if (!this.#hotspots.setSelected(id, performance.now())) return;
    if (this.#current) {
      setHighlight(this.#current.object, id, (id && this.#accents.get(id)) || '#ffffff');
    }
    this.#onHotspotSelect?.(id);
    // The pulse animates for a fixed window and then rests. Keeping the loop alive
    // only for that window is what stops an open callout from pinning the renderer.
    if (id !== null) this.#keepBusy(PULSE_MS + BUSY_TAIL_MS);
    this.#markDirty();
  }

  /**
   * Shows only `part` of the current model, or the whole model with null. Returns false,
   * changing nothing, when the model has no geometry of its own for `part` (skin's
   * hand-placed hotspots), so the caller can leave its control switched off.
   */
  isolate(part: string | null): boolean {
    if (this.#disposed || !this.#current) return false;
    if (!setIsolated(this.#current.object, part)) return false;
    this.#hotspots.setOnly(part);
    this.#markDirty();
    return true;
  }

  /**
   * Zooms by a multiplier on the current camera distance.
   *
   * Exposed as a method because scroll-to-zoom is unreachable by keyboard: the canvas
   * is not a focusable text surface, and OrbitControls only binds keys for panning,
   * which is disabled here. Without buttons driving this, keyboard users would have no
   * way to change the framing at all.
   */
  zoomBy(factor: number): void {
    if (this.#disposed) return;
    const offset = this.#camera.position.clone().sub(this.#controls.target);
    const distance = Math.min(
      Math.max(offset.length() * factor, this.#controls.minDistance),
      this.#controls.maxDistance,
    );
    this.#camera.position.copy(this.#controls.target).addScaledVector(offset.normalize(), distance);
    this.#controls.update();
    this.#markDirty();
  }

  /**
   * Enables the cross-section and positions the cut, where `position` runs 0..1 across
   * the model's width.
   */
  setCrossSection(enabled: boolean, position?: number): void {
    if (this.#disposed) return;
    this.#clipEnabled = enabled;
    if (typeof position === 'number') {
      this.#clipPosition = Math.min(Math.max(position, 0), 1);
    }

    const radius = this.#current?.radius ?? MODEL_FIT_SIZE / 2;
    this.#clipPlane.constant = (this.#clipPosition * 2 - 1) * radius;
    this.#renderer.clippingPlanes = enabled ? [this.#clipPlane] : [];
    // Clipping planes are global, so the shadow would be sliced in half with the model.
    this.#shadow.visible = !enabled;
    this.#markDirty();
  }

  get crossSectionEnabled(): boolean {
    return this.#clipEnabled;
  }

  /** Tweens the camera back to the framing chosen when the model loaded. */
  resetView(): void {
    if (this.#disposed) return;

    gsap.killTweensOf(this.#camera.position);
    gsap.killTweensOf(this.#controls.target);

    if (this.#reducedMotion) {
      this.#camera.position.copy(this.#home.position);
      this.#controls.target.copy(this.#home.target);
      this.#controls.update();
      this.#markDirty();
      return;
    }

    const onUpdate = () => this.#markDirty();
    gsap.to(this.#camera.position, {
      x: this.#home.position.x,
      y: this.#home.position.y,
      z: this.#home.position.z,
      duration: HOME_TWEEN_SECONDS,
      ease: 'power2.inOut',
      onUpdate,
    });
    gsap.to(this.#controls.target, {
      x: this.#home.target.x,
      y: this.#home.target.y,
      z: this.#home.target.z,
      duration: HOME_TWEEN_SECONDS,
      ease: 'power2.inOut',
      onUpdate,
    });

    this.#keepBusy(HOME_TWEEN_SECONDS * 1000 + BUSY_TAIL_MS);
  }

  /** Diagnostics for tests and the dev overlay. */
  stats() {
    return {
      geometries: this.#renderer.info.memory.geometries,
      textures: this.#renderer.info.memory.textures,
      programs: this.#renderer.info.programs?.length ?? 0,
      draws: this.drawCount,
      tracked: this.#registry.size,
      fading: this.#fade.active,
      cache: this.#loader.stats(),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;

    this.#abort?.abort();
    this.#abort = null;

    gsap.killTweensOf(this.#camera.position);
    gsap.killTweensOf(this.#controls.target);

    document.removeEventListener('visibilitychange', this.#handleVisibility);
    this.#pointer?.dispose();
    this.#resizeObserver.disconnect();
    this.#intersectionObserver.disconnect();
    this.#hotspots.dispose();

    this.#controls.removeEventListener('change', this.#markDirty);
    this.#controls.dispose();

    this.#fade.end();
    this.#current = null;
    // The loader owns every parsed model, so disposing it releases them all. Removing
    // them from the scene first keeps the graph consistent for anything reading it
    // during teardown.
    this.#scene.clear();
    this.#loader.dispose();
    this.#registry.disposeAll();

    this.#scene.environment = null;
    this.#scene.clear();

    this.#renderer.dispose();
    // Without this the browser keeps the GL context alive until GC. Browsers cap
    // simultaneous contexts at around 16, so leaking them turns the canvas blank after
    // a handful of remounts.
    this.#renderer.forceContextLoss();
    // The canvas dies with its context. A new Viewer builds a new one.
    this.#canvas.remove();
  }

  // ---------------------------------------------------------------------------
  // Render-on-demand loop
  // ---------------------------------------------------------------------------

  /** Requests exactly one more frame. */
  #markDirty = (): void => {
    this.#dirty = true;
    this.#schedule();
  };

  /** Keeps the loop running for a window, for tweens and inertia. */
  #keepBusy(ms: number): void {
    this.#busyUntil = Math.max(this.#busyUntil, performance.now() + ms);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#disposed || this.#frame !== null) return;
    if (!this.#onScreen || !this.#pageVisible) return;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  #tick = (now: number): void => {
    this.#frame = null;
    if (this.#disposed) return;

    // update() returns true when damping actually moved the camera this frame, which
    // is how the inertia tail keeps itself alive without a fixed timer.
    const controlsMoved = this.#controls.update();
    const fading = this.#fade.active;
    const pulsing = this.#hotspots.isPulsing(now);
    const busy = now < this.#busyUntil;

    if (this.#dirty || controlsMoved || busy || fading || pulsing) {
      // Cleared *before* drawing, not after. Rendering can legitimately request the
      // next frame from inside itself — retiring a cross-faded model mutates the scene
      // and marks dirty — and clearing afterwards would wipe that request, leaving the
      // canvas holding a stale frame with nothing scheduled to replace it.
      this.#dirty = false;
      this.#renderFrame(now);
      this.drawCount += 1;
    }

    // Note `pulsing` is re-read rather than reused: the pulse may have expired during
    // this very frame, and that is precisely when the loop should be allowed to stop.
    if (controlsMoved || busy || this.#fade.active || this.#hotspots.isPulsing(now)) {
      this.#schedule();
    }
  };

  /**
   * Draws one frame, with a three-pass cross-fade while a model is retiring.
   *
   * The naive way to fade a model out is to set opacity on its materials and render
   * normally. That looks wrong: an organ is a shell of many overlapping
   * surfaces, so a semi-transparent pass shows its own backfaces, inner parts, and
   * the far side of every fold — the model appears to turn inside out on the way out.
   *
   * A depth prepass fixes it. Pass one draws depth only, with colour writes disabled,
   * establishing the nearest surface at every pixel. Pass two draws colour with depth
   * writes off, which — since three's default depth function is less-or-equal — shades
   * exactly the surfaces the prepass recorded and nothing behind them. The result
   * reads as one solid object dissolving, which is what a viewer expects.
   */
  #renderFrame(now: number): void {
    // Markers are repositioned against the current camera before anything is drawn.
    this.#hotspots.update(this.#camera, now);

    if (!this.#fade.active) {
      this.#renderer.render(this.#scene, this.#camera);
      this.#emitProjection();
      return;
    }

    const finished = this.#fade.render(
      {
        renderer: this.#renderer,
        scene: this.#scene,
        camera: this.#camera,
        incoming: this.#current?.object ?? null,
      },
      now,
    );

    this.#emitProjection();

    if (finished) this.#endFade();
  }

  /** Publishes the selected marker's screen position for the DOM callout to follow. */
  #emitProjection(): void {
    if (!this.#onHotspotProject) return;
    const { clientWidth, clientHeight } = this.#container;
    this.#onHotspotProject(this.#hotspots.projectSelected(this.#camera, clientWidth, clientHeight));
  }

  #beginFade(model: LoadedModel): void {
    this.#fade.begin(model, performance.now());
    this.#keepBusy(FADE_MS + BUSY_TAIL_MS);
  }

  /** Ends any fade in progress immediately, retiring the outgoing model. */
  #endFade(): void {
    const outgoing = this.#fade.end();
    if (outgoing) this.#retire(outgoing);
  }

  /**
   * Removes a model from the scene and drops the viewer's reference to it.
   *
   * Deliberately not a disposal: the cache owns these models and may hand this one
   * back on the next switch. Its mutated material state is restored by the loader on
   * acquire, not here.
   */
  #retire(model: LoadedModel): void {
    model.object.visible = true;
    this.#scene.remove(model.object);
    this.#loader.release(model.url);

    /*
     * Retiring mutates the scene graph, so the canvas must be redrawn.
     *
     * This is not incidental bookkeeping — it was a bug that made every entity switch
     * appear to load nothing. #endFade runs at the *end* of #renderFrame, after that
     * frame has already been composited, so removing the outgoing model left the
     * canvas holding a stale image with no reason to ever draw another. Under
     * render-on-demand there is no next frame unless something asks for one, and only
     * the initially loaded model — which never goes through a fade — escaped it.
     */
    this.#markDirty();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Chooses a device pixel ratio ONCE and never revisits it.
   *
   * Deliberately not an adaptive controller. Frame intervals are vsync-quantised, so a
   * single hitch reads as sustained GPU load; the ratio steps down, and a vsync-locked
   * 16.7 ms interval never clears the threshold that would step it back up. The result
   * is a viewer that degrades permanently after one stutter. A fixed ratio is both
   * simpler and better behaved.
   */
  #resolvePixelRatio(): number {
    const lowPower =
      window.innerWidth < 768 ||
      (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4);
    return Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  }

  #addLights(): void {
    // Warm key, high and to the right of the default camera — a soft studio light that
    // models the folds of tissue without flattening them.
    const key = new DirectionalLight(0xfff1e4, 1.6);
    key.position.set(4, 6, 5);
    this.#scene.add(key);

    // Cool, low fill from the left, so the shadow side keeps some shape.
    const fill = new DirectionalLight(0xcfdcff, 0.55);
    fill.position.set(-5, -1, 2);
    this.#scene.add(fill);

    // Rim from behind: separates the silhouette from the dark backdrop.
    const rim = new DirectionalLight(0xffe6dc, 1.1);
    rim.position.set(-2, 3, -6);
    this.#scene.add(rim);

    const ambient = new HemisphereLight(0xf2ebe6, 0x1a1414, 0.45);
    this.#scene.add(ambient);
  }

  #frameModel(model: NormalisedModel): void {
    const box = new Box3().setFromObject(model.object);
    const target = box.getCenter(new Vector3());

    /*
     * Frame on the box's largest half-extent, not its bounding sphere.
     *
     * The sphere radius is the half-diagonal, which for a normalised cube is √3 ≈ 1.73
     * against a half-extent of 1 — so framing on it pushes the camera ~70% further
     * back than needed, and a long, thin model (a loop of intestine, say)
     * ends up a small object in a large empty frame. The margin below still leaves
     * room for the corners to swing through as the model is orbited.
     */
    const size = box.getSize(new Vector3());
    const halfExtent = Math.max(size.x, size.y, size.z) / 2;

    // The vertical field of view is the binding constraint on a landscape aperture, but
    // not on a portrait one, so the horizontal limit is checked too.
    const vertical = (halfExtent * FRAMING_MARGIN) / Math.sin((FOV * Math.PI) / 360);
    const horizontalFov = 2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * this.#camera.aspect);
    const horizontal = (halfExtent * FRAMING_MARGIN) / Math.sin(horizontalFov / 2);
    const distance = Math.max(vertical, horizontal);

    // Three-quarter view: reads as a technical illustration rather than an elevation,
    // and keeps booms and antennas from collapsing into the silhouette.
    const direction = new Vector3(0.72, 0.38, 1).normalize();
    const position = target.clone().addScaledVector(direction, distance);

    this.#home = { position, target };
    this.#camera.position.copy(position);
    this.#camera.near = Math.max(distance / 100, 0.01);
    this.#camera.far = distance * 12;
    this.#camera.updateProjectionMatrix();
    this.#controls.target.copy(target);
    // Sit the shadow just under the model, sized to its footprint.
    const footprint = Math.max(size.x, size.z) * 1.6;
    this.#shadow.scale.set(footprint, footprint, 1);
    this.#shadow.position.set(target.x, box.min.y - size.y * 0.04, target.z);

    this.#controls.minDistance = model.radius * 1.05;
    this.#controls.maxDistance = distance * 3;
    this.#controls.update();
  }

  #handleResize = (): void => {
    if (this.#disposed) return;
    const { clientWidth, clientHeight } = this.#container;
    if (clientWidth === 0 || clientHeight === 0) return;

    this.#renderer.setSize(clientWidth, clientHeight, false);
    this.#camera.aspect = clientWidth / clientHeight;
    this.#camera.updateProjectionMatrix();
    this.#markDirty();
  };

  #handleIntersection = (entries: IntersectionObserverEntry[]): void => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    this.#onScreen = entry.isIntersecting;
    if (this.#onScreen) {
      // Re-measure before the first frame back. ResizeObserver callbacks are delivered
      // as part of the rendering steps, so a resize that happened while this canvas was
      // off-screen or backgrounded has not been seen yet, and rendering at the stale
      // size would show one visibly wrong frame.
      this.#handleResize();
      this.#markDirty();
    } else if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
  };

  #handleVisibility = (): void => {
    this.#pageVisible = document.visibilityState === 'visible';
    if (this.#pageVisible) {
      this.#handleResize();
      this.#markDirty();
    } else if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
  };

  #emit(status: ViewerStatus, detail?: string): void {
    this.#onStatusChange?.(status, detail);
  }
}

/**
 * Reads the --void token so the WebGL clear colour matches the CSS aperture exactly.
 * A hardcoded duplicate here would drift the moment the palette changed.
 */
function readVoidColour(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--void').trim();
  return value.length > 0 ? value : '#161d26';
}

/**
 * A radial backdrop: the --void colour at the edges, lifted toward the centre so the
 * model reads as lit from within a space rather than pasted on a flat fill.
 */
function backdropTexture(edge: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const centre = new Color(edge).lerp(new Color('#3a4250'), 0.55);
  const gradient = context.createRadialGradient(256, 230, 0, 256, 256, 360);
  gradient.addColorStop(0, `#${centre.getHexString()}`);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A soft dark ellipse that fades to nothing, for the contact shadow. */
function shadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.22)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new CanvasTexture(canvas);
}

export { MODEL_FIT_SIZE };
