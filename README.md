# Soft Machinery

**The organs that keep you running.**

An interactive 3D explorer for nine human organs. Pick one, and the viewer shows you what
it does and which part of it does the work — the four chambers of the heart, the lobes
of the lungs, the layers of the eye.

Every figure in the interface is transcribed from a cited medical source (Cleveland
Clinic, StatPearls and other NCBI Bookshelf pages, PubMed Central), with the date it was
retrieved. Where a source did not state a number, the fact was left out rather than
filled in from memory.

> **Screenshots pending.** Generate them with `npm run capture` (see
> [Screenshots](#screenshots)).

Selecting a hotspot — on the model or in the list below it — draws a leader line to a
callout that tracks the marker as the model orbits. For parts with their own geometry,
**Isolate** hides everything else, and **Cross-section** slices the organ open.

**Live URL:** not deployed yet.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. The optimised models are committed, so nothing else
is needed to run it.

Or with Docker:

```bash
docker compose up
```

## The organs

| # | Organ | Category |
| --- | --- | --- |
| 01 | Heart | Muscular pump |
| 02 | Brain | Central nervous organ |
| 03 | Lungs | Respiratory organ, paired |
| 04 | Liver | Digestive gland |
| 05 | Kidneys | Excretory organ, paired |
| 06 | Eyeball | Sensory organ, paired |
| 07 | Intestine | Digestive tract segment |
| 08 | Pancreas | Digestive and endocrine gland |
| 09 | Skin | Integumentary organ |

Each organ has a summary, a short fact table, notes, a set of hotspots and at least one
dated citation. All of it lives in `app/lib/subject-data.ts` and nowhere else.

**Hotspots are derived, not guessed.** Every organ except skin breaks down into named
sub-structures in the BodyParts3D atlas, identified by FMA id. The build measures the
centroid of each sub-structure's real mesh, so the marker sits on the part it names, and
the same id drives the isolate tool. Skin is a single surface with no sub-structures, so
its three hotspots (scalp, palm, sole) are the only hand-placed ones.

## Architecture

React owns application state and chrome. A plain TypeScript class owns the canvas.
They meet at a narrow interface and nothing else crosses it. See
[ARCHITECTURE.md](ARCHITECTURE.md) for why, and for the render-on-demand contract.

```
app/
  layout.tsx                 metadata, fonts, theme colour
  page.tsx                   server component; renders the client shell
  globals.css                design tokens + viewer chrome
  components/
    ExplorerApp.tsx          shell: library, drawer, modal
    EntityLibrary.tsx        search + organ list
    SubjectViewer.tsx        canvas host, tool rail, isolate, cross-section
    InfoPanel.tsx            summary, fact table, notes, citations
    Modal.tsx                focus-trapped dialog
  lib/
    subject-data.ts          all content, and the only place it lives
    tissue.ts                colour and finish per organ part
    hotspot-position.ts      derived hotspot positions
    search.ts                library filter
    generated/
      anatomy-parts.json     part centroids written by build:organs
    three/
      viewer.ts              scene, lights, render loop, tools, teardown
      loaders.ts             decoders, normalisation, reference-counted LRU, prefetch
      tint.ts                tissue materials and part highlighting
      tissue-shader.ts       procedural mottling, bumps, rim light, cut faces
      cavity.ts              per-vertex darkening of folds and grooves
      hotspots.ts            marker sprites, occlusion, selection pulse
      crossfade.ts           the retiring model and its depth-prepass render
      pointer.ts             hover picking, click-vs-orbit
      body.ts                all organs in place inside ghosted skin (not wired up)
      dispose.ts             disposal registry
scripts/
  models.manifest.mjs        model provenance and per-organ hotspot FMA ids
  fetch-models.mjs           downloads the BodyParts3D atlas
  atlas.mjs                  parses the atlas's concept-to-element map
  build-organs.mjs           one glTF per organ, one named node per hotspot
  envelope.mjs               builds approximate lung lobe surfaces
  optimize-models.mjs        the asset pipeline
  write-credits.mjs          generates public/models/CREDITS.md
  report-substructures.mjs   lists each organ's available sub-structures
  sync-decoders.mjs          copies Draco decoders out of three.js (postinstall)
  capture-screenshots.mjs    photographs the running page into docs/
```

A few details worth knowing before reading the code:

- **The render loop is on demand.** No permanent `requestAnimationFrame`. A frame is
  drawn only when something changed, and the loop stops when the tab is hidden or the
  canvas scrolls out of view. This is asserted in the Playwright suite, not assumed.
- **Tissue is procedural.** The atlas meshes have no UVs, so surface character comes
  from 3D noise sampled in world space, plus a one-off per-vertex cavity pass at load.
  No textures are shipped.
- **The parsed-model cache is reference-counted**, not a plain LRU. During a cross-fade
  two models are live at once, and evicting on recency alone would dispose the one
  still being drawn.

## Asset pipeline

The raw atlas is **not** committed. Reproduce `public/models/` with:

```bash
npm run fetch:models && npm run build:organs && npm run optimize:models
```

`fetch:models` downloads BodyParts3D 4.0. `build:organs` picks out each organ's element
meshes, drops fragments under 1 mm, groups meshes by the hotspot that claims them,
converts Z-up to Y-up and writes one named node per group. `optimize:models` then welds,
simplifies, prunes and Meshopt-compresses each organ while keeping the groups separate.
It fails if any model exceeds 1.5 MB or the total exceeds 12 MB.

The atlas has no lung surface, only airway and vessel trees, so the lung lobes are an
approximate surface wrapped around those trees (`scripts/envelope.mjs`). The UI says so.

Regenerate the credits file after changing the manifest:

```bash
npm run write:credits
```

## Screenshots

`docs/` is regenerated from the running app rather than edited by hand. With a server
up — `npm run dev`, or `npm run build && npm run start` for the shipping artifact:

```bash
npm run capture
```

That writes the full page, the open callout, and one view per organ. Set `BASE_URL` to
point it at something other than <http://localhost:3000>.

## Tests

```bash
npm test
```

Unit tests under `node:test`, no browser required: content integrity (every organ
sourced, facts bounded, accent contrast), atlas parsing, part grouping, lung envelopes,
tissue palette, cavity shading, orientation, cache eviction, teardown, hotspot geometry,
search, and the optimised models' structure and size budgets.

```bash
npm run test:e2e
```

Playwright tests against a **production build**: the render loop idling at zero draws,
a hidden tab drawing nothing, GPU memory returning to baseline after teardown, and the
primary journey with zero console errors or warnings.

CI runs typecheck, lint, test and build, then the e2e suite.

## Licence

Code is MIT — see [LICENSE](LICENSE).

The 3D models are **not** covered by that licence. They are adapted from
[BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html),
© The Database Center for Life Science, licensed under CC Attribution 4.0
International. Attribution and the list of modifications:
[public/models/CREDITS.md](public/models/CREDITS.md). The Database Center for Life
Science does not endorse this project.

## Medical disclaimer

This is an educational visualisation, not medical advice. The atlas models one reference
adult; real anatomy varies between people, and the meshes have been simplified.

## What's not built yet

- **Not deployed.** No live URL yet.
- **Screenshots need regenerating** for the organ version of the app.
- **The body view is not wired into the UI.** `app/lib/three/body.ts` can place every
  organ where it sits in the body inside a ghosted skin, but nothing calls it yet.
- **No heart valves.** The atlas assigns valve geometry to the chambers on either side,
  leaving a valve nothing of its own to isolate.
- **No cross-browser testing.** Playwright runs Chromium only.
