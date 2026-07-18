# Scroll Wizard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved adaptive storyboard-first pipeline with Pencil-reviewed beats, hard-capped generation spending, capability-filtered provider choices, a no-video stills site, responsive mobile playback, and backward-compatible v2 gates.

**Architecture:** Pure planning helpers recommend beats and rank only preflight-verified provider routes; `budget.mjs` persists a reservation-based hard-cap ledger. The static template supports frames and blob-loaded video with responsive mobile behavior; pipeline scripts derive either balanced small-GOP media or still frames; `status.mjs` hashes stable gate-specific projections and preserves v1 receipts; `SKILL.md` orchestrates the approved feedback loop.

**Tech Stack:** Node 20+ ESM, ffmpeg/ffprobe via `execFile`, vitest (unit), Playwright (browser smoke), vanilla JS template.

## Global Constraints

- Node 20+; no new npm dependencies.
- All scripts follow the existing pattern: exported pure helpers + `main(argv, io, runner, …)` + `isDirect` guard; errors printed via `io.error`, exit codes 1 (usage) / 2 (runtime).
- Template stays vanilla JS, no framework; `scrub-core.js` holds only pure functions.
- Repo root: `C:\Users\ryanl\.claude\skills\scroll-wizard`. All paths below are relative to it.
- Run unit tests with `npx vitest run <file>`; browser tests with `npx playwright test`.
- Commit after every task (message style: existing history, e.g. `feat: …`, `fix: …`, `docs: …`).
- Existing v1 projects (receipts under gate name `keyframes`) must keep resuming without re-approval of completed gates.
- Paid generation must reserve its maximum quoted amount in `budget.json` before starting and must never exceed the hard cap without an explicit cap increase.
- Provider/model names and prices are runtime inputs from verified session capability checks; never hard-code a provider as universally available.
- Mobile usability uses the same media assets; separate portrait generation is out of scope.

---

### Task 1: Pure helpers — `lingerEase`, `progressToTime`, v2 `validateConfig`

**Files:**
- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Produces: `lingerEase(x, linger) => number`; `progressToTime(progress, duration, margin = 0.05) => seconds`; `selectScrubMode(config) => 'video'|'frames'` (explicit mode wins, otherwise video when a `video` block exists); `validateConfig(config)` accepts `scrub.linger` and requires safe `media/` assets in video mode without requiring frames.

- [ ] **Step 1: Write failing tests** (append to `tests/unit/scrub-core.test.mjs`, importing `lingerEase`, `progressToTime`, and `selectScrubMode` from `../../template/scrub-core.js`):

```js
describe('lingerEase', () => {
  it('keeps endpoints fixed', () => {
    expect(lingerEase(0, 0.7)).toBeCloseTo(0);
    expect(lingerEase(1, 0.7)).toBeCloseTo(1);
  });
  it('is identity when linger is 0', () => {
    expect(lingerEase(0.3, 0)).toBeCloseTo(0.3);
  });
  it('flattens the middle when linger is high', () => {
    // slope near 0.5 shrinks: f(0.55)-f(0.45) < 0.1 for L=1
    expect(lingerEase(0.55, 1) - lingerEase(0.45, 1)).toBeLessThan(0.1);
  });
  it('clamps junk input', () => {
    expect(lingerEase(NaN, 0.5)).toBe(0);
    expect(lingerEase(2, NaN)).toBe(1);
  });
});

describe('progressToTime', () => {
  it('maps progress across duration minus margin', () => {
    expect(progressToTime(0, 8)).toBe(0);
    expect(progressToTime(1, 8)).toBeCloseTo(7.95);
    expect(progressToTime(0.5, 8, 0)).toBeCloseTo(4);
  });
  it('returns 0 for invalid duration', () => {
    expect(progressToTime(0.5, 0)).toBe(0);
    expect(progressToTime(0.5, NaN)).toBe(0);
  });
});

describe('validateConfig v2', () => {
  const base = () => JSON.parse(JSON.stringify({
    brand: { name: 'X' },
    theme: {
      bg: '#050607', text: '#f7f8f2', accent: '#dfff57',
      surface: 'rgba(5,6,7,0.78)', radius: 12,
    },
    scrub: { heightVh: 400, smoothing: 0.12 },
    frames: { count: 24, pattern: 'frames/frame-{index:4}.webp', poster: 'frames/frame-0001.webp' },
  }));

  it('accepts video mode without a frames block', () => {
    const config = base();
    delete config.frames;
    config.scrub.mode = 'video';
    config.video = { src: 'media/video.mp4', poster: 'media/poster.webp', duration: 8 };
    expect(validateConfig(config).errors).toEqual([]);
  });
  it('rejects unknown mode and out-of-range linger', () => {
    const config = base();
    config.scrub.mode = 'dvd';
    config.scrub.linger = 1;
    const codes = validateConfig(config).errors.map((e) => e.code);
    expect(codes).toContain('scrub.mode');
    expect(codes).toContain('scrub.linger');
  });
  it('rejects unsafe video paths and bad duration', () => {
    const config = base();
    delete config.frames;
    config.scrub.mode = 'video';
    config.video = { src: 'media/../evil.mp4', poster: 'frames/p.webp', duration: 0 };
    const codes = validateConfig(config).errors.map((e) => e.code);
    expect(codes).toContain('video.src');
    expect(codes).toContain('video.poster');
    expect(codes).toContain('video.duration');
  });
  it('still requires frames in frames mode', () => {
    const config = base();
    delete config.frames;
    expect(validateConfig(config).errors.length).toBeGreaterThan(0);
  });
  it('defaults to video when a video block exists', () => {
    const config = base();
    delete config.frames;
    config.video = { src: 'media/video.mp4', poster: 'media/poster.webp', duration: 8 };
    expect(selectScrubMode(config)).toBe('video');
    expect(validateConfig(config).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/scrub-core.test.mjs` — expect FAIL (`lingerEase is not defined` etc.).

- [ ] **Step 3: Implement in `template/scrub-core.js`.**

Add near the other math helpers:

```js
export function lingerEase(x, linger) {
  const p = clamp(Number.isFinite(x) ? x : 0, 0, 1);
  const strength = clamp(Number.isFinite(linger) ? linger : 0, 0, 1);
  const c = p - 0.5;
  return (1 - strength) * p + strength * (4 * c * c * c + 0.5);
}

export function progressToTime(progress, duration, margin = 0.05) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const end = Math.max(0, duration - margin);
  return clamp(Number.isFinite(progress) ? progress : 0, 0, 1) * end;
}

export function selectScrubMode(config) {
  return config?.scrub?.mode ?? (config?.video ? 'video' : 'frames');
}
```

Generalize the frame-path check (replace the body of `safeFramePath` with a prefix-parameterized version; behavior for `frames/` is unchanged):

```js
function safeAssetPath(value, prefix) {
  if (typeof value !== 'string' || hasUnsafePathSyntax(value, true)) return false;
  const variants = decodedVariants(value);
  const decoded = variants[variants.length - 1];
  if (!value.startsWith(prefix) || !decoded.startsWith(prefix)
      || decoded.includes('//')) return false;
  try {
    const resolved = new URL(decoded, trustedOrigin);
    const normalized = decodeURIComponent(resolved.pathname.slice(1));
    return resolved.origin === trustedOrigin
      && !resolved.search
      && !resolved.hash
      && normalized === decoded;
  } catch {
    return false;
  }
}

function safeFramePath(value) {
  return safeAssetPath(value, 'frames/');
}

function safeMediaPath(value) {
  return safeAssetPath(value, 'media/') && /\.(mp4|webm|webp|jpg|png)$/i.test(value);
}
```

In `validateConfig`, after the existing `scrub` checks add:

```js
  const mode = selectScrubMode(config);
  if (!['frames', 'video'].includes(mode)) {
    addError('scrub.mode', 'scrub.mode', 'Mode must be "frames" or "video".');
  }
  const linger = config.scrub?.linger;
  if (linger !== undefined && !(Number.isFinite(linger) && linger >= 0 && linger < 1)) {
    addError('scrub.linger', 'scrub.linger', 'Linger must be a number in [0, 1).');
  }
  if (mode === 'video') {
    const video = config.video ?? {};
    if (!safeMediaPath(video.src)) {
      addError('video.src', 'video.src', 'Video src must be a normalized path under media/.');
    }
    if (!safeMediaPath(video.poster)) {
      addError('video.poster', 'video.poster', 'Video poster must be a normalized path under media/.');
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      addError('video.duration', 'video.duration', 'Video duration must be a positive number of seconds.');
    }
  }
```

Move the frame checks below the mode declaration and wrap them exactly as follows so video mode does not require frames:

```js
  if (mode !== 'video') {
    const frames = config.frames ?? {};
    if (!Number.isInteger(frames.count) || frames.count < 1 || frames.count > 9999) {
      addError('frames.count', 'frames.count', 'Frame count must be an integer from 1 to 9999.');
    } else if (frames.count < 24 || frames.count > 400) {
      warnings.push(issue('frames.budget', 'frames.count', 'Recommended frame count is 24 to 400.'));
    }
    if (typeof frames.pattern !== 'string' || !/\{index:\d+\}/.test(frames.pattern)) {
      addError('frames.pattern', 'frames.pattern', 'Frame pattern requires an {index:N} token.');
    } else if (!safeFramePath(frames.pattern)) {
      addError('frames.pattern', 'frames.pattern',
        'Frame pattern must be a normalized path under frames/.');
    }
    if (typeof frames.poster !== 'string' || !safeFramePath(frames.poster)) {
      addError('frames.poster', 'frames.poster', 'Poster must be a path under frames/.');
    }
  }
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/scrub-core.test.mjs` — expect PASS, including all pre-existing tests.

- [ ] **Step 5: Commit** — `git add template/scrub-core.js tests/unit/scrub-core.test.mjs && git commit -m "feat: linger easing, video time mapping, v2 config validation"`

---

### Task 2: Frames-mode loader fix + linger in frames engine

**Files:**
- Modify: `template/scrub-engine.js`
- Test: `tests/browser/smoke.spec.mjs` (assertion tweak)

**Interfaces:**
- Consumes: `lingerEase` from Task 1.
- Produces: loader hides on first drawn frame, not after full preload; frames tick applies `lingerEase(applyHolds(raw, holds), config.scrub.linger ?? 0)`.

- [ ] **Step 1: Read `tests/browser/smoke.spec.mjs` and `tests/browser/fixture-server.mjs`.** Run `npx playwright test` first to confirm the suite is green. Then make the frames fixture delay every frame after the initial decode window and add a test that waits for `#loader` to hide, captures debug state immediately, and asserts both `lastFrame >= 0` and `decodedCount < frameCount`. This test must fail against the old `preloadAll().then(() => loader.hidden = true)` behavior.

- [ ] **Step 2: Run to verify failure** — `npx playwright test tests/browser/smoke.spec.mjs --grep "loader"` — expect the loader assertion to time out while delayed background frames are outstanding.

- [ ] **Step 3: Implement in `template/scrub-engine.js`:**
  - Import `lingerEase` in the existing import block from `./scrub-core.js`.
  - In `runEngine`, replace `store.preloadAll().then(() => { loader.hidden = true; });` with `store.preloadAll();` (progress bar keeps updating via `onProgress`).
  - In `tick`, where `posterHidden` flips to true, also `loader.hidden = true;`.
  - Change `const targetProgress = applyHolds(raw, holds);` to `const targetProgress = lingerEase(applyHolds(raw, holds), config.scrub.linger ?? 0);`.

- [ ] **Step 4: Run** `npx playwright test` — expect PASS.

- [ ] **Step 5: Commit** — `git add template/scrub-engine.js tests/browser/ && git commit -m "fix: hide loader on first painted frame; apply linger easing"`

---

### Task 3: Video seek-scrub mode in the template

**Files:**
- Modify: `template/index.html`, `template/style.css`, `template/scrub-engine.js`
- Test: `tests/browser/smoke.spec.mjs` (new video-mode scenario), `tests/browser/fixture-server.mjs` (video fixture)

**Interfaces:**
- Consumes: `progressToTime`, `lingerEase`, v2 `validateConfig` (Task 1).
- Produces: with `config.scrub.mode === 'video'` and `config.video = {src, poster, duration}`, the site blob-loads the video, scrubs `currentTime` with seek coalescing, keeps the poster until first `seeked`, primes playback on first gesture. Frames mode untouched.

- [ ] **Step 1: Write the failing browser scenarios first.** Use the VP9 fixture and exact video/mobile assertions specified later in this task. Do not change `template/` yet.

- [ ] **Step 2: Run to verify failure** — `npx playwright test tests/browser/smoke.spec.mjs --grep "video mode|phone viewport"` — expect failure because `#scrub-video`, video-time debug state, and responsive behavior do not exist.

- [ ] **Step 3: Add the video element to `template/index.html`** directly after the poster `<img>`:

```html
        <video id="scrub-video" class="scrub__video" muted playsinline aria-hidden="true"></video>
```

- [ ] **Step 4: Add to `template/style.css`** (mirror the `.scrub__canvas` positioning block — read it first and copy its position/inset/size rules):

```css
.scrub__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
}

.scrub__video.is-ready {
  opacity: 1;
}
```

- [ ] **Step 5: Implement video mode in `template/scrub-engine.js`.**

Add `progressToTime` to the scrub-core import. Extract the overlay/progress-bar updates from `runEngine`'s `tick` into shared helpers (and call them from `runEngine`):

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

function updateProgressBar() {
  const pageProgress = Math.min(1, Math.max(0,
    scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)));
  progressBar.style.width = (pageProgress * 100) + '%';
}
```

Add the video path:

```js
const scrubVideo = document.getElementById('scrub-video');

async function loadScrubVideo(config) {
  const response = await fetch(config.video.src);
  if (!response.ok) throw new Error('Video request failed: HTTP ' + response.status);
  const blob = await response.blob();
  scrubVideo.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    if (scrubVideo.readyState >= 1) { resolve(); return; }
    scrubVideo.addEventListener('loadedmetadata', resolve, { once: true });
    scrubVideo.addEventListener('error', () => {
      reject(new Error('Scrub video failed to load.'));
    }, { once: true });
  });
  return scrubVideo;
}

function runVideoEngine(config, overlayNodes, video) {
  const holds = (config.overlays ?? [])
    .filter((overlay) => overlay.hold)
    .map((overlay) => overlay.at);
  const k = alphaToK(config.scrub.smoothing);
  const linger = config.scrub.linger ?? 0;
  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : config.video.duration;
  const epsilon = matchMedia('(pointer: coarse)').matches ? 0.02 : 0.008;

  // iOS: a muted play()->pause() on the first gesture makes later seeks paint.
  const prime = () => { video.play().then(() => video.pause()).catch(() => {}); };
  addEventListener('pointerdown', prime, { once: true });
  addEventListener('touchstart', prime, { once: true, passive: true });

  let posterHidden = false;
  video.addEventListener('seeked', () => {
    if (posterHidden) return;
    posterHidden = true;
    video.classList.add('is-ready');
    poster.classList.add('is-hidden');
  });

  loader.hidden = true;

  let smoothProgress = 0;
  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    const raw = scrollProgress(
      window.scrollY, scrub.offsetTop, scrub.offsetHeight, innerHeight,
    );
    const target = lingerEase(applyHolds(raw, holds), linger);
    smoothProgress = smooth(smoothProgress, target, k, dt);
    const time = progressToTime(smoothProgress, duration);
    // Seek coalescing: never queue a seek behind one still in flight.
    if (!video.seeking && Math.abs(video.currentTime - time) > epsilon) {
      video.currentTime = time;
    }
    updateOverlays(overlayNodes, raw);
    updateProgressBar();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
```

In `loadPoster`, choose the source with Task 1's helper: `poster.src = selectScrubMode(config) === 'video' ? config.video.poster : config.frames.poster;`

In `start()`, replace the final `runEngine(config, overlayNodes);` with:

```js
  if (selectScrubMode(config) === 'video') {
    let video;
    try {
      video = await loadScrubVideo(config);
    } catch (error) {
      showFatalError(error);
      return;
    }
    runVideoEngine(config, overlayNodes, video);
  } else {
    runEngine(config, overlayNodes);
  }
```

Extend the localhost debug object with `get videoTime() { return document.getElementById('scrub-video')?.currentTime ?? 0; }`.

**Browser fixture/test details for Steps 1–2.** Read `tests/browser/fixture-server.mjs` to see how the frames fixture site is assembled. Add a video-mode fixture: generate a tiny all-intra **VP9 webm** at setup (Playwright's Chromium has no H.264, so the test fixture uses webm; production uses mp4):

```
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc=duration=2:size=320x180:rate=12 -c:v libvpx-vp9 -g 1 -crf 40 -b:v 0 media/video.webm
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc=duration=1:size=320x180:rate=1 -frames:v 1 media/poster.webp
```

Fixture `config.json`: same shape as the frames fixture but `"scrub": { "heightVh": 400, "smoothing": 0.12, "mode": "video" }`, no `frames` block, and `"video": { "src": "media/video.webm", "poster": "media/poster.webp", "duration": 2 }`.

New spec in `smoke.spec.mjs`:

```js
test('video mode scrubs the video with scroll', async ({ page }) => {
  await page.goto(videoFixtureUrl);
  await page.waitForSelector('#loader', { state: 'hidden' });
  await page.mouse.wheel(0, 4000);
  await page.waitForFunction(() =>
    window.__SCROLL_WIZARD_DEBUG__ && window.__SCROLL_WIZARD_DEBUG__.videoTime > 0.2);
  await expect(page.locator('#poster')).toHaveClass(/is-hidden/);
});
```

Add a phone-viewport scenario (`390x844`, `hasTouch: true`) using the same media assets. Assert that the page has no horizontal overflow, the visible CTA has a hit area of at least 44x44 CSS pixels, overlay text remains inside the viewport, and scrolling advances video time. Add a resize assertion showing a height-only viewport change does not reset progress. Update responsive CSS with `env(safe-area-inset-*)`, mobile overlay width/position rules, and reduced decorative effects as needed to make the test pass; do not add portrait-specific media paths.

- [ ] **Step 6: Run** `npx playwright test` — expect PASS for frames, video, reduced-motion, and phone-viewport scenarios.

- [ ] **Step 7: Commit** — `git add template/ tests/browser/ && git commit -m "feat: add responsive video seek-scrub playback"`

---

### Task 4: `reencode-video.mjs` — balanced small-GOP encode + all-intra option

**Files:**
- Create: `scripts/reencode-video.mjs`
- Test: `tests/unit/reencode-video.test.mjs`

**Interfaces:**
- Consumes: `runFfprobe`, `videoVerdict`; payload constants from `extract-frames.mjs`; CLI helpers; and `pathExists`, `replaceDirectory`, `writeJsonAtomic` from `scripts/lib/files.mjs`.
- Produces: CLI `reencode-video <input> <outDir> [--crf 10..40=23] [--width 16..8192=1600] [--gop 1..120=8|--all-intra] [--poster-at seconds=0] [--force]`; writes H.264 faststart media, poster, and `media.json` with `{ duration, width, height, crf, gop }`; prints payload size and mid-4G estimate. Exports `parseReencodeArgs`, ffmpeg argument builders, and `main`.

- [ ] **Step 1: Write failing tests** in `tests/unit/reencode-video.test.mjs` (mirror the style of `tests/unit/extract-frames.test.mjs` — fake `runner`, fake `io` collecting lines; read that file first and reuse its helpers/pattern):

```js
import { describe, expect, it } from 'vitest';
import {
  buildPosterArgs,
  buildReencodeArgs,
  parseReencodeArgs,
} from '../../scripts/reencode-video.mjs';

describe('parseReencodeArgs', () => {
  it('applies defaults', () => {
    expect(parseReencodeArgs(['in.mp4', 'out'])).toEqual({
      input: 'in.mp4', outDir: 'out', crf: 23, width: 1600,
      gop: 8, posterAt: 0, force: false,
    });
  });
  it('rejects out-of-range crf', () => {
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--crf', '99'])).toThrow(/crf/);
  });
  it('rejects missing positionals', () => {
    expect(() => parseReencodeArgs(['in.mp4'])).toThrow(/input video and output directory/);
  });
});

describe('buildReencodeArgs', () => {
  it('encodes small-GOP h264 with faststart', () => {
    const args = buildReencodeArgs({
      input: 'in.mp4', width: 1280, crf: 20, gop: 8, output: 'out/video.mp4',
    });
    expect(args).toContain('-g');
    expect(args[args.indexOf('-g') + 1]).toBe('8');
    expect(args[args.indexOf('-keyint_min') + 1]).toBe('8');
    expect(args).toContain('+faststart');
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(args[args.indexOf('-vf') + 1]).toContain('scale=1280:-2');
    expect(args.at(-1)).toBe('out/video.mp4');
  });
  it('uses GOP 1 only for the explicit all-intra preset', () => {
    expect(parseReencodeArgs(['in.mp4', 'out', '--all-intra']).gop).toBe(1);
  });
});

describe('buildPosterArgs', () => {
  it('grabs one webp frame at the requested time', () => {
    const args = buildPosterArgs({ input: 'in.mp4', width: 1280, posterAt: 2.5, output: 'out/poster.webp' });
    expect(args[args.indexOf('-ss') + 1]).toBe('2.5');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args.at(-1)).toBe('out/poster.webp');
  });
});
```

Also test `main` with fake `io`/`runner`: missing input returns 1; ffprobe/ffmpeg failure returns 2; success emits the JSON report; and a failed forced run preserves a pre-existing output directory byte-for-byte.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/reencode-video.test.mjs` — expect FAIL (module not found).

- [ ] **Step 3: Implement `scripts/reencode-video.mjs`:**

```js
#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { hasFlag, isDirect } from './lib/cli.mjs';
import { pathExists, writeJsonAtomic } from './lib/files.mjs';
import {
  MID_4G_BYTES_PER_SECOND,
  REQUEST_OVERHEAD_SECONDS,
} from './extract-frames.mjs';
import { runFfprobe, videoVerdict } from './validate-media.mjs';

const execFileAsync = promisify(execFile);

function bounded(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(name + ' must be a number from ' + minimum + ' to ' + maximum + '.');
  }
  return parsed;
}

export function parseReencodeArgs(argv) {
  const positional = [];
  const values = new Map();
  const valueFlags = new Set(['--crf', '--width', '--gop', '--poster-at']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force' || argument === '--all-intra') continue;
    if (argument.startsWith('--')) {
      if (!valueFlags.has(argument)) throw new Error('Unknown option: ' + argument);
      if (index === argv.length - 1) throw new Error('Missing value for ' + argument);
      if (values.has(argument)) throw new Error('Duplicate option: ' + argument);
      values.set(argument, argv[index + 1]);
      index += 1;
      continue;
    }
    positional.push(argument);
  }
  if (positional.length !== 2) {
    throw new Error('Expected an input video and output directory.');
  }
  return {
    input: positional[0],
    outDir: positional[1],
    crf: Math.round(bounded(values.get('--crf') ?? '23', 'crf', 10, 40)),
    width: Math.round(bounded(values.get('--width') ?? '1600', 'width', 16, 8192)),
    gop: hasFlag(argv, '--all-intra')
      ? 1
      : Math.round(bounded(values.get('--gop') ?? '8', 'gop', 1, 120)),
    posterAt: bounded(values.get('--poster-at') ?? '0', 'poster-at', 0, 3600),
    force: hasFlag(argv, '--force'),
  };
}

export function buildReencodeArgs(options) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', options.input,
    '-an',
    '-vf', 'scale=' + options.width + ':-2:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(options.crf),
    '-g', String(options.gop), '-keyint_min', String(options.gop), '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    options.output,
  ];
}

export function buildPosterArgs(options) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(options.posterAt),
    '-i', options.input,
    '-frames:v', '1',
    '-vf', 'scale=' + options.width + ':-2:flags=lanczos',
    '-c:v', 'libwebp', '-quality', '82',
    options.output,
  ];
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown re-encode error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown re-encode error.';
}

export async function main(argv = process.argv.slice(2), io = console, runner = execFileAsync) {
  let options;
  try {
    options = parseReencodeArgs(argv);
  } catch (error) {
    if (argv.length > 0) io.error(firstLine(error));
    io.error('Usage: reencode-video <input> <output-dir> [--crf N] [--width N] [--gop N|--all-intra] [--poster-at S] [--force]');
    return 1;
  }

  const outDir = resolve(options.outDir);
  const videoOut = join(outDir, 'video.mp4');
  try {
    if (!await pathExists(options.input)) {
      io.error('Input not found: ' + options.input);
      return 1;
    }
    if (await pathExists(videoOut) && !options.force) {
      io.error('Output already exists; use --force to replace it: ' + videoOut);
      return 1;
    }
  } catch (error) {
    io.error('Could not inspect input or output: ' + firstLine(error));
    return 1;
  }

  try {
    const verdict = videoVerdict(await runFfprobe(options.input, runner));
    if (!verdict.valid) {
      io.error('Invalid video: ' + verdict.errors[0]);
      return 2;
    }
    await mkdir(outDir, { recursive: true });
    const posterOut = join(outDir, 'poster.webp');
    await runner('ffmpeg', buildReencodeArgs({ ...options, output: videoOut }));
    await runner('ffmpeg', buildPosterArgs({ ...options, output: posterOut }));

    const outVerdict = videoVerdict(await runFfprobe(videoOut, runner));
    if (!outVerdict.valid) {
      io.error('Re-encoded video failed validation: ' + outVerdict.errors[0]);
      return 2;
    }
    const { duration, width, height } = outVerdict.metadata;
    await writeJsonAtomic(join(outDir, 'media.json'), {
      duration, width, height, crf: options.crf, gop: options.gop,
    });

    const [videoStat, posterStat] = await Promise.all([stat(videoOut), stat(posterOut)]);
    io.log(JSON.stringify({
      videoBytes: videoStat.size,
      posterBytes: posterStat.size,
      duration,
      width,
      height,
      estimatedSeconds: Number(((videoStat.size + posterStat.size)
        / MID_4G_BYTES_PER_SECOND + REQUEST_OVERHEAD_SECONDS).toFixed(2)),
    }, null, 2));
    return 0;
  } catch (error) {
    io.error('Re-encode failed: ' + firstLine(error));
    return 2;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
```

Note: check `videoVerdict`'s metadata shape in `scripts/validate-media.mjs` before wiring `{ duration, width, height }` — use its actual field names.

Do not write directly into the live output directory. Create a sibling `.media.tmp-<uuid>` directory, write and validate all three files there, then call `replaceDirectory(prepared, outDir, options.force)`. Always remove the prepared path in `finally`. This is the same transaction pattern used by `extract-frames.mjs`; read its complete replacement/rollback block before implementing.

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/reencode-video.test.mjs` — expect PASS.

- [ ] **Step 5: End-to-end sanity** (real ffmpeg): `node scripts/reencode-video.mjs "C:\Users\ryanl\desktop\scrolltest\scrollcar\input\video.mp4" "C:\Users\ryanl\AppData\Local\Temp\claude\reencode-check" --width 640` — expect a JSON summary and three files in the output dir. Delete the temp dir afterwards.

- [ ] **Step 6: Commit** — `git add scripts/reencode-video.mjs tests/unit/reencode-video.test.mjs && git commit -m "feat: add balanced scrub-video encoding presets"`

---

### Task 5: `scaffold-site.mjs` video mode

**Files:**
- Modify: `scripts/scaffold-site.mjs`
- Test: `tests/unit/scaffold-site.test.mjs`

**Interfaces:**
- Consumes: v2 `validateConfig` (Task 1); `media/` layout from Task 4 (`video.mp4`, `poster.webp`, `media.json`).
- Produces: explicit `values.scrub.mode` wins; otherwise a valid project/inherited `media/media.json` selects video and frames select frames. `assembleConfig(defaults, values, frameSet, mediaSet)` emits the matching config and preserves transactional rollback for either asset directory.

- [ ] **Step 1: Write failing tests** (append to `tests/unit/scaffold-site.test.mjs`; read the file first and reuse its temp-project helpers):

```js
describe('assembleConfig video mode', () => {
  const defaults = () => JSON.parse(JSON.stringify({
    brand: { name: 'Aster', tagline: 'T', imageAlt: 'A' },
    theme: {
      bg: '#050607', text: '#f7f8f2', accent: '#dfff57',
      surface: 'rgba(5,6,7,0.78)', radius: 12,
      fonts: { display: 'Georgia, serif', body: 'Inter, sans-serif' },
    },
    frames: { count: 24, pattern: 'frames/frame-{index:4}.webp', poster: 'frames/frame-0001.webp' },
    scrub: { heightVh: 400, smoothing: 0.12 },
  }));

  it('emits a video block and drops frames', () => {
    const { config } = assembleConfig(
      defaults(),
      { scrub: { mode: 'video' } },
      null,
      { duration: 7.8 },
    );
    expect(config.video).toEqual({
      src: 'media/video.mp4', poster: 'media/poster.webp', duration: 7.8,
    });
    expect(config.frames).toBeUndefined();
    expect(config.scrub.mode).toBe('video');
  });

  it('still builds frames config when mediaSet is absent', () => {
    const { config } = assembleConfig(
      defaults(), {}, { count: 24, extension: 'webp', pattern: 'frames/frame-{index:4}.webp' }, null,
    );
    expect(config.frames.count).toBe(24);
    expect(config.video).toBeUndefined();
  });
});
```

Also add a `scaffoldProject` integration case: build a temp project with `values.json` containing `"scrub": { "mode": "video" }`, a `media/` dir holding a dummy `video.mp4`, `poster.webp` (any nonzero bytes), and `media.json` `{"duration": 7.8, "width": 1600, "height": 900}`, no `frames/` dir; assert the scaffold succeeds, `site/media/video.mp4` exists, and `site/config.json` has `scrub.mode === 'video'` and no `frames` key.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/scaffold-site.test.mjs` — expect FAIL.

- [ ] **Step 3: Implement in `scripts/scaffold-site.mjs`:**

`assembleConfig` gains a fourth parameter and branches:

```js
export function assembleConfig(defaults, values, frameSet, mediaSet = null) {
  const posterIndex = values.posterIndex ?? 1;
  if (!mediaSet && (!Number.isInteger(posterIndex)
      || posterIndex < 1 || posterIndex > frameSet.count)) {
    throw new Error('posterIndex must be within 1..' + frameSet.count);
  }
  const { posterIndex: _ignored, ...creative } = values;
  const brand = { ...defaults.brand, ...creative.brand };
  brand.imageAlt = brand.imageAlt || brand.tagline || (brand.name + ' hero scene');
  const config = {
    ...defaults,
    ...creative,
    brand,
    theme: {
      ...defaults.theme,
      ...creative.theme,
      fonts: { ...defaults.theme.fonts, ...creative.theme?.fonts },
    },
    scrub: { ...defaults.scrub, ...creative.scrub },
  };
  if (mediaSet) {
    delete config.frames;
    config.video = {
      src: 'media/video.mp4',
      poster: 'media/poster.webp',
      duration: mediaSet.duration,
    };
  } else {
    config.frames = {
      count: frameSet.count,
      pattern: frameSet.pattern,
      poster: 'frames/frame-' + String(posterIndex).padStart(4, '0')
        + '.' + frameSet.extension,
    };
  }
  const report = validateConfig(config);
  if (report.errors.length) {
    throw new Error(report.errors.map((item) => item.path + ': ' + item.message).join('\n'));
  }
  return { config, warnings: report.warnings };
}
```

In `scaffoldProject`, read `values.json` **before** the frames handling (move the `readJsonFile` calls up, before the frames branch), then:

```js
    const projectMediaPath = join(projectDir, 'media');
    const inheritedMediaPath = join(sitePath, 'media');
    const mediaAvailable = await pathExists(projectMediaPath)
      || await pathExists(inheritedMediaPath);
    const videoMode = values.scrub?.mode === 'video'
      || (values.scrub?.mode == null && mediaAvailable);
    let frameSet = null;
    let mediaSet = null;
    let framesSource;
    if (videoMode) {
      if (await pathExists(projectMediaPath)) {
        await rename(projectMediaPath, join(siteTmpPath, 'media'));
        framesSource = 'fresh';
      } else {
        const liveMediaPath = join(sitePath, 'media');
        if (!await pathExists(liveMediaPath)) {
          throw new Error(
            'No media available: run reencode-video into project/media, '
            + 'or scaffold over an existing site that already has media.',
          );
        }
        await cp(liveMediaPath, join(siteTmpPath, 'media'), { recursive: true });
        framesSource = 'inherited';
      }
      const mediaInfo = await readJsonFile(
        join(siteTmpPath, 'media', 'media.json'), 'media/media.json',
      );
      if (!Number.isFinite(mediaInfo.duration) || mediaInfo.duration <= 0) {
        throw new Error('media/media.json must contain a positive duration.');
      }
      mediaSet = mediaInfo;
    } else {
      const projectFramesPath = join(projectDir, 'frames');
      if (await pathExists(projectFramesPath)) {
        await rename(projectFramesPath, join(siteTmpPath, 'frames'));
        freshFramesMoved = true;
        framesSource = 'fresh';
      } else {
        const liveFramesPath = join(sitePath, 'frames');
        if (!await pathExists(liveFramesPath)) {
          throw new Error(
            'No frames available: run extraction into project/frames, '
            + 'or scaffold over an existing site that already has frames.',
          );
        }
        await cp(liveFramesPath, join(siteTmpPath, 'frames'), { recursive: true });
        framesSource = 'inherited';
      }
      frameSet = await inspectFrameSet(join(siteTmpPath, 'frames'));
    }
```

Mirror the frames rollback in the `catch`: if the fresh `media` dir was moved and the site was not replaced, move it back (same pattern as `freshFramesMoved`; add a `freshMediaMoved` flag). Update `recoverInterruptedRun`'s tmp-dir recovery to also restore an orphaned `media` dir (same code path as `frames` — add a second recovery block or loop over `['frames', 'media']`). Update `buildReadme` to print `- Video: media/video.mp4 (…)` instead of the frames line when `mediaSet` is set, and the `main` summary output likewise (`Video: media/video.mp4` / skip the poster-frames line).

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/scaffold-site.test.mjs` — expect PASS (old cases too).

- [ ] **Step 5: Commit** — `git add scripts/scaffold-site.mjs tests/unit/scaffold-site.test.mjs && git commit -m "feat: scaffold video-mode sites from project media"`

---

### Task 6: `status.mjs` v2 gates

**Files:**
- Modify: `scripts/status.mjs`
- Test: `tests/unit/status.test.mjs`

**Interfaces:**
- Consumes: `values.scrub.mode` convention (Task 5).
- Produces: the seven v2 gates; storyboard receipts include approved overlay fields; stills-preview hashes stable frames + storyboard projection rather than the mutable site; extraction hashes frames or encoded media and is never skipped; `video` skips only when `values.generation.video === false`; stills-preview skips only for legacy projects that have video but no beat prompts; legacy `keyframes` receipts count as storyboard; all-done resume step is 8.

- [ ] **Step 1: Write failing tests** (append to `tests/unit/status.test.mjs`; read it first — it builds temp projects and fake `inspect` functions; reuse those helpers):

Cases to add:
1. `GATES` equals the v2 list in order.
2. A project with a legacy `approvals.json` using key `keyframes` plus `input/video.mp4` and no beat prompts honors the receipt and skips only `stills-preview`.
3. A video-mode project with `media/video.mp4`, `media/poster.webp`, and `media/media.json` produces an extraction manifest and requires extraction approval.
4. `prompts/keyframe-beat-1.txt` + `input/keyframes/beat-1.png` produce a complete storyboard manifest; a missing `beat-2.png` for an existing `keyframe-beat-2.txt` appears as `storyboard:beat-2` in `incomplete`.
5. All-approved v2 project resolves `resumeStep === 8`.
6. Changing storyboard overlay copy/position/timing invalidates storyboard; changing only theme does not.
7. Rebuilding/theme-changing `site/` does not invalidate stills-preview when beat frames and storyboard projection are unchanged.
8. `values.generation.video === false` skips video but still requires extraction from beat frames.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/status.test.mjs` — expect FAIL.

- [ ] **Step 3: Implement in `scripts/status.mjs`:**

```js
export const GATES = [
  'brief',
  'storyboard',
  'stills-preview',
  'video',
  'extraction',
  'theme',
  'preview',
];
```

Roles: `const KEYFRAME_PROMPT = /^keyframe-(first|last|ref-[1-3]|beat-\d{1,2})\.txt$/;` and replace the `KEYFRAME_ROLES.indexOf` sort with:

```js
function roleRank(role) {
  const fixed = KEYFRAME_ROLES.indexOf(role);
  if (fixed !== -1) return fixed;
  return 100 + Number(role.slice('beat-'.length));
}
```

(sort by `roleRank(left.role) - roleRank(right.role)`).

Extend `valuesProjection` before changing manifests:

```js
  if (gate === 'storyboard') {
    return (values.overlays ?? []).map((overlay) => ({
      title: overlay.title ?? null,
      body: overlay.body ?? null,
      stats: overlay.stats ?? [],
      cta: overlay.cta ?? null,
      position: overlay.position ?? null,
      at: overlay.at ?? null,
      hold: Boolean(overlay.hold),
    }));
  }
```

`buildGateManifest`: rename the `keyframes` branch to `storyboard`, keep prompt/image hashing, and append `values.json#storyboard` using the canonical projection. Implement stable preview and dual extraction manifests:

```js
  if (gate === 'stills-preview') {
    const frames = await regularFilesRecursive(join(projectDir, 'frames'), inspect);
    const values = await readJsonObject(valuesPath, 'values.json');
    if (!frames.length || !values) return null;
    return sortManifestEntries([
      ...await hashFiles(frames, 'frames'),
      {
        path: 'values.json#storyboard',
        sha256: sha256Text(canonicalJson(valuesProjection(values, 'storyboard'))),
      },
    ]);
  }
```

For `extraction`, prefer project `media/`, then site `media/`, and hash every regular media file when present. Otherwise retain the frames manifest plus extraction projection. Leave the final `preview` fallback as the complete `site/` tree.

`buildInventory` additions:
- `const videoFileExists = await regularFileExists(join(projectDir, 'input', 'video.mp4'), inspect);`
- Read values once and return `videoEnabled: values?.generation?.video !== false` plus `scrubMode: values?.scrub?.mode ?? (media exists ? 'video' : 'frames')`.
- Legacy receipt mapping right after reading `approvals.json`:

```js
  if (receipts.keyframes && !receipts.storyboard) {
    receipts = { ...receipts, storyboard: receipts.keyframes };
  }
```

- Media mtimes: add `projectMedia: join(projectDir, 'media')` and `siteMedia: join(projectDir, 'site', 'media')` to `paths` and the mtime list (site one guarded by `siteRootAvailable` like `siteFrames`). Staleness additions:

```js
  const activeMediaMtime = mtimes.projectMedia ?? mtimes.siteMedia;
  if (
    mtimes.video !== null
    && activeMediaMtime !== null
    && mtimes.video > activeMediaMtime
  ) {
    stale.push('extraction');
  }
  const projectMediaOutrunSite = mtimes.projectMedia !== null
    && (mtimes.siteMedia === null || mtimes.projectMedia > mtimes.siteMedia);
```

(add `projectMediaOutrunSite` to the existing `stale.push('site')` condition).
- Return the new facts: `videoFileExists`, `scrubMode`; change the incomplete prefix to `'storyboard:' + role`.

Skip predicates (replace `keyframesSkipped`; extraction is deliberately absent):

```js
function gateSkipped(gate, inventory) {
  if (gate === 'storyboard') {
    return inventory.keyframePromptCount === 0 && inventory.videoPromptExists;
  }
  if (gate === 'stills-preview') {
    return inventory.keyframePromptCount === 0 && inventory.videoFileExists;
  }
  if (gate === 'video') return !inventory.videoEnabled;
  return false;
}
```

Use `gateSkipped` in `resolveResume` (replacing the `skippedKeyframes` block), in `approveGate`'s upstream loop (replacing the keyframes special case), and in `stateForGate` (return `'skipped'`).

`stepFor` v2:

```js
function stepFor(item) {
  if (item === 'brief') return 1;
  if (item.startsWith('keyframe') || item.startsWith('storyboard')) return 2;
  if (item === 'stills-preview') return 3;
  if (item === 'video') return 4;
  if (item === 'extraction') return 5;
  if (item === 'site' || item === 'theme') return 6;
  if (item === 'preview') return 7;
  return 1;
}
```

All-done resume becomes `8`: `return finish(actionableSteps.length ? Math.min(...actionableSteps) : 8, inventory, unapproved);`.

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/status.test.mjs` — expect PASS. Then run the whole unit suite `npx vitest run` — other suites (e.g. `tests/integration/pipeline.test.mjs`, `tests/skill/*`) may reference gate names or step numbers; update any that assert `keyframes`/6-gate numbering to the v2 names, keeping the legacy-receipt test intact.

- [ ] **Step 5: Real-project sanity** — `node scripts/status.mjs "C:\Users\ryanl\desktop\scrolltest\scrollcar" --json` — expect the v1 project to resolve without demanding re-approval of brief/storyboard/video/extraction (its receipts were written under v1 names; `stills-preview` must show as skipped because `input/video.mp4` exists).

- [ ] **Step 6: Commit** — `git add scripts/status.mjs tests/ && git commit -m "feat: add stable v2 gate receipts with v1 compatibility"`

---

### Task 7: `stills-to-frames.mjs` — beats → frames for the free stills site

**Files:**
- Create: `scripts/stills-to-frames.mjs`
- Test: `tests/unit/stills-to-frames.test.mjs`

**Interfaces:**
- Consumes: `replaceDirectory`, `pathExists`, `listFilesRecursive` from `scripts/lib/files.mjs`; `summarizeFrames` from `scripts/extract-frames.mjs`; `runFfprobe` from `scripts/validate-media.mjs`.
- Produces: CLI `stills-to-frames <projectDir> [--width 1600] [--quality 80] [--force]` — reads `input/keyframes/beat-<n>.(png|jpg|jpeg|webp)` (n contiguous from 1, at least 2), converts each to `frames/frame-000N.webp` in beat order via ffmpeg, atomically replaces `<projectDir>/frames`, prints the same JSON summary shape as `extract-frames`. Exports `planBeats(fileNames)`, `main(argv, io, runner)`.

- [ ] **Step 1: Write failing tests:**

```js
import { describe, expect, it } from 'vitest';
import { planBeats } from '../../scripts/stills-to-frames.mjs';

describe('planBeats', () => {
  it('orders beats numerically', () => {
    expect(planBeats(['beat-2.png', 'beat-10.webp', 'beat-1.jpg']))
      .toEqual(['beat-1.jpg', 'beat-2.png', 'beat-10.webp']);
  });
  it('rejects gaps, duplicates, and fewer than 2 beats', () => {
    expect(() => planBeats(['beat-1.png', 'beat-3.png'])).toThrow(/contiguous/);
    expect(() => planBeats(['beat-1.png', 'beat-1.webp'])).toThrow(/duplicate/i);
    expect(() => planBeats(['beat-1.png'])).toThrow(/at least 2/);
  });
  it('ignores non-beat files', () => {
    expect(planBeats(['beat-1.png', 'beat-2.png', 'notes.txt', 'first.png']))
      .toEqual(['beat-1.png', 'beat-2.png']);
  });
});
```

Add `main` tests using fake `io`/`runner`: missing directory returns 1; a conversion failure returns 2 and preserves an existing `frames/` directory; success invokes ffmpeg once per ordered beat, emits the standard JSON summary, and atomically replaces frames only after validation.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/stills-to-frames.test.mjs`.

- [ ] **Step 3: Implement `scripts/stills-to-frames.mjs`:**

```js
#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { hasFlag, isDirect } from './lib/cli.mjs';
import { pathExists, replaceDirectory } from './lib/files.mjs';
import { summarizeFrames } from './extract-frames.mjs';
import { runFfprobe } from './validate-media.mjs';

const execFileAsync = promisify(execFile);
const BEAT_NAME = /^beat-(\d{1,2})\.(png|jpe?g|webp)$/i;

export function planBeats(fileNames) {
  const beats = fileNames
    .map((name) => ({ name, match: BEAT_NAME.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({ name, index: Number(match[1]) }))
    .sort((left, right) => left.index - right.index);
  if (beats.length < 2) throw new Error('Need at least 2 beat stills (beat-1, beat-2, …).');
  beats.forEach((beat, position) => {
    if (beats.some((other, otherPosition) => (
      otherPosition !== position && other.index === beat.index
    ))) {
      throw new Error('Duplicate beat index: beat-' + beat.index);
    }
    if (beat.index !== position + 1) {
      throw new Error('Beat indices must be contiguous starting at beat-1 (gap found).');
    }
  });
  return beats.map((beat) => beat.name);
}

function bounded(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || parsed < minimum || parsed > maximum) {
    throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return parsed;
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown conversion error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown conversion error.';
}

export async function main(argv = process.argv.slice(2), io = console, runner = execFileAsync) {
  const projectDir = argv[0];
  if (!projectDir || projectDir.startsWith('--')) {
    io.error('Usage: stills-to-frames <projectDir> [--width N] [--quality N] [--force]');
    return 1;
  }
  let width;
  let quality;
  try {
    const values = new Map();
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '--force') continue;
      if (!['--width', '--quality'].includes(argument)) {
        throw new Error('Unknown option: ' + argument);
      }
      if (index === argv.length - 1) throw new Error('Missing value for ' + argument);
      values.set(argument, argv[index + 1]);
      index += 1;
    }
    width = bounded(values.get('--width') ?? '1600', 'width', 16, 8192);
    quality = bounded(values.get('--quality') ?? '80', 'quality', 1, 100);
  } catch (error) {
    io.error(firstLine(error));
    return 1;
  }

  const keyframesDir = join(resolve(projectDir), 'input', 'keyframes');
  const target = join(resolve(projectDir), 'frames');
  const force = hasFlag(argv, '--force');
  const prepared = join(
    dirname(target), '.' + basename(target) + '.tmp-' + randomUUID(),
  );
  try {
    if (!await pathExists(keyframesDir)) {
      io.error('No input/keyframes directory in ' + projectDir);
      return 1;
    }
    const names = (await readdir(keyframesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const ordered = planBeats(names);

    await mkdir(prepared, { recursive: true });
    for (const [position, name] of ordered.entries()) {
      const output = join(prepared, 'frame-' + String(position + 1).padStart(4, '0') + '.webp');
      await runner('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', join(keyframesDir, name),
        '-vf', 'scale=' + width + ':-2:flags=lanczos',
        '-c:v', 'libwebp', '-quality', String(quality),
        output,
      ]);
    }

    const files = (await readdir(prepared)).sort();
    const sizes = await Promise.all(files.map((name) => stat(join(prepared, name))));
    const probe = await runFfprobe(join(prepared, files[0]), runner);
    const stream = probe?.streams?.find((item) => item.codec_type === 'video');
    const frames = files.map((name, index) => ({
      path: name,
      bytes: sizes[index].size,
      width: Number(stream?.width),
      height: Number(stream?.height),
    }));
    await replaceDirectory(prepared, target, force);
    io.log(JSON.stringify(summarizeFrames(frames, { count: frames.length, width, quality }), null, 2));
    return 0;
  } catch (error) {
    io.error('Stills-to-frames failed: ' + firstLine(error));
    return 2;
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
```

Note: check `replaceDirectory`'s signature in `scripts/lib/files.mjs` first (extract-frames passes `(prepared, target, force, operations)`) and match it.

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/stills-to-frames.test.mjs` — expect PASS. Run `npx vitest run` for the full suite.

- [ ] **Step 5: Commit** — `git add scripts/stills-to-frames.mjs tests/unit/stills-to-frames.test.mjs && git commit -m "feat: stills-to-frames converter for the free stills-only site"`

---

### Task 8: Adaptive beats and capability-filtered provider planning

**Files:**
- Create: `scripts/lib/generation.mjs`
- Create: `scripts/plan-generation.mjs`
- Test: `tests/unit/generation.test.mjs`, `tests/unit/plan-generation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces the pure helpers plus CLI `plan-generation beats ...` and `plan-generation routes <routes.json> ...`. Provider routes and prices are runtime JSON inputs and are never hard-coded.

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from 'vitest';
import {
  estimateRouteCost,
  filterProviderRoutes,
  rankProviderRoutes,
  recommendBeatCount,
} from '../../scripts/lib/generation.mjs';

describe('recommendBeatCount', () => {
  it('maps simple, normal, dense, and catalog use cases into 3..10 beats', () => {
    expect(recommendBeatCount({ claimCount: 1, sectionCount: 2 })).toBe(3);
    expect(recommendBeatCount({ claimCount: 4, sectionCount: 5 })).toBe(5);
    expect(recommendBeatCount({ claimCount: 6, sectionCount: 6, hasProcess: true })).toBe(7);
    expect(recommendBeatCount({ claimCount: 9, sectionCount: 8, catalogItems: 12 })).toBe(10);
  });
  it('rejects negative/non-integer counts', () => {
    expect(() => recommendBeatCount({ claimCount: -1, sectionCount: 2 })).toThrow(/claimCount/);
  });
});

describe('provider planning', () => {
  const routes = [
    { id: 'none', available: true, costMicros: 0, noVideo: true, quality: 0, speed: 3 },
    { id: 'cheap', available: true, costMicros: 240000, durations: [8], resolutions: ['720p'], firstFrame: true, lastFrame: true, maxReferences: 2, quality: 1, speed: 3 },
    { id: 'quality', available: true, costMicros: 1600000, durations: [8], resolutions: ['1080p'], firstFrame: true, lastFrame: true, maxReferences: 3, quality: 3, speed: 1 },
    { id: 'missing', available: false, costMicros: 100000 },
  ];
  it('filters unavailable, over-budget, and capability-incompatible routes', () => {
    const result = filterProviderRoutes(routes, {
      budgetMicros: 500000, duration: 8, resolution: '720p', firstLast: true,
    });
    expect(result.eligible.map((route) => route.id)).toEqual(['none', 'cheap']);
    expect(result.excluded.map((item) => item.id)).toEqual(['quality', 'missing']);
  });
  it('ranks cheapest by cost and quality-first by quality', () => {
    expect(rankProviderRoutes(routes.slice(0, 3), 'cheapest')[0].id).toBe('none');
    expect(rankProviderRoutes(routes.slice(0, 3), 'quality-first')[0].id).toBe('quality');
  });
  it('estimates integer micro-unit costs', () => {
    expect(estimateRouteCost(30000, 8)).toBe(240000);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/generation.test.mjs` — expect module-not-found failure.

- [ ] **Step 3: Implement the pure module**

```js
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function count(value, name) {
  const normalized = value ?? 0;
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(name + ' must be a non-negative integer.');
  }
  return normalized;
}

export function recommendBeatCount(input = {}) {
  const claimCount = count(input.claimCount, 'claimCount');
  const sectionCount = count(input.sectionCount, 'sectionCount');
  const catalogItems = count(input.catalogItems, 'catalogItems');
  const density = Math.max(claimCount, sectionCount)
    + (input.hasProcess ? 1 : 0)
    + Math.min(2, Math.ceil(catalogItems / 6));
  if (density <= 2) return 3;
  if (density <= 5) return 5;
  if (density <= 7) return 7;
  return clamp(density, 8, 10);
}

export function estimateRouteCost(rateMicrosPerSecond, durationSeconds) {
  if (!Number.isInteger(rateMicrosPerSecond) || rateMicrosPerSecond < 0) {
    throw new Error('rateMicrosPerSecond must be a non-negative integer.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('durationSeconds must be positive.');
  }
  return Math.ceil(rateMicrosPerSecond * durationSeconds);
}

function exclusionReasons(route, requirements) {
  const reasons = [];
  if (!route.available) reasons.push('unavailable');
  if (!route.noVideo && route.costMicros > requirements.budgetMicros) reasons.push('over-budget');
  if (!route.noVideo && requirements.duration && !route.durations?.includes(requirements.duration)) reasons.push('duration');
  if (!route.noVideo && requirements.resolution && !route.resolutions?.includes(requirements.resolution)) reasons.push('resolution');
  if (!route.noVideo && requirements.firstLast && !(route.firstFrame && route.lastFrame)) reasons.push('first-last');
  if (!route.noVideo && requirements.referenceCount > (route.maxReferences ?? 0)) reasons.push('references');
  return reasons;
}

export function filterProviderRoutes(routes, requirements) {
  const eligible = [];
  const excluded = [];
  for (const route of routes) {
    const reasons = exclusionReasons(route, requirements);
    if (reasons.length) excluded.push({ id: route.id, reasons });
    else eligible.push(route);
  }
  return { eligible, excluded };
}

export function rankProviderRoutes(routes, preset) {
  const score = (route) => {
    if (preset === 'free' || preset === 'cheapest') return -route.costMicros;
    if (preset === 'quality-first') return route.quality * 1e9 - route.costMicros;
    return route.quality * 1e8 + route.speed * 1e7
      + (route.firstFrame ? 1e6 : 0) + (route.lastFrame ? 1e6 : 0)
      + (route.maxReferences ?? 0) * 1e5 - route.costMicros;
  };
  return [...routes].sort((left, right) => score(right) - score(left)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/generation.test.mjs` — expect PASS.

- [ ] **Step 5: Write the failing CLI tests** — `beats --claims 4 --sections 5` prints recommendation 5; `routes` reads a temp runtime routes file, filters unavailable/over-budget entries, ranks eligible routes for the selected preset, and prints excluded reasons; malformed JSON returns 2; invalid flags return 1.

- [ ] **Step 6: Run to verify failure** — `npx vitest run tests/unit/plan-generation.test.mjs` — expect module-not-found failure.

- [ ] **Step 7: Implement `scripts/plan-generation.mjs`** using exported `main(argv, io)` and the standard `isDirect` guard. Exact commands:

```text
plan-generation beats --claims N --sections N [--process] [--catalog N]
plan-generation routes <routes.json> --budget-micros N --preset free|cheapest|balanced|quality-first --duration N --resolution VALUE [--first-last] [--references N]
```

Use this command boundary around the Task 8 helpers:

```js
export async function main(argv = process.argv.slice(2), io = console) {
  const command = argv[0];
  try {
    if (command === 'beats') {
      const beatCount = recommendBeatCount({
        claimCount: integerFlag(argv, '--claims'),
        sectionCount: integerFlag(argv, '--sections'),
        hasProcess: argv.includes('--process'),
        catalogItems: optionalIntegerFlag(argv, '--catalog', 0),
      });
      io.log(JSON.stringify({ beatCount }, null, 2));
      return 0;
    }
    if (command !== 'routes' || !argv[1] || argv[1].startsWith('--')) {
      io.error(USAGE);
      return 1;
    }
    let routes;
    try {
      routes = JSON.parse(await readFile(resolve(argv[1]), 'utf8'));
    } catch (error) {
      io.error('Could not read routes: ' + String(error?.message ?? error));
      return 2;
    }
    if (!Array.isArray(routes)) throw new Error('Routes file must contain an array.');
    const requirements = {
      budgetMicros: integerFlag(argv, '--budget-micros'),
      duration: numericFlag(argv, '--duration'),
      resolution: valueAfter(argv, '--resolution'),
      firstLast: argv.includes('--first-last'),
      referenceCount: optionalIntegerFlag(argv, '--references', 0),
    };
    const preset = valueAfter(argv, '--preset');
    const { eligible, excluded } = filterProviderRoutes(routes, requirements);
    const ranked = rankProviderRoutes(eligible, preset);
    io.log(JSON.stringify({ recommended: ranked[0] ?? null, eligible: ranked, excluded }, null, 2));
    return 0;
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 1;
  }
}
```

Define `integerFlag`, `optionalIntegerFlag`, and `numericFlag` beside `USAGE` using `valueAfter`; each rejects missing, negative, or non-numeric values. Import `readFile`, `resolve`, `isDirect`, and the Task 8 helpers, then add the standard direct guard. Add `scroll-wizard-plan-generation` to `package.json#bin` and its path to package enumeration tests.

- [ ] **Step 8: Run tests** — `npx vitest run tests/unit/generation.test.mjs tests/unit/plan-generation.test.mjs tests/unit/package.test.mjs` — expect PASS.

- [ ] **Step 9: Commit** — `git add scripts/lib/generation.mjs scripts/plan-generation.mjs tests/unit/generation.test.mjs tests/unit/plan-generation.test.mjs tests/unit/package.test.mjs package.json && git commit -m "feat: add adaptive beat and provider planning"`

---

### Task 9: Durable hard-cap budget ledger

**Files:**
- Create: `scripts/budget.mjs`
- Test: `tests/unit/budget.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces CLI commands `budget <project> init|status|reserve|settle|unknown|raise-cap`; persists `budget.json` atomically. All money is integer micro-units (`1 USD = 1_000_000`) to support sub-cent quotes. Exports `createBudget`, `budgetTotals`, `reserveTransaction`, `settleTransaction`, `markTransactionUnknown`, `raiseBudgetCap`, and `main`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from 'vitest';
import {
  budgetTotals, createBudget, markTransactionUnknown,
  raiseBudgetCap, reserveTransaction, settleTransaction,
} from '../../scripts/budget.mjs';

describe('budget ledger', () => {
  it('reserves quoted cost and blocks calls over the hard cap', () => {
    const ledger = createBudget({ currency: 'USD', preset: 'balanced', capMicros: 1_000_000 });
    const reserved = reserveTransaction(ledger, {
      id: 'video-1', kind: 'video', provider: 'verified', model: 'm',
      quotedMicros: 800_000, promptPath: 'prompts/video.txt',
    }, '2026-07-18T00:00:00.000Z');
    expect(budgetTotals(reserved).remainingMicros).toBe(200_000);
    expect(() => reserveTransaction(reserved, {
      id: 'reroll-1', kind: 'reroll', provider: 'verified', model: 'm', quotedMicros: 300_000,
    })).toThrow(/hard cap/);
  });
  it('settles actual cost and retains unknown reservations', () => {
    const ledger = reserveTransaction(
      createBudget({ currency: 'USD', preset: 'cheapest', capMicros: 1_000_000 }),
      { id: 'still-1', kind: 'still', provider: 'p', model: 'm', quotedMicros: 200_000 },
    );
    expect(budgetTotals(settleTransaction(ledger, 'still-1', 150_000)).spentMicros).toBe(150_000);
    expect(budgetTotals(markTransactionUnknown(ledger, 'still-1')).reservedMicros).toBe(200_000);
  });
  it('requires an explicit strictly higher cap', () => {
    const ledger = createBudget({ currency: 'USD', preset: 'free', capMicros: 0 });
    expect(raiseBudgetCap(ledger, 500_000, 'cheapest')).toMatchObject({
      capMicros: 500_000, preset: 'cheapest',
    });
    expect(() => raiseBudgetCap(ledger, 0)).toThrow(/higher/);
  });
});
```

Add `main` tests with temp projects and fake `io`: Free init rejects a positive paid allocation; reserve persists atomically; duplicate IDs fail; `unknown` must be reconciled before reuse; failed writes leave the previous ledger valid; exit code is 1 for usage/validation and 2 for runtime I/O failure.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/budget.test.mjs` — expect module-not-found failure.

- [ ] **Step 3: Implement ledger transitions**

```js
export function budgetTotals(ledger) {
  const spentMicros = ledger.transactions
    .filter((item) => item.status === 'settled')
    .reduce((sum, item) => sum + item.actualMicros, 0);
  const reservedMicros = ledger.transactions
    .filter((item) => ['reserved', 'unknown'].includes(item.status))
    .reduce((sum, item) => sum + item.quotedMicros, 0);
  return {
    quotedMicros: ledger.transactions.reduce((sum, item) => sum + item.quotedMicros, 0),
    reservedMicros,
    spentMicros,
    remainingMicros: ledger.capMicros - spentMicros - reservedMicros,
  };
}

export function createBudget({ currency = 'USD', preset, capMicros, allocations = {} }) {
  if (!['free', 'cheapest', 'balanced', 'quality-first'].includes(preset)) throw new Error('Invalid preset.');
  if (!Number.isInteger(capMicros) || capMicros < 0) throw new Error('capMicros must be a non-negative integer.');
  if (preset === 'free' && capMicros !== 0) throw new Error('Free preset cap must be zero.');
  return { version: 1, currency, preset, capMicros, allocations, transactions: [] };
}

export function reserveTransaction(ledger, transaction, timestamp = new Date().toISOString()) {
  if (ledger.transactions.some((item) => item.id === transaction.id)) throw new Error('Duplicate transaction id.');
  if (!Number.isInteger(transaction.quotedMicros) || transaction.quotedMicros < 0) throw new Error('quotedMicros must be a non-negative integer.');
  if (transaction.quotedMicros > budgetTotals(ledger).remainingMicros) throw new Error('Reservation exceeds hard cap.');
  return { ...ledger, transactions: [...ledger.transactions, { ...transaction, status: 'reserved', timestamp }] };
}

export function settleTransaction(ledger, id, actualMicros, timestamp = new Date().toISOString()) {
  if (!Number.isInteger(actualMicros) || actualMicros < 0) throw new Error('actualMicros must be a non-negative integer.');
  const target = ledger.transactions.find((item) => item.id === id);
  if (!target || !['reserved', 'unknown'].includes(target.status)) throw new Error('Transaction is not reservable.');
  if (actualMicros > target.quotedMicros) throw new Error('Actual cost exceeds approved quote; reconcile manually.');
  return { ...ledger, transactions: ledger.transactions.map((item) => item.id === id
    ? { ...item, status: 'settled', actualMicros, settledAt: timestamp }
    : item) };
}

export function markTransactionUnknown(ledger, id) {
  if (!ledger.transactions.some((item) => item.id === id)) throw new Error('Unknown transaction id.');
  return { ...ledger, transactions: ledger.transactions.map((item) => item.id === id
    ? { ...item, status: 'unknown' }
    : item) };
}

export function raiseBudgetCap(ledger, capMicros, preset = ledger.preset) {
  if (!Number.isInteger(capMicros) || capMicros <= ledger.capMicros) throw new Error('New cap must be a higher integer amount.');
  if (preset === 'free') throw new Error('Raising a Free budget requires a paid preset.');
  return { ...ledger, capMicros, preset };
}
```

Add the standard imports (`readFile`, `join`, `resolve`, `isDirect`, `valueAfter`, `writeJsonAtomic`) and this CLI boundary. Money flags are integer micros only, so no floating-point conversion occurs:

```js
const USAGE = 'Usage: budget <project> init|status|reserve|settle|unknown|raise-cap [options]';
const required = (argv, flag) => valueAfter(argv, flag);
const integer = (argv, flag) => {
  const raw = required(argv, flag);
  if (!/^\d+$/.test(raw)) throw new Error(flag + ' must be a non-negative integer.');
  return Number(raw);
};
const optional = (argv, flag, fallback = null) => (
  argv.includes(flag) ? required(argv, flag) : fallback
);

async function readLedger(path) {
  const ledger = JSON.parse(await readFile(path, 'utf8'));
  if (ledger?.version !== 1 || !Array.isArray(ledger.transactions)) {
    throw new Error('budget.json has an unsupported shape.');
  }
  return ledger;
}

export async function main(argv = process.argv.slice(2), io = console) {
  const projectDir = argv[0];
  const command = argv[1];
  if (!projectDir || !command) { io.error(USAGE); return 1; }
  const path = join(resolve(projectDir), 'budget.json');
  let next;
  try {
    if (command === 'init') {
      next = createBudget({
        currency: optional(argv, '--currency', 'USD'),
        preset: required(argv, '--preset'),
        capMicros: integer(argv, '--cap-micros'),
      });
    } else {
      const ledger = await readLedger(path);
      if (command === 'status') {
        io.log(JSON.stringify({ ...budgetTotals(ledger), ledger }, null, 2));
        return 0;
      }
      if (command === 'reserve') {
        next = reserveTransaction(ledger, {
          id: required(argv, '--id'),
          kind: required(argv, '--kind'),
          provider: required(argv, '--provider'),
          model: required(argv, '--model'),
          quotedMicros: integer(argv, '--quoted-micros'),
          promptPath: optional(argv, '--prompt-path'),
          duration: optional(argv, '--duration'),
          resolution: optional(argv, '--resolution'),
        });
      } else if (command === 'settle') {
        next = settleTransaction(
          ledger, required(argv, '--id'), integer(argv, '--actual-micros'),
        );
      } else if (command === 'unknown') {
        next = markTransactionUnknown(ledger, required(argv, '--id'));
      } else if (command === 'raise-cap') {
        next = raiseBudgetCap(
          ledger, integer(argv, '--cap-micros'), optional(argv, '--preset', ledger.preset),
        );
      } else {
        io.error(USAGE);
        return 1;
      }
    }
  } catch (error) {
    io.error(String(error?.message ?? error));
    return error instanceof SyntaxError || error?.code ? 2 : 1;
  }
  try {
    await writeJsonAtomic(path, { ...next, totals: budgetTotals(next) });
    io.log(JSON.stringify({ ...budgetTotals(next), ledger: next }, null, 2));
    return 0;
  } catch (error) {
    io.error('Budget write failed: ' + String(error?.message ?? error));
    return 2;
  }
}

if (isDirect(import.meta.url)) process.exitCode = await main();
```

Add `scroll-wizard-budget` to `package.json#bin`.

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/budget.test.mjs tests/unit/package.test.mjs` — expect PASS.

- [ ] **Step 5: Commit** — `git add scripts/budget.mjs tests/unit/budget.test.mjs tests/unit/package.test.mjs package.json && git commit -m "feat: add hard-cap generation budget ledger"`

---

### Task 10: SKILL.md v2 workflow

**Files:**
- Modify: `SKILL.md`
- Modify: `tests/skill/scenarios.md` (gate names/steps), `tests/unit/template.test.mjs` / `tests/unit/package.test.mjs` only if they enumerate template files or scripts (check first)

**Interfaces:**
- Consumes: every script/helper and gate from Tasks 1–9, including `budget.mjs`, adaptive beat/provider helpers, `reencode-video`, and `stills-to-frames`.

- [ ] **Step 1: Rewrite the workflow sections of `SKILL.md`** (keep all Core rules, receipt discipline, handoff-card format, and prompt-craft confidentiality rules as-is). Concrete edits:

1. **Gates table** becomes:

| Gate | Kind | Persist before asking | Approve name |
|---|---|---|---|
| Brief | Hard | brief.md and intake values | brief |
| Storyboard | Light | active beat prompts, beat stills, and Pencil-reviewed overlays in values.json | storyboard |
| Stills preview | Light | stable beat-frame preview + reviewed overlays (legacy-only skip when a v1 video has no beat prompts) | stills-preview |
| Video watched | Hard | prompts/video.txt and input/video.mp4 | video |
| Extraction review | Light | frames + holds/posterIndex (frames mode) or media/ re-encode report (video mode) | extraction |
| Theme tokens | Light | theme in values.json | theme |
| Preview | Hard | complete site directory | preview |

2. **Step 1 Intake additions:** collect claim/section/process/catalog density, run `recommendBeatCount`, explain the 3–10 recommendation, and let the user override it. Ask for Free/Cheapest/Balanced/Quality-first plus an exact hard cap; initialize `budget.json` before any paid call. Ask for a payload preset and always state estimated size and mid-4G load time. Product-scrub defaults linger to 0.35 and uses feature-beat holds with orbit/dolly/light-sweep/peel-back motion around one clean-ground hero product.

3. **Step 2 becomes Storyboard:** write `prompts/keyframe-beat-<n>.txt` for each beat (beat-1 doubles as the video's first frame, the final beat as its last). Collect stills via the existing manual handoff cards or per-image money-gated API calls, into `input/keyframes/beat-<n>.<ext>`. Then, when Pencil MCP tools are available (probe by calling `get_editor_state` once; if unavailable, say so and fall back to numeric `values.json` editing): create one Pencil canvas per beat with the still as background and the overlay copy (title/body/stats/CTA) as editable nodes; iterate with the user via screenshots; on approval, write the resulting copy, `position`, `at` ranges, and `hold` flags back into `values.json` overlays. Approve with `--approve storyboard`.

4. **New Step 3 — Stills preview (no video-generation cost):** run `stills-to-frames`, then scaffold and review. Still acquisition obeys the ledger; Free uses user-provided/manual assets only. Offer the result as a shippable zero-video endpoint and approve `stills-preview` before offering video.

5. **Step 4 — Video, with budget menu.** Before writing `prompts/video.txt`, present the route menu with cost character and only routes actually available in this session:

| Route | Cost character |
|---|---|
| Manual handoff (Flow or user's own tool) | User's plan credits (default) |
| Veo / Seedance / Kling API | Current verified per-clip pricing and capability limits |
| Higgsfield API | Per-clip, typically pricier |
| Shorter/lower-res variant of any route (4–6 s, 720p) | Cheapest paid |
| No video — ship the stills site | Free |

Build route objects only from verified current-session capabilities, filter/rank them inside the remaining ledger budget, and show excluded reasons. Every paid call must reserve its maximum quote with `budget reserve` before generation, then `settle` or `unknown`. Approved beat stills become references only to the extent supported by the chosen route. When the cap is reached, explain the exact additional amount and likely targeted improvement without guaranteeing quality or raising the cap automatically.

Run `plan-generation routes` against the persisted preflight route JSON instead of ranking providers informally. Run `plan-generation beats` during intake and persist the user-confirmed override in `values.json`.

6. **Step 5 — Derive playback.** Default after video approval is balanced blob-video mode: `node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media --gop 8 --crf 23 --width 1600`; offer `--all-intra` only with its payload warning. Report the JSON payload summary and approve `extraction`, which hashes encoded media in video mode. Frames mode remains available when preferred or measured video playback is poor. With No video, set `generation.video` false, derive beat frames, skip only the video gate, and still approve extraction.

7. **Quick reference** gains:

```text
node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media --crf 23 --width 1600
node <skill-root>/scripts/stills-to-frames.mjs <project> --width 1600 --quality 80
node <skill-root>/scripts/budget.mjs <project> status
node <skill-root>/scripts/plan-generation.mjs beats --claims 4 --sections 5
```

8. Renumber the remaining steps (theme → 6, preview → 7, deploy → 8). Require the same-media responsive mobile checks: no horizontal overflow, safe-area padding, readable overlays, touch-sized CTAs, coarse-pointer seek tuning, iOS priming, and height-only resize stability. Do not add portrait-generation routes.

- [ ] **Step 2: Update `tests/skill/scenarios.md`** wherever it names the `keyframes` gate or old step numbers; check `tests/unit/package.test.mjs` and `tests/unit/template.test.mjs` for file enumerations (new files: `scripts/reencode-video.mjs`, `scripts/stills-to-frames.mjs`; template unchanged in file list except `index.html` content) and update if they assert lists.

- [ ] **Step 3: Full suite** — `npx vitest run && npx playwright test` — expect PASS.

- [ ] **Step 4: Commit** — `git add SKILL.md tests/ && git commit -m "docs: add adaptive budgeted v2 workflow"`

---

## Self-Review Notes

- Adaptive intake/provider filtering: Task 8; hard-cap persistence and reconciliation: Task 9; orchestration and cap-hit guidance: Task 10.
- Storyboard/Pencil and stable receipts: Tasks 6 and 10; stills-only derivation: Task 7; video/frames playback and responsive mobile behavior: Tasks 1–5.
- v1 compatibility is tested in Task 6 with both synthetic legacy receipts and the real `scrollcar` project.
- Playwright Chromium cannot decode H.264, so Task 3 uses an all-intra VP9 WebM fixture while production encoding defaults to H.264 GOP 8.
- Out-of-scope connector clips, portrait generation, frameworks, automatic rerolls, and automatic cap increases remain absent.
