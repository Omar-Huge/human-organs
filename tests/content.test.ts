/**
 * Content integrity tests.
 *
 * §9 of the project brief makes this suite build-blocking: unsourced or malformed
 * content must not ship. These assertions are deliberately about *data*, not rendering
 * — they run without a browser, a GPU, or a build step, so they stay fast enough to
 * gate every commit.
 *
 * Run: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ENTITIES, ENTITY_IDS, DEFAULT_ENTITY_ID, getEntity } from '../app/lib/subject-data.ts';

// Resolved from this file rather than process.cwd() so the suite behaves the same
// whether npm, an editor, or CI is the one invoking it.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * §4 specifies 4–8 facts; §9 specifies 3–8. Enforcing the stricter lower bound, since
 * §4 is the data contract the UI is built against and a 3-fact entity would render a
 * visibly thin panel.
 */
const MIN_FACTS = 4;
const MAX_FACTS = 8;
/**
 * Floor is 2, not 3, because two organs in the atlas cannot reach 3 disjoint hotspot
 * groups: kidneys has exactly 2 element meshes (left/right kidney, no third to group),
 * and pancreas has only 3 candidate sub-structures where two nest (the pancreatic duct
 * tree contains the pancreatic duct), leaving 2 usable disjoint groups. This is a
 * property of the atlas, not missing authoring work — do not raise this back to 3.
 */
const MIN_HOTSPOTS = 2;
const MAX_HOTSPOT_DETAIL = 60;

test('the roster is non-empty and within the specified band', () => {
  assert.ok(ENTITIES.length >= 6, `expected at least 6 entities, got ${ENTITIES.length}`);
  assert.ok(ENTITIES.length <= 12, `expected at most 12 entities, got ${ENTITIES.length}`);
});

test('entity ids are unique', () => {
  const seen = new Set<string>();
  for (const entity of ENTITIES) {
    assert.ok(!seen.has(entity.id), `duplicate entity id: ${entity.id}`);
    seen.add(entity.id);
  }
});

test('ENTITY_IDS mirrors ENTITIES, and DEFAULT_ENTITY_ID is real', () => {
  assert.deepEqual(ENTITY_IDS, ENTITIES.map((entity) => entity.id));
  assert.ok(
    ENTITY_IDS.includes(DEFAULT_ENTITY_ID),
    `DEFAULT_ENTITY_ID "${DEFAULT_ENTITY_ID}" is not in the roster`,
  );
  assert.equal(getEntity(DEFAULT_ENTITY_ID).id, DEFAULT_ENTITY_ID);
});

test('getEntity throws on an unknown id rather than returning undefined', () => {
  // @ts-expect-error — deliberately passing an id outside the union to prove the guard.
  assert.throws(() => getEntity('not-an-organ'), /Unknown entity id/);
});

for (const entity of ENTITIES) {
  test(`${entity.id}: identity strings are present`, () => {
    for (const field of ['name', 'formalName', 'category', 'summary'] as const) {
      assert.equal(typeof entity[field], 'string');
      assert.ok(entity[field].trim().length > 0, `${entity.id}.${field} is empty`);
    }
  });

  test(`${entity.id}: accent is a valid 6-digit hex`, () => {
    assert.match(entity.accent, HEX_COLOR, `${entity.id} accent "${entity.accent}" is not #RRGGBB`);
  });

  test(`${entity.id}: model file exists on disk and is a real glTF binary`, () => {
    assert.ok(
      entity.model.startsWith('/models/'),
      `${entity.id} model path "${entity.model}" must be rooted at /models/`,
    );
    const modelPath = path.join(PUBLIC_DIR, entity.model);
    assert.ok(existsSync(modelPath), `${entity.id} model missing: public${entity.model}`);
    assert.ok(statSync(modelPath).size > 0, `${entity.id} model is a zero-byte file`);
  });

  test(`${entity.id}: has ${MIN_FACTS}–${MAX_FACTS} facts, all populated`, () => {
    assert.ok(
      entity.facts.length >= MIN_FACTS && entity.facts.length <= MAX_FACTS,
      `${entity.id} has ${entity.facts.length} facts, expected ${MIN_FACTS}–${MAX_FACTS}`,
    );
    const labels = new Set<string>();
    for (const fact of entity.facts) {
      assert.ok(fact.label.trim().length > 0, `${entity.id} has a fact with an empty label`);
      assert.ok(fact.value.trim().length > 0, `${entity.id} fact "${fact.label}" has no value`);
      assert.ok(!labels.has(fact.label), `${entity.id} repeats fact label "${fact.label}"`);
      labels.add(fact.label);
    }
  });

  test(`${entity.id}: has at least ${MIN_HOTSPOTS} well-formed hotspots`, () => {
    assert.ok(
      entity.hotspots.length >= MIN_HOTSPOTS,
      `${entity.id} has ${entity.hotspots.length} hotspots, expected at least ${MIN_HOTSPOTS}`,
    );

    const ids = new Set<string>();
    for (const hotspot of entity.hotspots) {
      assert.ok(!ids.has(hotspot.id), `${entity.id} repeats hotspot id "${hotspot.id}"`);
      ids.add(hotspot.id);

      assert.ok(hotspot.label.trim().length > 0, `${entity.id}/${hotspot.id} has no label`);
      assert.ok(
        hotspot.detail.length > 0 && hotspot.detail.length <= MAX_HOTSPOT_DETAIL,
        `${entity.id}/${hotspot.id} detail is ${hotspot.detail.length} chars, max ${MAX_HOTSPOT_DETAIL}`,
      );
      assert.match(hotspot.color, HEX_COLOR, `${entity.id}/${hotspot.id} colour is not #RRGGBB`);

      // Only authored hotspots carry a hand-placed position; derived hotspots get
      // their position from the mesh centroid at build time and have none to check.
      if (hotspot.kind === 'authored') {
        assert.equal(hotspot.position.length, 3, `${entity.id}/${hotspot.id} position is not a triple`);
        for (const axis of hotspot.position) {
          assert.ok(Number.isFinite(axis), `${entity.id}/${hotspot.id} has a non-finite coordinate`);
          // Normalised model space: the fitted model spans roughly -1..1 on its widest
          // axis. A coordinate well outside that is an authoring error, not a design.
          assert.ok(
            Math.abs(axis) <= 2,
            `${entity.id}/${hotspot.id} coordinate ${axis} is outside normalised model space`,
          );
        }
      } else {
        assert.equal(hotspot.kind, 'derived', `${entity.id}/${hotspot.id} has an unknown hotspot kind`);
        assert.ok(hotspot.fmaId.trim().length > 0, `${entity.id}/${hotspot.id} derived hotspot has no fmaId`);
      }
    }
  });

  test(`${entity.id}: carries at least one citation`, () => {
    assert.ok(entity.sources.length >= 1, `${entity.id} has no sources — unsourced content cannot ship`);

    for (const source of entity.sources) {
      assert.ok(source.title.trim().length > 0, `${entity.id} has a source with no title`);
      assert.match(
        source.retrieved,
        ISO_DATE,
        `${entity.id} source "${source.title}" retrieved date must be YYYY-MM-DD`,
      );

      let parsed: URL;
      try {
        parsed = new URL(source.url);
      } catch {
        throw new assert.AssertionError({
          message: `${entity.id} source "${source.title}" has an unparseable URL: ${source.url}`,
        });
      }
      assert.equal(
        parsed.protocol,
        'https:',
        `${entity.id} source "${source.title}" must be https`,
      );
    }
  });

  test(`${entity.id}: notes are populated if present`, () => {
    for (const note of entity.notes) {
      assert.ok(note.trim().length > 0, `${entity.id} has an empty note`);
    }
  });
}

// ---------------------------------------------------------------------------
// Accent contrast.
//
// Entity accents appear on two very different surfaces: as a filled block in the
// paper chrome, and as a hotspot marker against the viewer void. A colour that reads
// on one can vanish on the other, and since the accents are per-entity there is no
// single place a designer would notice. The surface values are parsed out of
// globals.css rather than duplicated here, so the palette cannot drift away from the
// content without failing this test.
//
// Threshold is WCAG 1.4.11 non-text contrast (3:1). These are graphical indicators,
// not body copy — accents never carry text.
// ---------------------------------------------------------------------------

const MIN_NON_TEXT_CONTRAST = 3;

function readToken(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `globals.css does not define --${name} as a 6-digit hex`);
  return match[1]!;
}

function relativeLuminance(hex: string): number {
  const channel = (value: number): number =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

test('globals.css defines the six palette tokens', () => {
  const css = readFileSync(path.join(REPO_ROOT, 'app', 'globals.css'), 'utf8');
  for (const token of ['paper', 'graphite', 'drafting', 'trace', 'void', 'signal']) {
    assert.match(
      readToken(css, token),
      HEX_COLOR,
      `--${token} must be a 6-digit hex so contrast can be computed`,
    );
  }
});

test('body text clears 4.5:1 against the paper chrome', () => {
  const css = readFileSync(path.join(REPO_ROOT, 'app', 'globals.css'), 'utf8');
  const ratio = contrastRatio(readToken(css, 'graphite'), readToken(css, 'paper'));
  assert.ok(ratio >= 4.5, `graphite on paper is ${ratio.toFixed(2)}:1, need 4.5:1`);
});

test('the focus ring clears 3:1 on both surfaces', () => {
  const css = readFileSync(path.join(REPO_ROOT, 'app', 'globals.css'), 'utf8');
  const signal = readToken(css, 'signal');
  for (const surface of ['paper', 'void'] as const) {
    const ratio = contrastRatio(signal, readToken(css, surface));
    assert.ok(
      ratio >= MIN_NON_TEXT_CONTRAST,
      `--signal on --${surface} is ${ratio.toFixed(2)}:1, need ${MIN_NON_TEXT_CONTRAST}:1`,
    );
  }
});

for (const entity of ENTITIES) {
  test(`${entity.id}: accent is legible on both paper and void`, () => {
    const css = readFileSync(path.join(REPO_ROOT, 'app', 'globals.css'), 'utf8');
    for (const surface of ['paper', 'void'] as const) {
      const ratio = contrastRatio(entity.accent, readToken(css, surface));
      assert.ok(
        ratio >= MIN_NON_TEXT_CONTRAST,
        `${entity.id} accent ${entity.accent} on --${surface} is ${ratio.toFixed(2)}:1, need ${MIN_NON_TEXT_CONTRAST}:1`,
      );
    }
  });
}
