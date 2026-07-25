# Loading Animation + Spring Reveals + Hover Micro-interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three features from
`docs/superpowers/specs/2026-07-24-loading-and-motion-polish-design.md`:
an animated loader (with real progress in video mode), a spring/bounce
easing wired through the already-present-but-unused `--spring-bounce`
theme token, and CSS-only hover micro-interactions on gallery images,
feature media, and clickable spec rows.

**Architecture:** Every change extends an existing mechanism. The loader
switches from `hidden`-attribute toggling to a `.is-hidden` class so it
can transition. Video-mode progress reuses the exact `loadProgress.value
= fraction` signal shape frames mode already uses, sourced from a
streamed `fetch` read instead of `FrameStore`'s callback. Spring bounce is
computed once in `applyTheme()` into a new `--ease-spring` custom
property (a cubic-bezier string) alongside the existing `--ease`. Hover
effects are pure CSS added to the same
`@media (hover: hover) and (pointer: fine)` structure the CTA hover
already uses, nulled in the existing reduced-motion block.

**Tech Stack:** Vanilla JS (ES modules), vanilla CSS, vitest (unit),
Playwright (browser smoke). No new npm dependencies.

## Global Constraints

- Node 20+; no new npm dependencies.
- `template/scrub-core.js` holds only pure functions; this plan adds no
  new pure functions since all new logic is DOM-adjacent (lives in
  `scrub-engine.js`) or pure CSS.
- Every change must remain behaviorally correct for existing configs:
  `springBounce: 0` (the default for `minimal`/`technical`, and the
  `LEGACY_DIRECTION_RUNTIME` fallback) must produce visually identical
  motion to today's flat `--ease` curve.
- Every new motion effect must be inert under
  `prefers-reduced-motion: reduce`, matching the existing reduced-motion
  blocks in `template/style.css`.
- Do not add a `Co-Authored-By: Claude` trailer to any commit message in
  this repo.
- Commit after every task (message style: existing history, e.g. `feat:
  …`, `fix: …`).
- Run unit tests with `npx vitest run <file>`; browser tests with `npx
  playwright test`.
- Repo root: `c:\Users\ryanh\Documents\scroll-wizard`. All paths below are
  relative to it. Do this work in its own git worktree/branch, not
  directly on `main`.

---

### Task 1: Animated loader (fade transition + progress-bar restyle)

**Files:**
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `#loader` fades out via a `.is-hidden` class (not the `hidden`
  attribute) whenever loading completes, in both frames mode
  (`scrub-engine.js:510`) and video mode (`scrub-engine.js:650`, though
  Task 2 changes *when* video mode hides it, not *how*). `#load-progress`'s
  fill uses the theme accent color and pulses gently while visible.

- [ ] **Step 1: Write the failing browser test.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('loader fades out via a class instead of snapping hidden', async ({ page }) => {
  await page.route('**/frames/frame-*.webp', async (route) => {
    const isFirstFrame = route.request().url().endsWith('frame-0001.webp');
    if (!isFirstFrame) await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#loader')).not.toHaveClass(/is-hidden/);
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1)).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#loader')).toHaveClass(/is-hidden/);
  const opacity = await page.locator('#loader').evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(0.5);
});
```

- [ ] **Step 2: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "loader fades out"` — expect FAIL
  (`#loader` never gains `is-hidden`; it uses the `hidden` attribute
  today).

- [ ] **Step 3: Add CSS.** In `template/style.css`, replace the existing
  `.loader` rule:

```css
.loader {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  font-size: .8rem;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .7;
}
```

  with:

```css
.loader {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  font-size: .8rem;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .7;
  transition: opacity 320ms var(--ease), transform 320ms var(--ease);
}
.loader.is-hidden {
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
}
#load-progress {
  accent-color: var(--accent);
}
#load-progress::-webkit-progress-value { transition: width 120ms linear; }
@keyframes loader-pulse { 50% { opacity: .55; } }
#load-progress { animation: loader-pulse 1.4s ease-in-out infinite; }
```

  In the existing `@media (prefers-reduced-motion: reduce)` block, change
  `.scrub__canvas, .scrub__video, .loader { display: none; }` — this
  already fully hides `.loader` under reduced motion, so no further
  reduced-motion CSS is needed for the pulse/transition (they never run
  because the element is `display: none`). Confirm this line still reads
  exactly that after your edit; do not duplicate it.

- [ ] **Step 4: Update `template/scrub-engine.js`.** Replace both
  existing occurrences of `loader.hidden = true;` (at the frames-mode
  first-drawn-frame site, `scrub-engine.js:510`, and the video-mode site,
  `scrub-engine.js:650`) with `loader.classList.add('is-hidden');`.

- [ ] **Step 5: Run** `npx playwright test tests/browser/smoke.spec.mjs
  --grep "loader fades out"` — expect PASS. Then run the full suite (`npx
  playwright test`) — expect PASS with no regressions (in particular the
  existing `'loader hides after the first painted frame...'`-style tests,
  which check hidden state — confirm they still pass by checking the
  `is-hidden` class instead of/in addition to whatever they check today;
  read that test first and update its assertion from `toBeHidden()`
  checking the `hidden` attribute to checking the `is-hidden` class if it
  relied on the attribute specifically).

- [ ] **Step 6: Commit**

```bash
git add template/style.css template/scrub-engine.js tests/browser/smoke.spec.mjs
git commit -m "feat: fade the loader out instead of snapping it hidden"
```

---

### Task 2: Real load progress in video mode

**Files:**
- Modify: `template/scrub-engine.js`
- Modify: `tests/browser/fixture-server.mjs`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: Task 1's `.is-hidden` class.
- Produces: `loadScrubVideo(config, onProgress)` reports real fractional
  download progress via `onProgress(fraction)`, called with the same
  signature `FrameStore`'s callback already uses
  (`(fraction) => { loadProgress.value = fraction; }`). The loader hides
  once the video is actually ready to play, not immediately at the start
  of `runVideoEngine`.

- [ ] **Step 1: Add a throttled video route to the fixture server**, so a
  test can observe intermediate progress. In
  `tests/browser/fixture-server.mjs`, find the `/video/media/video.webm`
  route handler (serves `videoPath` in one `res.end(await
  readFile(videoPath))` call) and add a sibling route for a deliberately
  slow, chunked version:

```js
  if (pathname === '/video/media/video-slow.webm') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    const body = await readFile(videoPath);
    res.writeHead(200, {
      'Content-Type': contentTypes['.webm'],
      'Content-Length': String(body.length),
    });
    const half = Math.floor(body.length / 2);
    res.write(body.subarray(0, half));
    await new Promise((resolve) => setTimeout(resolve, 200));
    res.end(body.subarray(half));
    return;
  }
```

  Add a `videoSlowConfig` fixture (spread of `videoConfig` pointing
  `video.src` at `'media/video-slow.webm'`) and serve it at a new
  `/video-slow/` prefix — mirror exactly how `/video/` itself is prefixed
  in `serveStatic`'s `sitePath` computation (the ternary keyed on
  `pathname.startsWith('/video/')`); extend that ternary to also handle
  `/video-slow/` the same way, and add the matching
  `pathname === '/config.json' || pathname === '/video/config.json'`
  check to also accept `/video-slow/config.json` → `videoSlowConfig`.

- [ ] **Step 2: Write the failing browser test.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('video mode reports real load progress instead of hiding instantly', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.goto('/video-slow/');
  // Read the live DOM property, not the `value` attribute: setting
  // `<progress>.value` via JS does not update the reflected HTML
  // attribute, so getAttribute('value') would always read the static
  // markup value ("0") regardless of runtime progress.
  await expect.poll(() => page.locator('#load-progress').evaluate((el) => el.value))
    .toBeGreaterThan(0);
  const midProgress = await page.locator('#load-progress').evaluate((el) => el.value);
  expect(midProgress).toBeLessThan(1);
  await expect(page.locator('#loader')).toHaveClass(/is-hidden/, { timeout: 5000 });
});
```

- [ ] **Step 3: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "real load progress"` — expect FAIL
  (`loadScrubVideo` today has no progress reporting; `#load-progress`
  stays at `0` the whole time since video mode never writes to it).

- [ ] **Step 4: Implement in `template/scrub-engine.js`.** Replace
  `loadScrubVideo`:

```js
async function loadScrubVideo(config) {
  const response = await fetch(config.video.src);
  if (!response.ok) throw new Error('Video request failed: HTTP ' + response.status);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  addEventListener('pagehide', revoke, { once: true });
  scrubVideo.src = objectUrl;
  try {
    await new Promise((resolve, reject) => {
      const loaded = () => {
        scrubVideo.removeEventListener('error', failed);
        resolve();
      };
      const failed = () => {
        scrubVideo.removeEventListener('loadedmetadata', loaded);
        reject(new Error('Scrub video failed to load.'));
      };
      if (scrubVideo.readyState >= 1) {
        resolve();
        return;
      }
      scrubVideo.addEventListener('loadedmetadata', loaded, { once: true });
      scrubVideo.addEventListener('error', failed, { once: true });
    });
  } catch (error) {
    revoke();
    throw error;
  }
  return scrubVideo;
}
```

  with:

```js
async function loadScrubVideo(config, onProgress) {
  const response = await fetch(config.video.src);
  if (!response.ok) throw new Error('Video request failed: HTTP ' + response.status);
  const total = Number(response.headers.get('content-length'));
  let blob;
  if (Number.isFinite(total) && total > 0 && response.body) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(Math.min(1, received / total));
    }
    blob = new Blob(chunks);
  } else {
    blob = await response.blob();
  }
  const objectUrl = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  addEventListener('pagehide', revoke, { once: true });
  scrubVideo.src = objectUrl;
  try {
    await new Promise((resolve, reject) => {
      const loaded = () => {
        scrubVideo.removeEventListener('error', failed);
        resolve();
      };
      const failed = () => {
        scrubVideo.removeEventListener('loadedmetadata', loaded);
        reject(new Error('Scrub video failed to load.'));
      };
      if (scrubVideo.readyState >= 1) {
        resolve();
        return;
      }
      scrubVideo.addEventListener('loadedmetadata', loaded, { once: true });
      scrubVideo.addEventListener('error', failed, { once: true });
    });
  } catch (error) {
    revoke();
    throw error;
  }
  return scrubVideo;
}
```

  In `runVideoEngine`, remove the line `loader.hidden = true;` (it
  currently hides the loader immediately, before the video is even
  ready — exactly the gap this task closes). In `start()`, find the call
  site `video = await loadScrubVideo(config);` and change it to:

```js
    video = await loadScrubVideo(config, (fraction) => {
      loadProgress.value = fraction;
    });
    loader.classList.add('is-hidden');
```

  (placed right after the `loadScrubVideo` call succeeds, before
  `runVideoEngine(config, overlayNodes, video);` is called — so the
  loader now hides once the video is actually downloaded and its
  metadata is ready, using Task 1's fade, not before).

- [ ] **Step 5: Run** `npx playwright test tests/browser/smoke.spec.mjs
  --grep "real load progress"` — expect PASS. Then run the full suite —
  expect PASS with no regressions to the existing video-mode tests
  (`video mode scrubs the video with scroll`, etc.) or frames-mode tests.

- [ ] **Step 6: Commit**

```bash
git add template/scrub-engine.js tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs
git commit -m "feat: report real download progress for video-mode loading"
```

---

### Task 3: Spring/bounce easing

**Files:**
- Modify: `template/scrub-engine.js`
- Modify: `template/style.css`
- Modify: `references/directions.json`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `motion.springBounce` (already present in every
  `directions.json` preset and `LEGACY_DIRECTION_RUNTIME`).
- Produces: a new `--ease-spring` CSS custom property (a cubic-bezier
  string derived from `springBounce`), consumed by `.overlay__content`'s
  transform transition and the `section-reveal` keyframe animation's
  timing function. At `springBounce: 0` this is visually identical to
  today's flat `--ease` motion.

- [ ] **Step 1: Write the failing browser test.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('bold direction gets an overshooting spring ease, minimal stays flat', async ({ page }) => {
  await page.goto('/?direction=bold', { waitUntil: 'domcontentloaded' });
  await page.goto('/video/?fixture=variants&direction=bold');
  const boldEase = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim());
  expect(boldEase).toMatch(/cubic-bezier\(0\.34, 1\.\d+, 0\.64, 1\)/);

  await page.goto('/video/?fixture=variants&direction=minimal');
  const minimalEase = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim());
  expect(minimalEase).toBe('cubic-bezier(0.34, 1, 0.64, 1)');
});
```

  (This reuses the existing `variants`/`direction` fixture-selection
  mechanism already in `fixture-server.mjs`'s `/config.json` handler —
  read that handler first to confirm the exact query-param names and
  navigation pattern other direction-variant tests in this file already
  use, and match it exactly rather than guessing.)

- [ ] **Step 2: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "overshooting spring ease"` —
  expect FAIL (`--ease-spring` doesn't exist yet).

- [ ] **Step 3: Implement in `template/scrub-engine.js`.** In
  `applyTheme()`, immediately after the existing line
  `root.setProperty('--ease', motion.ease ?? LEGACY_DIRECTION_RUNTIME.motion.ease);`
  add:

```js
  const bounce = Number(
    motion.springBounce ?? LEGACY_DIRECTION_RUNTIME.motion.springBounce,
  ) || 0;
  root.setProperty('--ease-spring', `cubic-bezier(0.34, ${1 + bounce}, 0.64, 1)`);
```

  (`1 + bounce` is the control-point term that produces a visible
  overshoot-then-settle within a single transition/animation — this is
  the same control-point shape as the well-known
  `cubic-bezier(0.34, 1.56, 0.64, 1)` "easeOutBack" curve; at `bounce: 0`
  it reduces to `cubic-bezier(0.34, 1, 0.64, 1)`, a flat ease-out with no
  overshoot.)

- [ ] **Step 4: Update CSS consumers in `template/style.css`.** In the
  `.overlay__content` rule, change only the `transform` line of the
  `transition` (leave `filter` on `--ease` — blur doesn't have a
  meaningful "overshoot"):

```css
  transition:
    transform 320ms var(--ease-spring),
    filter 260ms var(--ease);
```

  In the `@supports (animation-timeline: view())` block, change:

```css
  .site-section:not([data-section="scrub-hero"]) .section-reveal { animation: section-reveal both linear; animation-timeline: view(); animation-range: entry 10% cover 32%; }
```

  to:

```css
  .site-section:not([data-section="scrub-hero"]) .section-reveal { animation: section-reveal both var(--ease-spring); animation-timeline: view(); animation-range: entry 10% cover 32%; }
```

- [ ] **Step 5: Update `references/directions.json`.** Change
  `bold.motion.springBounce` from `0` to `0.35` and
  `cinematic.motion.springBounce` from `0` to `0.12` (cinematic gets a
  much subtler bounce, matching its otherwise restrained motion
  character — `bold` is the preset explicitly meant to feel playful).
  Leave `minimal.motion.springBounce` and `technical.motion.springBounce`
  at `0`.

- [ ] **Step 6: Run** `npx playwright test tests/browser/smoke.spec.mjs
  --grep "overshooting spring ease"` — expect PASS. Then run the full
  suite — expect PASS with no regressions (in particular, any test
  asserting exact `--ease` values or overlay transition behavior for
  `minimal`/`technical` fixtures should be unaffected, since those two
  presets' `--ease-spring` is behaviorally flat).

- [ ] **Step 7: Commit**

```bash
git add template/scrub-engine.js template/style.css references/directions.json tests/browser/smoke.spec.mjs
git commit -m "feat: wire the unused spring-bounce token into overshoot easing"
```

---

### Task 4: Hover micro-interactions

**Files:**
- Modify: `template/style.css`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: nothing new (pure CSS, no JS/config changes).
- Produces: gallery images and feature-split media scale up slightly on
  hover; clickable spec rows (`.section-spec__row[data-beat]`, per
  `interactions.js:72`) get a hover background/shift. All gated behind
  `@media (hover: hover) and (pointer: fine)` and nulled under reduced
  motion, matching the existing CTA hover pattern exactly.

- [ ] **Step 1: Write the failing browser tests.** Append to
  `tests/browser/smoke.spec.mjs` (reuses the existing `sections`/`interactive`
  fixture query params already wired in `fixture-server.mjs` — confirm the
  exact navigation pattern other section tests in this file use before
  writing these, rather than guessing the URL):

```js
test('gallery image scales on hover at a fine-pointer viewport', async ({ page }) => {
  await page.goto('/?fixture=sections');
  const image = page.locator('.section-gallery__image').first();
  const before = await image.evaluate((el) => getComputedStyle(el).transform);
  await image.hover();
  await expect.poll(() => image.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(before);
});

test('clickable spec row gets a hover treatment, non-clickable rows do not', async ({ page }) => {
  await page.goto('/?fixture=sections');
  const clickableRow = page.locator('.section-spec__row[data-beat]').first();
  const before = await clickableRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  await clickableRow.hover();
  await expect.poll(() => clickableRow.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(before);
});

test('reduced motion disables gallery hover scale', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?fixture=sections');
  const image = page.locator('.section-gallery__image').first();
  const before = await image.evaluate((el) => getComputedStyle(el).transform);
  await image.hover();
  const after = await image.evaluate((el) => getComputedStyle(el).transform);
  expect(after).toBe(before);
});
```

- [ ] **Step 2: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "hover"` — expect FAIL (no hover
  rules exist yet for gallery images or spec rows).

- [ ] **Step 3: Add CSS.** In `template/style.css`, inside the existing
  `@media (hover: hover) and (pointer: fine) { .overlay__cta, .outro__cta { ... } ... }`
  block, add:

```css
  .section-feature__media { overflow: hidden; }
  .section-feature__media .section-feature__image,
  .section-feature__media .section-feature__video,
  .section-gallery__image {
    transition: transform 220ms var(--ease);
  }
  .section-feature__media:hover .section-feature__image,
  .section-feature__media:hover .section-feature__video {
    transform: scale(1.03);
  }
  .section-gallery__button:hover .section-gallery__image {
    transform: scale(1.04);
  }
  .section-spec__row[data-beat] {
    cursor: pointer;
    transition: background-color 160ms var(--ease), transform 160ms var(--ease);
  }
  .section-spec__row[data-beat]:hover {
    background-color: var(--surface);
    transform: translateX(2px);
  }
```

  (Note: `.section-spec__row[data-beat]` is placed inside the
  `hover: hover` block per this task's scope, but `cursor: pointer` and
  the `transition` declaration are harmless outside a hover-only context
  too — leave them inside the block for consistency with where
  interactive-affordance styling already lives in this file.)

  In the existing minified `@media (prefers-reduced-motion:reduce)` tail
  rule (the one already nulling `.scrub__tint`/nav-pill/hotspot/etc.
  transitions), add `.section-feature__image,.section-feature__video,
  .section-gallery__image,.section-spec__row[data-beat]` to the
  comma-separated selector list that gets `transition:none!important`,
  and also add a rule forcing `transform:none!important` on
  `.section-feature__media:hover .section-feature__image,
  .section-feature__media:hover .section-feature__video,
  .section-gallery__button:hover .section-gallery__image,
  .section-spec__row[data-beat]:hover` so the hover state itself cannot
  visually change anything under reduced motion (matching how
  `.overlay__cta:hover`/`.outro__cta:hover` are already forced back to
  `transform: none` in the larger reduced-motion block above it).

- [ ] **Step 4: Run** `npx playwright test tests/browser/smoke.spec.mjs
  --grep "hover"` — expect PASS. Then run the full suite — expect PASS
  with no regressions.

- [ ] **Step 5: Commit**

```bash
git add template/style.css tests/browser/smoke.spec.mjs
git commit -m "feat: add hover micro-interactions to gallery, feature media, and spec rows"
```
