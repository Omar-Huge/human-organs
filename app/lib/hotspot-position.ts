/**
 * Resolves a hotspot's position in normalised model space.
 *
 * `authored` hotspots carry their own coordinate. `derived` hotspots don't — see
 * subject-data.ts's header comment — so their position has to come from somewhere
 * else: the mesh centroid `scripts/build-organs.mjs` measured and wrote to
 * app/lib/generated/anatomy-parts.json. This is the one place that lookup happens, so
 * `hotspot.kind` is branched on here and nowhere else — the rendering code (hotspots.ts,
 * SubjectViewer.tsx) asks this for a position and never needs to know which kind of
 * hotspot it was given.
 */

import type { EntityId, Hotspot } from './subject-data.ts';
import generatedParts from './generated/anatomy-parts.json' with { type: 'json' };

type PartGroup = { elements: string[]; centroid: [number, number, number] };
type PartsIndex = Record<string, Record<string, PartGroup>>;

// The JSON import is inferred as `number[]` for centroid, not the fixed-length tuple
// this module wants to hand back — routed through `unknown` because the two array
// types don't otherwise overlap enough for a direct assertion.
const PARTS = generatedParts as unknown as PartsIndex;

export function resolveHotspotPosition(entityId: EntityId, hotspot: Hotspot): [number, number, number] {
  if (hotspot.kind === 'authored') return hotspot.position;

  const group = PARTS[entityId]?.[hotspot.id];
  if (!group) {
    // Not a fallback-and-continue situation: a missing group means the generated
    // sidecar has drifted from subject-data.ts or the manifest, and guessing a
    // position would misplace the marker silently instead of failing loudly.
    throw new Error(`No generated centroid for ${entityId}/${hotspot.id} — run \`npm run build:organs\``);
  }
  return group.centroid;
}
