# Scroll Wizard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Storyboard-first pipeline with a native video seek-scrub playback mode, Pencil-reviewed beats, a free stills-only site, a video-generation budget menu, and v2 gates — per the approved spec `docs/superpowers/specs/2026-07-18-scroll-wizard-v2-design.md`.

**Architecture:** The static-site template gains a second playback mode (`scrub.mode: "video"`) that seeks an all-intra-encoded `<video>` instead of drawing extracted frames; two new CLI scripts (`reencode-video.mjs`, `stills-to-frames.mjs`) feed it; `status.mjs` gains the v2 gate order with skip rules and v1 receipt compatibility; `SKILL.md` rewires the workflow (storyboard + Pencil loop + budget menu + product register).

**Tech Stack:** Node 20+ ESM, ffmpeg/ffprobe via `execFile`, vitest (unit), Playwright (browser smoke), vanilla JS template.

## Global Constraints

- Node 20+; no new npm dependencies.
- All scripts follow the existing pattern: exported pure helpers + `main(argv, io, runner, …)` + `isDirect` guard; errors printed via `io.error`, exit codes 1 (usage) / 2 (runtime).
- Template stays vanilla JS, no framework; `scrub-core.js` holds only pure functions.
- Repo root: `C:\Users\ryanl\.claude\skills\scroll-wizard`. All paths below are relative to it.
- Run unit tests with `npx vitest run <file>`; browser tests with `npx playwright test`.
- Commit after every task (message style: existing history, e.g. `feat: …`, `fix: …`, `docs: …`).
- Existing v1 projects (receipts under gate name `keyframes`) must keep resuming without re-approval of completed gates.

---

### Task 1: Pure helpers — `lingerEase`, `progressToTime`, v2 `validateConfig`

**Files:**
- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Produces: `lingerEase(x, linger) => number` (0..1→0..1, endpoints fixed); `progressToTime(progress, duration, margin = 0.05) => seconds`; `validateConfig(config)` additionally accepts `scrub.mode` (`'frames'`|`'video'`, default `'frames'`), `scrub.linger` (number in [0,1), optional), and — when mode is `'video'` — requires `config.video = { src, poster, duration }` with `src`/`poster` as safe paths under `media/` and skips the `frames` block requirement.

- [ ] **Step 1: Write failing tests** (append to `tests/unit/scrub-core.test.mjs`, importing the two new names from `../../template/scrub-core.js`):

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
  const mode = config.scrub?.mode ?? 'frames';
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

Wrap the existing `frames` validation block (count/pattern/poster checks) in `if (mode !== 'video') { … }` so video mode does not require it.

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

- [ ] **Step 1: Read `tests/browser/smoke.spec.mjs`** and find the assertion that waits for the loader to hide. Add/adjust a test asserting the loader is hidden as soon as the canvas has painted a frame (`window.__SCROLL_WIZARD_DEBUG__.lastFrame >= 0`) without requiring `decodedCount` to equal the full frame count. Run `npx playwright test` first to confirm the suite is green before editing.

- [ ] **Step 2: Implement in `template/scrub-engine.js`:**
  - Import `lingerEase` in the existing import block from `./scrub-core.js`.
  - In `runEngine`, replace `store.preloadAll().then(() => { loader.hidden = true; });` with `store.preloadAll();` (progress bar keeps updating via `onProgress`).
  - In `tick`, where `posterHidden` flips to true, also `loader.hidden = true;`.
  - Change `const targetProgress = applyHolds(raw, holds);` to `const targetProgress = lingerEase(applyHolds(raw, holds), config.scrub.linger ?? 0);`.

- [ ] **Step 3: Run** `npx playwright test` — expect PASS.

- [ ] **Step 4: Commit** — `git add template/scrub-engine.js tests/browser/smoke.spec.mjs && git commit -m "fix: hide loader on first painted frame; apply linger easing"`

---

### Task 3: Video seek-scrub mode in the template

**Files:**
- Modify: `template/index.html`, `template/style.css`, `template/scrub-engine.js`
- Test: `tests/browser/smoke.spec.mjs` (new video-mode scenario), `tests/browser/fixture-server.mjs` (video fixture)

**Interfaces:**
- Consumes: `progressToTime`, `lingerEase`, v2 `validateConfig` (Task 1).
- Produces: with `config.scrub.mode === 'video'` and `config.video = {src, poster, duration}`, the site blob-loads the video, scrubs `currentTime` with seek coalescing, keeps the poster until first `seeked`, primes playback on first gesture. Frames mode untouched.

- [ ] **Step 1: Add the video element to `template/index.html`** directly after the poster `<img>`:

```html
        <video id="scrub-video" class="scrub__video" muted playsinline aria-hidden="true"></video>
```

- [ ] **Step 2: Add to `template/style.css`** (mirror the `.scrub__canvas` positioning block — read it first and copy its position/inset/size rules):

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

- [ ] **Step 3: Implement video mode in `template/scrub-engine.js`.**

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

In `loadPoster`, choose the source by mode: `poster.src = (config.scrub?.mode === 'video') ? config.video.poster : config.frames.poster;`

In `start()`, replace the final `runEngine(config, overlayNodes);` with:

```js
  if ((config.scrub.mode ?? 'frames') === 'video') {
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

- [ ] **Step 4: Browser test.** Read `tests/browser/fixture-server.mjs` to see how the frames fixture site is assembled. Add a video-mode fixture: generate a tiny all-intra **VP9 webm** at setup (Playwright's Chromium has no H.264, so the test fixture uses webm; production uses mp4):

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

- [ ] **Step 5: Run** `npx playwright test` — expect PASS (both modes).

- [ ] **Step 6: Commit** — `git add template/ tests/browser/ && git commit -m "feat: video seek-scrub playback mode"`

---

### Task 4: `reencode-video.mjs` — all-intra re-encode + poster + payload report

**Files:**
- Create: `scripts/reencode-video.mjs`
- Test: `tests/unit/reencode-video.test.mjs`

**Interfaces:**
- Consumes: `runFfprobe`, `videoVerdict` from `scripts/validate-media.mjs`; `MID_4G_BYTES_PER_SECOND`, `REQUEST_OVERHEAD_SECONDS` from `scripts/extract-frames.mjs`; `hasFlag`, `isDirect` from `scripts/lib/cli.mjs`; `pathExists` from `scripts/lib/files.mjs`.
- Produces: CLI `reencode-video <input> <outDir> [--crf 10..40=23] [--width 16..8192=1600] [--poster-at seconds=0] [--force]`; writes `<outDir>/video.mp4` (h264, `-g 1`, faststart), `<outDir>/poster.webp`, `<outDir>/media.json` (`{ duration, width, height }`); prints JSON summary `{ videoBytes, posterBytes, duration, width, height, estimatedSeconds }`. Exports `parseReencodeArgs(argv)`, `buildReencodeArgs(options)`, `buildPosterArgs(options)`, `main(argv, io, runner)`.

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
      input: 'in.mp4', outDir: 'out', crf: 23, width: 1600, posterAt: 0, force: false,
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
  it('encodes all-intra h264 with faststart', () => {
    const args = buildReencodeArgs({ input: 'in.mp4', width: 1280, crf: 20, output: 'out/video.mp4' });
    expect(args).toContain('-g');
    expect(args[args.indexOf('-g') + 1]).toBe('1');
    expect(args).toContain('+faststart');
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(args[args.indexOf('-vf') + 1]).toContain('scale=1280:-2');
    expect(args.at(-1)).toBe('out/video.mp4');
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
  const valueFlags = new Set(['--crf', '--width', '--poster-at']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') continue;
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
    '-g', '1',
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
    io.error('Usage: reencode-video <input> <output-dir> [--crf N] [--width N] [--poster-at S] [--force]');
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
    await writeJsonAtomic(join(outDir, 'media.json'), { duration, width, height });

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

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/reencode-video.test.mjs` — expect PASS.

- [ ] **Step 5: End-to-end sanity** (real ffmpeg): `node scripts/reencode-video.mjs "C:\Users\ryanl\desktop\scrolltest\scrollcar\input\video.mp4" "C:\Users\ryanl\AppData\Local\Temp\claude\reencode-check" --width 640` — expect a JSON summary and three files in the output dir. Delete the temp dir afterwards.

- [ ] **Step 6: Commit** — `git add scripts/reencode-video.mjs tests/unit/reencode-video.test.mjs && git commit -m "feat: reencode-video script (all-intra scrub encode + poster + payload report)"`

---

### Task 5: `scaffold-site.mjs` video mode

**Files:**
- Modify: `scripts/scaffold-site.mjs`
- Test: `tests/unit/scaffold-site.test.mjs`

**Interfaces:**
- Consumes: v2 `validateConfig` (Task 1); `media/` layout from Task 4 (`video.mp4`, `poster.webp`, `media.json`).
- Produces: when `values.scrub?.mode === 'video'`, scaffold stages `<project>/media` (fresh) or `<project>/site/media` (inherited) into the new site, reads `media.json` for duration, and `assembleConfig(defaults, values, frameSet, mediaSet)` emits `config.video = { src: 'media/video.mp4', poster: 'media/poster.webp', duration }` with no `frames` block. Frames mode behavior unchanged.

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
    const videoMode = values.scrub?.mode === 'video';
    let frameSet = null;
    let mediaSet = null;
    let framesSource;
    if (videoMode) {
      const projectMediaPath = join(projectDir, 'media');
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
      // …existing frames staging block, unchanged…
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
- Produces: `GATES = ['brief', 'storyboard', 'stills-preview', 'video', 'extraction', 'theme', 'preview']`; skip rules — `storyboard` skipped when no keyframe prompts and `prompts/video.txt` exists (old rule, renamed), `stills-preview` skipped when `input/video.mp4` exists, `extraction` skipped when `values.scrub?.mode === 'video'`; legacy `keyframes` receipts count as `storyboard`; `keyframe-beat-N.txt` prompts/roles accepted; resume step numbering 1–7 (all-done = 8).

- [ ] **Step 1: Write failing tests** (append to `tests/unit/status.test.mjs`; read it first — it builds temp projects and fake `inspect` functions; reuse those helpers):

Cases to add:
1. `GATES` equals the v2 list in order.
2. A project with a legacy `approvals.json` using key `keyframes` (valid hash chain built the v1 way) plus `input/video.mp4` present resolves with `storyboard` **not** in `unapproved` (legacy receipt honored, stills-preview skipped).
3. A project with `values.json` containing `"scrub": {"mode": "video"}` and no `frames/` dir reports `extraction` as skipped (not in `unapproved`, and `resolveResume` does not stall on it).
4. `prompts/keyframe-beat-1.txt` + `input/keyframes/beat-1.png` produce a complete storyboard manifest; a missing `beat-2.png` for an existing `keyframe-beat-2.txt` appears as `storyboard:beat-2` in `incomplete`.
5. All-approved v2 project resolves `resumeStep === 8`.

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

`buildGateManifest`: rename the `keyframes` branch to `storyboard` (body unchanged); make the site-files fallback serve both preview gates explicitly:

```js
  if (gate === 'stills-preview' || gate === 'preview') {
    const siteFiles = await regularFilesRecursive(join(projectDir, 'site'), inspect);
    if (!siteFiles.length) return null;
    return sortManifestEntries(await hashFiles(siteFiles, 'site'));
  }
```

`buildInventory` additions:
- `const videoFileExists = await regularFileExists(join(projectDir, 'input', 'video.mp4'), inspect);`
- Read values once: `const values = await readJsonObject(paths.values, 'values.json').catch(() => null);` and `const scrubMode = values?.scrub?.mode ?? 'frames';`
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

Skip predicates (replace `keyframesSkipped`):

```js
function gateSkipped(gate, inventory) {
  if (gate === 'storyboard') {
    return inventory.keyframePromptCount === 0 && inventory.videoPromptExists;
  }
  if (gate === 'stills-preview') return inventory.videoFileExists;
  if (gate === 'extraction') return inventory.scrubMode === 'video';
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

All-done resume becomes `8` (the `finish(actionableSteps.length ? … : 7, …)` literal changes to `8`).

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/status.test.mjs` — expect PASS. Then run the whole unit suite `npx vitest run` — other suites (e.g. `tests/integration/pipeline.test.mjs`, `tests/skill/*`) may reference gate names or step numbers; update any that assert `keyframes`/6-gate numbering to the v2 names, keeping the legacy-receipt test intact.

- [ ] **Step 5: Real-project sanity** — `node scripts/status.mjs "C:\Users\ryanl\desktop\scrolltest\scrollcar" --json` — expect the v1 project to resolve without demanding re-approval of brief/storyboard/video/extraction (its receipts were written under v1 names; `stills-preview` must show as skipped because `input/video.mp4` exists).

- [ ] **Step 6: Commit** — `git add scripts/status.mjs tests/ && git commit -m "feat: v2 gates (storyboard, stills-preview, video-mode extraction skip, v1 receipts)"`

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

### Task 8: SKILL.md v2 workflow

**Files:**
- Modify: `SKILL.md`
- Modify: `tests/skill/scenarios.md` (gate names/steps), `tests/unit/template.test.mjs` / `tests/unit/package.test.mjs` only if they enumerate template files or scripts (check first)

**Interfaces:**
- Consumes: every script and gate from Tasks 1–7 (exact CLI names: `reencode-video`, `stills-to-frames`; gate names: `storyboard`, `stills-preview`).

- [ ] **Step 1: Rewrite the workflow sections of `SKILL.md`** (keep all Core rules, receipt discipline, handoff-card format, and prompt-craft confidentiality rules as-is). Concrete edits:

1. **Gates table** becomes:

| Gate | Kind | Persist before asking | Approve name |
|---|---|---|---|
| Brief | Hard | brief.md and intake values | brief |
| Storyboard | Light | active beat prompts, beat stills, and Pencil-reviewed overlays in values.json | storyboard |
| Stills preview | Light | stills-only site directory (skipped once input/video.mp4 exists) | stills-preview |
| Video watched | Hard | prompts/video.txt and input/video.mp4 | video |
| Extraction review | Light | frames + holds/posterIndex (frames mode) or media/ re-encode report (video mode) | extraction |
| Theme tokens | Light | theme in values.json | theme |
| Preview | Hard | complete site directory | preview |

2. **Step 1 Intake additions:** ask for beat count (3–10) alongside the existing brand/vibe/motion/holds/CTA pass; ask for a payload preset (frames density in frames mode, or re-encode width/CRF in video mode) and always state the estimated size and mid-4G load time from the script reports. Product-scrub register: default `scrub.linger` to 0.35, plan holds on feature beats, and use orbit/dolly/light-sweep/peel-back moves around one hero product on clean ground — never an environment fly-through.

3. **Step 2 becomes Storyboard:** write `prompts/keyframe-beat-<n>.txt` for each beat (beat-1 doubles as the video's first frame, the final beat as its last). Collect stills via the existing manual handoff cards or per-image money-gated API calls, into `input/keyframes/beat-<n>.<ext>`. Then, when Pencil MCP tools are available (probe by calling `get_editor_state` once; if unavailable, say so and fall back to numeric `values.json` editing): create one Pencil canvas per beat with the still as background and the overlay copy (title/body/stats/CTA) as editable nodes; iterate with the user via screenshots; on approval, write the resulting copy, `position`, `at` ranges, and `hold` flags back into `values.json` overlays. Approve with `--approve storyboard`.

4. **New Step 3 — Stills preview (free):** run `node <skill-root>/scripts/stills-to-frames.mjs <project> --width W --quality Q`, then `scaffold-site.mjs`; serve and review in the browser. Offer it as a shippable zero-video endpoint. Approve with `--approve stills-preview`. Skipped automatically once a video exists.

5. **Step 4 — Video, with budget menu.** Before writing `prompts/video.txt`, present the route menu with cost character and only routes actually available in this session:

| Route | Cost character |
|---|---|
| Manual handoff (Flow or user's own tool) | User's plan credits (default) |
| Seedance / Kling API | Per-clip API pricing |
| Higgsfield API | Per-clip, typically pricier |
| Shorter/lower-res variant of any route (4–6 s, 720p) | Cheapest paid |
| No video — ship the stills site | Free |

Every API route keeps the per-call money gate. Approved beat stills become the generation's keyframe references (beat-1 → first, last beat → last).

6. **Step 5 — Derive playback.** Default is video mode: `node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media [--crf N] [--width W]`, report the JSON payload summary, set `"scrub": { "mode": "video" }` in `values.json`, approve `extraction` (the gate now covers the re-encode report in video mode). Frames mode (`extract-frames.mjs`) remains available when the user prefers it or video playback misbehaves; hold/posterIndex review applies only in frames mode.

7. **Quick reference** gains:

```text
node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media --crf 23 --width 1600
node <skill-root>/scripts/stills-to-frames.mjs <project> --width 1600 --quality 80
```

8. Renumber the remaining steps (theme → 6, preview → 7, deploy → 8) and update every in-text step reference.

- [ ] **Step 2: Update `tests/skill/scenarios.md`** wherever it names the `keyframes` gate or old step numbers; check `tests/unit/package.test.mjs` and `tests/unit/template.test.mjs` for file enumerations (new files: `scripts/reencode-video.mjs`, `scripts/stills-to-frames.mjs`; template unchanged in file list except `index.html` content) and update if they assert lists.

- [ ] **Step 3: Full suite** — `npx vitest run && npx playwright test` — expect PASS.

- [ ] **Step 4: Commit** — `git add SKILL.md tests/ && git commit -m "docs: v2 workflow (storyboard + Pencil loop, stills preview, budget menu, video mode)"`

---

## Self-Review Notes

- Spec coverage: §1 dual modes → Tasks 1–5; §2 storyboard/Pencil → Tasks 6–8; §3 stills site → Tasks 7–8; §4 budget menu → Task 8; §5 product register → Task 8 (linger default, prompt craft) + Task 1 (linger); §6 gates → Task 6. Out-of-scope items untouched.
- v1 compatibility is tested in Task 6 (legacy receipt case + real `scrollcar` sanity check).
- Playwright Chromium cannot decode H.264, so the browser fixture uses VP9 webm; `safeMediaPath` accepts both `.mp4` and `.webm` for this reason.
