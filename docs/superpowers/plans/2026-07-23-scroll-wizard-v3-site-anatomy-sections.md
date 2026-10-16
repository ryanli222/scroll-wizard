# Scroll Wizard v3 — Plan 2: Site Anatomy / Section Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before each completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the generated page into an ordered, data-driven section composition with seven validated section types, deterministic v3 defaults, exact v2 legacy synthesis, a composed closing CTA, and progressively enhanced CSS `view()` reveals.

**Architecture:** Add one isomorphic pure module, `template/sections-core.js`, as the single source of truth for explicit-section normalization and no-sections synthesis. Both `scripts/scaffold-site.mjs` and the browser runtime call it so scaffolded output and direct legacy `config.json` fixtures cannot drift. Add `template/section-renderer.js` for DOM creation only. The renderer reuses and reorders the existing `#scrub` and `#outro` elements instead of rebuilding the scrub subtree, preserving all current scrub-engine element references and behavior. CSS owns layout and view-timeline enhancement; no section reveal installs a JavaScript scroll listener.

**Tech Stack:** Static HTML/CSS, vanilla ES modules, Node 20+, Vitest, Playwright Chromium. No build step, framework, or new runtime dependency.

## Global Constraints

- Implement only spec subsystem 2: section schema, section assembly and legacy synthesis, semantic rendering, composed CTA, and CSS `animation-timeline: view()` enhancement with a static fallback.
- Preserve Plan 1 behavior: direction presets, overlay variants/anchors, annotation point mapping, frame/video scrub behavior, focus/inert handling, and reduced-motion behavior.
- Do not implement Plan 3 interactions in this plan. In particular: no nav, hotspot wiring, config picker, spec-row jump, gallery lightbox/scrub action, email submission/inline success state, or cinematic-jump logic.
- Static vanilla-JS output only. Do not add a build step, framework, runtime package, or browser polyfill.
- No new JavaScript `scroll` listeners for section reveals. Baseline section content must be visible without `animation-timeline` support.
- Text over imagery must retain at least 4.5:1 contrast through the existing theme colors plus a CTA background scrim.
- Preserve section array order exactly. Explicit `sections: []` means the author intentionally selected no rendered sections; only an absent `sections` property triggers synthesis.
- Keep all layouts free of horizontal overflow at desktop and narrow mobile widths. Include `env(safe-area-inset-*)` in horizontal page gutters.
- Treat Plan 3-oriented fields (`rows[].beat`, `items[].beat`, and `emailCapture`) as semantic data hooks only in Plan 2.
- Never hand-edit generated `site/` files. Modify source templates and rerun the scaffold.
- Browser media fixtures must remain VP9 WebM-compatible with Playwright Chromium.
- Run focused RED/GREEN tests during each task. Before completion run `npx vitest run` and `npx playwright test`.

## Locked Section Contract

`config.sections`, when present, is an ordered array containing these shapes:

```js
[
  {
    type: 'masthead',
    eyebrow: 'Optional label',
    headline: 'Required non-empty string',
    sub: 'Optional supporting copy',
    scrollHint: 'Optional hint',
  },
  { type: 'scrub-hero' },
  {
    type: 'feature-split',
    headline: 'Required non-empty string',
    body: 'Optional supporting copy',
    side: 'left', // "left" | "right"; default "left"
    media: {
      kind: 'image', // "image" | "video"
      src: 'media/poster.webp',
      alt: 'Required for image; required descriptive fallback for video',
    },
  },
  { type: 'statement', text: 'Required non-empty string' },
  {
    type: 'spec',
    headline: 'Optional heading',
    rows: [{ label: 'Required', value: 'Required', beat: 2 }],
  },
  {
    type: 'gallery',
    headline: 'Optional heading',
    items: [{ src: 'media/still.webp', alt: 'Required when src exists', beat: 1 }],
  },
  {
    type: 'cta',
    headline: 'Required non-empty string',
    body: 'Optional supporting copy',
    cta: { label: 'Required', href: '#safe-target' },
    emailCapture: true,
    background: 'media/poster.webp',
  },
]
```

Contract details:

- Section `type` is one of `masthead`, `scrub-hero`, `feature-split`, `statement`, `spec`, `gallery`, or `cta`.
- `sections` may contain zero or one `scrub-hero`; duplicate scrub sections are invalid because there is one scrub engine and one reusable scrub DOM subtree.
- Unknown object keys remain forward-compatible and are ignored by Plan 2 rendering.
- `rows[].beat` and `items[].beat`, when present, are non-negative integers. Plan 2 emits them as `data-beat`; Plan 3 makes them interactive and validates them against navigable beats.
- A gallery item must provide at least one of `src` or `beat`. A beat-only item uses the active poster as its Plan 2 visual fallback.
- Image paths use the existing normalized `media/` or `frames/` asset rules. Feature video paths use the existing normalized `media/*.mp4|webm` rule. CTA links reuse existing safe-URL validation.
- `emailCapture: true` renders a labeled email input and submit button as inert integration markup: native `type="email"`/`required` constraints are allowed, but Plan 2 prevents submission and announces no fake success. Plan 3 owns inline validation and form wiring.
- If an explicit `cta` section exists, it supersedes `config.outro`. Otherwise, an absent `sections` property synthesizes a CTA from `outro`.

## Locked Synthesis Rules

`assembleSections(config)` is pure, never mutates its argument, and applies these rules:

1. If `config.sections` is present, return a deep-enough cloned array in the same order, including an explicit empty array.
2. If `sections` is absent and `register`, `archetype`, and `direction` are all absent, synthesize the legacy mix:
   - optional masthead only when `brand.tagline` is non-empty: `headline = brand.name`, `sub = brand.tagline`;
   - one `scrub-hero`;
   - one CTA: `headline = outro.headline || brand.name`, optional `body`/`cta` copied from `outro`, and `background = current poster`.
3. If any v3 mode field is present, synthesize the mode mix:
   - `product` or `full3d/teardown`: masthead → scrub-hero → spec → gallery → CTA;
   - `full3d/flythrough|walkthrough`: masthead → scrub-hero → statement → feature-split → CTA.
4. Default content is deterministic:
   - masthead uses `brand.name`, `brand.tagline`, and a default `"Scroll to explore"` hint;
   - product/teardown spec rows flatten overlay stats and copy the overlay index to `beat`;
   - product/teardown gallery items map overlays to beat-only items, with `alt = overlay.title || "Story beat N"`;
   - statement uses `brand.tagline`, then the first overlay title, then `brand.name`;
   - feature split uses the second overlay when available, otherwise the first; its media uses the active poster and `brand.imageAlt`, on side `right`;
   - CTA copies `outro`, falls back to `brand.name` for its headline, and uses the active poster as its background.
5. A synthesized `spec` or `gallery` with no derived items is omitted rather than rendering an empty decorative section. Remaining sections preserve the declared mix order.
6. `currentPoster(config)` returns `video.poster` in video mode and `frames.poster` otherwise.

---

### Task 1: Validate the `sections` schema

**Files:**

- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**

- Consumes: existing `validateConfig(config)`, safe asset validators, and `validateCta`.
- Produces: validation errors prefixed `sections.*`, `section.*`, `spec.*`, or `gallery.*`; no error when `sections` is absent.

- [ ] **Step 1: Write the failing enum and cardinality tests**

Add a focused `describe('validateConfig sections', ...)` block covering:

```js
it('accepts an absent sections property for v2 compatibility', () => {
  const { errors } = validateConfig(validConfig);
  expect(errors.filter((entry) => entry.path.startsWith('sections'))).toEqual([]);
});

it('rejects a non-array sections value', () => {
  const { errors } = validateConfig({ ...validConfig, sections: {} });
  expect(errors).toContainEqual(expect.objectContaining({ code: 'sections.type' }));
});

it('rejects unknown and duplicate scrub section types', () => {
  const { errors } = validateConfig({
    ...validConfig,
    sections: [{ type: 'scrub-hero' }, { type: 'carousel' }, { type: 'scrub-hero' }],
  });
  expect(errors.map((entry) => entry.code)).toEqual(
    expect.arrayContaining(['section.type', 'sections.scrub-duplicate']),
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/scrub-core.test.mjs -t "validateConfig sections"
```

Expected: FAIL because `validateConfig` does not inspect `sections`.

- [ ] **Step 3: Add per-type failing tests**

Cover every required field and enum:

- masthead requires `headline`;
- feature-split requires `headline`, `media`, valid `side`, valid media `kind/src/alt`;
- statement requires `text`;
- spec requires `rows`, and each row requires `label`/`value` with optional integer `beat`;
- gallery requires `items`, and each item requires `src` or `beat`;
- CTA requires `headline`, validates optional CTA through `validateCta`, boolean `emailCapture`, and safe optional `background`;
- valid full example and explicit `sections: []` pass.

Use exact path assertions such as:

```js
expect(errors).toContainEqual(expect.objectContaining({
  code: 'section.headline',
  path: 'sections[0].headline',
}));
```

- [ ] **Step 4: Implement section validation**

At module scope export the enum for reuse:

```js
export const SECTION_TYPES = [
  'masthead',
  'scrub-hero',
  'feature-split',
  'statement',
  'spec',
  'gallery',
  'cta',
];
```

Add small internal validators (`nonEmptyString`, `validateSectionMedia`,
`validateSection`) and call them from `validateConfig`. Count `scrub-hero`
entries after validating objects and emit `sections.scrub-duplicate` when the
count exceeds one.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/scrub-core.test.mjs -t "validateConfig sections"
```

Expected: PASS.

- [ ] **Step 6: Run the complete core suite**

Run:

```bash
npx vitest run tests/unit/scrub-core.test.mjs
```

Expected: PASS with all Plan 1 and v2 validation tests unchanged.

- [ ] **Step 7: Commit Task 1**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: validate site section schema"
```

---

### Task 2: Add pure section assembly and legacy synthesis

**Files:**

- Create: `template/sections-core.js`
- Create: `tests/unit/sections-core.test.mjs`

**Interfaces:**

```js
export function currentPoster(config) {}
export function assembleSections(config) {}
```

- [ ] **Step 1: Write failing explicit-section tests**

Test that `assembleSections`:

- preserves explicit order;
- respects `sections: []`;
- returns cloned section/row/item objects so mutation does not affect the source;
- selects the frame or video poster through `currentPoster`.

```js
it('preserves explicit order without mutating source data', () => {
  const config = {
    sections: [
      { type: 'statement', text: 'First' },
      { type: 'scrub-hero' },
      { type: 'cta', headline: 'Last' },
    ],
  };
  const result = assembleSections(config);
  expect(result.map(({ type }) => type)).toEqual(['statement', 'scrub-hero', 'cta']);
  result[0].text = 'Changed';
  expect(config.sections[0].text).toBe('First');
});
```

- [ ] **Step 2: Write failing legacy-synthesis tests**

Cover a v2 frame config with tagline/outro, a v2 config without tagline, and a
v2 video config. Assert the exact type list and exact CTA poster selection.

```js
expect(assembleSections(legacy).map(({ type }) => type))
  .toEqual(['masthead', 'scrub-hero', 'cta']);
expect(assembleSections({ ...legacy, brand: { name: 'Only' } }).map(({ type }) => type))
  .toEqual(['scrub-hero', 'cta']);
```

- [ ] **Step 3: Write failing v3 default-mix tests**

Cover:

- `product`;
- `full3d/teardown`;
- `full3d/flythrough`;
- `full3d/walkthrough`;
- content-aware omission of empty synthesized spec/gallery;
- flattened stats and overlay-index beat mappings;
- deterministic statement and feature-split fallbacks.

- [ ] **Step 4: Run the new suite and verify RED**

Run:

```bash
npx vitest run tests/unit/sections-core.test.mjs
```

Expected: FAIL because `template/sections-core.js` does not exist.

- [ ] **Step 5: Implement the pure module**

Use small, independently testable helpers:

```js
const clone = (value) => structuredClone(value);

export function currentPoster(config) {
  return config.video?.poster ?? config.frames?.poster;
}

export function assembleSections(config) {
  if (Object.hasOwn(config, 'sections')) return clone(config.sections);
  return isLegacy(config) ? legacySections(config) : modeSections(config);
}
```

Keep DOM APIs out of this file so Node can import the exact browser assembly
logic without jsdom.

- [ ] **Step 6: Run the new suite and verify GREEN**

Run:

```bash
npx vitest run tests/unit/sections-core.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add template/sections-core.js tests/unit/sections-core.test.mjs
git commit -m "feat: assemble section compositions"
```

---

### Task 3: Ask for and persist the visual ending treatment

**Files:**

- Modify: `SKILL.md`
- Modify: `tests/unit/skill-workflow.test.mjs`

**Decision contract:**

During Step 2 (Storyboard), before the free-text outline is approved, ask one
visual-only question:

> How should the page finish visually?
>
> 1. **Final-frame hold** — the scrub reaches its last frame and the page ends
>    there.
> 2. **Solid text continuation** — scrolling past the scrub reveals a solid
>    theme-background statement with centered text.

This choice never navigates to another URL. It only determines which sections
follow `scrub-hero` on the same document.

- [ ] **Step 1: Write the failing skill-workflow test**

Add:

```js
it('asks whether the page ends on-frame or continues to a solid text section', () => {
  expect(prose).toMatch(/How should the page finish visually/i);
  expect(prose).toMatch(/Final-frame hold.*page ends there/i);
  expect(prose).toMatch(/Solid text continuation.*solid theme-background statement/i);
  expect(prose).toMatch(/never navigates to another URL/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/skill-workflow.test.mjs -t "page ends on-frame"
```

Expected: FAIL because the storyboard workflow does not ask this question.

- [ ] **Step 3: Add the storyboard decision**

In `SKILL.md` Step 2, add the exact two-option question before drafting the
free-text outline. Persist the answer directly through section order:

- **Final-frame hold:** keep all approved pre-scrub sections, end the explicit
  `sections` array with `{ "type": "scrub-hero" }`, and add no post-scrub
  section.
- **Solid text continuation:** append
  `{ "type": "statement", "text": "<approved ending copy>" }` immediately after
  `scrub-hero`; ask for the ending copy and persist it before storyboard
  approval.

Do not add a separate `endingMode` field: the ordered `sections` array already
expresses the rendered result and remains the single source of truth.

- [ ] **Step 4: Run focused and complete workflow tests**

Run:

```bash
npx vitest run tests/unit/skill-workflow.test.mjs -t "page ends on-frame"
npx vitest run tests/unit/skill-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add SKILL.md tests/unit/skill-workflow.test.mjs
git commit -m "feat: ask for visual ending treatment"
```

---

### Task 4: Integrate section assembly into scaffold output

**Files:**

- Modify: `scripts/scaffold-site.mjs`
- Modify: `tests/unit/scaffold-site.test.mjs`

**Interfaces:**

- `assembleConfig(defaults, values, frameSet, mediaSet)` continues to return
  `{ config, warnings }`.
- Returned `config.sections` is always present after assembly, while direct
  browser configs remain compatible through Task 4 runtime assembly.

- [ ] **Step 1: Write failing scaffold tests**

Add tests proving:

- explicit `values.sections` order survives defaults and direction merging;
- legacy values synthesize masthead/scrub/CTA;
- full3d flythrough and teardown produce their correct default mixes;
- video-mode synthesized sections use `media/poster.webp`;
- invalid explicit sections fail through the existing aggregate
  `validateConfig` error path.

```js
const { config } = assembleConfig(defaults, {
  register: 'full3d',
  archetype: 'flythrough',
  direction: 'cinematic',
  brand: { name: 'World', tagline: 'Enter it' },
  overlays: [{ at: [0, 1], title: 'Arrival' }],
}, frameSet);

expect(config.sections.map(({ type }) => type)).toEqual([
  'masthead', 'scrub-hero', 'statement', 'feature-split', 'cta',
]);
```

- [ ] **Step 2: Run the focused scaffold tests and verify RED**

Run:

```bash
npx vitest run tests/unit/scaffold-site.test.mjs -t "sections"
```

Expected: FAIL because assembled configs do not yet populate `sections`.

- [ ] **Step 3: Assemble after the final media mode is known**

Import `assembleSections` from `../template/sections-core.js`. After
`config.frames` or `config.video` is finalized and before `validateConfig`:

```js
config.sections = assembleSections(config);
```

This placement is required so synthesized CTA/feature/gallery imagery uses the
actual output poster path.

- [ ] **Step 4: Run focused and full scaffold tests**

Run:

```bash
npx vitest run tests/unit/scaffold-site.test.mjs -t "sections"
npx vitest run tests/unit/scaffold-site.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/scaffold-site.mjs tests/unit/scaffold-site.test.mjs
git commit -m "feat: scaffold default site sections"
```

---

### Task 5: Render ordered semantic sections without rebuilding the scrub

**Files:**

- Create: `template/section-renderer.js`
- Modify: `template/index.html`
- Modify: `template/scrub-engine.js`
- Modify: `template/config.json`
- Modify: `tests/unit/template.test.mjs`

**Interfaces:**

```js
export function renderSections({
  container,
  scrubElement,
  outroElement,
  sections,
  poster,
}) {}
```

DOM contract:

- `<main id="site-sections" class="site-sections">`
- every rendered section has `.site-section`, `data-section`, and
  `data-section-index`;
- the existing scrub node gains `data-section="scrub-hero"` when used;
- the existing outro node gains `data-section="cta"` and is populated by the
  section renderer;
- `renderSections` returns `{ sectionNodes, formNodes }` for future Plan 3
  enhancement without wiring interactions now.

- [ ] **Step 1: Add failing static template tests**

Assert that:

- `index.html` contains the stable `#site-sections`, `#scrub`, and `#outro`
  anchors;
- `scrub-engine.js` imports and calls `assembleSections` and `renderSections`;
- the obsolete `renderOutro` function is absent;
- no new `addEventListener('scroll', ...)` or `onscroll` appears;
- `config.json` exercises all seven section types.

- [ ] **Step 2: Run the focused template tests and verify RED**

Run:

```bash
npx vitest run tests/unit/template.test.mjs -t "sections"
```

Expected: FAIL because the renderer and container contract are absent.

- [ ] **Step 3: Create semantic DOM builders**

Implement dependency-injected DOM rendering in `section-renderer.js`. Use
semantic elements:

- masthead: `<header>` content inside the section;
- feature split: `<figure>` plus text content;
- statement: `<blockquote>`;
- spec: `<dl>` rows, with `data-beat` only when present;
- gallery: `<ul>` of `<figure>` items, with non-interactive items in Plan 2;
- CTA: heading, accent rule, optional safe link, and optional labeled email
  form.

For media:

```js
function image(src, alt, className) {
  const node = document.createElement('img');
  node.src = src;
  node.alt = alt;
  node.className = className;
  node.loading = 'lazy';
  node.decoding = 'async';
  return node;
}
```

For a beat-only gallery item, render `poster` and retain its `data-beat`.
Feature videos must be `muted`, `playsInline`, `loop`, and must not autoplay
when `prefers-reduced-motion: reduce` matches.

- [ ] **Step 4: Reuse static scrub/outro anchors in array order**

Change `<main>` to `<main id="site-sections" class="site-sections">` but keep the
existing scrub subtree byte-for-byte apart from section classes/attributes.
`renderSections` must detach both reusable nodes, clear only the outro, append
sections in declared order, and leave an omitted scrub/outro detached.

- [ ] **Step 5: Integrate renderer into engine startup**

In `scrub-engine.js`:

```js
import { assembleSections, currentPoster } from './sections-core.js';
import { renderSections } from './section-renderer.js';
```

After validation/theme application and before copy rendering:

```js
const sections = assembleSections(config);
renderSections({
  container: document.getElementById('site-sections'),
  scrubElement: scrub,
  outroElement: outro,
  sections,
  poster: currentPoster(config),
});
```

Remove `renderOutro` and its call from `renderCopy`; preserve overlay and footer
rendering. If the explicit composition omits `scrub-hero`, skip scrub animation
startup after rendering while still showing all non-scrub sections.

- [ ] **Step 6: Expand the demo config**

Add an explicit, valid `sections` array to `template/config.json` that exercises
all seven types and uses only existing template asset paths. Do not add Plan 3
hotspots, nav, lightbox, or form-success behavior.

- [ ] **Step 7: Run focused and full unit tests**

Run:

```bash
npx vitest run tests/unit/template.test.mjs -t "sections"
npx vitest run
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add template/section-renderer.js template/index.html template/scrub-engine.js \
  template/config.json tests/unit/template.test.mjs
git commit -m "feat: render ordered site sections"
```

---

### Task 6: Style the section library, composed CTA, and progressive reveals

**Files:**

- Modify: `template/style.css`
- Modify: `tests/unit/template.test.mjs`

**CSS contract:**

- Baseline `.site-section` content is visible and transformed by `none`.
- Layout selectors are type-specific through `[data-section="..."]`.
- Only the feature query applies reveal keyframes:

```css
@supports (animation-timeline: view()) {
  .site-section:not([data-section="scrub-hero"]) .section-reveal {
    animation: section-reveal both linear;
    animation-timeline: view();
    animation-range: entry 10% cover 32%;
  }
}
```

- Reduced motion disables reveal animation and feature-video autoplay styling.
- CTA background uses a pseudo-element/absolute media layer plus a scrim; content
  remains above it and the page never transitions to a flat blank outro.

- [ ] **Step 1: Write failing CSS contract tests**

In `tests/unit/template.test.mjs`, assert:

- all seven `[data-section="..."]` selectors exist;
- `.site-section`/`.section-reveal` baseline is visible;
- `@supports (animation-timeline: view())`, `animation-timeline: view()`, and
  `animation-range` exist;
- `@media (prefers-reduced-motion: reduce)` disables section animation;
- CTA includes a scrim layer;
- horizontal gutters use both `max()` and `env(safe-area-inset-left/right)`;
- only `.overlay--panel` retains ordinary-content `backdrop-filter`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/unit/template.test.mjs -t "section styles"
```

Expected: FAIL because section layout/reveal styles are absent.

- [ ] **Step 3: Add shared section layout primitives**

Add:

- safe-area-aware `.site-section__inner` gutters;
- responsive type scale with bounded `clamp()`;
- feature split grid that collapses to one column;
- statement readable measure;
- spec metric grid and definition-list reset;
- gallery grid with `minmax(0, 1fr)` and media `max-width: 100%`;
- composed CTA with `isolation: isolate`, background media, scrim, and content
  z-index;
- `overflow-wrap: anywhere` on untrusted copy-bearing elements.

- [ ] **Step 4: Add progressive reveal and reduced-motion override**

Keep the static fallback outside `@supports`; do not hide content before feature
detection. Animate only `opacity`, `transform`, and a restrained `filter` blur,
using direction motion tokens already serialized by Plan 1.

Inside reduced motion:

```css
.site-section .section-reveal {
  animation: none !important;
  opacity: 1;
  transform: none;
  filter: none;
}
```

- [ ] **Step 5: Run focused tests and all unit tests**

Run:

```bash
npx vitest run tests/unit/template.test.mjs -t "section styles"
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add template/style.css tests/unit/template.test.mjs
git commit -m "feat: style responsive section compositions"
```

---

### Task 7: Add browser acceptance and legacy regression coverage

**Files:**

- Create: `tests/browser/sections.spec.mjs`
- Modify: `tests/browser/fixture-server.mjs`

**Fixture routes:**

- `/?fixture=sections` — explicit all-section composition.
- `/?fixture=legacy` — no `register`, `archetype`, `direction`, or `sections`.
- Preserve all existing default, direction, overlay-variant, and video fixtures.

- [ ] **Step 1: Add failing ordered-render acceptance test**

Assert exact DOM order and one reused scrub node:

```js
await page.goto('/?fixture=sections');
await expect(page.locator('[data-section]')).toHaveCount(7);
await expect(page.locator('[data-section]').evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.section)
)).resolves.toEqual([
  'masthead', 'scrub-hero', 'feature-split', 'statement', 'spec', 'gallery', 'cta',
]);
await expect(page.locator('#scrub[data-section="scrub-hero"]')).toHaveCount(1);
await expect(page.locator('#outro[data-section="cta"]')).toHaveCount(1);
```

Also assert semantic text, image alt text, `data-beat` hooks, CTA link, labeled
email field, and absence of page errors.

- [ ] **Step 2: Add failing legacy synthesis test**

Load `/?fixture=legacy` and assert:

- masthead/scrub/CTA render in that order;
- legacy brand, tagline, outro copy, and CTA link survive;
- the CTA background uses the legacy poster;
- scrub progress still changes after scrolling.

- [ ] **Step 3: Add failing overflow matrix**

At minimum test:

- desktop `1440 × 900`;
- narrow mobile `360 × 800`;
- coarse-pointer mobile project or context already used by the suite.

At each size:

```js
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
expect(overflow).toBeLessThanOrEqual(1);
```

Scroll each non-scrub section into view so lazy media and view-timeline states
are included in the measurement.

- [ ] **Step 4: Add failing reduced-motion acceptance test**

Create a context with `reducedMotion: 'reduce'`. Assert:

- every non-scrub `.section-reveal` is visible;
- computed animation name is `none`;
- transforms are `none`;
- feature videos are paused;
- the existing scrub reduced-motion poster behavior still passes.

- [ ] **Step 5: Run the new browser file and verify RED**

Run:

```bash
npx playwright test tests/browser/sections.spec.mjs
```

Expected: FAIL until fixture routing and all browser-facing section behavior are
complete.

- [ ] **Step 6: Add deterministic section and legacy fixtures**

Extend `fixture-server.mjs` by cloning the base fixture config and selecting it
from the existing query-param routing. Keep fixture generation dependency-free.
The explicit fixture must exercise all section types; the legacy fixture must
delete every v3 discriminator and `sections`.

- [ ] **Step 7: Iterate to GREEN without weakening assertions**

Run:

```bash
npx playwright test tests/browser/sections.spec.mjs
```

Expected: PASS.

- [ ] **Step 8: Run the complete verification matrix**

Run:

```bash
npx vitest run
npx playwright test
```

Expected: all existing and new tests PASS, with no skipped section acceptance
tests and no regression in Plan 1 overlay variants/directions.

- [ ] **Step 9: Review the diff for Plan 2 scope**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Confirm:

- no generated `site/` output is staged;
- no unrelated pre-existing untracked directories are staged;
- no Plan 3 interaction code entered the diff;
- no JavaScript section-reveal scroll listener exists.

- [ ] **Step 10: Commit Task 7**

```bash
git add tests/browser/sections.spec.mjs tests/browser/fixture-server.mjs
git commit -m "test: cover section compositions in browser"
```

---

## Plan 2 Completion Gate

Before requesting code review:

- [ ] Run `npx vitest run`.
- [ ] Run `npx playwright test`.
- [ ] Run `git diff --check`.
- [ ] Verify an explicit all-section config renders in declared order.
- [ ] Verify a v2 config with no v3 fields synthesizes masthead?/scrub/CTA.
- [ ] Verify the final CTA carries the active poster beneath a readable scrim.
- [ ] Verify 360px and 1440px viewports have no horizontal overflow.
- [ ] Verify reduced motion leaves all non-scrub content static and visible.
- [ ] Verify no section reveal is driven by a JavaScript scroll listener.
- [ ] Use `superpowers:requesting-code-review` for a final spec-compliance review.
- [ ] Do not begin Plan 3 until this plan is reviewed and accepted.

