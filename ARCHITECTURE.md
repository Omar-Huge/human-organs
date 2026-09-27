# Architecture

## Why the 3D layer is a plain class, not React components

React is a good fit for state that is derived and re-derived: given this data, produce
this tree. A three.js scene is the opposite. It is long-lived mutable state with an
imperative lifecycle, where object *identity* matters — the same `Mesh` instance must
persist across frames, because the GPU resources hanging off it cost real time to
create and real memory to hold.

Wrapping that in components means fighting the reconciler for control of identity.
Every render risks recreating a material, which recompiles a shader; every unmount
risks orphaning a geometry, which leaks a vertex buffer that no garbage collector will
ever reclaim. The workarounds are familiar — refs everywhere, `useMemo` on anything
that allocates, effects that reach around the component model to do the real work — and
what you end up with is imperative code wearing a declarative costume.

So the split here is by responsibility, not by technology. `Viewer` owns the canvas,
the scene graph, the render loop, and every GPU resource. React owns application state
and chrome: which organ is selected, what is in the search box, whether a dialog
is open. They meet at a deliberately narrow interface — `showModel(url)`,
`setHotspots(...)`, `selectHotspot(id)`, `resetView()`, plus callbacks going the other
way. `SubjectViewer.tsx` constructs a `Viewer`, hands it a mount point, and disposes it.
It holds no three.js object.

Two consequences worth stating, because both were bugs before they were decisions:

**The Viewer creates its own canvas.** A canvas element hands out exactly one WebGL
context in its lifetime. Teardown calls `forceContextLoss()` to release it promptly,
which means that element can never produce another context. React Strict Mode
double-mounts every effect in development, so a canvas owned by React and reused across
two `Viewer` instances gives the second one a dead context and a null dereference.
Owning the element makes its lifetime match the context's.

**Frame-rate data never touches React state.** The selected hotspot's screen position
is emitted after every rendered frame so the callout can follow it. That is applied
straight to the DOM through refs. Routing it through `useState` would re-render the
component tree on every frame of an orbit.

## The render-on-demand contract

There is no permanent `requestAnimationFrame` loop. A frame is drawn only when
something changed, and the loop stops entirely when nothing is happening.

A frame is requested when:

- OrbitControls reports the camera moved (this covers the damped inertia tail —
  `controls.update()` returns whether it actually moved anything, so the tail keeps
  itself alive without a timer)
- a model finishes loading, or the displayed entity changes
- the hovered hotspot changes — and *only* when it changes, since pointer moves fire
  far faster than frames
- the canvas resizes
- a time-boxed animation is running: a camera tween, a cross-fade, or a selection pulse

That last category is why there is a `busyUntil` window alongside the dirty flag. Each
of those animations declares a duration up front and the loop runs until it expires,
then stops. **The selection pulse in particular decays to nothing and then reports
itself as finished** — an open callout must not hold a frame request open indefinitely.

The loop is gated twice more. An `IntersectionObserver` stops it when the canvas
scrolls out of view, and `visibilitychange` stops it when the tab is backgrounded. Both
re-measure the canvas before the first frame back, because `ResizeObserver` callbacks
are delivered as part of the rendering steps and a resize that happened while hidden
has not been seen yet.

Device pixel ratio is resolved **once** at construction and never revisited. An
adaptive DPR controller is a trap: frame intervals are vsync-quantised, so a single
hitch reads as sustained GPU load, the ratio steps down, and a vsync-locked 16.7 ms
interval never clears the threshold that would step it back up. The viewer degrades
permanently after one stutter. A fixed ratio is simpler and better behaved.

`Viewer.drawCount` is public so this contract is testable rather than merely claimed.

## Resource ownership

Anything with a `dispose()` is registered with a `DisposalRegistry` at creation, and
teardown drains the registry. This inverts the usual failure mode: forgetting to
*register* is the only way to leak, rather than forgetting to *clean up*. The registry
size is directly assertable in a test with no GPU present.

Parsed models are owned by the cache in `loaders.ts`, not by the viewer. The cache is
reference-counted rather than a plain LRU because during a cross-fade two models are
live at once, and evicting on recency alone would dispose the one still being drawn.

## Files

```
app/lib/three/
  viewer.ts       scene, lights, camera, render loop, tools, teardown
  loaders.ts      decoders, normalisation, reference-counted LRU cache, prefetch
  hotspots.ts     marker sprites: lifting, facing fade, picking, selection pulse
  crossfade.ts    the retiring model and its depth-prepass render
  pointer.ts      pointer events → hover picking and click-vs-orbit
  dispose.ts      disposal registry and subtree teardown
```

`crossfade.ts` and `pointer.ts` were split out of `viewer.ts` when it passed its
700-line budget; both are coherent units rather than arbitrary slices.

## Model normalisation

Every model is centred on its bounding box and uniformly scaled to fit a cube of edge
`MODEL_FIT_SIZE`. This is what lets hotspot coordinates in `subject-data.ts` be authored
by hand and mean the same thing across models whose raw glTF units differ by orders of
magnitude.

Normalisation wraps the model in a group rather than transforming it in place. Writing
the centring offset onto the model's own position would overwrite whatever transform
the glTF author already applied, silently mis-centring anything not authored at the
origin — which was a real bug, caught by a test.
