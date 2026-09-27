/**
 * Dresses a loaded organ in tissue materials, and highlights a selected part.
 *
 * The atlas geometry arrives with one flat grey material. build-organs names each node
 * after the hotspot that claims its meshes, so a mesh's part is found by walking up to
 * the nearest ancestor whose name the palette knows. Each part gets one material,
 * shared by every mesh under it — which is also what makes highlighting a part a single
 * material edit rather than a traversal.
 */

import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial } from 'three';
import type { Material, Mesh, Object3D } from 'three';

import { tissueFor } from '../tissue.ts';
import type { OrganPalette } from '../tissue.ts';
import { injectTissueShader, tissueUniforms } from './tissue-shader.ts';

/** How much of its own colour an unselected part keeps while another is highlighted. */
const DIMMED = 0.55;
/** Strength of the accent glow on the selected part. */
const GLOW = 0.35;
/** How much of its opacity an unselected translucent part keeps. */
const FADED = 0.35;
/** What light scattered through tissue tends toward: blood red. */
const FLESH_TINT = new Color('#ff3b2e');

type TissueData = {
  part: string | null;
  color: Color;
  opacity: number;
  /** Flat colour for inside faces seen through the cross-section; opaque parts only. */
  cut?: { base: Color; uniform: { value: Color } };
};

/** A cut through tissue shows a paler, less saturated face than its surface. */
function cutColourOf(color: Color): Color {
  return color.clone().offsetHSL(0, -0.1, 0.07);
}

/**
 * Suffix on nodes holding a part's generated outer surface. Must match SURFACE_SUFFIX in
 * scripts/build-organs.mjs.
 */
export const SURFACE_SUFFIX = '--surface';

function partOf(
  mesh: Object3D,
  palette: OrganPalette,
  root: Object3D,
): { part: string | null; surface: boolean } {
  for (let node: Object3D | null = mesh; node && node !== root.parent; node = node.parent) {
    const surface = node.name.endsWith(SURFACE_SUFFIX);
    const name = surface ? node.name.slice(0, -SURFACE_SUFFIX.length) : node.name;
    if (name in palette.parts || name === 'rest') return { part: name, surface };
  }
  return { part: null, surface: false };
}

function isMesh(node: Object3D): node is Mesh {
  return (node as Mesh).isMesh === true;
}

/** Replaces every mesh material under `root` with its part's tissue material. */
export function applyTissue(root: Object3D, palette: OrganPalette): void {
  const byPart = new Map<string, MeshPhysicalMaterial>();
  const replaced = new Set<Material>();

  root.traverse((node) => {
    if (!isMesh(node)) return;
    const { part, surface } = partOf(node, palette, root);
    const key = `${part}${surface ? SURFACE_SUFFIX : ''}`;

    let material = byPart.get(key);
    if (!material) {
      const look = tissueFor(palette, part, surface);
      const opacity = look.opacity ?? 1;
      material = new MeshPhysicalMaterial({
        color: look.color,
        roughness: look.roughness,
        metalness: 0,
        clearcoat: look.clearcoat ?? 0,
        clearcoatRoughness: 0.25,
        sheen: look.sheen ?? 0,
        sheenColor: look.sheenColor ?? '#ffffff',
        sheenRoughness: 0.6,
        transparent: opacity < 1,
        opacity,
        // Translucent parts must not hide what sits behind them in the depth buffer.
        depthWrite: opacity >= 1,
        // Double-sided so the cross-section shows a coloured interior, not a hole.
        side: opacity < 1 ? FrontSide : DoubleSide,
        // Cavity shading baked at load (cavity.ts), when the geometry carries it.
        vertexColors: node.geometry.hasAttribute('color'),
      });
      material.name = part ?? 'tissue';
      const tissue: TissueData = { part, color: material.color.clone(), opacity };
      // Scatter glows warmer and redder than the surface colour it comes through.
      const flesh = material.color.clone().lerp(FLESH_TINT, 0.55);
      const cutBase = opacity >= 1 ? cutColourOf(material.color) : null;
      const uniforms = tissueUniforms(palette.detail, flesh, cutBase?.clone() ?? null);
      if (cutBase) tissue.cut = { base: cutBase, uniform: uniforms.cutColor };
      material.onBeforeCompile = (shader) => injectTissueShader(shader, uniforms);
      material.userData.tissue = tissue;
      byPart.set(key, material);
    }

    for (const old of Array.isArray(node.material) ? node.material : [node.material]) {
      replaced.add(old);
    }
    node.material = material;
  });

  for (const old of replaced) old.dispose();
}

/**
 * Lights `part` in the accent colour and dims every other part, or restores all of
 * them when `part` is null. A part with no geometry of its own (skin's hand-placed
 * hotspots) changes nothing — dimming the whole organ around an empty selection
 * would only make it look broken.
 */
export function setHighlight(root: Object3D, part: string | null, accent: string): void {
  const materials = new Set<MeshPhysicalMaterial>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    const material = node.material as MeshPhysicalMaterial;
    if (material.userData?.tissue) materials.add(material);
  });

  const present = part !== null && [...materials].some((m) => (m.userData.tissue as TissueData).part === part);
  const glow = new Color(accent).multiplyScalar(GLOW);

  for (const material of materials) {
    const tissue = material.userData.tissue as TissueData;
    material.color.copy(tissue.color);
    material.emissive.setHex(0);
    material.opacity = tissue.opacity;
    tissue.cut?.uniform.value.copy(tissue.cut.base);
    if (!present) continue;
    if (tissue.part === part) {
      material.emissive.copy(glow);
    } else {
      material.color.multiplyScalar(DIMMED);
      tissue.cut?.uniform.value.multiplyScalar(DIMMED);
      // Through a translucent sheet, darkening alone reads as grey haze; thinning the
      // unselected sheets is what lets the selected one stand out.
      if (material.transparent) material.opacity = tissue.opacity * FADED;
    }
  }
}

/**
 * Shows only the meshes of `part` — its surface included — or everything when `part` is
 * null. Returns false, changing nothing, when the model has no geometry for `part`:
 * hiding the whole organ around an empty selection would leave a blank viewer.
 */
export function setIsolated(root: Object3D, part: string | null): boolean {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node) && (node.material as Material).userData?.tissue) meshes.push(node);
  });
  const partOfMesh = (mesh: Mesh) => ((mesh.material as Material).userData.tissue as TissueData).part;

  if (part !== null && !meshes.some((mesh) => partOfMesh(mesh) === part)) return false;
  for (const mesh of meshes) mesh.visible = part === null || partOfMesh(mesh) === part;
  return true;
}
