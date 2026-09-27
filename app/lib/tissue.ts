/**
 * How each organ's surface looks: colour and finish per part.
 *
 * Kept apart from subject-data.ts, which holds the strings the UI renders; this is
 * appearance only. Keys under `parts` are hotspot ids, which build-organs also uses as
 * the node names in each GLB, so a part's look is matched to its geometry by name.
 * Geometry not claimed by any hotspot sits under a node called `rest` and takes `base`.
 *
 * Colours are sRGB hex, chosen to read as fresh tissue under the viewer's lighting
 * rather than as textbook-diagram flats.
 */

import { ENTITIES } from './subject-data.ts';
import type { EntityId } from './subject-data.ts';

export type Tissue = {
  color: string;
  /** 0 = mirror, 1 = chalk. Wet tissue sits low. */
  roughness: number;
  /** Strength of the thin glossy layer over the surface — the moist look. */
  clearcoat?: number;
  /** Soft velvety rim, for surfaces like lung and brain. */
  sheen?: number;
  sheenColor?: string;
  /** Below 1 renders translucent — cornea, lens, vitreous. */
  opacity?: number;
};

/**
 * Surface character, generated in the shader from 3D noise — the atlas meshes have no
 * texture coordinates, so there is nothing to paint an image onto.
 */
export type Detail = {
  /** Noise frequency across the fitted model (which spans about 2 units). */
  scale: number;
  /** Height of the bumps the noise raises. */
  bump: number;
  /** Colour variation, as a fraction of the base colour: blotches, mottling. */
  mottle: number;
  /** Darkening in folds and grooves; see app/lib/three/cavity.ts. */
  cavity: number;
  /** Warm glow at the silhouette, where light would scatter back out of the tissue. */
  flesh: number;
};

export type OrganPalette = {
  detail: Detail;
  base: Tissue;
  parts: Record<string, Partial<Tissue>>;
  /** Layered over a part's look for its generated outer surface, where the build made one. */
  surface?: Partial<Tissue>;
};

export const PALETTES: Record<EntityId, OrganPalette> = {
  heart: {
    detail: { scale: 4.5, bump: 0.8, mottle: 0.12, cavity: 1.6, flesh: 0.3 },
    // Great vessels and coronaries: paler, more fibrous than the muscle.
    base: { color: '#9a4f45', roughness: 0.5, clearcoat: 0.35 },
    parts: {
      'right-atrium': { color: '#5e1a1c' },
      'left-atrium': { color: '#661e1f' },
      'right-ventricle': { color: '#7c2825' },
      'left-ventricle': { color: '#732320' },
      // Arteries run brighter than the muscle they feed.
      'right-coronary-artery': { color: '#b8433a', roughness: 0.4 },
      'left-coronary-artery': { color: '#c04a3f', roughness: 0.4 },
    },
  },
  brain: {
    detail: { scale: 3.5, bump: 0.5, mottle: 0.08, cavity: 2.2, flesh: 0.2 },
    base: { color: '#d6aaa3', roughness: 0.55, clearcoat: 0.25, sheen: 0.4, sheenColor: '#f3d2cc' },
    parts: {
      'right-cerebral-hemisphere': { color: '#d8aca6' },
      'left-cerebral-hemisphere': { color: '#d2a49e' },
      diencephalon: { color: '#c99890' },
      brainstem: { color: '#e2c4b6' },
      cerebellum: { color: '#cfa097' },
    },
  },
  lungs: {
    detail: { scale: 7, bump: 0.6, mottle: 0.14, cavity: 1.2, flesh: 0.25 },
    // Inside: the airway and vessel trees the atlas provides, a deeper pink-red.
    base: { color: '#c86f68', roughness: 0.5, clearcoat: 0.3 },
    // Outside: the generated lobe surface, pale pink and see-through so the trees show.
    surface: {
      color: '#f7c0b6',
      roughness: 0.55,
      clearcoat: 0.3,
      sheen: 0.6,
      sheenColor: '#ffe3dc',
      opacity: 0.5,
    },
    parts: {
      'upper-lobe-right': { color: '#cc756d' },
      'middle-lobe-right': { color: '#c36a63' },
      'lower-lobe-right': { color: '#c97169' },
      'upper-lobe-left': { color: '#cf7870' },
      'lower-lobe-left': { color: '#c06660' },
    },
  },
  liver: {
    detail: { scale: 7, bump: 0.5, mottle: 0.14, cavity: 1.2, flesh: 0.2 },
    base: { color: '#5a1d17', roughness: 0.45, clearcoat: 0.45 },
    parts: {
      'right-lobe': { color: '#571c16' },
      'left-lobe': { color: '#64221a' },
      // Venous blood: darker and bluer than the surrounding tissue.
      'right-portal-vein': { color: '#5a3f66', roughness: 0.35 },
      // Bile ducts carry bile, not blood: yellow-green against the red-brown.
      'intrahepatic-biliary-tree': { color: '#8f9a3e', roughness: 0.3 },
    },
  },
  kidneys: {
    detail: { scale: 5, bump: 0.4, mottle: 0.1, cavity: 1.2, flesh: 0.25 },
    base: { color: '#5f231d', roughness: 0.45, clearcoat: 0.45 },
    parts: {
      'right-kidney': { color: '#5c221c' },
      'left-kidney': { color: '#662620' },
    },
  },
  eyeball: {
    // Smooth and clean: a glossy sclera with only faint veining.
    detail: { scale: 5, bump: 0.08, mottle: 0.04, cavity: 0.8, flesh: 0.1 },
    base: { color: '#e8d6c4', roughness: 0.4, clearcoat: 0.4 },
    parts: {
      sclera: { color: '#efe9df', roughness: 0.3, clearcoat: 0.8 },
      cornea: { color: '#ffffff', roughness: 0.05, clearcoat: 1, opacity: 0.25 },
      iris: { color: '#6b4a2b', roughness: 0.5 },
      lens: { color: '#f2e6c4', roughness: 0.1, clearcoat: 1, opacity: 0.55 },
      'vitreous-body': { color: '#dfe8ea', roughness: 0.1, opacity: 0.2 },
      choroid: { color: '#5a2a26', roughness: 0.5 },
    },
  },
  intestine: {
    detail: { scale: 5.5, bump: 0.6, mottle: 0.1, cavity: 2, flesh: 0.3 },
    base: { color: '#cf9486', roughness: 0.4, clearcoat: 0.5 },
    parts: {
      duodenum: { color: '#d4867a' },
      jejunum: { color: '#dc9083' },
      ileum: { color: '#d08377' },
      'ileocecal-junction': { color: '#c77b70' },
      'large-intestine': { color: '#d7a596' },
    },
  },
  pancreas: {
    // Visibly lobulated: the bumpiest of the nine.
    detail: { scale: 9, bump: 1.2, mottle: 0.14, cavity: 1.5, flesh: 0.2 },
    base: { color: '#e0b48a', roughness: 0.55, clearcoat: 0.3 },
    parts: {
      parenchyma: { color: '#e3b98f' },
      'pancreatic-duct-tree': { color: '#efd9a8', roughness: 0.35 },
    },
  },
  skin: {
    // Fine pores rather than blotches; strong scatter, since skin is the most translucent.
    detail: { scale: 28, bump: 0.3, mottle: 0.05, cavity: 1.2, flesh: 0.35 },
    base: { color: '#d9a384', roughness: 0.5, clearcoat: 0.15, sheen: 0.3, sheenColor: '#ffd6c2' },
    parts: {},
  },
};

/** The look for one named part of an organ, falling back to the organ's base. */
export function tissueFor(palette: OrganPalette, part: string | null, surface = false): Tissue {
  const override = part === null ? undefined : palette.parts[part];
  const look = { ...palette.base, ...override };
  if (!surface) return look;
  // A surface keeps its part's hue unless the organ's surface look names its own.
  return { ...look, ...palette.surface };
}

/** The palette for a model URL, or null for a model no entity claims. */
export function paletteForModel(url: string): OrganPalette | null {
  const entity = ENTITIES.find((candidate) => candidate.model === url);
  return entity ? PALETTES[entity.id] : null;
}
