# Scroll Wizard v3 — Plan 1: Directions & Overlay Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the art-direction token system (`register`/`archetype`/`direction`) and the extended overlay vocabulary (`variant`/`anchor`/`point` incl. teardown annotations) to the scaffold template and validator — the foundation the other four v3 plans build on.

**Architecture:** Additive, backward-compatible extension of the existing static vanilla-JS scaffold. New enums and a pure point→pixel helper go in `template/scrub-core.js` (unit-tested with Vitest). Direction token presets live as data in `references/directions.json` and are merged into `theme` by `scripts/scaffold-site.mjs`; explicit `theme` values always win. CSS gains `dir-*` presets + `variant`/`anchor`/annotation classes; the engine emits the classes and positions annotation/hotspot points via the new helper (Playwright-verified). No build step, no framework, no new runtime dependency.

**Tech Stack:** Vanilla ES modules, Vitest (unit), Playwright Chromium (browser), Node 20+ scaffold scripts.

## Global Constraints

- Static vanilla-JS output only — no build step, no framework, no new runtime dependency. Copied verbatim from spec: "AI-generated video … scroll-scrubbed, static vanilla JS, no build step, no WebGL, no framework."
- All schema changes are additive and backward-compatible: `register` absent ⇒ treat as `product`; `direction` absent ⇒ `minimal`; existing v2 configs must still validate and scaffold unchanged.
- Never hand-edit generated `site/` files — change `values.json` / template and re-run scaffold (scroll-wizard skill Core rule 5).
- Runtime hot path (per-frame scrub loop) animates only `transform`/`opacity`; never write a CSS variable on a shared ancestor per frame (spec §2.3 perf catch).
- Contrast: body text over any surface/footage must reach ≥4.5:1 (spec §2.4); direction presets must pass the existing `contrastRatio` checks in `validateConfig`.
- Enums (exact values, copied from spec §9): `register` ∈ {`full3d`,`product`}; `archetype` ∈ {`flythrough`,`walkthrough`,`teardown`} (required iff `register==="full3d"`); `direction` ∈ {`minimal`,`cinematic`,`technical`,`bold`}; overlay `variant` ∈ {`bare`,`hero`,`caption`,`metric`,`panel`,`annotation`}; overlay `anchor` ∈ {`top`,`middle`,`bottom`}.
- Test commands: `npx vitest run` (unit/integration), `npx playwright test` (browser). Browser video fixtures use VP9 WebM (Playwright Chromium cannot decode H.264).

---

### Task 1: Validate `register` / `archetype` / `direction`

**Files:**
- Modify: `template/scrub-core.js` (inside `validateConfig`, after the `brand.name` block ~line 279)
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Consumes: existing `validateConfig(config) → { errors, warnings }`, `issue(code, path, message)` helper, `addError(code, path, message)`.
- Produces: `validateConfig` now emits errors coded `register.enum`, `archetype.required`, `archetype.enum`, `direction.enum`. Absent fields produce no error (defaults applied downstream).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/scrub-core.test.mjs` inside the existing `describe('validateConfig', …)` block (or a new one):

```js
describe('validateConfig register/direction', () => {
  const base = () => structuredClone(validConfig);

  it('accepts a config with no register/direction (v2 back-compat)', () => {
    const { errors } = validateConfig(base());
    expect(errors).toEqual([]);
  });

  it('accepts product register without archetype', () => {
    const { errors } = validateConfig({ ...base(), register: 'product', direction: 'minimal' });
    expect(errors).toEqual([]);
  });

  it('rejects an unknown register', () => {
    const { errors } = validateConfig({ ...base(), register: 'hologram' });
    expect(errors.some((e) => e.code === 'register.enum')).toBe(true);
  });

  it('requires archetype when register is full3d', () => {
    const { errors } = validateConfig({ ...base(), register: 'full3d', direction: 'cinematic' });
    expect(errors.some((e) => e.code === 'archetype.required')).toBe(true);
  });

  it('accepts full3d with a valid archetype', () => {
    const { errors } = validateConfig({
      ...base(), register: 'full3d', archetype: 'teardown', direction: 'technical',
    });
    expect(errors).toEqual([]);
  });

  it('rejects an unknown archetype', () => {
    const { errors } = validateConfig({ ...base(), register: 'full3d', archetype: 'zoom' });
    expect(errors.some((e) => e.code === 'archetype.enum')).toBe(true);
  });

  it('rejects an unknown direction', () => {
    const { errors } = validateConfig({ ...base(), direction: 'brutalist' });
    expect(errors.some((e) => e.code === 'direction.enum')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t "register/direction"`
Expected: FAIL — unknown register/archetype/direction currently produce no error, so the `rejects`/`requires` assertions fail.

- [ ] **Step 3: Add the validation**

In `template/scrub-core.js`, inside `validateConfig`, immediately after the `brand.name` check (after line 279, before `const theme = …`):

```js
  const REGISTERS = ['full3d', 'product'];
  const ARCHETYPES = ['flythrough', 'walkthrough', 'teardown'];
  const DIRECTIONS = ['minimal', 'cinematic', 'technical', 'bold'];

  if (config.register !== undefined && !REGISTERS.includes(config.register)) {
    addError('register.enum', 'register', 'Register must be "full3d" or "product".');
  }
  if (config.register === 'full3d') {
    if (config.archetype === undefined) {
      addError('archetype.required', 'archetype',
        'Archetype is required when register is "full3d".');
    } else if (!ARCHETYPES.includes(config.archetype)) {
      addError('archetype.enum', 'archetype',
        'Archetype must be flythrough, walkthrough, or teardown.');
    }
  } else if (config.archetype !== undefined && !ARCHETYPES.includes(config.archetype)) {
    addError('archetype.enum', 'archetype',
      'Archetype must be flythrough, walkthrough, or teardown.');
  }
  if (config.direction !== undefined && !DIRECTIONS.includes(config.direction)) {
    addError('direction.enum', 'direction',
      'Direction must be minimal, cinematic, technical, or bold.');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t "register/direction"`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat(v3): validate register/archetype/direction enums"
```

---

### Task 2: Validate overlay `variant` / `anchor` / `point`

**Files:**
- Modify: `template/scrub-core.js` (inside the `overlays.forEach` loop, after the `position` check ~line 375)
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Consumes: the existing per-overlay validation loop and `addError`.
- Produces: new error codes `overlay.variant`, `overlay.anchor`, `overlay.point`. Rule: `variant`/`anchor` optional (defaults `bare`/`bottom` applied at render); when `variant === 'annotation'`, `point` is required and each of `point[0]`,`point[1]` must be a finite number in `[0,1]`.

- [ ] **Step 1: Write the failing tests**

```js
describe('validateConfig overlay variant/anchor/point', () => {
  const withOverlay = (overlay) => ({
    ...structuredClone(validConfig),
    overlays: [{ at: [0.2, 0.4], title: 'X', ...overlay }],
  });

  it('accepts an overlay with no variant/anchor (defaults)', () => {
    expect(validateConfig(withOverlay({})).errors).toEqual([]);
  });

  it('accepts every valid variant and anchor', () => {
    for (const variant of ['bare', 'hero', 'caption', 'metric', 'panel']) {
      expect(validateConfig(withOverlay({ variant, anchor: 'middle' })).errors).toEqual([]);
    }
  });

  it('rejects an unknown variant', () => {
    const { errors } = validateConfig(withOverlay({ variant: 'jumbotron' }));
    expect(errors.some((e) => e.code === 'overlay.variant')).toBe(true);
  });

  it('rejects an unknown anchor', () => {
    const { errors } = validateConfig(withOverlay({ anchor: 'baseline' }));
    expect(errors.some((e) => e.code === 'overlay.anchor')).toBe(true);
  });

  it('requires point when variant is annotation', () => {
    const { errors } = validateConfig(withOverlay({ variant: 'annotation' }));
    expect(errors.some((e) => e.code === 'overlay.point')).toBe(true);
  });

  it('accepts an annotation with an in-range point', () => {
    expect(validateConfig(withOverlay({ variant: 'annotation', point: [0.6, 0.44] })).errors)
      .toEqual([]);
  });

  it('rejects an out-of-range point', () => {
    const { errors } = validateConfig(withOverlay({ variant: 'annotation', point: [1.5, 0.4] }));
    expect(errors.some((e) => e.code === 'overlay.point')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t "variant/anchor/point"`
Expected: FAIL — unknown variant/anchor and missing/out-of-range point currently pass.

- [ ] **Step 3: Add the validation**

In `template/scrub-core.js`, inside `overlays.forEach`, right after the existing `overlay.position` check (after line 375):

```js
    if (overlay.variant !== undefined
        && !['bare', 'hero', 'caption', 'metric', 'panel', 'annotation'].includes(overlay.variant)) {
      addError('overlay.variant', path + '.variant',
        'Variant must be bare, hero, caption, metric, panel, or annotation.');
    }
    if (overlay.anchor !== undefined
        && !['top', 'middle', 'bottom'].includes(overlay.anchor)) {
      addError('overlay.anchor', path + '.anchor', 'Anchor must be top, middle, or bottom.');
    }
    const needsPoint = overlay.variant === 'annotation';
    if (needsPoint || overlay.point !== undefined) {
      const pt = overlay.point;
      const valid = Array.isArray(pt) && pt.length === 2
        && pt.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
      if (!valid) {
        addError('overlay.point', path + '.point',
          'Point must be [x, y] with each value in [0, 1]' + (needsPoint ? ' (required for annotation).' : '.'));
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t "variant/anchor/point"`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat(v3): validate overlay variant/anchor/point"
```

---

### Task 3: `pointToPixel` cover-rect mapping helper

**Files:**
- Modify: `template/scrub-core.js` (add exported function after `coverRect`, ~line 81)
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Consumes: existing `coverRect(imgW, imgH, canvasW, canvasH) → { sx, sy, sw, sh }`.
- Produces: `pointToPixel(point, imgW, imgH, boxW, boxH) → { x, y }` — maps a normalized `[nx, ny]` (0..1, top-left origin) on the source image to a pixel offset **within the box** after `object-fit: cover` cropping. Used by the engine (Task 7) and by hotspots (Plan 3) to pin annotations/dots to a spot on the footage across responsive crops. Returns `{ x: NaN, y: NaN }` on invalid input.

- [ ] **Step 1: Write the failing tests**

```js
describe('pointToPixel', () => {
  it('maps center to box center regardless of crop', () => {
    const p = pointToPixel([0.5, 0.5], 1000, 500, 800, 800);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(400);
  });

  it('maps a point on a wider-than-box image (horizontal crop)', () => {
    // image 1000x500 (aspect 2) into 500x500 box (aspect 1): cover crops width,
    // visible source x-range is [250,750]; nx=0.5 -> box center; nx=0.75 -> right edge.
    const mid = pointToPixel([0.5, 0.5], 1000, 500, 500, 500);
    expect(mid.x).toBeCloseTo(250);
    const right = pointToPixel([0.75, 0.5], 1000, 500, 500, 500);
    expect(right.x).toBeCloseTo(500);
    const left = pointToPixel([0.25, 0.5], 1000, 500, 500, 500);
    expect(left.x).toBeCloseTo(0);
  });

  it('maps a point on a taller-than-box image (vertical crop)', () => {
    const mid = pointToPixel([0.5, 0.5], 500, 1000, 500, 500);
    expect(mid.y).toBeCloseTo(250);
    const bottom = pointToPixel([0.5, 0.75], 500, 1000, 500, 500);
    expect(bottom.y).toBeCloseTo(500);
  });

  it('returns NaN for invalid input', () => {
    const p = pointToPixel([0.5, 0.5], 0, 500, 800, 800);
    expect(Number.isNaN(p.x)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t pointToPixel`
Expected: FAIL with "pointToPixel is not defined" (also add it to the import list at the top of the test file).

- [ ] **Step 3: Implement the helper**

In `template/scrub-core.js`, immediately after `coverRect` (after line 81):

```js
// Maps a normalized [nx, ny] on the source image to a pixel offset within a
// box that displays the image with object-fit: cover. Inverse of the crop in
// coverRect: the visible source window is [sx, sx+sw] x [sy, sy+sh], scaled to
// fill the box. Used to pin annotations/hotspots to a spot on the footage.
export function pointToPixel(point, imgW, imgH, boxW, boxH) {
  const [nx, ny] = Array.isArray(point) ? point : [NaN, NaN];
  const crop = coverRect(imgW, imgH, boxW, boxH);
  if (crop.sw <= 0 || crop.sh <= 0
      || ![nx, ny, boxW, boxH].every(Number.isFinite)) {
    return { x: NaN, y: NaN };
  }
  const srcX = nx * imgW;
  const srcY = ny * imgH;
  return {
    x: ((srcX - crop.sx) / crop.sw) * boxW,
    y: ((srcY - crop.sy) / crop.sh) * boxH,
  };
}
```

Add `pointToPixel` to the import list in `tests/unit/scrub-core.test.mjs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scrub-core.test.mjs -t pointToPixel`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat(v3): add pointToPixel cover-rect mapping"
```

---

### Task 4: Direction token presets data file

**Files:**
- Create: `references/directions.json`
- Test: `tests/unit/directions.test.mjs`

**Interfaces:**
- Produces: a JSON object keyed by direction name; each value is `{ theme: {...}, motion: {...}, chromeStyle, scrimStrength }`. `theme` uses the same token shape `validateConfig` expects (`bg`,`text`,`accent`,`surface`,`radius`,`fonts.{display,body}`). Consumed by scaffold (Task 5) and CSS/engine (Tasks 6–7).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/directions.test.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, validateConfig } from '../../template/scrub-core.js';

const presets = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../references/directions.json', import.meta.url)), 'utf8',
));

const baseConfig = {
  brand: { name: 'Test' },
  frames: { count: 24, pattern: 'frames/frame-{index:4}.webp', poster: 'frames/frame-0001.webp' },
  scrub: { heightVh: 400, smoothing: 0.12 },
  overlays: [],
};

describe('directions.json', () => {
  it('defines all four directions', () => {
    expect(Object.keys(presets).sort()).toEqual(['bold', 'cinematic', 'minimal', 'technical']);
  });

  it('each preset theme passes validateConfig contrast rules', () => {
    for (const [name, preset] of Object.entries(presets)) {
      const { errors } = validateConfig({ ...baseConfig, direction: name, theme: preset.theme });
      expect(errors, name + ': ' + JSON.stringify(errors)).toEqual([]);
    }
  });

  it('each preset has body text >= 4.5:1 on its bg', () => {
    for (const [name, preset] of Object.entries(presets)) {
      expect(contrastRatio(preset.theme.text, preset.theme.bg), name)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('each preset declares motion + chrome fields', () => {
    for (const preset of Object.values(presets)) {
      expect(typeof preset.motion.ease).toBe('string');
      expect(typeof preset.chromeStyle).toBe('string');
      expect(typeof preset.scrimStrength).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/directions.test.mjs`
Expected: FAIL — `references/directions.json` does not exist (readFileSync throws).

- [ ] **Step 3: Create the data file**

Create `references/directions.json` (values verified to pass contrast in Step 4; tune only if a contrast test fails):

```json
{
  "minimal": {
    "theme": {
      "bg": "#0b0b0c", "text": "#f5f5f7", "accent": "#2997ff",
      "surface": "rgba(11, 11, 12, 0.7)", "radius": 12,
      "fonts": {
        "display": "-apple-system, \"SF Pro Display\", system-ui, sans-serif",
        "body": "-apple-system, \"SF Pro Text\", system-ui, sans-serif"
      }
    },
    "motion": { "ease": "cubic-bezier(0.23, 1, 0.32, 1)", "springBounce": 0, "revealTravelPx": 16 },
    "chromeStyle": "quiet",
    "scrimStrength": 0.5
  },
  "cinematic": {
    "theme": {
      "bg": "#12130f", "text": "#eceae3", "accent": "#c9b48a",
      "surface": "rgba(18, 19, 15, 0.72)", "radius": 2,
      "fonts": {
        "display": "\"Times New Roman\", Georgia, serif",
        "body": "Georgia, \"Times New Roman\", serif"
      }
    },
    "motion": { "ease": "cubic-bezier(0.4, 0, 0.2, 1)", "springBounce": 0, "revealTravelPx": 12 },
    "chromeStyle": "meta-strip",
    "scrimStrength": 0.65
  },
  "technical": {
    "theme": {
      "bg": "#0a0a0a", "text": "#fafafa", "accent": "#ff3b30",
      "surface": "rgba(10, 10, 10, 0.8)", "radius": 0,
      "fonts": {
        "display": "\"SFMono-Regular\", ui-monospace, \"Cascadia Mono\", monospace",
        "body": "ui-monospace, \"SFMono-Regular\", monospace"
      }
    },
    "motion": { "ease": "cubic-bezier(0.85, 0, 0.15, 1)", "springBounce": 0, "revealTravelPx": 0 },
    "chromeStyle": "grid-index",
    "scrimStrength": 0.55
  },
  "bold": {
    "theme": {
      "bg": "#0e1f13", "text": "#f2f7f0", "accent": "#b8ff3a",
      "surface": "rgba(14, 31, 19, 0.72)", "radius": 20,
      "fonts": {
        "display": "\"Helvetica Neue\", Arial, sans-serif",
        "body": "\"Helvetica Neue\", Arial, sans-serif"
      }
    },
    "motion": { "ease": "cubic-bezier(0.16, 1, 0.3, 1)", "springBounce": 0.2, "revealTravelPx": 24 },
    "chromeStyle": "solid",
    "scrimStrength": 0.4
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/directions.test.mjs`
Expected: PASS. If a `contrast.*` error appears for a preset, darken that preset's `bg` or lighten its `text` until `contrastRatio(text, bg) ≥ 4.5` and re-run — do not weaken the validator.

- [ ] **Step 5: Commit**

```bash
git add references/directions.json tests/unit/directions.test.mjs
git commit -m "feat(v3): add direction token presets"
```

---

### Task 5: Scaffold merges the direction preset into theme

**Files:**
- Modify: `scripts/scaffold-site.mjs` (`assembleConfig`, ~lines 76–101; and load `directions.json` near the template-dir constants ~line 22)
- Test: `tests/unit/scaffold-site.test.mjs`

**Interfaces:**
- Consumes: `assembleConfig(defaults, values, frameSet, mediaSet)` (exported from `scaffold-site.mjs`), `references/directions.json`.
- Produces: when `values.direction` is set, the assembled `config.theme` is the direction preset merged **under** any explicit `values.theme` (explicit wins); `config.direction` is preserved on the output. When `values.direction` is absent, behavior is unchanged from v2.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/scaffold-site.test.mjs` (mirror the existing import of `assembleConfig`; if the suite imports it, reuse that):

```js
describe('assembleConfig direction presets', () => {
  const defaults = {
    brand: { name: 'D' },
    theme: { bg: '#000', text: '#fff', accent: '#0f0', surface: 'rgba(0,0,0,0.8)', radius: 8,
      fonts: { display: 'serif', body: 'sans-serif' } },
    scrub: { heightVh: 400, smoothing: 0.12 },
  };
  const frameSet = { count: 24, pattern: 'frames/frame-{index:4}.webp', extension: 'webp' };

  it('applies the cinematic preset font when direction is set', () => {
    const { config } = assembleConfig(defaults, {
      brand: { name: 'D' }, direction: 'cinematic',
    }, frameSet, null);
    expect(config.direction).toBe('cinematic');
    expect(config.theme.fonts.display).toMatch(/serif/i);
    expect(config.theme.accent).toBe('#c9b48a');
  });

  it('lets an explicit theme value override the preset', () => {
    const { config } = assembleConfig(defaults, {
      brand: { name: 'D' }, direction: 'cinematic', theme: { accent: '#ff0000' },
    }, frameSet, null);
    expect(config.theme.accent).toBe('#ff0000');
  });

  it('is unchanged when no direction is given', () => {
    const { config } = assembleConfig(defaults, { brand: { name: 'D' } }, frameSet, null);
    expect(config.theme.accent).toBe('#0f0');
    expect(config.direction).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/scaffold-site.test.mjs -t "direction presets"`
Expected: FAIL — preset is not applied; `config.theme.accent` stays the default.

- [ ] **Step 3: Load presets and merge them**

Near the top of `scripts/scaffold-site.mjs`, after `DEFAULT_TEMPLATE_DIR` (~line 22):

```js
const DIRECTIONS = JSON.parse(
  await readFile(fileURLToPath(new URL('../references/directions.json', import.meta.url)), 'utf8'),
);
```

(`readFile` is already imported from `node:fs/promises`; `fileURLToPath` from `node:url`. If the module is not already top-level `await`, load it lazily inside `assembleConfig` instead — see note.) In `assembleConfig`, replace the `theme:` block of the assembled `config` object (lines ~95–99) so the preset sits **under** defaults+explicit:

```js
    theme: {
      ...defaults.theme,
      ...(DIRECTIONS[creative.direction]?.theme ?? {}),
      ...creative.theme,
      fonts: {
        ...defaults.theme.fonts,
        ...DIRECTIONS[creative.direction]?.theme?.fonts,
        ...creative.theme?.fonts,
      },
    },
```

Note on `await`: if `assembleConfig`'s module cannot use top-level `await`, make `DIRECTIONS` a lazy `let` populated by a small `loadDirections()` called at the start of the scaffold entrypoint, and pass it in — keep the merge logic identical. The unit test imports `assembleConfig` directly, so prefer top-level `await` (Node ESM supports it) to keep the signature unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scaffold-site.test.mjs -t "direction presets"`
Expected: PASS (all 3). Then run the whole scaffold suite to confirm no regression: `npx vitest run tests/unit/scaffold-site.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/scaffold-site.mjs tests/unit/scaffold-site.test.mjs
git commit -m "feat(v3): scaffold merges direction preset under explicit theme"
```

---

### Task 6: CSS — `dir-*` presets, `variant`/`anchor` classes, annotation leader line

**Files:**
- Modify: `template/style.css` (overlay block ~lines 151–167; add new blocks)
- Modify: `template/config.json` (demo: add `direction` + one `annotation` overlay so the browser test has something to assert)
- Test: `tests/browser/overlay-variants.spec.mjs` (new; mirror existing Playwright specs under `tests/browser/` — confirm dir/naming with `ls tests/browser`)

**Interfaces:**
- Consumes: body class `dir-<direction>` and overlay classes `overlay--<variant>`, `overlay--anchor-<anchor>` (emitted by the engine in Task 7).
- Produces: CSS that positions each anchor, styles each variant, and draws the annotation leader line from a CSS-variable pixel point (`--px`,`--py` set by the engine). No behavior depends on JS for the resting (visible) state — reveal only refines an already-visible default (spec §2.3 reveal-safety).

- [ ] **Step 1: Write the failing browser test**

Create `tests/browser/overlay-variants.spec.mjs` (adapt import/serve harness to match the existing browser specs — check one sibling file first):

```js
import { test, expect } from '@playwright/test';
// Assumes the shared harness serves template/ over http (see sibling specs).
test.describe('overlay variants & anchors', () => {
  test('hero variant is centered and large', async ({ page }) => {
    await page.goto('/?config=variants'); // harness maps this to a variants fixture
    const hero = page.locator('.overlay--hero').first();
    await expect(hero).toHaveClass(/overlay--anchor-middle|overlay--hero/);
    const fontSize = await hero.locator('.overlay__title').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThan(40);
  });

  test('annotation renders a leader line element', async ({ page }) => {
    await page.goto('/?config=variants');
    await expect(page.locator('.overlay--annotation .overlay__leader').first()).toBeVisible();
  });

  test('body gets the direction class', async ({ page }) => {
    await page.goto('/?config=variants');
    await expect(page.locator('body')).toHaveClass(/dir-technical/);
  });
});
```

> If the existing browser harness has no `?config=` switch, instead point this spec at a small fixture HTML that loads `scrub-engine.js` with a variants config; keep the three assertions. Match whatever pattern the sibling specs already use rather than inventing a new server.

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/browser/overlay-variants.spec.mjs`
Expected: FAIL — classes/leader element/`dir-*` not present yet.

- [ ] **Step 3: Add the CSS**

In `template/style.css`, replace the current overlay placement block (lines 151–167) with the anchor-aware version, and append the variant + direction blocks:

```css
.overlays { position: absolute; inset: 0; pointer-events: none; perspective: 1000px; }
.overlay {
  position: absolute;
  width: min(34rem, calc(100% - 2rem));
  transform: translateX(var(--tx, 0))
    rotateX(calc((1 - var(--reveal, 1)) * 6deg));
  translate: 0 calc((1 - var(--reveal, 1)) * var(--reveal-travel, 24px));
  opacity: 0;
  filter: blur(calc((1 - var(--reveal, 1)) * 4px));
  transition: translate 320ms var(--ease, cubic-bezier(.16,1,.3,1)),
    transform 260ms var(--ease, cubic-bezier(.16,1,.3,1)),
    opacity 260ms var(--ease, cubic-bezier(.16,1,.3,1)),
    filter 260ms var(--ease, cubic-bezier(.16,1,.3,1));
}
/* Horizontal */
.overlay--center { left: 50%; --tx: -50%; }
.overlay--left   { left: clamp(1.5rem, 5vw, 5rem); }
.overlay--right  { right: clamp(1.5rem, 5vw, 5rem); }
/* Vertical anchor */
.overlay--anchor-bottom { bottom: clamp(3rem, 10vh, 7rem); }
.overlay--anchor-top    { top: clamp(4.5rem, 13vh, 9rem); }
.overlay--anchor-middle { top: 50%; translate: 0 calc(-50% + (1 - var(--reveal,1)) * var(--reveal-travel,24px)); }

/* Variants */
.overlay--hero { width: min(60rem, calc(100% - 4rem)); text-align: center; }
.overlay--hero .overlay__title { font-size: clamp(2.75rem, 8vw, 6rem); letter-spacing: -.03em; }
.overlay--hero .overlay__body  { max-width: 46ch; margin-inline: auto; }
.overlay--caption { width: min(22rem, calc(100% - 2rem)); }
.overlay--caption .overlay__title { font-size: clamp(1rem, 2vw, 1.4rem); }
.overlay--metric .overlay__title  { font-size: clamp(3rem, 10vw, 7rem); line-height: .95; }
.overlay--panel {
  background: var(--surface);
  backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: var(--radius);
  padding: clamp(1.25rem, 3vw, 2rem);
}
/* Annotation: label + leader line to a pixel point set by the engine */
.overlay--annotation { width: max-content; max-width: 18rem; }
.overlay__leader {
  position: absolute;
  left: 0; top: 0;
  width: var(--leader-len, 2rem);
  height: 1px;
  background: var(--accent);
  transform-origin: left center;
  transform: rotate(var(--leader-angle, 0deg));
  pointer-events: none;
}
.overlay__leader::after {
  content: ""; position: absolute; right: -3px; top: -2px;
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
}

/* Direction presets — mirror references/directions.json for the browser.
   Body dir-* class overrides :root tokens; engine still applies exact theme
   from config, these are the structural/motion knobs CSS needs. */
body.dir-minimal   { --ease: cubic-bezier(.23,1,.32,1); --reveal-travel: 16px; }
body.dir-cinematic { --ease: cubic-bezier(.4,0,.2,1);   --reveal-travel: 12px; }
body.dir-technical { --ease: cubic-bezier(.85,0,.15,1); --reveal-travel: 0px; }
body.dir-bold      { --ease: cubic-bezier(.16,1,.3,1);  --reveal-travel: 24px; }
/* Opt-in scaffolding: hidden unless the direction/beat asks for it (spec §2.4). */
.overlay__index, .overlay__kicker { display: none; }
.overlay--show-index .overlay__index { display: block; }
.overlay--show-kicker .overlay__kicker { display: block; }
```

Add a reduced-motion guard in the existing `@media (prefers-reduced-motion: reduce)` block:

```css
  .overlay { filter: none !important; transition: opacity 200ms ease; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/browser/overlay-variants.spec.mjs`
Expected: PASS (all 3). Requires Task 7's engine changes for the classes to be emitted — if running Task 6 in isolation, expect the `dir-technical`/class assertions to stay red until Task 7 lands; sequence 6 and 7 together in one review.

- [ ] **Step 5: Commit**

```bash
git add template/style.css template/config.json tests/browser/overlay-variants.spec.mjs
git commit -m "feat(v3): direction + variant/anchor CSS and annotation leader line"
```

---

### Task 7: Engine emits classes, applies direction, positions annotations

**Files:**
- Modify: `template/scrub-engine.js` (`renderOverlay` ~lines 48–74; `applyTheme` ~lines 83–94; the frame loop `tick`/`runEngine` and `runVideoEngine` for annotation positioning)
- Modify: `template/index.html` (nothing structural required; verify overlay layer id unchanged)
- Test: `tests/browser/overlay-variants.spec.mjs` (extends Task 6's spec with an annotation-tracking assertion)

**Interfaces:**
- Consumes: `pointToPixel` (Task 3), config fields `direction`, overlay `variant`/`anchor`/`point`, and the existing `coverRect`/`drawCover` sizing already computed in the loop.
- Produces: each overlay node carries `overlay overlay--<variant> overlay--<position> overlay--anchor-<anchor>` (and `overlay--show-index`/`overlay--show-kicker` only when the data opts in); `document.body` gets `dir-<direction>`; annotation overlays get `--px`/`--py`/`--leader-angle`/`--leader-len` set from `pointToPixel` each time the sticky box resizes (not per frame — position is frame-independent for a fixed cover crop).

- [ ] **Step 1: Write the failing test (extends Task 6 spec)**

Append to `tests/browser/overlay-variants.spec.mjs`:

```js
test('annotation leader point tracks the box on resize', async ({ page }) => {
  await page.goto('/?config=variants');
  const leader = page.locator('.overlay--annotation').first();
  await page.setViewportSize({ width: 1200, height: 800 });
  const wide = await leader.evaluate((el) => el.style.getPropertyValue('--px'));
  await page.setViewportSize({ width: 600, height: 800 });
  const narrow = await leader.evaluate((el) => el.style.getPropertyValue('--px'));
  expect(wide).not.toBe('');
  expect(wide).not.toBe(narrow); // cover crop differs -> pixel x differs
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/browser/overlay-variants.spec.mjs -g "tracks the box"`
Expected: FAIL — engine does not set `--px` yet.

- [ ] **Step 3: Implement the engine changes**

In `template/scrub-engine.js` `renderOverlay` (replace the class string and header, ~lines 48–57):

```js
function renderOverlay(data, index, total) {
  const variant = data.variant ?? 'bare';
  const anchor = data.anchor ?? 'bottom';
  const classes = ['overlay', 'overlay--' + variant,
    'overlay--' + (data.position ?? 'center'), 'overlay--anchor-' + anchor];
  if (data.showIndex) classes.push('overlay--show-index');
  if (data.kicker) classes.push('overlay--show-kicker');
  const panel = element('article', classes.join(' '));
  panel.dataset.overlayIndex = String(index);
  panel.inert = true;
  panel.append(element('span', 'overlay__index',
    String(index + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')));
  if (variant === 'annotation') {
    const leader = element('span', 'overlay__leader');
    panel.dataset.point = JSON.stringify(data.point);
    panel.prepend(leader);
  }
  // ... existing kicker/title/body/stats/cta appends unchanged ...
```

In `applyTheme` (after setting theme vars, ~line 93) add the body class:

```js
  if (config.direction) document.body.classList.add('dir-' + config.direction);
  document.documentElement.style.setProperty('--reveal-travel',
    (DIRECTION_TRAVEL[config.direction] ?? 24) + 'px');
```

Add near the top of the module: `const DIRECTION_TRAVEL = { minimal: 16, cinematic: 12, technical: 0, bold: 24 };` and import `pointToPixel` from `./scrub-core.js`.

Add an annotation-positioning function and call it from the existing resize handler (both `runEngine`'s `handleResize` and `runVideoEngine`'s resize path). It reads the poster/video natural size and the sticky box size:

```js
function positionAnnotations(sourceW, sourceH, boxW, boxH) {
  for (const node of overlayLayer.querySelectorAll('.overlay--annotation')) {
    const point = JSON.parse(node.dataset.point);
    const { x, y } = pointToPixel(point, sourceW, sourceH, boxW, boxH);
    if (!Number.isFinite(x)) continue;
    const rect = node.getBoundingClientRect();
    const boxRect = node.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const localX = rect.left - boxRect.left;
    const localY = rect.top - boxRect.top;
    const dx = x - localX;
    const dy = y - localY;
    node.style.setProperty('--px', x.toFixed(1));
    node.style.setProperty('--py', y.toFixed(1));
    node.style.setProperty('--leader-len', Math.hypot(dx, dy).toFixed(1) + 'px');
    node.style.setProperty('--leader-angle', (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + 'deg');
  }
}
```

Call `positionAnnotations(source.width, source.height, rect.width, rect.height)` from inside the existing `ResizeObserver` handler (`handleResize`) in `runEngine`, using the current `lastSource` bitmap (or the poster's `naturalWidth/Height` before the first frame), and from the equivalent resize path in `runVideoEngine` using `scrubVideo.videoWidth/Height`. Do **not** call it inside the per-frame `tick` — the mapping is frame-independent for a fixed crop, so resize + first-paint is sufficient (spec §2.3 perf).

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/browser/overlay-variants.spec.mjs`
Expected: PASS (all 4, including the resize-tracking test). Run the full browser suite to check no regression: `npx playwright test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add template/scrub-engine.js template/index.html tests/browser/overlay-variants.spec.mjs
git commit -m "feat(v3): engine emits variant/anchor/direction classes and positions annotations"
```

---

## Self-Review

**Spec coverage (Plan-1 slice of spec §2, §5, §9):**
- Direction enum + presets → Tasks 1, 4, 5 ✓
- register/archetype enum → Task 1 ✓
- Overlay `variant`/`anchor` → Tasks 2, 6, 7 ✓
- Annotation `point` + leader line + cover-rect tracking → Tasks 2, 3, 6, 7 ✓
- Opt-in eyebrow/index (spec §2.4 anti-slop) → Task 6 CSS + Task 7 `showIndex`/`kicker` gating ✓
- Motion craft (blur-in, custom ease, reduced-motion) → Task 6 CSS ✓
- Perf catch: no per-frame CSS-var writes; annotation positioned on resize only → Task 7 ✓
- Backward-compat (no register/direction still validates & scaffolds) → Task 1 test, Task 5 test ✓

**Deferred to later plans (not this plan):** section library / composed CTA (Plan 2); nav/hotspots/config/gallery/cinematic-jump (Plan 3); mode+inspiration gate & `status.mjs` (Plan 4); `.pen`-per-pause (Plan 5). Hotspots reuse `pointToPixel` from Task 3.

**Placeholder scan:** none — every code step has concrete code; browser-harness specifics flagged to match sibling specs (verify `tests/browser` layout before writing Task 6/7 specs).

**Type consistency:** `pointToPixel(point, imgW, imgH, boxW, boxH) → {x,y}` used identically in Tasks 3 and 7. Direction preset shape `{theme, motion, chromeStyle, scrimStrength}` consistent across Tasks 4, 5, 6. Class names `overlay--<variant>`, `overlay--anchor-<anchor>`, `dir-<direction>`, `overlay__leader` consistent across Tasks 6 and 7.

**Open verification for the implementer (do first):** Playwright `testDir` is `./tests/browser` with `baseURL: http://127.0.0.1:4173` and a configured `webServer` (confirmed); mirror the existing `tests/browser/smoke.spec.mjs` for the serve/goto harness — adapt the `/?config=variants` fixture switch to whatever `smoke.spec.mjs` already does rather than inventing a server. Also confirm whether `scaffold-site.mjs` can use top-level `await` for the `directions.json` load (Task 5 note). Neither changes the design, only the test wiring.
