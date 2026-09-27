/**
 * Generated-parts integrity tests.
 *
 * anatomy-parts.json is a build artefact, not hand-authored, so what needs checking is
 * not its content but its contract with subject-data.ts: every `derived` hotspot must
 * resolve to a group the build actually measured, with a centroid inside normalised
 * model space, and `authored` hotspots must only exist where the atlas genuinely has
 * nothing to derive from (skin).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import parts from '../app/lib/generated/anatomy-parts.json' with { type: 'json' };
import { ENTITIES } from '../app/lib/subject-data.ts';

for (const entity of ENTITIES) {
  const groups = (parts as Record<string, Record<string, { centroid: number[] }>>)[entity.id];

  test(`${entity.id}: has a generated entry`, () => {
    assert.ok(groups, `${entity.id} is missing from anatomy-parts.json`);
  });

  for (const hotspot of entity.hotspots) {
    if (hotspot.kind !== 'derived') continue;
    test(`${entity.id}/${hotspot.id}: resolves to a generated group with an in-bounds centroid`, () => {
      const group = groups[hotspot.id];
      assert.ok(group, `${hotspot.id} has no generated group — rebuild with npm run build:organs`);
      for (const axis of group.centroid) {
        assert.ok(axis >= -1.5 && axis <= 1.5, `centroid ${group.centroid} is outside normalised space`);
      }
    });
  }

  test(`${entity.id}: authored hotspots only where nothing subdivides`, () => {
    const authored = entity.hotspots.filter((h) => h.kind === 'authored');
    if (authored.length === 0) return;
    const derivable = Object.keys(groups).filter((g) => g !== 'rest');
    assert.equal(derivable.length, 0, `${entity.id} has derivable geometry — authored hotspots are not allowed here`);
  });
}
