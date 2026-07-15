# Scroll Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build the cross-harness scroll-wizard skill, its standalone Node CLI pipeline, and its self-contained scroll-scrub site template.

**Architecture:** Pure, dependency-free functions live in the shipped template or focused script modules and are imported directly by Vitest. Thin CLI/DOM seams own ffmpeg, filesystem, and browser effects. Generated sites are assembled transactionally from the immutable template, creative values, and a validated contiguous frame set.

**Tech Stack:** Node.js 20+ ESM, ffmpeg/ffprobe, Vitest 4.1.10, Playwright Test 1.61.1 with Chromium, browser Canvas 2D, and vendored Lenis 1.3.25.

## Global Constraints

- Node.js must be version 20 or newer.
- Runtime npm dependencies must remain zero; ffmpeg and ffprobe are external prerequisites.
- Dev dependencies are exactly Vitest and Playwright Test.
- All shipped JavaScript is ESM except the vendored Lenis browser bundle.
- Frame indices are one-based in filenames/configuration and zero-based inside scrub-core functions.
- Supported extraction formats are webp and jpg; output names are frame-0001 through frame-9999.
- The default desktop-rich preset is 150 frames, 1600 px width, quality 80, and a 12 MiB soft budget.
- The mobile-first preset is 100 frames, 1280 px width, quality 75, and a 6 MiB soft budget.
- Load estimates use 500,000 bytes/second plus 0.15 seconds of fixed request overhead, labeled as an estimate.
- The template is copied, never regenerated or hand-edited by the skill.
- Every gate persists its reviewed state before asking for approval.
- API-mode paid calls require approval of the exact prompt immediately before each call.
- Prompt revisions move the previous active file into prompts/history; active filenames never change.
- Generated sites make no network requests except their own static files.
- Configuration-derived text must be inserted with textContent or equivalent DOM properties, never innerHTML.
- The browser runtime may fetch all compressed frame bytes, but decoded ImageBitmap objects are bounded to at most min(frameCount, 2N + 1), with N defaulting to 12.
- Reduced-motion mode requests config plus the poster only; it must not request the remaining sequence frames.
- Lenis is optional at runtime: deleting template/lenis.js must leave native scrolling functional.

## Final-review clarifications locked for implementation

1. The extraction gate hashes a canonical projection of values.json containing only hold ranges and posterIndex. Adding theme later must not invalidate extraction approval.
2. The theme gate hashes only the canonical theme projection from values.json.
3. The preview gate hashes every regular file under site, including template JavaScript/CSS, frames, and an optional local font.
4. A skipped keyframe step is inferred safely only after an active video prompt exists with no keyframe prompt files. Before that point, resume returns to step 2.
5. The poster alt text comes from optional brand.imageAlt, falling back to brand.tagline and then brand.name + " hero scene".
6. The reduced-motion smoke assertion permits exactly the poster frame request and rejects requests for every other sequence frame.
7. A theme-only scaffold copies the existing live frame/font data into the staging site; it never renames data out of the live site before commit.
8. The poster img is an LCP candidate, not an LCP guarantee; full-viewport heuristics and early user input remain browser-controlled.

## File map

### Root and configuration

- Create package.json: package metadata, bin entries, test scripts, publish whitelist, exact dev versions.
- Create package-lock.json: npm-generated dependency lock.
- Create .gitignore: dependency, test-report, and transaction-temporary exclusions.
- Create vitest.config.mjs: Node test configuration for unit and integration suites.
- Create playwright.config.mjs: Chromium smoke configuration and local fixture server.
- Create README.md: installation, standalone CLI, generated-project workflow, and deploy instructions.
- Create THIRD_PARTY_LICENSES.md: Lenis version, source, copyright, and MIT text.

### CLI and shared Node modules

- Create scripts/lib/cli.mjs: argument helpers and direct-invocation detection.
- Create scripts/lib/files.mjs: path checks, canonical JSON, hashing, atomic JSON writes, recursive manifests, and directory replacement helpers.
- Create scripts/validate-media.mjs: ffprobe seam, media detection, verdicts, and CLI.
- Create scripts/extract-frames.mjs: extraction argument parsing, frame plan, ffmpeg invocation, budget summary, and replacement.
- Create scripts/status.mjs: gate manifests, receipt chains, staleness inventory, approvals, and resume CLI.
- Create scripts/scaffold-site.mjs: frame-set inspection, config assembly, validation, staged site transaction, and generated README.

### Shipped template

- Create template/scrub-core.js: all pure scrub math, decode-window selection, color/contrast helpers, and config validation.
- Create template/index.html: semantic poster/canvas/overlay/outro structure.
- Create template/style.css: sticky scrub, scene chips, responsive/static layouts, focus, and loading UI.
- Create template/scrub-engine.js: safe DOM rendering, bounded frame store, rAF loop, resize, reduced motion, Lenis, and FontFace.
- Create template/lenis.js: pinned upstream Lenis 1.3.25 browser bundle with its license header.
- Create template/config.json: complete valid example configuration.

### Tests

- Create tests/unit/package.test.mjs.
- Create tests/unit/scrub-core.test.mjs.
- Create tests/unit/validate-media.test.mjs.
- Create tests/unit/extract-frames.test.mjs.
- Create tests/unit/status.test.mjs.
- Create tests/unit/scaffold-site.test.mjs.
- Create tests/integration/pipeline.test.mjs.
- Create tests/browser/fixture-server.mjs.
- Create tests/browser/smoke.spec.mjs.

### Agent layer

- Create SKILL.md: harness-neutral eight-step wizard with hard/light/money gates, manual handoffs, API fallback, prompt craft, status-based resume, and cheapest-point re-entry.

---

### Task 1: Bootstrap the npm package and test harness

**Files:**
- Create: package.json
- Create: package-lock.json
- Create: .gitignore
- Create: vitest.config.mjs
- Create: playwright.config.mjs
- Create: tests/unit/package.test.mjs

**Interfaces:**
- Consumes: Node.js 20+ and npm.
- Produces: npm run test:unit, npm run test:integration, npm run test:browser, and npm test.

- [ ] **Step 1: Write the package contract test**

~~~javascript
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

describe('package contract', () => {
  it('is ESM, Node 20+, and exposes all four CLIs', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.bin).toEqual({
      'scroll-wizard-validate': 'scripts/validate-media.mjs',
      'scroll-wizard-extract': 'scripts/extract-frames.mjs',
      'scroll-wizard-scaffold': 'scripts/scaffold-site.mjs',
      'scroll-wizard-status': 'scripts/status.mjs',
    });
  });

  it('ships the skill, scripts, template, readme, and third-party notice', () => {
    expect(pkg.files).toEqual([
      'scripts/',
      'template/',
      'SKILL.md',
      'README.md',
      'THIRD_PARTY_LICENSES.md',
    ]);
    expect(pkg.dependencies).toBeUndefined();
  });
});
~~~

- [ ] **Step 2: Create package.json and test configuration**

~~~json
{
  "name": "scroll-wizard",
  "version": "0.1.0",
  "description": "Cross-harness skill and CLI for scroll-scrub video websites",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "bin": {
    "scroll-wizard-validate": "scripts/validate-media.mjs",
    "scroll-wizard-extract": "scripts/extract-frames.mjs",
    "scroll-wizard-scaffold": "scripts/scaffold-site.mjs",
    "scroll-wizard-status": "scripts/status.mjs"
  },
  "files": [
    "scripts/",
    "template/",
    "SKILL.md",
    "README.md",
    "THIRD_PARTY_LICENSES.md"
  ],
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:browser": "playwright test",
    "test:all": "npm test && npm run test:browser"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "vitest": "4.1.10"
  },
  "license": "MIT"
}
~~~

~~~javascript
// vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.mjs', 'tests/integration/**/*.test.mjs'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
  },
});
~~~

~~~javascript
// playwright.config.mjs
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    reducedMotion: 'no-preference',
  },
  webServer: {
    command: 'node tests/browser/fixture-server.mjs',
    port: 4173,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
~~~

~~~gitignore
node_modules/
playwright-report/
test-results/
coverage/
*.tgz
.scroll-wizard-*
site.tmp*/
site.old*/
~~~

- [ ] **Step 3: Install exact development dependencies**

Run: npm install

Expected: exit 0; package-lock.json is created with Vitest 4.1.10 and Playwright Test 1.61.1.

- [ ] **Step 4: Run the package test**

Run: npm run test:unit -- tests/unit/package.test.mjs

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

~~~bash
git add package.json package-lock.json .gitignore vitest.config.mjs playwright.config.mjs tests/unit/package.test.mjs
git commit -m "chore: bootstrap scroll-wizard package"
~~~

### Task 2: Implement the pure scrub core and configuration validator

**Files:**
- Create: template/scrub-core.js
- Create: tests/unit/scrub-core.test.mjs

**Interfaces:**
- Consumes: plain numbers, ranges, frame patterns, colors, and configuration objects.
- Produces: scrollProgress, applyHolds, progressToFrame, smooth, alphaToK, coverRect, canvasSize, frameFilename, overlayOpacity, holdFrames, recommendHeightVh, decodeWindow, contrastRatio, and validateConfig.

- [ ] **Step 1: Write failing tests for mapping, geometry, and decode-window behavior**

~~~javascript
import { describe, expect, it } from 'vitest';
import {
  alphaToK,
  applyHolds,
  canvasSize,
  coverRect,
  decodeWindow,
  frameFilename,
  holdFrames,
  overlayOpacity,
  progressToFrame,
  recommendHeightVh,
  scrollProgress,
  smooth,
} from '../../template/scrub-core.js';

describe('scrub mapping', () => {
  it('clamps scroll progress and handles degenerate sections', () => {
    expect(scrollProgress(150, 100, 500, 100)).toBeCloseTo(0.125);
    expect(scrollProgress(-1, 0, 500, 100)).toBe(0);
    expect(scrollProgress(999, 0, 500, 100)).toBe(1);
    expect(scrollProgress(10, 0, 100, 100)).toBe(0);
  });

  it('creates continuous plateaus and redistributes moving progress', () => {
    const holds = [[0.25, 0.5]];
    expect(applyHolds(0, holds)).toBe(0);
    expect(applyHolds(0.25, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(0.4, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(0.5, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(1, holds)).toBe(1);
  });

  it('maps progress and hold plateaus to zero-based frames', () => {
    expect(progressToFrame(0.5, 5)).toBe(2);
    expect(progressToFrame(2, 5)).toBe(4);
    expect(holdFrames([[0.25, 0.5]], 10)).toEqual([3]);
  });

  it('uses frame-rate-independent smoothing', () => {
    const k = alphaToK(0.12);
    expect(smooth(0, 1, k, 1 / 60)).toBeCloseTo(0.12);
  });
});

describe('geometry and filenames', () => {
  it('computes centered cover crops and capped backing sizes', () => {
    expect(coverRect(1600, 900, 1000, 1000)).toEqual({
      sx: 350, sy: 0, sw: 900, sh: 900,
    });
    expect(canvasSize(500, 300, 3)).toEqual({ width: 1000, height: 600 });
  });

  it('expands one-based padded frame names', () => {
    expect(frameFilename(0, 'frames/frame-{index:4}.webp'))
      .toBe('frames/frame-0001.webp');
  });

  it('computes overlay fades and height recommendations', () => {
    expect(overlayOpacity(0.1, [0.1, 0.3], 0.05)).toBe(0);
    expect(overlayOpacity(0.125, [0.1, 0.3], 0.05)).toBeCloseTo(0.5);
    expect(recommendHeightVh(400, [[0.2, 0.7]])).toEqual({
      heightVh: 700,
      speedUp: 2,
    });
  });

  it('keeps a bounded, direction-biased decode set', () => {
    expect(decodeWindow(10, 2, 30, 0)).toEqual([8, 9, 10, 11, 12]);
    expect(decodeWindow(10, 2, 30, 1)).toEqual([9, 10, 11, 12, 13]);
    expect(decodeWindow(10, 2, 30, -1)).toEqual([7, 8, 9, 10, 11]);
    expect(decodeWindow(0, 2, 4, -1)).toEqual([0, 1, 2, 3]);
  });
});
~~~

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: npm run test:unit -- tests/unit/scrub-core.test.mjs

Expected: FAIL because template/scrub-core.js does not exist.

- [ ] **Step 3: Implement the pure mapping and geometry exports**

~~~javascript
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function scrollProgress(scrollY, sectionTop, sectionHeight, viewportH) {
  const distance = sectionHeight - viewportH;
  if (![scrollY, sectionTop, sectionHeight, viewportH].every(Number.isFinite)
      || distance <= 0) return 0;
  return clamp((scrollY - sectionTop) / distance, 0, 1);
}

export function applyHolds(progress, holds = []) {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const sorted = [...holds].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, range) => sum + range[1] - range[0], 0);
  if (total <= 0) return p;
  const moving = 1 - total;
  if (moving <= 0) return 0;
  let removed = 0;
  for (const [start, end] of sorted) {
    if (p < start) return clamp((p - removed) / moving, 0, 1);
    if (p <= end) return clamp((start - removed) / moving, 0, 1);
    removed += end - start;
  }
  return clamp((p - removed) / moving, 0, 1);
}

export function progressToFrame(progress, frameCount) {
  const count = Math.max(1, Math.trunc(frameCount));
  return clamp(Math.round(clamp(progress, 0, 1) * (count - 1)), 0, count - 1);
}

export function smooth(current, target, k, dt) {
  if (![current, target, k, dt].every(Number.isFinite) || k <= 0 || dt <= 0) {
    return current;
  }
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

export function alphaToK(alpha) {
  const value = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 0.999999);
  return -60 * Math.log(1 - value);
}

export function coverRect(imgW, imgH, canvasW, canvasH) {
  if ([imgW, imgH, canvasW, canvasH].some((value) => !Number.isFinite(value) || value <= 0)) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const imageAspect = imgW / imgH;
  const canvasAspect = canvasW / canvasH;
  if (imageAspect > canvasAspect) {
    const sw = imgH * canvasAspect;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / canvasAspect;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

export function canvasSize(cssW, cssH, dpr, maxDpr = 2) {
  const ratio = clamp(Number.isFinite(dpr) ? dpr : 1, 1, maxDpr);
  return {
    width: Math.max(1, Math.round(cssW * ratio)),
    height: Math.max(1, Math.round(cssH * ratio)),
  };
}

export function frameFilename(index, pattern) {
  return pattern.replace(/\{index:(\d+)\}/, (_match, width) =>
    String(index + 1).padStart(Number(width), '0'));
}

export function overlayOpacity(progress, range, fade) {
  const [start, end] = range;
  const width = end - start;
  const ramp = fade ?? Math.min(0.05, width / 2);
  if (progress <= start || progress >= end || width <= 0) return 0;
  if (ramp <= 0) return 1;
  return clamp(Math.min((progress - start) / ramp, (end - progress) / ramp), 0, 1);
}

export function holdFrames(holds, frameCount) {
  return holds.map(([start]) =>
    progressToFrame(applyHolds(start, holds), frameCount));
}

export function recommendHeightVh(baseVh, holds = []) {
  const total = holds.reduce((sum, range) => sum + range[1] - range[0], 0);
  if (total <= 0) return { heightVh: baseVh, speedUp: 1 };
  if (total >= 1) return { heightVh: Infinity, speedUp: Infinity };
  return {
    heightVh: 100 + (baseVh - 100) / (1 - total),
    speedUp: 1 / (1 - total),
  };
}

export function decodeWindow(targetIndex, n, frameCount, direction = 0) {
  const count = Math.max(0, Math.trunc(frameCount));
  if (count === 0) return [];
  const radius = Math.max(0, Math.trunc(n));
  const size = Math.min(count, radius * 2 + 1);
  const remaining = size - 1;
  const before = direction > 0
    ? Math.floor(remaining / 4)
    : direction < 0
      ? Math.ceil(remaining * 3 / 4)
      : Math.floor(remaining / 2);
  const target = clamp(Math.trunc(targetIndex), 0, count - 1);
  const start = clamp(target - before, 0, count - size);
  return Array.from({ length: size }, (_value, offset) => start + offset);
}
~~~

- [ ] **Step 4: Add failing color and validation tests**

~~~javascript
import { contrastRatio, validateConfig } from '../../template/scrub-core.js';

const validConfig = {
  brand: { name: 'Aster', tagline: 'Light, held in motion' },
  theme: {
    bg: '#000000',
    text: '#ffffff',
    accent: '#dfff57',
    surface: 'rgba(0, 0, 0, 0.75)',
    radius: 10,
    fonts: { display: 'serif', body: 'sans-serif' },
  },
  frames: {
    count: 24,
    pattern: 'frames/frame-{index:4}.webp',
    poster: 'frames/frame-0001.webp',
  },
  scrub: { heightVh: 400, smoothing: 0.12 },
  overlays: [{
    at: [0.2, 0.4],
    title: 'Precision',
    body: 'A quiet reveal.',
    hold: true,
    position: 'left',
    stats: [{ value: '18 h', label: 'Battery' }],
    cta: { label: 'See the specs', href: '/specs' },
  }],
  outro: {
    headline: 'Made to move',
    body: 'A final thought.',
    cta: { label: 'Buy Aster', href: '#buy' },
  },
};

describe('colors and config validation', () => {
  it('computes known WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
  });

  it('accepts a complete valid config', () => {
    expect(validateConfig(validConfig)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects unsafe and inaccessible values', () => {
    const result = validateConfig({
      ...validConfig,
      theme: { ...validConfig.theme, text: '#111111', surface: 'rgba(0,0,0,0.2)' },
      overlays: [{
        ...validConfig.overlays[0],
        cta: { label: 'Open', href: 'javascript:alert(1)' },
      }],
    });
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['contrast.text', 'theme.surface-alpha', 'cta.href']),
    );
  });

  it('rejects overlapping holds and font traversal', () => {
    const result = validateConfig({
      ...validConfig,
      theme: {
        ...validConfig.theme,
        fonts: { ...validConfig.theme.fonts, displayFile: 'fonts/../secret.woff2' },
      },
      overlays: [
        validConfig.overlays[0],
        { at: [0.3, 0.5], title: 'Overlap', hold: true },
      ],
    });
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['holds.overlap', 'font.path']),
    );
  });
});
~~~

- [ ] **Step 5: Implement color parsing, URL checks, and validateConfig**

~~~javascript
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*(?:\.\d+)?))?\s*\)$/i,
  );
  if (!rgba) return null;
  const color = {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
  if ([color.r, color.g, color.b].some((channel) => channel < 0 || channel > 255)
      || color.a < 0 || color.a > 1) return null;
  return color;
}

function composite(foreground, background) {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function luminance(color) {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(colorA, colorB, compositeOver) {
  let first = parseColor(colorA);
  let second = parseColor(colorB);
  const background = parseColor(compositeOver ?? '#000000');
  if (!first || !second || !background) return NaN;
  if (first.a < 1) first = composite(first, background);
  if (second.a < 1) second = composite(second, background);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function safeHref(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[\u0000-\u001f]/.test(value)) {
    return false;
  }
  if (/^(#|\/(?!\/)|\.{1,2}\/|\?)/.test(value)) return true;
  try {
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const issue = (code, path, message) => ({ code, path, message });

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const addError = (code, path, message) => errors.push(issue(code, path, message));

  if (!config || typeof config !== 'object') {
    return { errors: [issue('config.type', '', 'Config must be an object.')], warnings };
  }

  if (!config.brand || typeof config.brand.name !== 'string' || !config.brand.name.trim()) {
    addError('brand.name', 'brand.name', 'Brand name is required.');
  }

  const theme = config.theme ?? {};
  const colors = {};
  for (const key of ['bg', 'text', 'accent', 'surface']) {
    colors[key] = parseColor(theme[key]);
    if (!colors[key]) addError('theme.color', 'theme.' + key, 'Expected #rrggbb or rgb/rgba.');
  }
  if (!Number.isFinite(theme.radius) || theme.radius < 0) {
    addError('theme.radius', 'theme.radius', 'Radius must be a non-negative number.');
  }
  if (colors.surface && colors.surface.a < 0.45) {
    addError('theme.surface-alpha', 'theme.surface', 'Surface alpha must be at least 0.45.');
  }
  const displayFile = theme.fonts?.displayFile;
  if (displayFile !== undefined
      && !/^fonts\/(?!.*\.\.)[A-Za-z0-9._-]+\.woff2$/.test(displayFile)) {
    addError('font.path', 'theme.fonts.displayFile', 'Display font must be fonts/<name>.woff2.');
  }
  if (colors.text && colors.bg && contrastRatio(theme.text, theme.bg) < 4.5) {
    addError('contrast.text', 'theme.text', 'Text/background contrast must be at least 4.5:1.');
  }
  if (colors.text && colors.surface && colors.bg
      && contrastRatio(theme.text, theme.surface, theme.bg) < 4.5) {
    addError('contrast.cta', 'theme.surface', 'CTA text/surface contrast must be at least 4.5:1.');
  }

  const frames = config.frames ?? {};
  if (!Number.isInteger(frames.count) || frames.count < 1 || frames.count > 9999) {
    addError('frames.count', 'frames.count', 'Frame count must be an integer from 1 to 9999.');
  } else if (frames.count < 24 || frames.count > 400) {
    warnings.push(issue('frames.budget', 'frames.count', 'Recommended frame count is 24 to 400.'));
  }
  if (typeof frames.pattern !== 'string' || !/\{index:\d+\}/.test(frames.pattern)) {
    addError('frames.pattern', 'frames.pattern', 'Frame pattern requires an {index:N} token.');
  }
  if (typeof frames.poster !== 'string' || !frames.poster.startsWith('frames/')) {
    addError('frames.poster', 'frames.poster', 'Poster must be a path under frames/.');
  }

  if (!Number.isFinite(config.scrub?.heightVh) || config.scrub.heightVh <= 100) {
    addError('scrub.height', 'scrub.heightVh', 'Scrub height must exceed 100vh.');
  }
  if (!Number.isFinite(config.scrub?.smoothing)
      || config.scrub.smoothing < 0 || config.scrub.smoothing >= 1) {
    addError('scrub.smoothing', 'scrub.smoothing', 'Smoothing must be in [0, 1).');
  }

  const overlays = Array.isArray(config.overlays) ? config.overlays : [];
  const holds = [];
  overlays.forEach((overlay, index) => {
    const path = 'overlays[' + index + ']';
    const range = overlay.at;
    if (!Array.isArray(range) || range.length !== 2
        || !range.every(Number.isFinite)
        || range[0] < 0 || range[1] > 1 || range[0] >= range[1]) {
      addError('overlay.range', path + '.at', 'Overlay range must satisfy 0 <= start < end <= 1.');
    } else if (overlay.hold) {
      holds.push({ range, path });
    }
    if (overlay.position !== undefined
        && !['center', 'left', 'right'].includes(overlay.position)) {
      addError('overlay.position', path + '.position', 'Position must be center, left, or right.');
    }
    if (overlay.cta) validateCta(overlay.cta, path + '.cta', addError);
    if (overlay.stats !== undefined) {
      if (!Array.isArray(overlay.stats)) {
        addError('stats.type', path + '.stats', 'Stats must be an array.');
      } else {
        overlay.stats.forEach((stat, statIndex) => {
          if (!stat || !String(stat.value ?? '').trim() || !String(stat.label ?? '').trim()) {
            addError('stats.entry', path + '.stats[' + statIndex + ']',
              'Each stat needs non-empty value and label.');
          }
        });
      }
    }
  });

  holds.sort((a, b) => a.range[0] - b.range[0]);
  for (let index = 1; index < holds.length; index += 1) {
    if (holds[index].range[0] < holds[index - 1].range[1]) {
      addError('holds.overlap', holds[index].path + '.at', 'Hold ranges must not overlap.');
    }
  }
  const holdTotal = holds.reduce(
    (sum, hold) => sum + hold.range[1] - hold.range[0], 0,
  );
  if (holdTotal >= 1) addError('holds.total', 'overlays', 'Holds cannot cover the whole scrub.');

  if (config.outro?.cta) validateCta(config.outro.cta, 'outro.cta', addError);
  return { errors, warnings };
}

function validateCta(cta, path, addError) {
  if (typeof cta.label !== 'string' || !cta.label.trim()) {
    addError('cta.label', path + '.label', 'CTA label is required.');
  }
  if (!safeHref(cta.href)) {
    addError('cta.href', path + '.href', 'CTA href uses an unsupported or unsafe scheme.');
  }
}
~~~

- [ ] **Step 6: Run the complete scrub-core suite**

Run: npm run test:unit -- tests/unit/scrub-core.test.mjs

Expected: PASS for all mapping, geometry, windowing, contrast, and validation cases.

- [ ] **Step 7: Commit**

~~~bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: add tested scrub core"
~~~
