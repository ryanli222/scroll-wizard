# Richer Scroll Interactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four opt-in template features from
`docs/superpowers/specs/2026-07-23-scroll-interactivity-design.md`: a
process/how-it-works section, staggered overlay-child reveal, decorative
parallax layers, and a pointer/ambient-driven cursor accent — plus the
`SKILL.md` intake changes needed to actually collect the content for them.

**Architecture:** Two existing internal patterns do all the work: the
per-tick "JS computes a number → CSS custom property → CSS paints it"
split already used for `--reveal`, and a new tiny generic
IntersectionObserver reveal primitive (`data-reveal` → `.is-visible`) for
below-the-fold content. Every new behavior is gated by an optional
`values.json`/`config.json` field; its absence leaves today's output
byte-for-byte identical.

**Tech Stack:** Vanilla JS (ES modules), vanilla CSS, vitest (unit),
Playwright (browser smoke). No new npm dependencies.

## Global Constraints

- Node 20+; no new npm dependencies.
- `template/scrub-core.js` holds only pure functions; DOM wiring lives in
  `template/scrub-engine.js`.
- Every new config field is optional; its absence must leave existing
  generated sites byte-for-byte behaviorally identical to today.
- Every new motion/decoration feature must no-op (fully static, or not
  initialized at all) under `prefers-reduced-motion: reduce`.
- Do not add a `Co-Authored-By: Claude` trailer to any commit message in
  this repo.
- Commit after every task (message style: existing history, e.g. `feat:
  …`, `fix: …`, `docs: …`).
- Run unit tests with `npx vitest run <file>`; browser tests with `npx
  playwright test`.
- Repo root: `c:\Users\ryanh\Documents\scroll-wizard`. All paths below are
  relative to it. Do this work in its own git worktree/branch, not
  directly on `main`.

---

### Task 1: `validateConfig` for `process`, `scrub.parallax`, `scrub.cursorAccent`

**Files:**
- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Produces: `validateConfig` accepts an optional top-level `process: {
  steps: [{title, body}] }` (1-8 steps, each needing non-empty string
  `title`/`body`) and optional `scrub.parallax` / `scrub.cursorAccent`
  booleans; also produces `childRevealRange(range, offsetFraction) =>
  [number, number]`, a pure helper Task 3 depends on.

- [ ] **Step 1: Write the failing tests.** Append to
  `tests/unit/scrub-core.test.mjs` (it already imports `validateConfig`
  and has a `validConfig` fixture with `outro` but no `process`; reuse
  that fixture):

```js
describe('validateConfig process/parallax/cursorAccent', () => {
  const base = () => JSON.parse(JSON.stringify(validConfig));

  it('accepts a valid process block', () => {
    const config = base();
    config.process = {
      steps: [
        { title: 'Steep', body: '18 hours, cold.' },
        { title: 'Pour', body: 'Over ice.' },
      ],
    };
    expect(validateConfig(config).errors).toEqual([]);
  });

  it('rejects too few/too many steps and empty step fields', () => {
    const tooFew = base();
    tooFew.process = { steps: [] };
    expect(validateConfig(tooFew).errors.map((e) => e.code)).toContain('process.steps');

    const emptyTitle = base();
    emptyTitle.process = { steps: [{ title: '', body: 'x' }] };
    expect(validateConfig(emptyTitle).errors.map((e) => e.code)).toContain('process.step.title');

    const tooMany = base();
    tooMany.process = {
      steps: Array.from({ length: 9 }, (_, i) => ({ title: 't' + i, body: 'b' })),
    };
    expect(validateConfig(tooMany).errors.map((e) => e.code)).toContain('process.steps');
  });

  it('validates scrub.parallax and scrub.cursorAccent as booleans', () => {
    const badParallax = base();
    badParallax.scrub.parallax = 'yes';
    expect(validateConfig(badParallax).errors.map((e) => e.code)).toContain('scrub.parallax');

    const badCursor = base();
    badCursor.scrub.parallax = true;
    badCursor.scrub.cursorAccent = 1;
    expect(validateConfig(badCursor).errors.map((e) => e.code)).toContain('scrub.cursorAccent');

    const good = base();
    good.scrub.parallax = true;
    good.scrub.cursorAccent = false;
    expect(validateConfig(good).errors).toEqual([]);
  });
});

describe('childRevealRange', () => {
  it('shifts the start forward by a fraction of the range width, keeping the end fixed', () => {
    expect(childRevealRange([0.2, 0.6], 0)).toEqual([0.2, 0.6]);
    expect(childRevealRange([0.2, 0.6], 0.5)).toEqual([0.4, 0.6]);
  });

  it('clamps an out-of-range fraction', () => {
    expect(childRevealRange([0.2, 0.6], 2)).toEqual([0.6, 0.6]);
    expect(childRevealRange([0.2, 0.6], -1)).toEqual([0.2, 0.6]);
  });
});
```

  Also add `childRevealRange` to the top import statement.

- [ ] **Step 2: Run to verify failure** —
  `npx vitest run tests/unit/scrub-core.test.mjs` — expect FAIL
  (`childRevealRange is not defined`, missing error codes).

- [ ] **Step 3: Implement in `template/scrub-core.js`.**

  Add near the other small pure helpers (after `overlayOpacity`):

```js
export function childRevealRange(range, offsetFraction) {
  const [start, end] = range;
  const width = end - start;
  const fraction = clamp(Number.isFinite(offsetFraction) ? offsetFraction : 0, 0, 1);
  return [start + fraction * width, end];
}
```

  In `validateConfig`, immediately before `if (config.outro?.cta) …` add:

```js
  if (config.process !== undefined) {
    if (!config.process || typeof config.process !== 'object' || Array.isArray(config.process)) {
      addError('process.type', 'process', 'Process must be an object.');
    } else {
      const steps = config.process.steps;
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) {
        addError('process.steps', 'process.steps', 'Process needs 1 to 8 steps.');
      } else {
        steps.forEach((step, index) => {
          const path = 'process.steps[' + index + ']';
          if (!step || typeof step.title !== 'string' || !step.title.trim()) {
            addError('process.step.title', path + '.title', 'Each step needs a non-empty title.');
          }
          if (!step || typeof step.body !== 'string' || !step.body.trim()) {
            addError('process.step.body', path + '.body', 'Each step needs a non-empty body.');
          }
        });
      }
    }
  }
  if (config.scrub?.parallax !== undefined && typeof config.scrub.parallax !== 'boolean') {
    addError('scrub.parallax', 'scrub.parallax', 'parallax must be a boolean.');
  }
  if (config.scrub?.cursorAccent !== undefined && typeof config.scrub.cursorAccent !== 'boolean') {
    addError('scrub.cursorAccent', 'scrub.cursorAccent', 'cursorAccent must be a boolean.');
  }
```

- [ ] **Step 4: Run tests** —
  `npx vitest run tests/unit/scrub-core.test.mjs` — expect PASS, including
  all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: validate process steps and parallax/cursorAccent config flags"
```

---

### Task 2: Process section render, generic scroll-reveal, outro empty-space fix

**Files:**
- Modify: `template/index.html`
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Modify: `tests/browser/fixture-server.mjs`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `config.process` (Task 1's validated shape).
- Produces: `<section id="process">` renders one `.step` per
  `config.process.steps` entry (hidden entirely when `config.process` is
  absent); a generic `initScrollReveal()` toggles `.is-visible` on any
  `[data-reveal]` element the first time it's ~25% in view; `#outro` is
  `hidden` by default and only unhidden when `config.outro` is present
  (fixes a pre-existing bug where every generated site reserves 80vh of
  empty space after the hero because `.outro` has `min-height: 80vh` with
  no `hidden` gate).

- [ ] **Step 1: Read the current files before editing.** Read
  `template/index.html`, the `.outro` rule and reduced-motion block in
  `template/style.css`, and `renderOutro`/`renderCopy`/`start()` in
  `template/scrub-engine.js`. Note that `renderOutro` already exists and
  already handles absent `config.outro` by returning early — the bug is
  only that the section isn't `hidden` by default, so it still reserves
  layout space even when empty.

- [ ] **Step 2: Write the failing browser tests.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('outro section is hidden by default when config has no outro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#outro')).toBeHidden();
});

test('process steps are absent until enabled, then reveal progressively on scroll', async ({ page }) => {
  await page.goto('/process/');
  await expect(page.locator('#process')).toBeVisible();
  await expect(page.locator('.step')).toHaveCount(3);
  await expect(page.locator('.step.is-visible')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('#process').scrollIntoView());
  await expect.poll(() => page.locator('.step.is-visible').count()).toBeGreaterThan(0);
});

test('reduced motion shows all process steps immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/process/');
  const opacity = await page.locator('.step').first().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe('1');
});
```

- [ ] **Step 3: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "outro section|process steps"` —
  expect failure: `/process/` doesn't exist yet (404/timeout) and `#outro`
  is not hidden.

- [ ] **Step 4: Add the `/process/` fixture route.** In
  `tests/browser/fixture-server.mjs`, this task generalizes the
  video-only special-casing into a small prefix map so later tasks
  (parallax, cursor accent) can each add one line. Replace the
  `videoConfig` block and the `/config.json` / static-serving logic as
  follows.

  Replace:

```js
const videoConfig = {
  ...config,
  scrub: { heightVh: 400, smoothing: 0.12, mode: 'video' },
  video: {
    src: 'media/video.webm',
    poster: 'media/poster.webp',
    duration: 9,
  },
};
delete videoConfig.frames;
```

  with:

```js
const videoConfig = {
  ...config,
  scrub: { heightVh: 400, smoothing: 0.12, mode: 'video' },
  video: {
    src: 'media/video.webm',
    poster: 'media/poster.webp',
    duration: 9,
  },
};
delete videoConfig.frames;

const processConfig = {
  ...config,
  process: {
    steps: [
      { title: 'Steep', body: 'Cold, eighteen hours.' },
      { title: 'Pour', body: 'Slow, over ice.' },
      { title: 'Sip', body: 'However you like it.' },
    ],
  },
};

const FIXTURE_CONFIGS = {
  '/video/': videoConfig,
  '/process/': processConfig,
};

function fixturePrefix(pathname) {
  return Object.keys(FIXTURE_CONFIGS).find((prefix) => (
    pathname === prefix || pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
  ));
}
```

  Replace the `serveStatic` function's `sitePath` computation:

```js
async function serveStatic(res, pathname) {
  const prefix = fixturePrefix(pathname);
  const sitePath = !prefix
    ? pathname
    : (pathname === prefix || pathname === prefix.slice(0, -1))
      ? '/index.html'
      : pathname.slice(prefix.length - 1);
  const relative = normalize(sitePath === '/' ? '/index.html' : sitePath)
    .replace(/^([/\\]\.\.)+/, '');
  const filePath = join(templateDir, relative);
  if (filePath !== templateDir && !filePath.startsWith(templateDir + '\\')
      && !filePath.startsWith(templateDir + '/')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}
```

  Replace the `/config.json` route handler:

```js
  if (pathname === '/config.json' || (fixturePrefix(pathname) && pathname.endsWith('/config.json'))) {
    const prefix = fixturePrefix(pathname);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(prefix ? FIXTURE_CONFIGS[prefix] : config));
    return;
  }
```

  Leave the `/video/media/video.webm` and `/video/media/poster.webp`
  routes exactly as they are — they're unaffected by this refactor.

- [ ] **Step 5: Add the process section markup.** In
  `template/index.html`, insert a new section between `</section>` (the
  closing tag of `#scrub`) and `<section id="outro" class="outro">`:

```html
    <section id="process" class="process" aria-label="How it works" hidden></section>
```

  Add `hidden` to the outro section tag, changing:

```html
    <section id="outro" class="outro"></section>
```

  to:

```html
    <section id="outro" class="outro" hidden></section>
```

- [ ] **Step 6: Add CSS.** In `template/style.css`, add after the
  `.outro` rule:

```css
.outro[hidden] { display: none; }
.process[hidden] { display: none; }
.process {
  padding: 10vh 8vw;
  display: grid;
  gap: 2.5rem;
  max-width: 60rem;
  margin: 0 auto;
}
.step {
  opacity: 0;
  translate: 0 24px;
  transition: opacity 480ms ease, translate 480ms ease;
  transition-delay: calc(var(--i, 0) * 90ms);
}
.step.is-visible { opacity: 1; translate: 0 0; }
.step__title { font-size: clamp(1.25rem, 2.5vw, 1.75rem); margin: 0 0 .5rem; }
.step__body { margin: 0; opacity: .8; }
```

  In the existing `@media (prefers-reduced-motion: reduce)` block, add
  one more rule so steps render fully visible without needing the
  observer to ever fire:

```css
  .step { opacity: 1 !important; translate: none !important; transition: none !important; }
```

- [ ] **Step 7: Implement rendering + the reveal primitive in
  `template/scrub-engine.js`.**

  Add a new top-level const next to the other `document.getElementById`
  calls:

```js
const processSection = document.getElementById('process');
```

  Add these two functions near `renderOutro`:

```js
function renderProcess(config) {
  if (!config.process) return;
  const steps = config.process.steps.map((step, index) => {
    const article = element('article', 'step');
    article.dataset.reveal = '';
    article.style.setProperty('--i', String(index));
    article.append(element('h3', 'step__title', step.title));
    article.append(element('p', 'step__body', step.body));
    return article;
  });
  processSection.append(...steps);
  processSection.hidden = false;
}

function initScrollReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.25 });
  targets.forEach((target) => observer.observe(target));
}
```

  Fix `renderOutro` to unhide the section (this is the actual bug fix —
  everything else in the function is unchanged):

```js
function renderOutro(data) {
  if (!data) return;
  outro.hidden = false;
  if (data.headline) outro.append(element('h1', 'outro__headline', data.headline));
  if (data.body) outro.append(element('p', 'outro__body', data.body));
  if (data.cta) outro.append(linkButton(data.cta, 'outro__cta'));
}
```

  In `start()`, right after `overlayNodes = renderCopy(config);` add:

```js
    renderProcess(config);
    initScrollReveal();
```

- [ ] **Step 8: Run** `npx playwright test tests/browser/smoke.spec.mjs`
  — expect PASS for the full file, including the pre-existing video-mode
  and phone-viewport scenarios (the fixture-server refactor must not
  change their behavior).

- [ ] **Step 9: Commit**

```bash
git add template/index.html template/style.css template/scrub-engine.js tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs
git commit -m "feat: add process section with generic scroll-reveal; fix outro reserving empty space when absent"
```

---

### Task 3: Staggered overlay-child reveal

**Files:**
- Modify: `template/scrub-engine.js`
- Modify: `template/style.css`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `childRevealRange` from Task 1.
- Produces: each overlay's title/body/stats/CTA fades in on its own
  delayed sub-range of the overlay's `at` range instead of all together;
  overall overlay `inert`/pointer-events gating is unchanged.

- [ ] **Step 1: Write the failing browser test.** Append to
  `tests/browser/smoke.spec.mjs`. This reuses the existing `/` fixture's
  hold overlay (`at: [0.05, 0.98]`, has title/body/stats/cta) — no
  fixture change needed:

```js
test('overlay children stagger in rather than fading together', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.09));
  const opacities = await page.evaluate(() => {
    const overlay = document.querySelector('.overlay');
    return {
      title: getComputedStyle(overlay.querySelector('.overlay__title')).opacity,
      cta: getComputedStyle(overlay.querySelector('.overlay__cta')).opacity,
    };
  });
  expect(Number(opacities.title)).toBeGreaterThan(Number(opacities.cta));
});
```

- [ ] **Step 2: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "stagger"` — expect FAIL (title and
  CTA currently share the same opacity).

- [ ] **Step 3: Import `childRevealRange` in `template/scrub-engine.js`.**
  Add it to the existing import list from `./scrub-core.js`.

- [ ] **Step 4: Change `renderOverlay` to return child field references.**
  Replace the current function:

```js
function renderOverlay(data, index) {
  const panel = element(
    'article',
    'overlay overlay--' + (data.position ?? 'center'),
  );
  panel.dataset.overlayIndex = String(index);
  panel.inert = true;
  if (data.title) panel.append(element('h2', 'overlay__title', data.title));
  if (data.body) panel.append(element('p', 'overlay__body', data.body));
  if (data.stats?.length) {
    const list = element('div', 'stats');
    for (const stat of data.stats) {
      const chip = element('div', 'stat');
      chip.append(
        element('strong', 'stat__value', stat.value),
        element('span', 'stat__label', stat.label),
      );
      list.append(chip);
    }
    panel.append(list);
  }
  if (data.cta) panel.append(linkButton(data.cta, 'overlay__cta'));
  return panel;
}
```

  with:

```js
const STAGGER_ROLES = [
  ['title', 0],
  ['body', 0.12],
  ['stats', 0.24],
  ['cta', 0.36],
];

function renderOverlay(data, index) {
  const panel = element(
    'article',
    'overlay overlay--' + (data.position ?? 'center'),
  );
  panel.dataset.overlayIndex = String(index);
  panel.inert = true;
  const fields = {};
  if (data.title) fields.title = element('h2', 'overlay__title', data.title);
  if (data.body) fields.body = element('p', 'overlay__body', data.body);
  if (data.stats?.length) {
    const list = element('div', 'stats');
    for (const stat of data.stats) {
      const chip = element('div', 'stat');
      chip.append(
        element('strong', 'stat__value', stat.value),
        element('span', 'stat__label', stat.label),
      );
      list.append(chip);
    }
    fields.stats = list;
  }
  if (data.cta) fields.cta = linkButton(data.cta, 'overlay__cta');
  for (const field of Object.values(fields)) panel.append(field);
  return { node: panel, fields };
}
```

- [ ] **Step 5: Update `renderCopy` to carry `fields` through.** Replace:

```js
function renderCopy(config) {
  const overlayNodes = (config.overlays ?? []).map((data, index) => {
    const node = renderOverlay(data, index);
    overlayLayer.append(node);
    return { data, node };
  });
  renderOutro(config.outro);
  footerBrand.textContent = config.brand.name;
  return overlayNodes;
}
```

  with:

```js
function renderCopy(config) {
  const overlayNodes = (config.overlays ?? []).map((data, index) => {
    const { node, fields } = renderOverlay(data, index);
    overlayLayer.append(node);
    return { data, node, fields };
  });
  renderOutro(config.outro);
  footerBrand.textContent = config.brand.name;
  return overlayNodes;
}
```

- [ ] **Step 6: Update `updateOverlays` to drive each child's own
  reveal.** Replace:

```js
function updateOverlays(overlayNodes, raw) {
  for (const { data, node } of overlayNodes) {
    const opacity = overlayOpacity(raw, data.at);
    node.style.opacity = String(opacity);
    node.style.setProperty('--reveal', String(opacity));
    const visible = opacity >= 0.05;
    node.inert = !visible;
    node.style.pointerEvents = visible ? 'auto' : 'none';
  }
}
```

  with:

```js
function updateOverlays(overlayNodes, raw) {
  for (const { data, node, fields } of overlayNodes) {
    const opacity = overlayOpacity(raw, data.at);
    const visible = opacity >= 0.05;
    node.inert = !visible;
    // ponytail: CTA pointer-events follow the overlay's overall visibility,
    // not its own later-staggered fade-in start — a brief early-clickable
    // window while the CTA is still fading in. Fine for a decorative CTA;
    // revisit with a per-child pointer-events gate if it ever matters.
    node.style.pointerEvents = visible ? 'auto' : 'none';
    for (const [role, offsetFraction] of STAGGER_ROLES) {
      const field = fields[role];
      if (!field) continue;
      const childOpacity = overlayOpacity(raw, childRevealRange(data.at, offsetFraction));
      field.style.setProperty('--reveal', String(childOpacity));
    }
  }
}
```

- [ ] **Step 7: Move the reveal treatment from `.overlay` onto its
  children in `template/style.css`.** Replace the block starting at
  `.overlay {` through `.stat__label { … }` with:

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
}
.overlay--center { left: 50%; transform: translate(-50%, -50%); text-align: center; }
.overlay--left { left: clamp(1rem, 6vw, 6rem); }
.overlay--right { right: clamp(1rem, 6vw, 6rem); }
.overlay__title,
.stats,
.overlay__cta {
  opacity: var(--reveal, 0);
  translate: 0 calc((1 - var(--reveal, 0)) * 20px);
}
.overlay__body {
  opacity: calc(var(--reveal, 0) * 0.85);
  translate: 0 calc((1 - var(--reveal, 0)) * 20px);
}
.overlay__cta, .outro__cta {
  pointer-events: auto;
  display: inline-grid;
  min-width: 44px;
  min-height: 44px;
  place-items: center;
  margin-top: 1rem;
  padding: .85rem 1.75rem;
  background: var(--accent);
  color: var(--bg);
  text-decoration: none;
  font-weight: 600;
  font-size: .85rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  border-radius: var(--radius);
}
.overlay__title, .overlay__body, .stats { transition: opacity 280ms ease, translate 320ms cubic-bezier(.16, 1, .3, 1); }
.overlay__cta { transition: opacity 280ms ease, translate 320ms cubic-bezier(.16, 1, .3, 1), transform 160ms ease; }
.outro__cta { transition: opacity 160ms ease, transform 160ms ease; }
.overlay__cta:hover, .outro__cta:hover { opacity: .85; transform: translateY(-1px); }
.overlay__title {
  font-size: clamp(1.75rem, 4vw, 3rem);
  line-height: 1.05;
  letter-spacing: -.01em;
  margin: 0 0 .5rem;
}
.overlay__body { font-size: clamp(1rem, 1.4vw, 1.25rem); line-height: 1.4; margin: 0; }
.stats { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; }
.stat { padding: .6rem .9rem; border: 1px solid color-mix(in srgb, var(--text) 25%, transparent); border-radius: var(--radius); }
.stat__value { display: block; font-size: 1.25rem; font-weight: 600; color: var(--accent); }
.stat__label { display: block; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; opacity: .65; }
```

  In the existing `@media (prefers-reduced-motion: reduce)` block, the
  line `.overlay, .overlay--center, .overlay--left, .overlay--right {
  position: relative; inset: auto; width: 100%; transform: none; opacity:
  1 !important; }` no longer needs to force opacity on the parent (it has
  none to force), but the children now need it instead. Add right after
  that existing rule:

```css
  .overlay__title, .overlay__body, .stats, .overlay__cta {
    opacity: 1 !important;
    translate: none !important;
  }
```

- [ ] **Step 8: Run** `npx playwright test` — expect PASS for the entire
  suite, including the pre-existing reduced-motion and mobile-overlay
  scenarios (those assert the overlay content is reachable/visible, not
  the exact opacity mechanism, so they should be unaffected).

- [ ] **Step 9: Commit**

```bash
git add template/scrub-engine.js template/style.css tests/browser/smoke.spec.mjs
git commit -m "feat: stagger overlay title/body/stats/cta reveal instead of fading as one block"
```

---

### Task 4: Decorative parallax layers

**Files:**
- Modify: `template/index.html`
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Modify: `tests/browser/fixture-server.mjs`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `config.scrub.parallax` (Task 1); the per-tick `raw` scroll
  progress already computed in both `runEngine` and `runVideoEngine`.
- Produces: `initParallax(config) => Array<{node, rate}>` (empty array
  when disabled); `updateParallax(layers, raw)` sets `--parallax` on each
  layer node every tick.

- [ ] **Step 1: Add the `/parallax/` fixture route.** In
  `tests/browser/fixture-server.mjs`, add after `processConfig`:

```js
const parallaxConfig = { ...config, scrub: { ...config.scrub, parallax: true } };
```

  and add `'/parallax/': parallaxConfig,` as a new entry in
  `FIXTURE_CONFIGS`.

- [ ] **Step 2: Write the failing browser tests.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('parallax layers stay hidden until scrub.parallax is enabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.parallax-layers')).toBeHidden();
});

test('parallax layers shift at different rates as the page scrolls', async ({ page }) => {
  await page.goto('/parallax/');
  await expect(page.locator('.parallax-layers')).toBeVisible();
  const before = await page.evaluate(() =>
    getComputedStyle(document.querySelectorAll('.parallax-layer')[0]).translate);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.5));
  await expect.poll(() => page.evaluate(() =>
    getComputedStyle(document.querySelectorAll('.parallax-layer')[0]).translate))
    .not.toBe(before);
});

test('reduced motion hides parallax layers entirely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/parallax/');
  await expect(page.locator('.parallax-layers')).toBeHidden();
});
```

- [ ] **Step 3: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "parallax"` — expect FAIL
  (`.parallax-layers` doesn't exist yet).

- [ ] **Step 4: Add static markup in `template/index.html`.** Insert
  between `<canvas id="scrub-canvas" class="scrub__canvas"
  aria-hidden="true"></canvas>` and `<div class="scrub__vignette"
  aria-hidden="true"></div>`:

```html
        <div class="parallax-layers" aria-hidden="true" hidden>
          <div class="parallax-layer" data-rate="0.15"></div>
          <div class="parallax-layer" data-rate="0.3"></div>
          <div class="parallax-layer" data-rate="0.5"></div>
        </div>
```

- [ ] **Step 5: Add CSS.** In `template/style.css`, add near
  `.scrub__vignette`:

```css
.parallax-layers[hidden] { display: none; }
.parallax-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.35;
  translate: 0 calc(var(--parallax, 0) * 80px);
}
.parallax-layer:nth-child(1) { background: radial-gradient(circle at 20% 25%, var(--accent) 0%, transparent 55%); }
.parallax-layer:nth-child(2) { background: radial-gradient(circle at 80% 30%, var(--accent) 0%, transparent 45%); }
.parallax-layer:nth-child(3) { background: radial-gradient(circle at 50% 80%, var(--surface) 0%, transparent 60%); }
```

  In the reduced-motion block, change the line `.scrub__canvas,
  .scrub__video, .loader { display: none; }` to:

```css
  .scrub__canvas, .scrub__video, .loader, .parallax-layers { display: none; }
```

- [ ] **Step 6: Implement in `template/scrub-engine.js`.** Add:

```js
function initParallax(config) {
  if (config.scrub?.parallax !== true) return [];
  const container = document.querySelector('.parallax-layers');
  container.hidden = false;
  return [...container.querySelectorAll('.parallax-layer')].map((node) => ({
    node,
    rate: Number(node.dataset.rate) || 0,
  }));
}

function updateParallax(layers, raw) {
  for (const { node, rate } of layers) {
    node.style.setProperty('--parallax', String(raw * rate));
  }
}
```

  In `runEngine(config, overlayNodes)`, change the signature to
  `runEngine(config, overlayNodes, parallaxLayers)` and in its `tick`,
  right after `updateOverlays(overlayNodes, raw);` add:
  `updateParallax(parallaxLayers, raw);`.

  Do the same in `runVideoEngine(config, overlayNodes, video)` → add a
  fourth parameter `parallaxLayers`, and add the same
  `updateParallax(parallaxLayers, raw);` call right after its own
  `updateOverlays(overlayNodes, raw);`.

  In `start()`, right after the `if (globalThis.Lenis) { … }` block, add:

```js
  const parallaxLayers = initParallax(config);
```

  and update the two call sites at the bottom of `start()`:

```js
    runVideoEngine(config, overlayNodes, video, parallaxLayers);
  } else {
    runEngine(config, overlayNodes, parallaxLayers);
  }
```

- [ ] **Step 7: Run** `npx playwright test` — expect PASS for the entire
  suite.

- [ ] **Step 8: Commit**

```bash
git add template/index.html template/style.css template/scrub-engine.js tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs
git commit -m "feat: add opt-in decorative parallax layers behind the hero"
```

---

### Task 5: Cursor/physics accent

**Files:**
- Modify: `template/index.html`
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Modify: `tests/browser/fixture-server.mjs`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `config.scrub.cursorAccent` (Task 1); `alphaToK`, `smooth`
  (already imported from `scrub-core.js`).
- Produces: `initCursorAccent(config)` — no-op when disabled; otherwise
  unhides `#cursor-accent` and starts an independent `requestAnimationFrame`
  loop that springs 4 dots toward the pointer (fine pointer) or an
  ambient sine drift (coarse pointer), never initialized under reduced
  motion.

- [ ] **Step 1: Add the `/cursor/` fixture route.** In
  `tests/browser/fixture-server.mjs`, add after `parallaxConfig`:

```js
const cursorConfig = { ...config, scrub: { ...config.scrub, cursorAccent: true } };
```

  and add `'/cursor/': cursorConfig,` as a new entry in
  `FIXTURE_CONFIGS`.

- [ ] **Step 2: Write the failing browser tests.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('cursor accent stays hidden until scrub.cursorAccent is enabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cursor-accent')).toBeHidden();
});

test('cursor accent dots follow the pointer on a fine-pointer viewport', async ({ page }) => {
  await page.goto('/cursor/');
  await expect(page.locator('#cursor-accent')).toBeVisible();
  const dot = page.locator('.cursor-accent__dot').first();
  const before = await dot.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.move(300, 300);
  await page.mouse.move(500, 120, { steps: 10 });
  await expect.poll(() => dot.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(before);
});

test('reduced motion hides the cursor accent entirely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cursor/');
  await expect(page.locator('#cursor-accent')).toBeHidden();
});
```

- [ ] **Step 3: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "cursor accent"` — expect FAIL
  (`#cursor-accent` doesn't exist yet).

- [ ] **Step 4: Add static markup in `template/index.html`.** Insert
  right after the `.parallax-layers` div added in Task 4, still before
  `<div class="scrub__vignette" aria-hidden="true"></div>`:

```html
        <div id="cursor-accent" class="cursor-accent" aria-hidden="true" hidden>
          <span class="cursor-accent__dot"></span>
          <span class="cursor-accent__dot"></span>
          <span class="cursor-accent__dot"></span>
          <span class="cursor-accent__dot"></span>
        </div>
```

- [ ] **Step 5: Add CSS.** In `template/style.css`, add near
  `.parallax-layer` rules:

```css
.cursor-accent[hidden] { display: none; }
.cursor-accent { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cursor-accent__dot {
  position: absolute;
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.6;
  will-change: transform;
}
```

  In the reduced-motion block, extend the same line from Task 4:

```css
  .scrub__canvas, .scrub__video, .loader, .parallax-layers, .cursor-accent { display: none; }
```

- [ ] **Step 6: Implement in `template/scrub-engine.js`.** Add:

```js
function initCursorAccent(config) {
  if (config.scrub?.cursorAccent !== true) return;
  const container = document.getElementById('cursor-accent');
  container.hidden = false;
  const dots = [...container.querySelectorAll('.cursor-accent__dot')].map((node, index) => ({
    node,
    x: 0,
    y: 0,
    offsetX: (index - 1.5) * 14,
    offsetY: (index % 2 === 0 ? -1 : 1) * 10,
  }));
  const coarse = matchMedia('(pointer: coarse)').matches;
  let pointerX = innerWidth / 2;
  let pointerY = innerHeight / 2;
  if (!coarse) {
    addEventListener('pointermove', (event) => {
      const rect = scrub.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
    });
  }
  const k = alphaToK(0.2);
  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    for (const dot of dots) {
      const targetX = coarse
        ? innerWidth / 2 + Math.sin(now / 1400 + dot.offsetX) * 60 + dot.offsetX
        : pointerX + dot.offsetX;
      const targetY = coarse
        ? innerHeight / 2 + Math.cos(now / 1700 + dot.offsetY) * 60 + dot.offsetY
        : pointerY + dot.offsetY;
      dot.x = smooth(dot.x, targetX, k, dt);
      dot.y = smooth(dot.y, targetY, k, dt);
      dot.node.style.transform = 'translate(' + dot.x + 'px, ' + dot.y + 'px)';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
```

  In `start()`, right after `const parallaxLayers = initParallax(config);`
  (added in Task 4), add:

```js
  initCursorAccent(config);
```

- [ ] **Step 7: Run** `npx playwright test` — expect PASS for the entire
  suite.

- [ ] **Step 8: Commit**

```bash
git add template/index.html template/style.css template/scrub-engine.js tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs
git commit -m "feat: add opt-in pointer-following/ambient-drift cursor accent"
```

---

### Task 6: `SKILL.md` — collect process steps, outro copy, and offer the new toggles

**Files:**
- Modify: `SKILL.md`

**Interfaces:**
- Consumes: nothing new (workflow-only change).
- Produces: Step 1 (Intake) collects process step copy and outro
  headline/body/CTA when the story has a process; Step 6 (Art-direct and
  scaffold) offers `parallax`/`cursorAccent` as optional, off-by-default
  toggles.

- [ ] **Step 1: Read `SKILL.md`'s current Step 1 and Step 6 sections**
  (`## Step 1: Intake` and `## Step 6: Art-direct and scaffold`) to match
  surrounding tone and bullet style exactly.

- [ ] **Step 2: Edit Step 1.** In the bullet that currently reads:

```
- Ask brand, vibe, motion, stopped scenes ("holds"), and CTA. Also collect claim count,
  section count, whether the story has a process, and catalog-item count.
```

  add a new bullet immediately after it:

```
- When the story has a process, collect one short title/body pair per step (3-6
  steps is typical) and persist it to `values.json#process`; this renders as a
  scroll-revealed section between the hero and the closing CTA. Also collect the
  closing headline/body/CTA for `values.json#outro` in this same conversation —
  it renders automatically once present, and stays hidden (no empty gap) if left
  out.
```

- [ ] **Step 3: Edit Step 6.** In `## Step 6: Art-direct and scaffold`,
  after the bullet ending `Explain each token in one short sentence tied
  to something visible in the viewed frames.` add:

```
- Offer `scrub.parallax` and `scrub.cursorAccent` as optional, off-by-default
  toggles: one sentence each — both are purely decorative (no new generation
  call, no added payload), and both disable themselves automatically for
  reduced-motion visitors.
```

- [ ] **Step 4: Verify the edits landed correctly.**

```bash
grep -n "values.json#process" SKILL.md
grep -n "scrub.cursorAccent" SKILL.md
```

  Expect both to print a matching line.

- [ ] **Step 5: Commit**

```bash
git add SKILL.md
git commit -m "docs: collect process/outro copy at intake; offer parallax and cursor-accent toggles"
```
