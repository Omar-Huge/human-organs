/**
 * Tissue colour tests.
 *
 * Two halves: the palette data (every part of every organ has a look), and the code
 * that dresses a loaded model in it and highlights a selected part. Both run under
 * plain Node — three's scene graph and materials need no GPU until something draws.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BoxGeometry, BufferAttribute, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { MeshPhysicalMaterial } from 'three';

import { ENTITIES } from '../app/lib/subject-data.ts';
import { PALETTES, tissueFor } from '../app/lib/tissue.ts';
import { applyTissue, setHighlight, setIsolated } from '../app/lib/three/tint.ts';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

for (const entity of ENTITIES) {
  test(`${entity.id}: every derived hotspot has its own tissue colour`, () => {
    const palette = PALETTES[entity.id];
    assert.ok(palette, `no palette for ${entity.id}`);
    for (const hotspot of entity.hotspots) {
      if (hotspot.kind !== 'derived') continue;
      assert.ok(palette.parts[hotspot.id], `${entity.id} has no colour for part "${hotspot.id}"`);
    }
  });

  test(`${entity.id}: palette values are well-formed`, () => {
    const palette = PALETTES[entity.id];
    const looks = [palette.base, ...Object.values(palette.parts)];
    for (const look of looks) {
      if (look.color !== undefined) assert.match(look.color, HEX_COLOR);
      if (look.sheenColor !== undefined) assert.match(look.sheenColor, HEX_COLOR);
      for (const key of ['roughness', 'clearcoat', 'sheen', 'opacity'] as const) {
        const value = look[key];
        if (value === undefined) continue;
        assert.ok(value >= 0 && value <= 1, `${entity.id} ${key} ${value} is outside 0..1`);
      }
    }
  });
}

test('tissueFor falls back to the base for unknown and unclaimed parts', () => {
  const palette = PALETTES.heart;
  assert.equal(tissueFor(palette, 'rest').color, palette.base.color);
  assert.equal(tissueFor(palette, null).color, palette.base.color);
  assert.equal(tissueFor(palette, 'left-ventricle').color, palette.parts['left-ventricle'].color);
  // A part override inherits the finish it does not set.
  assert.equal(tissueFor(palette, 'left-ventricle').roughness, palette.base.roughness);
});

/** A stand-in for a loaded organ: named part nodes, each holding one mesh. */
function fakeHeart() {
  const root = new Group();
  const make = (name: string) => {
    const node = new Group();
    node.name = name;
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    node.add(mesh);
    root.add(node);
    return mesh;
  };
  return {
    root,
    ventricle: make('left-ventricle'),
    atrium: make('right-atrium'),
    rest: make('rest'),
  };
}

const colourOf = (mesh: Mesh) => (mesh.material as MeshPhysicalMaterial).color.getHexString();
const expected = (hex: string) => new Color(hex).getHexString();

test('applyTissue colours each mesh by the part node it sits under', () => {
  const { root, ventricle, atrium, rest } = fakeHeart();
  applyTissue(root, PALETTES.heart);

  assert.equal(colourOf(ventricle), expected(PALETTES.heart.parts['left-ventricle'].color!));
  assert.equal(colourOf(atrium), expected(PALETTES.heart.parts['right-atrium'].color!));
  assert.equal(colourOf(rest), expected(PALETTES.heart.base.color));
  assert.equal((ventricle.material as MeshPhysicalMaterial).isMeshPhysicalMaterial, true);
});

test('applyTissue makes translucent parts transparent and leaves solid ones opaque', () => {
  const root = new Group();
  const cornea = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  cornea.name = 'cornea';
  const sclera = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  sclera.name = 'sclera';
  root.add(cornea, sclera);

  applyTissue(root, PALETTES.eyeball);

  const corneaMaterial = cornea.material as MeshPhysicalMaterial;
  assert.equal(corneaMaterial.transparent, true);
  assert.ok(corneaMaterial.opacity < 1);
  assert.equal((sclera.material as MeshPhysicalMaterial).transparent, false);
});

test('setHighlight lights the selected part and dims the rest, then restores', () => {
  const { root, ventricle, atrium } = fakeHeart();
  applyTissue(root, PALETTES.heart);
  const atriumBefore = colourOf(atrium);

  setHighlight(root, 'left-ventricle', '#d63d4a');
  const lit = ventricle.material as MeshPhysicalMaterial;
  assert.ok(lit.emissive.r > 0, 'selected part should glow');
  assert.notEqual(colourOf(atrium), atriumBefore, 'other parts should dim');

  setHighlight(root, null, '#d63d4a');
  assert.equal(lit.emissive.getHex(), 0);
  assert.equal(colourOf(atrium), atriumBefore);
});

test('setHighlight on a part the model lacks leaves everything at full colour', () => {
  const { root, atrium } = fakeHeart();
  applyTissue(root, PALETTES.heart);
  const before = colourOf(atrium);
  // Skin's hotspots are authored, with no geometry of their own to light.
  setHighlight(root, 'no-such-part', '#d63d4a');
  assert.equal(colourOf(atrium), before);
});

test('applyTissue gives a generated surface its own translucent look, keyed to its part', () => {
  const root = new Group();
  const tree = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  tree.name = 'upper-lobe-right';
  const sheet = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  sheet.name = 'upper-lobe-right--surface';
  root.add(tree, sheet);

  applyTissue(root, PALETTES.lungs);

  const sheetMaterial = sheet.material as MeshPhysicalMaterial;
  assert.notEqual(sheetMaterial, tree.material, 'surface and tree should not share a material');
  assert.equal(sheetMaterial.transparent, true);

  // Highlighting the lobe lights both its tree and its surface.
  setHighlight(root, 'upper-lobe-right', '#3aa7a3');
  assert.ok(sheetMaterial.emissive.r + sheetMaterial.emissive.g > 0);
  assert.ok((tree.material as MeshPhysicalMaterial).emissive.g > 0);
});

test('setIsolated hides every part but one, and null shows them all again', () => {
  const { root, ventricle, atrium, rest } = fakeHeart();
  applyTissue(root, PALETTES.heart);

  assert.equal(setIsolated(root, 'left-ventricle'), true);
  assert.equal(ventricle.visible, true);
  assert.equal(atrium.visible, false);
  assert.equal(rest.visible, false);

  setIsolated(root, null);
  assert.ok([ventricle, atrium, rest].every((mesh) => mesh.visible));
});

test('setIsolated refuses a part with no geometry and leaves the model whole', () => {
  const { root, atrium } = fakeHeart();
  applyTissue(root, PALETTES.heart);
  assert.equal(setIsolated(root, 'no-such-part'), false);
  assert.equal(atrium.visible, true);
});

test('opaque parts paint their inside faces a flat cut colour, for the cross-section', () => {
  const { root, ventricle } = fakeHeart();
  applyTissue(root, PALETTES.heart);
  const material = ventricle.material as MeshPhysicalMaterial;

  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: 'void main() {\n#include <tonemapping_fragment>\n}',
    vertexShader: '',
  };
  material.onBeforeCompile(shader as never, null as never);

  assert.ok(shader.uniforms.cutColor, 'no cutColor uniform');
  assert.match(shader.fragmentShader, /gl_FrontFacing/);
  // Injected before tone mapping, so the cut colour is tone-mapped like everything else.
  assert.ok(shader.fragmentShader.indexOf('gl_FrontFacing') < shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));

  // Dimming for a highlight elsewhere dims the cut face too.
  const before = (shader.uniforms.cutColor.value as Color).getHex();
  setHighlight(root, 'right-atrium', '#d63d4a');
  assert.notEqual((shader.uniforms.cutColor.value as Color).getHex(), before);
});

test('the tissue shader adds noise-driven mottling, bumps and a flesh rim', () => {
  const { root, ventricle } = fakeHeart();
  applyTissue(root, PALETTES.heart);
  const material = ventricle.material as MeshPhysicalMaterial;

  const hooks = [
    '#include <color_fragment>',
    '#include <normal_fragment_maps>',
    '#include <tonemapping_fragment>',
  ];
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: `void main() {\n${hooks.join('\n')}\n}`,
    vertexShader: 'void main() {\n#include <project_vertex>\n}',
  };
  material.onBeforeCompile(shader as never, null as never);

  assert.equal(shader.uniforms.tissueScale.value, PALETTES.heart.detail.scale);
  assert.equal(shader.uniforms.tissueFlesh.value, PALETTES.heart.detail.flesh);
  assert.match(shader.vertexShader, /vTissuePos\s*=/);
  // Every hook survives, with the injected code alongside it.
  for (const hook of hooks) assert.ok(shader.fragmentShader.includes(hook), `lost ${hook}`);
  assert.match(shader.fragmentShader, /tissueNoise\(/);
  assert.match(shader.fragmentShader, /dFdx/);
});

test('applyTissue uses baked cavity shading when the geometry carries it', () => {
  const { root, ventricle } = fakeHeart();
  const count = ventricle.geometry.getAttribute('position').count;
  ventricle.geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(0.8), 3));
  applyTissue(root, PALETTES.heart);
  assert.equal((ventricle.material as MeshPhysicalMaterial).vertexColors, true);
});
