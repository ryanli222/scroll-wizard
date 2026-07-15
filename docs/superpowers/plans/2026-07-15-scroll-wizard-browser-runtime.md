# Scroll Wizard Browser Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build the self-contained static template, bounded-memory scrub runtime, Chromium smoke suite, and full ffmpeg pipeline integration test.

**Architecture:** Semantic HTML provides a real poster image and ordinary content structure. scrub-engine fetches configuration, renders user text safely, stores compressed frame blobs, and keeps decoded ImageBitmap objects inside a direction-biased window. Browser tests exercise the runtime against a built-in fixture server; integration tests exercise the real CLIs with an ffmpeg-generated video.

**Tech Stack:** Browser ESM, Canvas 2D, createImageBitmap, ResizeObserver, FontFace, Lenis 1.3.25, Playwright Test 1.61.1, Node.js HTTP, Vitest, ffmpeg.

## Global Constraints

- Complete the foundation/core and CLI pipeline plans first.
- Generated sites make no external network requests.
- The poster is a real img and canvas is aria-hidden.
- User-provided copy is assigned through textContent; no configuration string reaches innerHTML.
- URLs pass validateConfig before being assigned to href.
- Reduced-motion mode requests only config and the poster.
- Decoded bitmaps never exceed min(frameCount, 2N + 1), where N defaults to 12.
- Every bitmap leaving the decode window is closed.
- A failed frame logs once and the canvas renders the nearest decoded frame or poster.
- Deleting lenis.js leaves native scrolling and anchor links functional.
- Browser tests skip cleanly when the pinned Chromium executable is absent.

---

### Task 7: Create the static template and pin Lenis

**Files:**
- Create: template/index.html
- Create: template/style.css
- Create: template/config.json
- Create: template/lenis.js
- Test: tests/unit/template.test.mjs

**Interfaces:**
- Consumes: config.json and same-origin frame/font files.
- Produces: #scrub, #poster, #scrub-canvas, #overlay-layer, #load-progress, #outro, and #fatal-error DOM hooks.

- [ ] **Step 1: Write the failing static-template contract**

~~~javascript
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(
  new URL('../../template/index.html', import.meta.url), 'utf8',
);
const config = JSON.parse(await readFile(
  new URL('../../template/config.json', import.meta.url), 'utf8',
));

describe('template contract', () => {
  it('contains semantic runtime hooks and a real poster image', () => {
    expect(html).toContain('id="poster"');
    expect(html).toContain('id="scrub-canvas"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('id="overlay-layer"');
    expect(html).toContain('id="outro"');
    expect(html).toContain('type="module" src="scrub-engine.js"');
  });

  it('ships a complete valid example', async () => {
    const { validateConfig } = await import('../../template/scrub-core.js');
    expect(validateConfig(config).errors).toEqual([]);
    expect(config.brand.imageAlt).toBeTruthy();
  });
});
~~~

- [ ] **Step 2: Run the test and verify red**

Run: npm run test:unit -- tests/unit/template.test.mjs

Expected: FAIL because template/index.html and template/config.json do not exist.

- [ ] **Step 3: Create index.html**

~~~html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Scroll story</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <section id="scrub" class="scrub" aria-label="Visual story">
      <div class="scrub__sticky">
        <img id="poster" class="scrub__poster" alt="">
        <canvas id="scrub-canvas" class="scrub__canvas" aria-hidden="true"></canvas>
        <div id="overlay-layer" class="overlays"></div>
        <div class="loader" aria-live="polite">
          <span id="load-label">Loading scene</span>
          <progress id="load-progress" value="0" max="1"></progress>
        </div>
        <p id="fatal-error" class="fatal-error" role="alert" hidden></p>
      </div>
    </section>
    <section id="outro" class="outro"></section>
  </main>
  <footer class="footer">
    <span id="footer-brand"></span>
  </footer>
  <script src="lenis.js"></script>
  <script type="module" src="scrub-engine.js"></script>
</body>
</html>
~~~

- [ ] **Step 4: Create a complete example config**

~~~json
{
  "brand": {
    "name": "Aster",
    "tagline": "Light, held in motion",
    "imageAlt": "A sculptural Aster lamp rotating through a dark studio"
  },
  "theme": {
    "bg": "#050607",
    "text": "#f7f8f2",
    "accent": "#dfff57",
    "surface": "rgba(5, 6, 7, 0.78)",
    "radius": 12,
    "fonts": {
      "display": "Georgia, serif",
      "body": "Inter, ui-sans-serif, system-ui, sans-serif"
    }
  },
  "frames": {
    "count": 24,
    "pattern": "frames/frame-{index:4}.webp",
    "poster": "frames/frame-0001.webp"
  },
  "scrub": {
    "heightVh": 400,
    "smoothing": 0.12
  },
  "overlays": [
    {
      "at": [0.05, 0.22],
      "title": "Form follows light",
      "body": "A quiet opening view.",
      "position": "center"
    },
    {
      "at": [0.36, 0.56],
      "title": "Precision at rest",
      "body": "The scene pauses while the detail lands.",
      "hold": true,
      "position": "left",
      "stats": [
        { "value": "18 h", "label": "Battery" }
      ],
      "cta": {
        "label": "See the specs",
        "href": "#specs"
      }
    }
  ],
  "outro": {
    "headline": "Made to move with you",
    "body": "One object, seen from every side.",
    "cta": {
      "label": "Buy Aster",
      "href": "#buy"
    }
  }
}
~~~

- [ ] **Step 5: Implement style.css**

Define these exact behaviors:

~~~css
:root {
  --bg: #050607;
  --text: #f7f8f2;
  --accent: #dfff57;
  --surface: rgba(5, 6, 7, 0.78);
  --radius: 12px;
  --display: Georgia, serif;
  --body: Inter, ui-sans-serif, system-ui, sans-serif;
}

* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); font-family: var(--body); }
body { margin: 0; background: var(--bg); }
button, a { font: inherit; }
a:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 4px;
}

.scrub { position: relative; height: 400vh; }
.scrub__sticky {
  position: sticky;
  top: 0;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}
.scrub__poster,
.scrub__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.scrub__poster { object-fit: cover; transition: opacity 240ms ease; }
.scrub__poster.is-hidden { opacity: 0; pointer-events: none; }
.scrub__canvas { display: block; }
.overlays { position: absolute; inset: 0; pointer-events: none; }
.overlay {
  position: absolute;
  top: 50%;
  width: min(32rem, calc(100% - 2rem));
  padding: clamp(1rem, 2vw, 1.5rem);
  border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
  border-radius: var(--radius);
  background: var(--surface);
  backdrop-filter: blur(18px);
  transform: translateY(-50%);
  opacity: 0;
}
.overlay--center { left: 50%; transform: translate(-50%, -50%); text-align: center; }
.overlay--left { left: clamp(1rem, 6vw, 6rem); }
.overlay--right { right: clamp(1rem, 6vw, 6rem); }
.overlay__cta, .outro__cta { pointer-events: auto; }
.stats { display: flex; flex-wrap: wrap; gap: .75rem; }
.stat { padding: .6rem .8rem; border: 1px solid currentColor; border-radius: var(--radius); }
.loader { position: absolute; left: 1rem; bottom: 1rem; font-size: .8rem; }
.fatal-error { position: absolute; inset: auto 1rem 1rem; background: #600; padding: 1rem; }
.outro { min-height: 80vh; display: grid; place-content: center; padding: 8vw; text-align: center; }
.footer { padding: 1rem; text-align: center; }
h1, h2, h3 { font-family: var(--display); }

@media (max-width: 700px) {
  .overlay--left, .overlay--right {
    left: 1rem;
    right: 1rem;
    width: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scrub { height: auto !important; }
  .scrub__sticky { position: relative; height: auto; overflow: visible; }
  .scrub__poster { position: relative; width: 100%; min-height: 60vh; }
  .scrub__canvas, .loader { display: none; }
  .overlays { position: relative; display: grid; gap: 1rem; padding: 1rem; }
  .overlay, .overlay--center, .overlay--left, .overlay--right {
    position: relative;
    inset: auto;
    width: 100%;
    transform: none;
    opacity: 1 !important;
  }
}
~~~

- [ ] **Step 6: Vendor Lenis 1.3.25**

Run:

~~~bash
npm pack lenis@1.3.25 --pack-destination .scroll-wizard-vendor
tar -xf .scroll-wizard-vendor/lenis-1.3.25.tgz -C .scroll-wizard-vendor
~~~

Copy package/dist/lenis.min.js to template/lenis.js without modification. Preserve its license banner. Record the upstream version, https://github.com/darkroomengineering/lenis, copyright darkroom.engineering, and full MIT license in THIRD_PARTY_LICENSES.md during Task 12. Delete .scroll-wizard-vendor.

- [ ] **Step 7: Run template tests**

Run: npm run test:unit -- tests/unit/template.test.mjs

Expected: PASS for hooks, poster semantics, module reference, and valid example config.

- [ ] **Step 8: Commit**

~~~bash
git add template/index.html template/style.css template/config.json template/lenis.js tests/unit/template.test.mjs
git commit -m "feat: add static scrub template"
~~~

### Task 8: Implement the bounded-memory scrub engine

**Files:**
- Create: template/scrub-engine.js
- Test: tests/browser/smoke.spec.mjs in Task 9

**Interfaces:**
- Consumes: template DOM hooks and validated config.json.
- Produces: rendered copy, bounded FrameStore, responsive canvas, scroll-driven frames/overlays, reduced-motion static layout, optional Lenis, and optional FontFace.

- [ ] **Step 1: Implement safe DOM constructors**

Import alphaToK, applyHolds, canvasSize, coverRect, decodeWindow, frameFilename, overlayOpacity, progressToFrame, scrollProgress, smooth, and validateConfig from scrub-core.js.

Use only textContent and DOM properties:

~~~javascript
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function linkButton(cta, className) {
  const link = element('a', className, cta.label);
  link.href = cta.href;
  return link;
}

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
~~~

renderOutro creates h1, p, and optional anchor in #outro. Set #footer-brand with textContent. Set CSS variables with style.setProperty; never concatenate a style attribute.

- [ ] **Step 2: Implement FrameStore**

Use this state and invariant:

~~~javascript
class FrameStore {
  constructor(config, onProgress) {
    this.config = config;
    this.onProgress = onProgress;
    this.blobs = new Array(config.frames.count);
    this.failed = new Set();
    this.warned = new Set();
    this.bitmaps = new Map();
    this.pendingBitmaps = new Map();
    this.radius = 12;
    this.loaded = 0;
  }

  url(index) {
    return frameFilename(index, this.config.frames.pattern);
  }

  async fetchOne(index) {
    if (this.blobs[index] || this.failed.has(index)) return;
    try {
      const response = await fetch(this.url(index));
      if (!response.ok) throw new Error('HTTP ' + response.status);
      this.blobs[index] = await response.blob();
    } catch (error) {
      this.failed.add(index);
      this.warnOnce(index, error);
    } finally {
      this.loaded += 1;
      this.onProgress(this.loaded / this.config.frames.count);
    }
  }

  warnOnce(index, error) {
    if (this.warned.has(index)) return;
    this.warned.add(index);
    console.warn('Frame ' + (index + 1) + ' failed:', error.message);
  }
}
~~~

Add preloadAll(concurrency = 6) using a shared next-index counter and six async workers. It stores only Blob objects.

Add ensureBitmap(index):

1. Return an existing bitmap.
2. Return an existing pending promise.
3. Fetch the blob when absent.
4. Call createImageBitmap(blob).
5. Store the bitmap only if index is still desired; otherwise close it immediately.
6. Remove the pending promise in finally.

Add reconcile(target, direction):

~~~javascript
async reconcile(target, direction) {
  const desired = new Set(
    decodeWindow(target, this.radius, this.config.frames.count, direction),
  );
  this.desired = desired;
  for (const [index, bitmap] of this.bitmaps) {
    if (!desired.has(index)) {
      bitmap.close();
      this.bitmaps.delete(index);
    }
  }
  const ordered = [...desired].sort((a, b) => {
    const aAhead = direction >= 0 ? a - target : target - a;
    const bAhead = direction >= 0 ? b - target : target - b;
    return Math.abs(aAhead) - Math.abs(bAhead);
  });
  await Promise.allSettled(ordered.map((index) => this.ensureBitmap(index)));
}
~~~

nearest(index) returns the decoded bitmap with minimum absolute index distance, preferring the requested direction on ties. destroy closes every bitmap and clears maps.

- [ ] **Step 3: Implement configuration, poster, theme, and font startup**

Startup sequence:

1. Fetch config.json with cache: no-store.
2. Run validateConfig; throw a joined human-readable error when errors exist and console.warn each warning.
3. Apply CSS variables and scrub height.
4. Set poster.src to config.frames.poster.
5. Set poster.alt to brand.imageAlt || brand.tagline || brand.name + " hero scene".
6. Wait for poster.decode(), falling back to the load event when decode rejects.
7. Build overlays/outro/footer safely.
8. If theme.fonts.displayFile exists, load FontFace("ScrollWizardDisplay", url), add it to document.fonts, and set --display to ScrollWizardDisplay plus the configured fallback stack. Warn and continue on failure.
9. If window.Lenis exists and reduced motion is false, create new window.Lenis({autoRaf: true, anchors: true}).

On any fatal config/poster error, reveal #fatal-error with textContent and leave ordinary page scrolling available.

- [ ] **Step 4: Implement reduced motion**

When matchMedia('(prefers-reduced-motion: reduce)').matches:

1. Do not construct FrameStore and do not request frameFilename values.
2. Keep the poster visible.
3. Remove inert from every overlay.
4. Set each overlay opacity to 1 and clear pointer-events overrides.
5. Do not initialize Lenis or requestAnimationFrame.
6. Return after rendering copy.

Listen for a preference change and reload once so changing the OS/browser emulation switches modes deterministically.

- [ ] **Step 5: Implement canvas sizing and drawing**

~~~javascript
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const size = canvasSize(rect.width, rect.height, devicePixelRatio);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
    return true;
  }
  return false;
}

function drawCover(context, source) {
  const crop = coverRect(
    source.width, source.height,
    context.canvas.width, context.canvas.height,
  );
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(
    source,
    crop.sx, crop.sy, crop.sw, crop.sh,
    0, 0, context.canvas.width, context.canvas.height,
  );
}
~~~

Observe the sticky wrapper with ResizeObserver, resize at startup, and redraw the last source after resize.

- [ ] **Step 6: Implement the animation loop**

Hold ranges are config.overlays.filter(overlay => overlay.hold).map(overlay => overlay.at).

Each rAF tick:

1. Calculate raw progress with scrollProgress(window.scrollY, scrub.offsetTop, scrub.offsetHeight, innerHeight).
2. Calculate target progress with applyHolds.
3. Smooth toward target with alphaToK(config.scrub.smoothing), clamping dt to at most 0.1 seconds.
4. Convert smoothed progress to target frame.
5. Derive direction from target frame minus previous target frame.
6. When target changes, call store.reconcile without awaiting the rAF loop.
7. Draw store.nearest(target) when its index differs from the last drawn index.
8. On the first successful canvas draw, add is-hidden to the poster.
9. For each overlay, set opacity from overlayOpacity(raw, overlay.at), set inert when opacity < 0.05, and set pointer-events to auto only when visible.
10. Request the next animation frame.

Start store.preloadAll() in the background after poster paint. The canvas may begin as soon as the target window decodes; it does not wait for all compressed frames.

- [ ] **Step 7: Add engine observability used by smoke tests**

Expose read-only debug state only under localhost:

~~~javascript
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  window.__SCROLL_WIZARD_DEBUG__ = {
    get decodedCount() { return store?.bitmaps.size ?? 0; },
    get lastFrame() { return lastDrawnIndex; },
    get failedFrames() { return [...(store?.failed ?? [])]; },
  };
}
~~~

- [ ] **Step 8: Run unit tests and syntax check**

Run: node --check template/scrub-engine.js

Expected: exit 0.

Run: npm run test:unit

Expected: all existing unit tests pass.

- [ ] **Step 9: Commit**

~~~bash
git add template/scrub-engine.js
git commit -m "feat: add bounded scroll scrub engine"
~~~

### Task 9: Add the Chromium browser smoke suite

**Files:**
- Create: tests/browser/fixture-server.mjs
- Create: tests/browser/smoke.spec.mjs
- Modify: playwright.config.mjs

**Interfaces:**
- Consumes: shipped template files.
- Produces: deterministic local frames/config and smoke coverage for poster, canvas, focus/inert, reduced motion, frame failure, and decode bound.

- [ ] **Step 1: Implement a dependency-free fixture server**

fixture-server.mjs serves template files from the repository and generates 8 two-by-two PNG frames in memory. Build PNGs with node:zlib and explicit PNG chunks:

~~~javascript
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function makePng(red, green, blue) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.from([0, red, green, blue, red, green, blue]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
~~~

Use config frames.count=8, pattern frames/frame-{index:4}.webp, poster frame 1, heightVh=250, one hold CTA overlay, and valid high-contrast tokens. For /frames/frame-N.webp, return makePng(N * 25, 20, 255 - N * 25) with Content-Type image/png. Serve only normalized paths inside template; reject traversal with 403.

- [ ] **Step 2: Write smoke tests with browser availability skip**

~~~javascript
import { existsSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';

test.skip(
  !existsSync(chromium.executablePath()),
  'Playwright Chromium is not installed; browser smoke suite skipped.',
);

test('poster appears before delayed sequence and canvas scrubs', async ({ page }) => {
  await page.route('**/frames/frame-*.webp', async (route) => {
    if (!route.request().url().endsWith('frame-0001.webp')) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#poster')).toBeVisible();
  await expect(page.locator('#poster')).not.toHaveClass(/is-hidden/);

  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 0)).toBeGreaterThan(0);
  const first = await page.evaluate(() =>
    [...document.querySelector('#scrub-canvas').getContext('2d').getImageData(0, 0, 1, 1).data]);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.65));
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1)).toBeGreaterThan(1);
  const later = await page.evaluate(() =>
    [...document.querySelector('#scrub-canvas').getContext('2d').getImageData(0, 0, 1, 1).data]);
  expect(later).not.toEqual(first);
});

test('visibility controls inert and keyboard focus', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('[data-overlay-index="0"]');
  await expect(overlay).toHaveJSProperty('inert', true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
  await expect(overlay).toHaveJSProperty('inert', false);
  await overlay.getByRole('link').focus();
  await expect(overlay.getByRole('link')).toBeFocused();
});
~~~

- [ ] **Step 3: Add reduced-motion and missing-frame tests**

~~~javascript
test('reduced motion requests only the poster frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requested = [];
  page.on('request', (request) => {
    if (request.url().includes('/frames/')) requested.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#scrub-canvas')).toBeHidden();
  await expect(page.locator('[data-overlay-index="0"]')).toHaveJSProperty('inert', false);
  await page.waitForTimeout(200);
  expect(requested.map((url) => url.split('/').pop())).toEqual(['frame-0001.webp']);
});

test('one missing frame warns once and keeps rendering', async ({ page }) => {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/frames/frame-0004.webp', (route) =>
    route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.5));
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.failedFrames.includes(3))).toBe(true);
  expect(warnings.filter((line) => line.includes('Frame 4 failed'))).toHaveLength(1);
  await expect(page.locator('#scrub-canvas')).toBeVisible();
});

test('decoded bitmap count never exceeds the configured bound', async ({ page }) => {
  await page.goto('/');
  for (const fraction of [0.1, 0.3, 0.6, 0.9]) {
    await page.evaluate((value) =>
      scrollTo(0, document.body.scrollHeight * value), fraction);
  }
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 999)).toBeLessThanOrEqual(8);
});
~~~

- [ ] **Step 4: Run the browser suite**

Run: npx playwright install chromium

Expected: Chromium installs successfully. If it is already installed, the command exits 0 without changing application files.

Run: npm run test:browser

Expected: 5 tests pass. If Chromium is intentionally absent, all tests report skipped and the command exits 0.

- [ ] **Step 5: Commit**

~~~bash
git add tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs playwright.config.mjs
git commit -m "test: add browser scrub smoke coverage"
~~~

### Task 10: Add the real ffmpeg integration pipeline

**Files:**
- Create: tests/integration/pipeline.test.mjs

**Interfaces:**
- Consumes: ffmpeg/ffprobe and all four CLIs.
- Produces: one generated-video pipeline test covering validation, extraction, scaffold, approvals, staleness, and replacement.

- [ ] **Step 1: Write the self-skipping fixture setup**

~~~javascript
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

describe.skipIf(!hasFfmpeg)('ffmpeg pipeline', () => {
  // Tests below.
});
~~~

- [ ] **Step 2: Generate and validate the fixture**

Inside the suite, create a temporary project and run:

~~~javascript
const fixture = join(projectDir, 'input', 'video.mp4');
await mkdir(join(projectDir, 'input'), { recursive: true });
const generated = await run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi',
  '-i', 'testsrc=duration=2:size=320x240:rate=15',
  '-c:v', 'mpeg4',
  fixture,
], projectDir);
expect(generated.code).toBe(0);

const valid = await run(process.execPath, [
  repo('scripts/validate-media.mjs'), fixture, '--json',
], projectDir);
expect(valid.code).toBe(0);
expect(JSON.parse(valid.stdout).warnings.map((item) => item.code))
  .toContain('video.height');

await writeFile(join(projectDir, 'fake.mp4'), '<html>not video</html>');
const invalid = await run(process.execPath, [
  repo('scripts/validate-media.mjs'), join(projectDir, 'fake.mp4'),
], projectDir);
expect(invalid.code).toBe(2);
expect(invalid.stderr).toMatch(/Not decodable/);
~~~

- [ ] **Step 3: Extract, scaffold, and assert the first build**

~~~javascript
const extracted = await run(process.execPath, [
  repo('scripts/extract-frames.mjs'),
  fixture,
  join(projectDir, 'frames'),
  '--count', '24',
  '--width', '320',
  '--format', 'webp',
], projectDir);
expect(extracted.code).toBe(0);
expect((await readdir(join(projectDir, 'frames')))).toHaveLength(24);

await writeFile(join(projectDir, 'brief.md'), '# Aster\n');
await mkdir(join(projectDir, 'prompts'), { recursive: true });
await writeFile(join(projectDir, 'prompts', 'video.txt'), 'One continuous shot.');
await writeFile(join(projectDir, 'values.json'), JSON.stringify({
  brand: {
    name: 'Aster',
    tagline: 'Light in motion',
    imageAlt: 'Aster test pattern in motion'
  },
  theme: {
    bg: '#000000',
    text: '#ffffff',
    accent: '#dfff57',
    surface: 'rgba(0,0,0,0.8)',
    radius: 8,
    fonts: { display: 'serif', body: 'sans-serif' }
  },
  scrub: { heightVh: 300, smoothing: 0.12 },
  overlays: [{ at: [0.2, 0.4], title: 'Test', hold: true }],
  outro: { headline: 'Done', body: 'Complete' },
  posterIndex: 12
}, null, 2));

const scaffolded = await run(process.execPath, [
  repo('scripts/scaffold-site.mjs'),
  projectDir,
  '--config', join(projectDir, 'values.json'),
], projectDir);
expect(scaffolded.code).toBe(0);
expect(await pathMissing(join(projectDir, 'frames'))).toBe(true);
expect(await readdir(join(projectDir, 'site', 'frames'))).toHaveLength(24);
const builtConfig = JSON.parse(
  await readFile(join(projectDir, 'site', 'config.json'), 'utf8'),
);
expect(builtConfig.frames).toMatchObject({
  count: 24,
  pattern: 'frames/frame-{index:4}.webp',
  poster: 'frames/frame-0012.webp',
});
~~~

- [ ] **Step 4: Verify approvals survive the physical frame move**

Before scaffold, approve brief, video, and extraction. After scaffold, assert the extraction manifest hash is unchanged because entries normalize to frames/<name> whether files live at project/frames or site/frames. Then approve theme and preview:

~~~javascript
for (const gate of ['brief', 'video', 'extraction']) {
  expect((await run(process.execPath, [
    repo('scripts/status.mjs'), projectDir, '--approve', gate,
  ], projectDir)).code).toBe(0);
}

// Run scaffold here.

const afterMove = await run(process.execPath, [
  repo('scripts/status.mjs'), projectDir, '--json',
], projectDir);
expect(JSON.parse(afterMove.stdout).unapproved).not.toContain('extraction');

for (const gate of ['theme', 'preview']) {
  expect((await run(process.execPath, [
    repo('scripts/status.mjs'), projectDir, '--approve', gate,
  ], projectDir)).code).toBe(0);
}
const done = JSON.parse((await run(process.execPath, [
  repo('scripts/status.mjs'), projectDir, '--json',
], projectDir)).stdout);
expect(done).toMatchObject({ resumeStep: 7, unapproved: [] });
~~~

- [ ] **Step 5: Verify staleness and wholesale format replacement**

~~~javascript
const future = new Date(Date.now() + 5_000);
await utimes(fixture, future, future);
const stale = JSON.parse((await run(process.execPath, [
  repo('scripts/status.mjs'), projectDir, '--json',
], projectDir)).stdout);
expect(stale.staleness).toContain('extraction');

expect((await run(process.execPath, [
  repo('scripts/extract-frames.mjs'),
  fixture,
  join(projectDir, 'frames'),
  '--count', '12',
  '--width', '320',
  '--format', 'jpg',
], projectDir)).code).toBe(0);
expect((await run(process.execPath, [
  repo('scripts/scaffold-site.mjs'),
  projectDir,
  '--config', join(projectDir, 'values.json'),
  '--force',
], projectDir)).code).toBe(0);

const finalNames = await readdir(join(projectDir, 'site', 'frames'));
expect(finalNames).toHaveLength(12);
expect(finalNames.every((name) => name.endsWith('.jpg'))).toBe(true);
~~~

- [ ] **Step 6: Run integration tests**

Run: npm run test:integration

Expected: PASS for the complete pipeline, or one clearly labeled skipped suite when ffmpeg/ffprobe are absent.

- [ ] **Step 7: Run all automated core/runtime verification**

Run: npm test

Expected: unit and integration suites pass with zero failures.

Run: npm run test:browser

Expected: browser smoke tests pass, or skip cleanly only when Chromium is absent.

- [ ] **Step 8: Commit**

~~~bash
git add tests/integration/pipeline.test.mjs
git commit -m "test: cover complete scroll-wizard pipeline"
~~~
