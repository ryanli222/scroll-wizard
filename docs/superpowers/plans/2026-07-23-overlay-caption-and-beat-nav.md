# Overlay Caption Restyle + Beat Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boxed/scrim overlay text treatment with an accent-line caption style, and add an opt-in floating "beat nav" pill bar (click-to-jump + active-state progression) to the scroll-wizard template.

**Architecture:** Two independent, additive changes to `template/`: (1) a CSS-only restyle of the existing `.overlay` markup (no new DOM, no schema change), and (2) a new opt-in feature gated by `values.json`'s `nav: true`, adding one new element to `index.html`, two new pure functions to `scrub-core.js`, and rendering/update logic to `scrub-engine.js`. Both ship in the shared template so every scaffolded project gets the restyle, and any project can opt into the nav.

**Tech Stack:** Vanilla JS (ES modules), plain CSS custom properties, Vitest (unit), Playwright (browser smoke tests). No new dependencies.

## Global Constraints

- `nav` is optional and defaults to off (`undefined`/`false`); omitting it from `values.json` must leave a project's generated site byte-for-byte behaviorally identical to today.
- The nav is hidden below the existing 700px mobile breakpoint already used in `style.css` — do not introduce a new breakpoint value.
- The nav is skipped entirely under `prefers-reduced-motion: reduce` (that path never reaches the scroll engine at all today; leave it that way).
- Do not change `.overlay`, `.overlay__title`, `.overlay__body`, `.overlay__cta`, `data-overlay-index`, or `.stats`/`.stat` DOM structure or class names — only their CSS properties. `tests/browser/smoke.spec.mjs` has existing assertions (tall-content internal scroll on mobile/coarse-pointer) that depend on the current structural CSS (`max-height`, `overflow-y`, `overscroll-behavior`, `scrollbar-gutter`) surviving unchanged.
- This is inspired by (not copied from) `oso95/scroll-world`'s nav pattern — write original code with this repo's own naming conventions (no `sw-` prefix, no lifted CSS/JS).
- No new npm dependencies.

---

### Task 1: `scrub-core.js` — scroll/beat math + nav config validation

**Files:**
- Modify: `template/scrub-core.js:1-8` (add `progressToScrollY` after `scrollProgress`)
- Modify: `template/scrub-core.js:96-104` (add `nearestOverlayIndex` after `overlayOpacity`)
- Modify: `template/scrub-core.js:277-280` (add `nav` field validation after the `brand.name` check)
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Produces: `progressToScrollY(progress: number, sectionTop: number, sectionHeight: number, viewportH: number): number` — exact inverse of `scrollProgress`; given a target progress (0–1) and the same three geometry inputs `scrollProgress` takes, returns the `scrollY` that would produce that progress.
- Produces: `nearestOverlayIndex(progress: number, overlays: Array<{ at: [number, number] }>): number` — returns the index of the overlay whose `at` range contains `progress`, or the closest *preceding* overlay's index if `progress` falls in a gap, or `0` if `progress` is before every overlay's start. Returns `-1` if `overlays` is empty or not an array.
- Consumes: nothing new — both are pure functions over existing `overlay.at` shape already validated by `validateConfig`.

- [ ] **Step 1: Write the failing unit tests**

Add this new `describe` block to `tests/unit/scrub-core.test.mjs`, right after the `import` statement's consumers are updated. First, update the import at the top of the file:

```js
import {
  alphaToK,
  applyHolds,
  canvasSize,
  contrastRatio,
  coverRect,
  decodeWindow,
  frameFilename,
  holdFrames,
  lingerEase,
  nearestOverlayIndex,
  overlayOpacity,
  progressToFrame,
  progressToScrollY,
  progressToTime,
  recommendHeightVh,
  scrollProgress,
  selectScrubMode,
  smooth,
  validateConfig,
} from '../../template/scrub-core.js';
```

Then add this block anywhere after the existing `describe('scrub mapping', ...)` block:

```js
describe('beat nav helpers', () => {
  it('inverts scrollProgress exactly', () => {
    const scrollY = progressToScrollY(0.4, 100, 500, 100);
    expect(scrollY).toBeCloseTo(260);
    expect(scrollProgress(scrollY, 100, 500, 100)).toBeCloseTo(0.4);
  });

  it('clamps progress and falls back to sectionTop for a degenerate section', () => {
    expect(progressToScrollY(2, 0, 500, 100)).toBe(500);
    expect(progressToScrollY(-1, 0, 500, 100)).toBe(0);
    expect(progressToScrollY(0.5, 10, 100, 100)).toBe(10);
  });

  const beats = [
    { at: [0, 0.2] },
    { at: [0.2, 0.4] },
    { at: [0.4, 0.6] },
  ];

  it('finds the beat containing the current progress', () => {
    expect(nearestOverlayIndex(0.1, beats)).toBe(0);
    expect(nearestOverlayIndex(0.3, beats)).toBe(1);
    expect(nearestOverlayIndex(0.6, beats)).toBe(2);
  });

  it('falls back to the closest preceding beat across a gap', () => {
    const withGap = [{ at: [0, 0.2] }, { at: [0.5, 0.7] }];
    expect(nearestOverlayIndex(0.3, withGap)).toBe(0);
  });

  it('falls back to beat 0 before the first beat starts', () => {
    expect(nearestOverlayIndex(0.1, [{ at: [0.3, 0.5] }])).toBe(0);
  });

  it('returns -1 for no overlays', () => {
    expect(nearestOverlayIndex(0.5, [])).toBe(-1);
    expect(nearestOverlayIndex(0.5, null)).toBe(-1);
  });
});
```

Also add this test inside the existing `describe('colors and config validation', ...)` block, right after the `it('accepts a complete valid config', ...)` test:

```js
  it('accepts a valid nav flag and rejects a non-boolean one', () => {
    expect(validateConfig({ ...validConfig, nav: true }).errors).toEqual([]);
    expect(validateConfig({ ...validConfig, nav: false }).errors).toEqual([]);
    const result = validateConfig({ ...validConfig, nav: 'yes' });
    expect(result.errors).toContainEqual({
      code: 'nav.type',
      path: 'nav',
      message: 'Nav must be a boolean.',
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/scrub-core.test.mjs`
Expected: FAIL — `progressToScrollY` and `nearestOverlayIndex` are not exported, and the `nav.type` error is never produced.

- [ ] **Step 3: Implement `progressToScrollY`**

In `template/scrub-core.js`, immediately after the existing `scrollProgress` function (after line 8, before `export function applyHolds`), add:

```js
export function progressToScrollY(progress, sectionTop, sectionHeight, viewportH) {
  if (![progress, sectionTop, sectionHeight, viewportH].every(Number.isFinite)) {
    return sectionTop;
  }
  const distance = Math.max(0, sectionHeight - viewportH);
  return sectionTop + clamp(progress, 0, 1) * distance;
}
```

- [ ] **Step 4: Implement `nearestOverlayIndex`**

Immediately after the existing `overlayOpacity` function (after its closing `}`, before `export function holdFrames`), add:

```js
export function nearestOverlayIndex(progress, overlays) {
  if (!Array.isArray(overlays) || overlays.length === 0) return -1;
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  let best = 0;
  for (let index = 0; index < overlays.length; index += 1) {
    const [start, end] = overlays[index].at ?? [0, 0];
    if (p >= start && p <= end) return index;
    if (start <= p) best = index;
  }
  return best;
}
```

- [ ] **Step 5: Add the `nav` field validation**

In `validateConfig`, right after the existing `brand.name` check:

```js
  if (!config.brand || typeof config.brand.name !== 'string' || !config.brand.name.trim()) {
    addError('brand.name', 'brand.name', 'Brand name is required.');
  }
```

add:

```js

  if (config.nav !== undefined && typeof config.nav !== 'boolean') {
    addError('nav.type', 'nav', 'Nav must be a boolean.');
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/scrub-core.test.mjs`
Expected: PASS, all tests including the new ones.

- [ ] **Step 7: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: add beat-nav scroll math and nav config validation"
```

---

### Task 2: Overlay CSS restyle (accent-line caption)

**Files:**
- Modify: `template/style.css:65-78` (`.overlay` box → accent-line)
- Modify: `template/style.css:101-107` (`.overlay__title` / `.overlay__body` typography)
- Modify: `template/style.css:125-151` (mobile / coarse-pointer overrides — drop `backdrop-filter`, keep everything else)
- Test: existing `tests/browser/smoke.spec.mjs` (no new file; this task's job is to not break it)

**Interfaces:**
- Consumes: nothing new. Same `--bg`, `--text`, `--accent`, `--surface`, `--radius` custom properties already set by `applyTheme` in `scrub-engine.js`.
- Produces: nothing new. Same class names (`overlay`, `overlay__title`, `overlay__body`, etc.) other tasks and existing tests rely on.

- [ ] **Step 1: Confirm the baseline passes before touching CSS**

Run: `npx playwright test tests/browser/smoke.spec.mjs`
Expected: PASS (or the pre-existing skip for Chromium-not-installed / ffmpeg-not-installed — record which, so Step 4 can compare against the same baseline).

- [ ] **Step 2: Replace the `.overlay` box with an accent-line**

Replace:

```css
.overlay {
  position: absolute;
  top: 50%;
  width: min(32rem, calc(100% - 2rem));
  padding: clamp(1.5rem, 2.5vw, 2.25rem) clamp(1.5rem, 2.5vw, 2rem);
  border-top: 2px solid var(--accent);
  border-radius: var(--radius);
  background: var(--surface);
  backdrop-filter: blur(18px);
  transform: translateY(-50%);
  translate: 0 calc((1 - var(--reveal, 1)) * 28px);
  opacity: 0;
  transition: translate 320ms cubic-bezier(.16, 1, .3, 1);
}
```

with:

```css
.overlay {
  position: absolute;
  top: 50%;
  width: min(32rem, calc(100% - 2rem));
  padding: clamp(1.5rem, 2.5vw, 2.25rem) clamp(1.5rem, 2.5vw, 2rem);
  border-left: 2px solid var(--accent);
  transform: translateY(-50%);
  translate: 0 calc((1 - var(--reveal, 1)) * 28px);
  opacity: 0;
  transition: translate 320ms cubic-bezier(.16, 1, .3, 1);
}
```

- [ ] **Step 3: Restyle the title and body as an italic caption**

Replace:

```css
.overlay__title {
  font-size: clamp(1.75rem, 4vw, 3rem);
  line-height: 1.05;
  letter-spacing: -.01em;
  margin: 0 0 .5rem;
}
.overlay__body { font-size: clamp(1rem, 1.4vw, 1.25rem); line-height: 1.4; margin: 0; opacity: .85; }
```

with:

```css
.overlay__title {
  font-size: clamp(1.75rem, 4vw, 3rem);
  line-height: 1.05;
  letter-spacing: -.01em;
  margin: 0 0 .5rem;
  font-style: italic;
  text-shadow: 0 2px 16px rgba(0, 0, 0, .55);
}
.overlay__body {
  font-size: clamp(.85rem, 1.1vw, 1rem);
  line-height: 1.4;
  margin: 0;
  opacity: .8;
  text-shadow: 0 1px 10px rgba(0, 0, 0, .5);
}
```

- [ ] **Step 4: Drop `backdrop-filter` from the mobile / coarse-pointer overrides**

In the `@media (max-width: 700px)` block, remove the `backdrop-filter: blur(10px);` line from `.overlay` (keep `max-height`, `overflow-y`, `overscroll-behavior`, `scrollbar-gutter`, `padding` exactly as they are).

In the `@media (pointer: coarse) and (max-height: 500px)` block, remove the `backdrop-filter: blur(6px);` line from `.overlay` (same — keep every other property).

- [ ] **Step 5: Run the browser suite to verify nothing broke**

Run: `npx playwright test tests/browser/smoke.spec.mjs`
Expected: PASS — in particular `visibility controls inert and keyboard focus`, `phone viewport keeps tall landscape overlay content reachable`, and `phone viewport keeps tall portrait overlay content reachable` must still pass unchanged, since they assert on `.overlay`'s `max-height`/`overflow-y` behavior, not its background.

- [ ] **Step 6: Commit**

```bash
git add template/style.css
git commit -m "style: restyle overlay text as an accent-line caption"
```

---

### Task 3: Beat nav — opt-in click + scroll progression

**Files:**
- Modify: `template/index.html:11` (add `<nav id="beat-nav">` placeholder)
- Modify: `template/scrub-engine.js` (DOM ref, module state, `renderNav`/`jumpTo`/`updateNav`, wiring into `start()`, `runEngine`, `runVideoEngine`)
- Modify: `template/style.css` (append `.beat-nav` rules + mobile hide)
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `progressToScrollY` and `nearestOverlayIndex` from Task 1 (`template/scrub-core.js`).
- Produces: `renderNav(config: object, overlayNodes: Array<{ data, node }>): Array<{ index: number, node: HTMLButtonElement }>` — module-level function in `scrub-engine.js`. `jumpTo(overlayData: { at: [number, number] })` — module-level function, no return value. `updateNav(navItems: Array<{ index, node }>, config: object, raw: number): void` — module-level function, no return value.
- DOM contract: `#beat-nav` element in `index.html`, class `beat-nav`; each rendered item is `<button class="beat-nav__item" data-nav-index="N">`; active item additionally has class `is-active`.

- [ ] **Step 1: Add the nav placeholder to `index.html`**

In `template/index.html`, right after:

```html
  <div id="progress-bar" class="progress-bar" aria-hidden="true"></div>
```

add:

```html
  <nav id="beat-nav" class="beat-nav" aria-label="Chapters" hidden></nav>
```

- [ ] **Step 2: Add the `#beat-nav` DOM reference in `scrub-engine.js`**

Right after the existing:

```js
const progressBar = document.getElementById('progress-bar');
```

add:

```js
const beatNav = document.getElementById('beat-nav');
```

- [ ] **Step 3: Import the two new pure functions**

Update the import block at the top of `template/scrub-engine.js` to add `nearestOverlayIndex` and `progressToScrollY`:

```js
import {
  alphaToK,
  applyHolds,
  canvasSize,
  coverRect,
  decodeWindow,
  frameFilename,
  lingerEase,
  nearestOverlayIndex,
  overlayOpacity,
  progressToFrame,
  progressToScrollY,
  progressToTime,
  scrollProgress,
  selectScrubMode,
  smooth,
  validateConfig,
} from './scrub-core.js';
```

- [ ] **Step 4: Add a module-level `lenisInstance` variable**

Right after the existing:

```js
let store = null;
let lastDrawnIndex = -1;
```

add:

```js
let lenisInstance = null;
```

- [ ] **Step 5: Write `renderNav`, `jumpTo`, and `updateNav`**

Add these three functions right after the existing `renderCopy` function:

```js
function jumpTo(overlayData) {
  const target = progressToScrollY(
    overlayData.at[0], scrub.offsetTop, scrub.offsetHeight, innerHeight,
  );
  if (lenisInstance) {
    lenisInstance.scrollTo(target, { immediate: false });
  } else {
    window.scrollTo({ top: target, behavior: 'smooth' });
  }
}

function renderNav(config, overlayNodes) {
  if (config.nav !== true) return [];
  const navItems = overlayNodes
    .map(({ data }, index) => ({ data, index }))
    .filter(({ data }) => typeof data.title === 'string' && data.title.trim())
    .map(({ data, index }) => {
      const button = element('button', 'beat-nav__item', data.title);
      button.type = 'button';
      button.dataset.navIndex = String(index);
      button.addEventListener('click', () => jumpTo(data));
      beatNav.append(button);
      return { index, node: button };
    });
  if (navItems.length) beatNav.hidden = false;
  return navItems;
}

function updateNav(navItems, config, raw) {
  if (!navItems.length) return;
  const current = nearestOverlayIndex(raw, config.overlays ?? []);
  for (const { index, node } of navItems) {
    node.classList.toggle('is-active', index === current);
  }
}
```

- [ ] **Step 6: Declare `navItems` alongside `start()`'s other state**

Change:

```js
  let config;
  let overlayNodes;
  let removeVideoPrime = () => {};
```

to:

```js
  let config;
  let overlayNodes;
  let navItems;
  let removeVideoPrime = () => {};
```

- [ ] **Step 7: Capture the Lenis instance and render the nav inside the `try` block**

Replace:

```js
  if (globalThis.Lenis) {
    try {
      new globalThis.Lenis({ autoRaf: true, anchors: true });
    } catch (error) {
      console.warn('Lenis failed to initialize:', error.message);
    }
  }
```

with:

```js
  if (globalThis.Lenis) {
    try {
      lenisInstance = new globalThis.Lenis({ autoRaf: true, anchors: true });
    } catch (error) {
      console.warn('Lenis failed to initialize:', error.message);
    }
  }
```

Then, right after:

```js
    overlayNodes = renderCopy(config);
```

add:

```js
    navItems = renderNav(config, overlayNodes);
```

- [ ] **Step 8: Pass `navItems` into both engines**

Replace:

```js
    runVideoEngine(config, overlayNodes, video);
  } else {
    runEngine(config, overlayNodes);
  }
```

with:

```js
    runVideoEngine(config, overlayNodes, video, navItems);
  } else {
    runEngine(config, overlayNodes, navItems);
  }
```

- [ ] **Step 9: Update `runEngine`'s signature and tick loop**

Change:

```js
function runEngine(config, overlayNodes) {
```

to:

```js
function runEngine(config, overlayNodes, navItems) {
```

Then, right after the existing:

```js
    updateOverlays(overlayNodes, raw);
    updateProgressBar();
```

(inside `runEngine`'s `tick`), add:

```js
    updateNav(navItems, config, raw);
```

- [ ] **Step 10: Update `runVideoEngine`'s signature and tick loop**

Change:

```js
function runVideoEngine(config, overlayNodes, video) {
```

to:

```js
function runVideoEngine(config, overlayNodes, video, navItems) {
```

Then, right after the existing:

```js
    updateOverlays(overlayNodes, raw);
    updateProgressBar();
```

(inside `runVideoEngine`'s `tick`), add:

```js
    updateNav(navItems, config, raw);
```

- [ ] **Step 11: Add `.beat-nav` styles**

Append to `template/style.css`, right after the existing `.footer { ... }` rule and before `h1, h2, h3 { font-family: var(--display); }`:

```css
.beat-nav {
  position: fixed;
  top: 1.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 11;
  display: flex;
  gap: 4px;
  padding: 5px;
  background: var(--surface);
  backdrop-filter: blur(14px);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  border-radius: 999px;
}
.beat-nav[hidden] { display: none; }
.beat-nav__item {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text);
  opacity: .6;
  font: inherit;
  font-size: .8rem;
  letter-spacing: .02em;
  padding: .5rem 1rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background 200ms ease, opacity 200ms ease, color 200ms ease;
}
.beat-nav__item:hover { opacity: .9; }
.beat-nav__item.is-active {
  opacity: 1;
  background: var(--accent);
  color: var(--bg);
}
```

Then, inside the existing `@media (max-width: 700px) { ... }` block, add:

```css
  .beat-nav { display: none; }
```

- [ ] **Step 12: Write the failing browser tests**

Add these two tests to `tests/browser/smoke.spec.mjs`, after the existing `test('one missing frame warns once and keeps rendering', ...)` test:

```js
test('beat nav is absent when not enabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#beat-nav')).toBeHidden();
});

test('beat nav renders, jumps on click, and highlights the active beat', async ({ page }) => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    config.nav = true;
    config.overlays = [
      { at: [0.05, 0.3], title: 'One', position: 'left' },
      { at: [0.3, 0.6], title: 'Two', position: 'center' },
      { at: [0.6, 0.95], title: 'Three', position: 'right' },
    ];
    await route.fulfill({ response, json: config });
  });
  await page.goto('/');

  const nav = page.locator('#beat-nav');
  await expect(nav).toBeVisible();
  const items = nav.locator('.beat-nav__item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('One');
  await expect(items.nth(1)).toHaveText('Two');
  await expect(items.nth(2)).toHaveText('Three');

  await items.nth(2).click();
  await expect(page.locator('[data-nav-index="2"]')).toHaveClass(/is-active/);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await expect(page.locator('[data-overlay-index="2"]')).toHaveJSProperty('inert', false);
});

test('beat nav is hidden at mobile viewport width', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.route('**/config.json', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      config.nav = true;
      await route.fulfill({ response, json: config });
    });
    await page.goto('/');
    await expect(page.locator('#beat-nav')).toBeHidden();
  } finally {
    await context.close();
  }
});
```

- [ ] **Step 13: Run the tests to verify they fail**

Run: `npx playwright test tests/browser/smoke.spec.mjs -g "beat nav"`
Expected: FAIL — `#beat-nav` doesn't exist yet / is never un-hidden / has no items.

- [ ] **Step 14: Implement Steps 1–11 above, then re-run**

(Steps 1–11 are the implementation; this step is the checkpoint after all of them are done.)

Run: `npx playwright test tests/browser/smoke.spec.mjs -g "beat nav"`
Expected: PASS, all three new tests.

- [ ] **Step 15: Run the full browser and unit suites to check for regressions**

Run: `npm test && npx playwright test tests/browser/smoke.spec.mjs`
Expected: PASS across the board.

- [ ] **Step 16: Commit**

```bash
git add template/index.html template/scrub-engine.js template/style.css tests/browser/smoke.spec.mjs
git commit -m "feat: add opt-in beat nav with click-to-jump and active progression"
```

---

### Task 4: Roll out to `bubble-tea`

**Files:**
- Modify: `../bubble-tea/values.json` (absolute path: `C:\Users\ryanh\Documents\bubble-tea\values.json` — outside this repo)

**Interfaces:**
- Consumes: the `nav: true` config field and restyled `.overlay` CSS from Tasks 2–3 (via a fresh `scaffold-site.mjs` run, not by hand-editing `bubble-tea/site/`).

- [ ] **Step 1: Rewrite the beat captions**

In `C:\Users\ryanh\Documents\bubble-tea\values.json`, replace the `overlays` array:

```json
  "overlays": [
    { "at": [0, 0.2], "title": "Walking", "position": "left" },
    { "at": [0.2, 0.4], "title": "Close-up", "position": "left" },
    { "at": [0.4, 0.6], "title": "Transition", "position": "center" },
    { "at": [0.6, 0.8], "title": "Pour", "position": "right" },
    { "at": [0.8, 1.0], "title": "Hero reveal", "position": "center", "hold": true }
  ],
```

with:

```json
  "nav": true,
  "overlays": [
    { "at": [0, 0.2], "title": "Walking", "body": "A cup, carried through the city.", "position": "left" },
    { "at": [0.2, 0.4], "title": "Close-up", "body": "Held cold, condensation and all.", "position": "left" },
    { "at": [0.4, 0.6], "title": "Transition", "body": "Carried into another light.", "position": "center" },
    { "at": [0.6, 0.8], "title": "Pour", "body": "Held cold, poured slow.", "position": "right" },
    { "at": [0.8, 1.0], "title": "Hero reveal", "body": "Milk tea, at rest.", "position": "center", "hold": true }
  ],
```

(Copy is a starting point — walk through the live preview with the user in Step 4 below and revise if any line doesn't land.)

- [ ] **Step 2: Re-run scaffold**

Run: `node C:/Users/ryanh/Documents/scroll-wizard/scripts/scaffold-site.mjs C:/Users/ryanh/Documents/bubble-tea --config C:/Users/ryanh/Documents/bubble-tea/values.json --force`
Expected: `Site: C:\Users\ryanh\Documents\bubble-tea\site` with no errors. (If it fails with `EBUSY`, a leftover static-file server is still holding `site/` — find and stop it first, as happened earlier in this project.)

- [ ] **Step 3: Check gate status and walk the re-approval chain**

Run: `node C:/Users/ryanh/Documents/scroll-wizard/scripts/status.mjs C:/Users/ryanh/Documents/bubble-tea --json`
Expected: `storyboard` and everything after it (`stills-preview`, `video`, `extraction`, `theme`, `preview`) listed under `unapproved` — changing overlay copy invalidates the storyboard receipt, which cascades. Re-approve each in order with `status.mjs --approve <gate>`, confirming with the user before each one per the skill's gate recipe (this is a copy/nav-only change — no artifacts need regenerating, just the confirmations).

- [ ] **Step 4: Serve and visually confirm**

Run: `npx serve C:/Users/ryanh/Documents/bubble-tea/site -l 4175` (pick a free port), open it, and confirm with the user: the nav pill bar appears top-center on desktop, clicking a label jumps to that beat and highlights it, the nav disappears below 700px width, and the caption text reads as an accent-line italic label + small caption line rather than a boxed card.

- [ ] **Step 5: Stop the preview server**

Once confirmed, stop whatever process is serving port 4175 (same pattern as the earlier `pkill`/`Stop-Process` cleanup in this project).
