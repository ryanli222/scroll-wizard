# Scroll Wizard v3 â€” Plan 3: Functional Components + Cinematic-Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before each completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an approval-gated motion plan that turns approved beats into one or more stitchable video clips, then make the generated page functional: nav pills, waypoint stepper, frame-pinned hotspots, spec-row jumps, a gallery lightbox, a config picker, and wired email capture â€” all riding one interruptible cinematic-jump that animates scroll (and therefore the final stitched scrub) to a beat.

**Architecture:** A new `motion-plan` hard gate follows the approved storyboard: the user supplies only their provider's maximum per-clip duration, `scripts/motion-plan.mjs` derives a deterministic beat-aware sequence of clips, and `prompts/motion-plan.json` becomes the reviewable, hashed artifact. Adjacent clips carry an explicit last-frame-to-first-frame continuity handoff and are stitched into the existing single scrub asset after generation. The page runtime remains two modules: `template/jump.js` owns the cinematic-jump; `template/interactions.js` owns all component wiring and is called once from `scrub-engine.js` after `renderSections`. Pure math (`jumpDuration`, `beatTargetY`) and all schema validation extend `template/scrub-core.js` so Node unit tests cover them without a browser.

**Tech Stack:** Static HTML/CSS, vanilla ES modules, bundled Lenis 1.3.25 (`template/lenis.js`, exposed as `globalThis.Lenis`), native `<dialog>` for the lightbox, native constraint validation for email. Node 20+, Vitest, Playwright Chromium. No build step, framework, or new runtime dependency.

## Global Constraints

- Implement spec subsystem 3 (spec Â§6â€“Â§7) plus this approved corrective addition: the `motion-plan` gate, beat-aware clip planning, and stitch handoff metadata. Do not add paid routes, invoke providers, or alter `.pen` scaffolding (Plans 4â€“5).
- Preserve Plan 1 and Plan 2 behavior: direction presets, overlay variants/anchors, annotation point mapping, section assembly/synthesis, section rendering, `view()` reveals, and reduced-motion behavior.
- Static vanilla-JS output only. No build step, framework, runtime package, or polyfill. React never enters the template.
- "Scroll motion is the product" (spec focus contract): every component in this plan must feed or ride the scroll motion. No standalone-app behavior.
- Cinematic-jump mechanism (spec Â§7, locked): `lenis.scrollTo(targetY, { duration, easing })` where `duration = clamp(minMs, distancePx / pxPerMs, maxMs)` with defaults `{ minMs: 500, maxMs: 1400, pxPerMs: 2.2 }` (config `scrub.jump` overrides), eased `easeInOutCubic`.
- **Interruptible (hard requirement):** any manual wheel/touch/keyboard scroll or a second click cancels the in-flight jump and hands control back to scroll immediately. No input lockout at any point.
- **Reduced motion:** cinematic-jump becomes an instant scroll set. No fast fly-through. All new components stay fully operable.
- All new components are keyboard-accessible: real `<button>`/`<dialog>` elements where possible; any ARIA role-button carries `tabindex="0"` plus Enter/Space handling; hotspot hit targets â‰¥ 44Ã—44 px.
- Craft rules (spec Â§2.3): `:active { transform: scale(0.97) }` on every new pressable; popovers/chrome stay crisp (no entrance animation on frequently clicked chrome); animate only `transform`/`opacity`; the tint swap must not write a CSS variable on a shared ancestor per frame â€” it is a one-shot `background-color` + `opacity` transition on a dedicated tint layer.
- The per-frame scrub hot path (`tick` in `scrub-engine.js`) must not gain work. All interaction wiring is event-driven; the only new scroll-coupled work is Lenis's own scrollTo animation.
- Schema changes are additive and backward-compatible: `hotspots`, `config`, `scrub.jump`, `sections[].navLabel`, and `cta.emailAction` are all optional; absent fields change nothing.
- Never hand-edit generated `site/` files. Modify source templates and rerun the scaffold.
- Browser media fixtures must remain VP9 WebM-compatible with Playwright Chromium.
- Run focused RED/GREEN tests during each task. Before completion run `npx vitest run` and `npx playwright test`.
## Locked Motion-Plan Gate Contract (corrective addition)

- Insert a hard `motion-plan` gate after `storyboard` and before `stills-preview`. It is required for video generation, but frame-only projects (`values.generation.video === false`) retain the existing status flow and do not need a motion plan.
- At the gate, ask for exactly one user input: `maxClipDurationSeconds`, a finite number from 2 through 15. It means the provider's maximum duration for one generated clip; it is not a request for a fixed total duration.
- `scripts/motion-plan.mjs create <projectDir> --max-clip-seconds N` reads the approved beat prompts and `values.json`, writes `prompts/motion-plan.json`, and never calls a provider or spends money.
- The persisted JSON contains `maxClipDurationSeconds`, `totalDurationSeconds`, `clips`, and `continuity`. Each clip has a 1-based `index`, `durationSeconds <= maxClipDurationSeconds`, and inclusive `beatStart`/`beatEnd` indexes. `continuity` has one entry per clip boundary declaring `{ fromClip, toClip, handoff: "last-frame-to-first-frame" }`.
- Duration heuristic is deterministic: ordinary beats cost 2 seconds; a beat with `motion: "high"` costs 4 seconds; missing `motion` means ordinary. The total is the sum of beat costs. Pack contiguous beats greedily without exceeding the supplied maximum; a high-motion beat that cannot fit alone is rejected with a clear error. The first clip starts from the approved first keyframe; every following clip uses the preceding clip's final frame as its first-frame reference.
- `status.mjs --approve motion-plan` hashes `prompts/motion-plan.json` and the storyboard manifest. Editing the maximum, beat prompts, or motion-plan artifact invalidates the receipt. `video` approval requires a current `motion-plan` receipt in video mode.
- Provider calls remain outside this plan, but stitching is included: after the approved clips are generated, `scripts/stitch-video.mjs` validates their count/order against `prompts/motion-plan.json`, concatenates them, and emits the existing single `input/video.mp4` asset. The final site therefore continues to consume one stitched video through `media/video.mp4` and `media/media.json`.

---

### Task 0: Add the beat-aware motion-plan approval gate

**Files:**

- Create: `scripts/motion-plan.mjs`
- Create: `scripts/stitch-video.mjs`
- Modify: `scripts/status.mjs`
- Modify: `SKILL.md`
- Modify: `README.md`
- Test: `tests/unit/motion-plan.test.mjs`
- Test: `tests/unit/stitch-video.test.mjs`
- Test: `tests/unit/status.test.mjs`
- Test: `tests/unit/skill-workflow.test.mjs`

**Interfaces:**

- Consumes: `values.json` (`generation.video`, optional beat `motion`), `prompts/keyframe-beat-*.txt`, and the approved storyboard gate.
- Produces: `export function planMotionClips(beats, maxClipDurationSeconds)`, `export async function createMotionPlan(projectDir, maxClipDurationSeconds)`, and `export async function stitchVideo(projectDir)`; `prompts/motion-plan.json`; `input/video.mp4`; `motion-plan` in `GATES`.

- [ ] **Step 1: Write the failing motion-plan tests**

Create `tests/unit/motion-plan.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { planMotionClips } from '../../scripts/motion-plan.mjs';

describe('planMotionClips', () => {
  it('derives total duration and greedy stitchable clips from beat demand', () => {
    expect(planMotionClips([
      { motion: 'ordinary' }, { motion: 'high' }, { motion: 'ordinary' },
    ], 6)).toEqual({
      maxClipDurationSeconds: 6,
      totalDurationSeconds: 8,
      clips: [
        { index: 1, durationSeconds: 6, beatStart: 1, beatEnd: 2 },
        { index: 2, durationSeconds: 2, beatStart: 3, beatEnd: 3 },
      ],
      continuity: [{ fromClip: 1, toClip: 2, handoff: 'last-frame-to-first-frame' }],
    });
  });

  it('uses ordinary motion when a beat has no motion field', () => {
    expect(planMotionClips([{}, {}], 8).totalDurationSeconds).toBe(4);
  });

  it('rejects an invalid maximum or a beat that cannot fit in one clip', () => {
    expect(() => planMotionClips([{}], 1)).toThrow(/2.*15/);
    expect(() => planMotionClips([{ motion: 'high' }], 3)).toThrow(/high-motion beat/i);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/motion-plan.test.mjs`

Expected: FAIL because `scripts/motion-plan.mjs` does not exist.

- [ ] **Step 3: Implement the pure planner and persisted artifact command**

Create `scripts/motion-plan.mjs` with the exact exported planner contract above. Validate `maxClipDurationSeconds` as finite and within `[2, 15]`; map `motion === 'high'` to `4` seconds and every other value to `2`; greedily pack contiguous beats; derive continuity entries from the resulting clip count. Its CLI accepts only `create <projectDir> --max-clip-seconds N`, reads the project beat prompts in numeric order, writes `prompts/motion-plan.json` atomically, and prints the JSON artifact. It must never make a provider call.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/motion-plan.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write the failing stitch tests and implement the stitch command**

Create `tests/unit/stitch-video.test.mjs` covering: a motion plan with two clips requires exactly `input/clips/clip-01.mp4` and `input/clips/clip-02.mp4`; a missing or extra numbered clip fails before `ffmpeg` runs; and two valid clips invoke `ffmpeg` with a concat-demuxer manifest, `-c copy`, and output `input/video.mp4`. Export `stitchVideo(projectDir, runner)` from `scripts/stitch-video.mjs`; it reads `prompts/motion-plan.json`, verifies the expected numbered clips, writes its concat manifest in the project temp directory, runs `ffmpeg`, validates the resulting video with the existing `validate-media.mjs` helper, and atomically replaces `input/video.mp4`. It must preserve the source clips for inspection and must not call a provider.

Run: `npx vitest run tests/unit/stitch-video.test.mjs`

Expected: PASS after the implementation.

- [ ] **Step 6: Write failing status and workflow tests**

Add assertions that `GATES` is exactly:

```js
['brief', 'storyboard', 'motion-plan', 'stills-preview', 'video', 'extraction', 'theme', 'preview']
```

Add a status test that approves `brief` and `storyboard`, creates `prompts/motion-plan.json`, approves `motion-plan`, edits its `maxClipDurationSeconds`, and expects `status()` to report `motion-plan` as `needs re-review`. Add a video-mode test that `approveGate(projectDir, 'video')` rejects when the motion-plan receipt is absent. Add a frame-only test (`generation: { video: false }`) proving the new gate is skipped. Update `tests/unit/skill-workflow.test.mjs` to require the workflow to ask for the user's maximum clip duration, show the derived clip/cost plan, and end the turn for explicit `motion-plan` approval before any video-generation call.

- [ ] **Step 7: Implement gate ordering and manifest rules**

In `scripts/status.mjs`, insert `motion-plan` after `storyboard`; make its manifest contain `prompts/motion-plan.json` plus the storyboard manifest; require a current `motion-plan` receipt before `video` in video mode; retain the frame-only skip. Update status resume numbering and all gate-chain calculations accordingly. In `SKILL.md`, add the hard gate table row and the exact interaction: ask only for maximum per-clip seconds, create and summarize the artifact, recommend the plan, request approval, then record `--approve motion-plan`. Document the command and artifact in `README.md`.

- [ ] **Step 8: Run focused gate tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/motion-plan.test.mjs tests/unit/stitch-video.test.mjs tests/unit/status.test.mjs tests/unit/skill-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit Task 0**

```bash
git add scripts/motion-plan.mjs scripts/stitch-video.mjs scripts/status.mjs SKILL.md README.md tests/unit/motion-plan.test.mjs tests/unit/stitch-video.test.mjs tests/unit/status.test.mjs tests/unit/skill-workflow.test.mjs
git commit -m "feat: add motion-plan approval gate"
```

---

## Locked Schema Contract (additive)

```jsonc
{
  "scrub": {
    // existing v2 fields unchanged; new optional tuning block:
    "jump": { "minMs": 500, "maxMs": 1400, "pxPerMs": 2.2 }
  },
  "hotspots": [
    { "point": [0.62, 0.44], "target": 1, "label": "Cell" }
  ],
  "config": {
    "options": [
      { "id": "graphite", "label": "Graphite",
        "poster": "media/poster-graphite.webp",   // optional, safe image path
        "src": "media/video-graphite.webm",       // optional, safe video path
        "tint": "#333333" }                        // optional, #rrggbb or rgb/rgba
    ]
  },
  "sections": [
    { "type": "spec", "navLabel": "Specs", "rows": [{ "label": "â€¦", "value": "â€¦", "beat": 1 }] }
  ]
}
```

Contract details:

- `hotspots` is an optional array. Each hotspot requires `point` (`[x, y]`, each in `[0, 1]`), integer `target` with `0 <= target < overlays.length`, and non-empty `label`. Error codes: `hotspots.type`, `hotspot.point`, `hotspot.target`, `hotspot.label`.
- `config.options` is an optional array of at least one option. Each option requires non-empty `id` (unique across options) and `label`; optional `poster` (safe image path), `src` (safe `media/*.mp4|webm` path), `tint` (parseable color). Error codes: `config.type`, `config.options`, `config.id`, `config.id-duplicate`, `config.label`, `config.poster`, `config.src`, `config.tint`. The picker renders only when `register !== "full3d"` (product register only, spec Â§6); a `config` block on a full3d config is a validation **warning** `config.register`, not an error.
- `scrub.jump`, when present, must be an object whose `minMs`/`maxMs`/`pxPerMs` are each, when present, finite and `> 0`, with `minMs <= maxMs`. Error code: `scrub.jump`.
- Any section may carry optional `navLabel` (non-empty string). Sections with `navLabel` become nav pills in declared order. Error code: `section.nav-label`.
- A `cta` section may carry optional `emailAction` (validated by the existing `safeHref`). When present the email form posts natively to it; when absent a valid submit is intercepted and an inline confirmation renders (no network). Error code: `section.email-action`.
- `spec` rows' `beat`, `gallery` items' `beat`, and `hotspots[].target` must all be `< overlays.length` when overlays exist; when `overlays` is absent/empty, any beat reference is an error. Error codes: `spec.beat-range`, `gallery.beat-range`, `hotspot.target`.

## Locked Jump Math

Pure, in `template/scrub-core.js`:

- `jumpDuration(distancePx, jump = {})` â†’ milliseconds. `clamp(minMs, |distancePx| / pxPerMs, maxMs)` with defaults `{ minMs: 500, maxMs: 1400, pxPerMs: 2.2 }` filled per-field from `jump`. Non-finite `distancePx` returns `minMs`.
- `beatTargetY(at, sectionTop, sectionHeight, viewportH)` â†’ the `scrollY` at which the existing `scrollProgress(scrollY, sectionTop, sectionHeight, viewportH)` equals the midpoint of `at` â€” i.e. `sectionTop + ((at[0] + at[1]) / 2) * (sectionHeight - viewportH)`. Returns `sectionTop` when the section has no scroll distance. Overlay `at` ranges are in **raw** progress space (the engine feeds raw progress to `overlayOpacity`), so no hold/linger compensation belongs here.

## Locked Interruption Semantics

`createJump` (in `template/jump.js`) exposes `{ toY(targetY), cancel(), active }`:

- `toY` with Lenis and no reduced motion: `lenis.scrollTo(targetY, { duration: jumpDuration(targetY - win.scrollY, tuning) / 1000, easing: easeInOutCubic, onComplete })` (Lenis durations are **seconds**). While a jump is in flight, one-shot `wheel` / `touchstart` / `keydown` window listeners call `cancel()`.
- `cancel()`: `lenis.scrollTo(win.scrollY, { immediate: true })` â€” retargets the tween to the current position instantly, which ends the programmatic scroll and leaves native/Lenis scrolling live. Listeners are removed.
- A second `toY` while active simply retargets (transitions, not keyframes â€” spec Â§2.3): no cancel-then-wait.
- Reduced motion or `lenis == null`: `win.scrollTo(0, targetY)` â€” instant set, `active` never becomes true.

---

### Task 1: Pure jump helpers

**Files:**

- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**

- Consumes: existing `scrollProgress` (for the inverse relationship), module-local `clamp`.
- Produces: `export function jumpDuration(distancePx, jump = {})` â†’ number (ms); `export function beatTargetY(at, sectionTop, sectionHeight, viewportH)` â†’ number (scrollY px). Later tasks import both by these exact names.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/scrub-core.test.mjs` (import `jumpDuration`, `beatTargetY`, and the existing `scrollProgress` from `../../template/scrub-core.js`):

```js
describe('jumpDuration', () => {
  it('scales with distance between the bounds', () => {
    expect(jumpDuration(2200)).toBe(1000); // 2200 / 2.2
  });

  it('clamps to minMs and maxMs', () => {
    expect(jumpDuration(10)).toBe(500);
    expect(jumpDuration(1_000_000)).toBe(1400);
  });

  it('uses absolute distance for upward jumps', () => {
    expect(jumpDuration(-2200)).toBe(1000);
  });

  it('honors per-field tuning overrides', () => {
    expect(jumpDuration(10, { minMs: 100 })).toBe(100);
    expect(jumpDuration(2200, { pxPerMs: 1.1, maxMs: 3000 })).toBe(2000);
  });

  it('returns minMs for non-finite distance', () => {
    expect(jumpDuration(NaN)).toBe(500);
  });
});

describe('beatTargetY', () => {
  it('is the inverse of scrollProgress at the beat midpoint', () => {
    const y = beatTargetY([0.4, 0.6], 800, 3000, 900); // midpoint 0.5
    expect(y).toBe(800 + 0.5 * (3000 - 900));
    expect(scrollProgress(y, 800, 3000, 900)).toBeCloseTo(0.5, 10);
  });

  it('returns sectionTop when the section has no scroll distance', () => {
    expect(beatTargetY([0, 1], 800, 900, 900)).toBe(800);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/scrub-core.test.mjs -t "jumpDuration"
npx vitest run tests/unit/scrub-core.test.mjs -t "beatTargetY"
```

Expected: FAIL â€” the functions are not exported.

- [ ] **Step 3: Implement the helpers**

In `template/scrub-core.js`, after `recommendHeightVh`:

```js
export function jumpDuration(distancePx, jump = {}) {
  const minMs = jump.minMs ?? 500;
  const maxMs = jump.maxMs ?? 1400;
  const pxPerMs = jump.pxPerMs ?? 2.2;
  if (!Number.isFinite(distancePx)) return minMs;
  return clamp(Math.abs(distancePx) / pxPerMs, minMs, maxMs);
}

export function beatTargetY(at, sectionTop, sectionHeight, viewportH) {
  const distance = sectionHeight - viewportH;
  if (distance <= 0) return sectionTop;
  return sectionTop + ((at[0] + at[1]) / 2) * distance;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Same commands as Step 2. Expected: PASS.

- [ ] **Step 5: Run the complete core suite**

```bash
npx vitest run tests/unit/scrub-core.test.mjs
```

Expected: PASS with no regressions.

- [ ] **Step 6: Commit Task 1**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: add cinematic-jump math helpers"
```

---

### Task 2: Validate the interaction schema

**Files:**

- Modify: `template/scrub-core.js`
- Modify: `tests/browser/fixture-server.mjs` (see Step 4a â€” the Plan 2 fixture references beat 1 with only one overlay, which this task's beat-range rule correctly rejects)
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**

- Consumes: existing `validateConfig`, `issue`/`addError` pattern, `safeHref`, the module-local `safeVideoPath`/`safeImagePath` helpers, `parseColor`, `nonEmptyString`.
- Produces: `validateConfig` emits the error/warning codes listed in the Locked Schema Contract. No error for absent optional fields.

- [ ] **Step 1: Write the failing tests**

Add a `describe('validateConfig interactions', ...)` block. Cover every code from the Locked Schema Contract:

```js
describe('validateConfig interactions', () => {
  const base = () => structuredClone(validConfig); // has >= 1 overlay

  it('accepts absent hotspots, config, scrub.jump, navLabel, emailAction', () => {
    const { errors } = validateConfig(base());
    expect(errors).toEqual([]);
  });

  it('accepts a valid hotspot', () => {
    const config = { ...base(), hotspots: [{ point: [0.6, 0.4], target: 0, label: 'Cell' }] };
    expect(validateConfig(config).errors).toEqual([]);
  });

  it('rejects hotspot with bad point, out-of-range target, or empty label', () => {
    const config = {
      ...base(),
      hotspots: [
        { point: [1.4, 0.4], target: 0, label: 'A' },
        { point: [0.5, 0.5], target: 99, label: 'B' },
        { point: [0.5, 0.5], target: 0, label: ' ' },
      ],
    };
    const codes = validateConfig(config).errors.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'hotspot.point', 'hotspot.target', 'hotspot.label',
    ]));
  });

  it('rejects non-array hotspots', () => {
    const { errors } = validateConfig({ ...base(), hotspots: {} });
    expect(errors).toContainEqual(expect.objectContaining({ code: 'hotspots.type' }));
  });

  it('accepts a valid config picker and rejects duplicates/bad paths', () => {
    const good = {
      ...base(),
      config: { options: [
        { id: 'a', label: 'A', tint: '#333333' },
        { id: 'b', label: 'B', poster: 'media/poster-b.webp', src: 'media/b.webm' },
      ] },
    };
    expect(validateConfig(good).errors).toEqual([]);
    const bad = {
      ...base(),
      config: { options: [
        { id: 'a', label: 'A' },
        { id: 'a', label: '', poster: '../x.webp', src: 'media/x.txt', tint: 'blurple' },
      ] },
    };
    const codes = validateConfig(bad).errors.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'config.id-duplicate', 'config.label', 'config.poster', 'config.src', 'config.tint',
    ]));
  });

  it('warns (not errors) on a config picker under full3d', () => {
    const config = {
      ...base(),
      register: 'full3d', archetype: 'teardown', direction: 'technical',
      config: { options: [{ id: 'a', label: 'A' }] },
    };
    const { errors, warnings } = validateConfig(config);
    expect(errors).toEqual([]);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'config.register' }));
  });

  it('validates scrub.jump tuning', () => {
    const bad = { ...base(), scrub: { ...base().scrub, jump: { minMs: 900, maxMs: 400 } } };
    expect(validateConfig(bad).errors)
      .toContainEqual(expect.objectContaining({ code: 'scrub.jump' }));
    const good = { ...base(), scrub: { ...base().scrub, jump: { pxPerMs: 3 } } };
    expect(validateConfig(good).errors).toEqual([]);
  });

  it('rejects beat references beyond the overlay count', () => {
    const overlayCount = base().overlays.length;
    const config = {
      ...base(),
      hotspots: [{ point: [0.5, 0.5], target: overlayCount, label: 'X' }],
      sections: [
        { type: 'scrub-hero' },
        { type: 'spec', rows: [{ label: 'L', value: 'V', beat: overlayCount }] },
        { type: 'gallery', items: [{ beat: overlayCount }] },
      ],
    };
    const codes = validateConfig(config).errors.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'hotspot.target', 'spec.beat-range', 'gallery.beat-range',
    ]));
  });

  it('validates navLabel and cta emailAction', () => {
    const config = {
      ...base(),
      sections: [
        { type: 'scrub-hero', navLabel: ' ' },
        { type: 'cta', headline: 'Go', emailCapture: true, emailAction: 'javascript:alert(1)' },
      ],
    };
    const codes = validateConfig(config).errors.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'section.nav-label', 'section.email-action',
    ]));
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/scrub-core.test.mjs -t "validateConfig interactions"
```

Expected: FAIL.

- [ ] **Step 3: Implement the validation**

In `validateConfig`, after the existing `sections` block (note: overlay count is known there):

```js
const overlayCount = overlays.length;
const validBeat = (beat) => Number.isInteger(beat) && beat >= 0 && beat < overlayCount;

if (config.hotspots !== undefined) {
  if (!Array.isArray(config.hotspots)) {
    addError('hotspots.type', 'hotspots', 'Hotspots must be an array.');
  } else {
    config.hotspots.forEach((hotspot, index) => {
      const path = 'hotspots[' + index + ']';
      const pt = hotspot?.point;
      if (!Array.isArray(pt) || pt.length !== 2
          || !pt.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
        addError('hotspot.point', path + '.point', 'Hotspot point must be [x, y] in [0, 1].');
      }
      if (!validBeat(hotspot?.target)) {
        addError('hotspot.target', path + '.target',
          'Hotspot target must index an existing overlay beat.');
      }
      if (!nonEmptyString(hotspot?.label)) {
        addError('hotspot.label', path + '.label', 'Hotspot label is required.');
      }
    });
  }
}

if (config.config !== undefined) {
  const picker = config.config;
  if (!picker || typeof picker !== 'object' || Array.isArray(picker)
      || !Array.isArray(picker.options) || picker.options.length === 0) {
    addError('config.options', 'config.options', 'Config picker needs a non-empty options array.');
  } else {
    const seen = new Set();
    picker.options.forEach((option, index) => {
      const path = 'config.options[' + index + ']';
      if (!nonEmptyString(option?.id)) {
        addError('config.id', path + '.id', 'Config option id is required.');
      } else if (seen.has(option.id)) {
        addError('config.id-duplicate', path + '.id', 'Config option ids must be unique.');
      } else {
        seen.add(option.id);
      }
      if (!nonEmptyString(option?.label)) {
        addError('config.label', path + '.label', 'Config option label is required.');
      }
      if (option?.poster !== undefined && !safeImagePath(option.poster)) {
        addError('config.poster', path + '.poster', 'Config option poster path is invalid.');
      }
      if (option?.src !== undefined && !safeVideoPath(option.src)) {
        addError('config.src', path + '.src', 'Config option src must be media/*.mp4|webm.');
      }
      if (option?.tint !== undefined && !parseColor(option.tint)) {
        addError('config.tint', path + '.tint', 'Config option tint must be a color.');
      }
    });
    if (config.register === 'full3d') {
      warnings.push(issue('config.register', 'config',
        'Config picker is a product-register component; it will not render under full3d.'));
    }
  }
}

const jump = config.scrub?.jump;
if (jump !== undefined) {
  const fieldOk = (value) => value === undefined || (Number.isFinite(value) && value > 0);
  const min = jump?.minMs ?? 500;
  const max = jump?.maxMs ?? 1400;
  if (!jump || typeof jump !== 'object' || Array.isArray(jump)
      || !fieldOk(jump.minMs) || !fieldOk(jump.maxMs) || !fieldOk(jump.pxPerMs)
      || min > max) {
    addError('scrub.jump', 'scrub.jump',
      'Jump tuning needs positive minMs/maxMs/pxPerMs with minMs <= maxMs.');
  }
}
```

Then extend `validateSection` (it needs the overlay count â€” change its signature to `validateSection(section, path, addError, overlayCount)` and pass `overlays.length` from the `sections` loop in `validateConfig`):

- every type: `if (section.navLabel !== undefined && !nonEmptyString(section.navLabel)) addError('section.nav-label', path + '.navLabel', 'navLabel must be a non-empty string.');`
- spec rows, after the existing `spec.beat` check: `if (Number.isInteger(row.beat) && row.beat >= 0 && row.beat >= overlayCount) addError('spec.beat-range', rowPath + '.beat', 'Spec beat must index an existing overlay.');`
- gallery items, same pattern with code `gallery.beat-range`;
- cta: `if (section.emailAction !== undefined && !safeHref(section.emailAction)) addError('section.email-action', path + '.emailAction', 'emailAction must be a safe URL.');`

- [ ] **Step 4: Run the focused tests and verify GREEN**

```bash
npx vitest run tests/unit/scrub-core.test.mjs -t "validateConfig interactions"
```

Expected: PASS.

- [ ] **Step 4a: Fix the Plan 2 browser fixture the new rule exposes**

`sectionsConfig` in `tests/browser/fixture-server.mjs` references `beat: 1` in its spec row and gallery item, but its base config has only **one** overlay â€” under the new `spec.beat-range`/`gallery.beat-range` rules that config is now (correctly) invalid and the sections fixture would render a fatal error in the browser suite. Change both beats to `0`:

```js
{ type: 'spec', headline: 'Fixture spec', rows: [{ label: 'Battery', value: '18 h', beat: 0 }] },
{ type: 'gallery', headline: 'Fixture gallery', items: [{ src: 'frames/frame-0001.webp', alt: 'Fixture gallery image', beat: 0 }] },
```

If any assertion in `tests/browser/sections.spec.mjs` pins `data-beat="1"`, update it to `data-beat="0"` in the same change. (`template/config.json` is already valid: it has three overlays.)

- [ ] **Step 5: Run the complete core suite**

```bash
npx vitest run tests/unit/scrub-core.test.mjs
```

Expected: PASS â€” all Plan 1/2 validation tests unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs tests/browser/fixture-server.mjs
git commit -m "feat: validate interaction schema"
```

---

### Task 3: Cinematic-jump runtime

**Files:**

- Create: `template/jump.js`
- Create: `tests/unit/jump.test.mjs`

**Interfaces:**

- Consumes: `jumpDuration` from `./scrub-core.js` (Task 1).
- Produces:

```js
export function easeInOutCubic(t) {}
export function createJump({ lenis, win = globalThis, reducedMotion = false, tuning = {} }) {}
// â†’ { toY(targetY), cancel(), get active() }
```

Dependency-injected (`lenis`, `win`) so Vitest tests it with stubs â€” no jsdom.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/jump.test.mjs`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createJump, easeInOutCubic } from '../../template/jump.js';

function fakeWin() {
  const listeners = new Map();
  return {
    scrollY: 0,
    scrollTo(x, y) { this.scrollY = y; },
    addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    fire(type) { listeners.get(type)?.(); },
    listeners,
  };
}

describe('easeInOutCubic', () => {
  it('matches the standard curve at key points', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeCloseTo(4 * 0.25 ** 3, 10);
  });
});

describe('createJump', () => {
  it('drives lenis.scrollTo with seconds duration and easing', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    win.scrollY = 0;
    jump.toY(2200);
    expect(lenis.scrollTo).toHaveBeenCalledWith(2200, expect.objectContaining({
      duration: 1, // jumpDuration(2200) = 1000ms
      easing: easeInOutCubic,
    }));
    expect(jump.active).toBe(true);
  });

  it('cancel retargets to the current position immediately', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    win.scrollY = 750;
    jump.cancel();
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(750, { immediate: true });
    expect(jump.active).toBe(false);
  });

  it('manual wheel input cancels the in-flight jump', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    win.fire('wheel');
    expect(jump.active).toBe(false);
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(win.scrollY, { immediate: true });
  });

  it('a second toY retargets without cancelling', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    jump.toY(400);
    expect(jump.active).toBe(true);
    expect(lenis.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('onComplete removes interrupt listeners and clears active', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn((_y, opts) => opts.onComplete?.()) };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    expect(jump.active).toBe(false);
    expect(win.listeners.size).toBe(0);
  });

  it('is an instant set under reduced motion', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win, reducedMotion: true });
    jump.toY(2200);
    expect(lenis.scrollTo).not.toHaveBeenCalled();
    expect(win.scrollY).toBe(2200);
    expect(jump.active).toBe(false);
  });

  it('is an instant set when lenis is absent', () => {
    const win = fakeWin();
    const jump = createJump({ lenis: null, win });
    jump.toY(900);
    expect(win.scrollY).toBe(900);
  });
});
```

- [ ] **Step 2: Run the new suite and verify RED**

```bash
npx vitest run tests/unit/jump.test.mjs
```

Expected: FAIL â€” `template/jump.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `template/jump.js`:

```js
import { jumpDuration } from './scrub-core.js';

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

const INTERRUPTS = ['wheel', 'touchstart', 'keydown'];

export function createJump({ lenis, win = globalThis, reducedMotion = false, tuning = {} }) {
  let active = false;

  const onInterrupt = () => cancel();

  function listen() {
    for (const type of INTERRUPTS) {
      win.addEventListener(type, onInterrupt, { passive: true });
    }
  }

  function unlisten() {
    for (const type of INTERRUPTS) win.removeEventListener(type, onInterrupt);
  }

  function settle() {
    active = false;
    unlisten();
  }

  function cancel() {
    if (!active) return;
    settle();
    lenis.scrollTo(win.scrollY, { immediate: true });
  }

  function toY(targetY) {
    if (reducedMotion || !lenis) {
      win.scrollTo(0, targetY);
      return;
    }
    if (!active) {
      active = true;
      listen();
    }
    lenis.scrollTo(targetY, {
      duration: jumpDuration(targetY - win.scrollY, tuning) / 1000,
      easing: easeInOutCubic,
      onComplete: settle,
    });
  }

  return { toY, cancel, get active() { return active; } };
}
```

- [ ] **Step 4: Run the new suite and verify GREEN**

```bash
npx vitest run tests/unit/jump.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add template/jump.js tests/unit/jump.test.mjs
git commit -m "feat: add interruptible cinematic-jump runtime"
```

---

### Task 4: Interactions module â€” nav pills, waypoint stepper, engine integration

**Files:**

- Create: `template/interactions.js`
- Modify: `template/scrub-engine.js`
- Test: `tests/unit/template.test.mjs`

**Interfaces:**

- Consumes: `createJump` from `./jump.js` (Task 3), `beatTargetY` from `./scrub-core.js` (Task 1), `renderSections`'s `{ sectionNodes, formNodes }` return value, the assembled `sections` array.
- Produces:

```js
export function installInteractions({
  config,        // validated config object
  sections,      // assembled section data array (same order as sectionNodes)
  sectionNodes,  // DOM nodes returned by renderSections
  formNodes,     // email <form> nodes returned by renderSections
  scrubElement,  // #scrub (may be detached when composition omits scrub-hero)
  overlayLayer,  // #overlay-layer
  lenis,         // Lenis instance or null
  reducedMotion, // boolean
}) {}
// â†’ { jump } (the createJump instance, reused by Tasks 5â€“8 wiring inside this module)
```

DOM contract produced by this task:

- `<nav id="site-nav" class="site-nav" aria-label="Sections">` appended to `document.body` only when â‰¥ 1 section has `navLabel`; one `<button type="button" class="site-nav__pill">` per labeled section, `data-target-index` = the section index.
- `<button type="button" id="waypoint-stepper" class="waypoint-stepper">` appended to `document.body` only when `config.register === 'full3d'` and `config.overlays?.length >= 1`; `aria-label="Next waypoint"`.
- Clicking a pill jumps to that section's top (`node.offsetTop`); clicking the stepper jumps to the first overlay beat whose target Y is more than 4px below the current scroll, wrapping to the first beat past the end.

- [ ] **Step 1: Write the failing source-contract tests**

Add a `describe('interactions', ...)` block to `tests/unit/template.test.mjs` (this file asserts on source text; follow its existing pattern of reading template files with `readFileSync`):

```js
describe('interactions', () => {
  const interactions = readFileSync(new URL('../../template/interactions.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../../template/scrub-engine.js', import.meta.url), 'utf8');

  it('exports installInteractions and builds nav/stepper chrome', () => {
    expect(interactions).toMatch(/export function installInteractions/);
    expect(interactions).toMatch(/site-nav/);
    expect(interactions).toMatch(/waypoint-stepper/);
    expect(interactions).toMatch(/createJump/);
    expect(interactions).toMatch(/beatTargetY/);
  });

  it('engine wires interactions after rendering sections', () => {
    expect(engine).toMatch(/import \{ installInteractions \} from '\.\/interactions\.js'/);
    expect(engine).toMatch(/installInteractions\(/);
  });

  it('adds no scroll listeners in interactions', () => {
    expect(interactions).not.toMatch(/addEventListener\(\s*['"]scroll['"]/);
    expect(interactions).not.toMatch(/\bonscroll\b/);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
```

Expected: FAIL.

- [ ] **Step 3: Create `template/interactions.js` with nav + stepper**

```js
import { beatTargetY } from './scrub-core.js';
import { createJump } from './jump.js';

function button(className, label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}

function beatY(config, scrubElement, index) {
  return beatTargetY(
    config.overlays[index].at,
    scrubElement.offsetTop, scrubElement.offsetHeight, innerHeight,
  );
}

function installNav({ sections, sectionNodes, jump }) {
  const labeled = sections
    .map((data, index) => ({ data, node: sectionNodes[index], index }))
    .filter(({ data, node }) => data.navLabel && node?.isConnected);
  if (!labeled.length) return;
  const nav = document.createElement('nav');
  nav.id = 'site-nav';
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Sections');
  for (const { data, node, index } of labeled) {
    const pill = button('site-nav__pill', data.navLabel);
    pill.dataset.targetIndex = String(index);
    pill.addEventListener('click', () => jump.toY(node.offsetTop));
    nav.append(pill);
  }
  document.body.append(nav);
}

function installStepper({ config, scrubElement, jump }) {
  if (config.register !== 'full3d' || !(config.overlays?.length >= 1)
      || !scrubElement.isConnected) return;
  const stepper = button('waypoint-stepper');
  stepper.id = 'waypoint-stepper';
  stepper.setAttribute('aria-label', 'Next waypoint');
  stepper.addEventListener('click', () => {
    const targets = config.overlays.map((_overlay, index) =>
      beatY(config, scrubElement, index));
    const next = targets.find((y) => y > scrollY + 4) ?? targets[0];
    jump.toY(next);
  });
  document.body.append(stepper);
}

export function installInteractions(deps) {
  const { config, lenis, reducedMotion } = deps;
  const jump = createJump({
    lenis, reducedMotion, tuning: config.scrub?.jump ?? {},
  });
  installNav({ ...deps, jump });
  installStepper({ ...deps, jump });
  return { jump };
}
```

- [ ] **Step 4: Integrate into `scrub-engine.js`**

Add the import next to the section imports:

```js
import { installInteractions } from './interactions.js';
```

In `start()`, capture the render result and the Lenis instance, then install interactions **before** the reduced-motion early return so components stay operable (instant jumps):

```js
const sections = assembleSections(config);
const { sectionNodes, formNodes } = renderSections({
  container: sectionContainer, scrubElement: scrub, outroElement: outro,
  sections, poster: currentPoster(config),
});
```

Move the Lenis construction up so it exists before `installInteractions` (keep the `reducedMotion` guard â€” no Lenis under reduced motion), then after the try/catch block and the `if (!scrub.isConnected) return;` guard is **removed from before interactions** (interactions must run even when the composition omits the scrub):

```js
let lenis = null;
if (!reducedMotion && globalThis.Lenis) {
  try {
    lenis = new globalThis.Lenis({ autoRaf: true, anchors: true });
  } catch (error) {
    console.warn('Lenis failed to initialize:', error.message);
  }
}

installInteractions({
  config, sections, sectionNodes, formNodes,
  scrubElement: scrub, overlayLayer, lenis, reducedMotion,
});

if (reducedMotion) {
  applyReducedMotion(overlayNodes);
  return;
}
if (!scrub.isConnected) return;
```

Delete the old `if (globalThis.Lenis) { ... }` block further down (it is replaced by the code above). Keep everything else in `start()` unchanged.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add template/interactions.js template/scrub-engine.js tests/unit/template.test.mjs
git commit -m "feat: wire nav and waypoint stepper through cinematic jump"
```

---

### Task 5: Hotspots pinned to the footage

**Files:**

- Modify: `template/interactions.js`
- Modify: `template/scrub-engine.js`
- Test: `tests/unit/template.test.mjs`

**Interfaces:**

- Consumes: `config.hotspots` (validated in Task 2), the `jump` instance from Task 4, `positionAnnotations` in `scrub-engine.js`.
- Produces: for each hotspot, a `<button type="button" class="hotspot">` inside `#overlay-layer` with `data-point` (JSON `[x, y]`), `data-target`, and `aria-label` = hotspot label. `positionAnnotations` positions `.hotspot` nodes via the same `pointToPixel` call it uses for annotations, writing `--px`/`--py` custom properties.

- [ ] **Step 1: Write the failing source-contract tests**

Add to the `describe('interactions', ...)` block:

```js
it('renders hotspot buttons with point data and jumps on click', () => {
  expect(interactions).toMatch(/class=.?hotspot|'hotspot'|"hotspot"/);
  expect(interactions).toMatch(/data-point|dataset\.point/);
  expect(interactions).toMatch(/aria-label/);
});

it('engine positions hotspots with the cover-rect pass', () => {
  expect(engine).toMatch(/\.hotspot/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
```

Expected: FAIL on the two new assertions.

- [ ] **Step 3: Render and wire hotspots in `interactions.js`**

```js
function installHotspots({ config, overlayLayer, scrubElement, jump }) {
  const hotspots = config.hotspots ?? [];
  if (!hotspots.length || !scrubElement.isConnected) return;
  for (const hotspot of hotspots) {
    const dot = button('hotspot');
    dot.dataset.point = JSON.stringify(hotspot.point);
    dot.dataset.target = String(hotspot.target);
    dot.setAttribute('aria-label', hotspot.label);
    dot.addEventListener('click', () =>
      jump.toY(beatY(config, scrubElement, hotspot.target)));
    overlayLayer.append(dot);
  }
}
```

Call `installHotspots({ ...deps, jump });` from `installInteractions`.

- [ ] **Step 4: Position hotspots in the engine's cover-rect pass**

In `scrub-engine.js`, at the end of `positionAnnotations(sourceW, sourceH, boxW, boxH)`, add:

```js
for (const dot of overlayLayer.querySelectorAll('.hotspot')) {
  let point;
  try {
    point = JSON.parse(dot.dataset.point);
  } catch {
    continue;
  }
  const { x, y } = pointToPixel(point, sourceW, sourceH, boxW, boxH);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  dot.style.setProperty('--px', x.toFixed(1) + 'px');
  dot.style.setProperty('--py', y.toFixed(1) + 'px');
}
```

Note: `installInteractions` runs before `runEngine`/`runVideoEngine` start their resize observers, so hotspots exist by the first `positionAnnotations` call in both engines. The `start()` function also calls `positionAnnotations` once directly after fonts load â€” that call now positions hotspots too. No ordering change needed beyond Task 4's placement; verify `installInteractions` is called before that direct `positionAnnotations` call, and move the `installInteractions` call above it if not.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add template/interactions.js template/scrub-engine.js tests/unit/template.test.mjs
git commit -m "feat: pin interactive hotspots to the footage"
```

---

### Task 6: Spec-row jumps and gallery lightbox

**Files:**

- Modify: `template/interactions.js`
- Test: `tests/unit/template.test.mjs`

**Interfaces:**

- Consumes: `sectionNodes` (spec rows carry `data-beat` from Plan 2; gallery items carry `data-beat` and a `figure > img`), the `jump` instance.
- Produces:
  - every `.section-spec__row[data-beat]` gains `role="button"`, `tabindex="0"`, `aria-label` "Scrub to <label>", and Click/Enter/Space activation that jumps to the beat;
  - one shared `<dialog class="lightbox">` appended to `document.body` when any gallery item exists, containing `<img class="lightbox__image">`, a "View this moment" jump button (`.lightbox__jump`, rendered only for items with a beat), and a close button (`.lightbox__close`);
  - each `.section-gallery__item`'s figure is wrapped in a `<button type="button" class="section-gallery__button">` that opens the lightbox with that item's image/alt.

- [ ] **Step 1: Write the failing source-contract tests**

Add to the `describe('interactions', ...)` block:

```js
it('makes spec rows with beats keyboard-activatable', () => {
  expect(interactions).toMatch(/section-spec__row/);
  expect(interactions).toMatch(/role.*button|'button'/);
  expect(interactions).toMatch(/tabindex|tabIndex/);
});

it('opens gallery items in a native dialog lightbox', () => {
  expect(interactions).toMatch(/createElement\('dialog'\)/);
  expect(interactions).toMatch(/showModal/);
  expect(interactions).toMatch(/lightbox__jump/);
  expect(interactions).toMatch(/section-gallery__button/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
```

Expected: FAIL on the new assertions.

- [ ] **Step 3: Wire spec rows**

```js
function installSpecRows({ sectionNodes, config, scrubElement, jump }) {
  if (!scrubElement.isConnected) return;
  for (const sectionNode of sectionNodes) {
    for (const row of sectionNode.querySelectorAll('.section-spec__row[data-beat]')) {
      const beat = Number(row.dataset.beat);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-label',
        'Scrub to ' + row.querySelector('dt').textContent);
      const activate = () => jump.toY(beatY(config, scrubElement, beat));
      row.addEventListener('click', activate);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
  }
}
```

- [ ] **Step 4: Wire the gallery lightbox**

```js
function installGallery({ sectionNodes, config, scrubElement, jump }) {
  const items = sectionNodes.flatMap((node) =>
    [...node.querySelectorAll('.section-gallery__item')]);
  if (!items.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  const image = document.createElement('img');
  image.className = 'lightbox__image';
  const jumpButton = button('lightbox__jump', 'View this moment');
  const close = button('lightbox__close', 'Close');
  close.addEventListener('click', () => dialog.close());
  dialog.append(image, jumpButton, close);
  document.body.append(dialog);

  let activeBeat;
  jumpButton.addEventListener('click', () => {
    dialog.close();
    if (activeBeat !== undefined && scrubElement.isConnected) {
      jump.toY(beatY(config, scrubElement, activeBeat));
    }
  });

  for (const item of items) {
    const figure = item.querySelector('figure');
    const trigger = button('section-gallery__button');
    item.insertBefore(trigger, figure);
    trigger.append(figure);
    trigger.addEventListener('click', () => {
      const source = trigger.querySelector('img');
      image.src = source.src;
      image.alt = source.alt;
      activeBeat = item.dataset.beat === undefined
        ? undefined
        : Number(item.dataset.beat);
      jumpButton.hidden = activeBeat === undefined || !scrubElement.isConnected;
      dialog.showModal();
    });
  }
}
```

Call both from `installInteractions`. `<dialog>` gives Esc-close and focus containment natively â€” do not reimplement either.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add template/interactions.js tests/unit/template.test.mjs
git commit -m "feat: wire spec-row jumps and gallery lightbox"
```

---

### Task 7: Config picker with tint layer

**Files:**

- Modify: `template/interactions.js`
- Modify: `template/index.html`
- Test: `tests/unit/template.test.mjs`

**Interfaces:**

- Consumes: `config.config.options` (validated in Task 2), `#scrub-tint` (new static node), `#poster`, `#scrub-video`.
- Produces: `<div class="config-picker" role="radiogroup" aria-label="Configurations">` appended inside `#scrub .scrub__sticky`, one `<button type="button" role="radio" class="config-picker__option">` per option with `aria-checked`. Selecting an option: sets `aria-checked` states; if `tint` present, sets the tint layer's `background-color` and adds `is-active` (CSS transitions its `opacity` â€” never a per-frame variable write); if `poster` present, swaps `#poster`'s `src`; if `src` present and the config is in video mode, swaps `#scrub-video`'s `src`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/template.test.mjs`:

```js
it('index.html carries the tint layer inside the sticky viewport', () => {
  const html = readFileSync(new URL('../../template/index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/id="scrub-tint"/);
  expect(html).toMatch(/scrub__tint/);
});

it('renders the config picker as a radiogroup and swaps media', () => {
  expect(interactions).toMatch(/config-picker/);
  expect(interactions).toMatch(/radiogroup/);
  expect(interactions).toMatch(/aria-checked/);
  expect(interactions).toMatch(/scrub-tint/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs -t "interactions"
npx vitest run tests/unit/template.test.mjs -t "tint layer"
```

Expected: FAIL.

- [ ] **Step 3: Add the tint layer to `index.html`**

Inside `.scrub__sticky`, directly after `.scrub__vignette`:

```html
<div id="scrub-tint" class="scrub__tint" aria-hidden="true"></div>
```

- [ ] **Step 4: Implement the picker in `interactions.js`**

```js
function installConfigPicker({ config, scrubElement }) {
  const options = config.config?.options;
  // ponytail: product-register only per spec Â§6; full3d configs get a
  // validation warning instead of a picker.
  if (!options?.length || config.register === 'full3d'
      || !scrubElement.isConnected) return;

  const tint = document.getElementById('scrub-tint');
  const poster = document.getElementById('poster');
  const video = document.getElementById('scrub-video');
  const isVideo = Boolean(config.video?.src);

  const group = document.createElement('div');
  group.className = 'config-picker';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Configurations');

  const buttons = options.map((option) => {
    const chip = button('config-picker__option', option.label);
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', 'false');
    chip.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-checked', 'false');
      chip.setAttribute('aria-checked', 'true');
      if (option.tint) {
        tint.style.backgroundColor = option.tint;
        tint.classList.add('is-active');
      } else {
        tint.classList.remove('is-active');
      }
      if (option.poster) poster.src = option.poster;
      // ponytail: option videos must match config.video.duration; the running
      // engine keeps its captured duration. Per-option durations would need an
      // engine restart â€” add only if a real project ships mismatched cuts.
      if (option.src && isVideo) video.src = option.src;
    });
    return chip;
  });
  group.append(...buttons);
  scrubElement.querySelector('.scrub__sticky').append(group);
}
```

Call from `installInteractions`.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run tests/unit/template.test.mjs
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add template/interactions.js template/index.html tests/unit/template.test.mjs
git commit -m "feat: add product config picker with tint layer"
```

---

### Task 8: Email capture wiring

**Files:**

- Modify: `template/section-renderer.js`
- Modify: `template/interactions.js`
- Test: `tests/unit/template.test.mjs`

**Interfaces:**

- Consumes: `formNodes` from `renderSections`, `cta` section data (`emailAction` validated in Task 2).
- Produces:
  - `buildCta` in `section-renderer.js` no longer installs its own unconditional `preventDefault` submit listener; when `data.emailAction` is present it sets `form.action = data.emailAction` and `form.method = 'post'`, and stamps `form.dataset.wired = 'action'`; otherwise `form.dataset.wired = 'inline'`;
  - `installEmail` in `interactions.js` wires each form: invalid submit â†’ `preventDefault()` + `reportValidity()`; valid submit on an `inline` form â†’ `preventDefault()` + append `<p class="section-email__done" role="status">Thanks â€” you're on the list.</p>` once and disable the submit button; valid submit on an `action` form â†’ allowed through natively (no preventDefault).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/template.test.mjs`:

```js
it('renderer defers email submit handling to interactions', () => {
  const renderer = readFileSync(new URL('../../template/section-renderer.js', import.meta.url), 'utf8');
  expect(renderer).not.toMatch(/preventDefault/);
  expect(renderer).toMatch(/emailAction/);
  expect(renderer).toMatch(/dataset\.wired/);
});

it('interactions validate inline and never fake a network submit silently', () => {
  expect(interactions).toMatch(/reportValidity/);
  expect(interactions).toMatch(/section-email__done/);
  expect(interactions).toMatch(/role.*status|'status'/);
});
```

If an existing Plan 2 unit or browser assertion pins the renderer's own `preventDefault` listener (search `tests/` for `preventDefault` near email assertions), update it in this task to assert the new split instead â€” the behavior contract ("no fake success while unwired") is now owned by `interactions.js`.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs
```

Expected: FAIL on the new assertions.

- [ ] **Step 3: Update `buildCta` in `section-renderer.js`**

Replace the email block:

```js
if (data.emailCapture) {
  const form = node('form', 'section-email');
  if (data.emailAction) {
    form.action = data.emailAction;
    form.method = 'post';
    form.dataset.wired = 'action';
  } else {
    form.dataset.wired = 'inline';
  }
  const label = node('label', '', 'Email address');
  const input = node('input');
  input.type = 'email'; input.required = true; input.name = 'email';
  const submit = node('button', 'section-email__submit', 'Keep me posted');
  submit.type = 'submit';
  label.append(input);
  form.append(label, submit);
  content.append(form);
  formNodes.push(form);
}
```

- [ ] **Step 4: Wire forms in `interactions.js`**

```js
function installEmail({ formNodes }) {
  for (const form of formNodes) {
    form.addEventListener('submit', (event) => {
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
        return;
      }
      if (form.dataset.wired !== 'inline') return; // native POST proceeds
      event.preventDefault();
      if (form.querySelector('.section-email__done')) return;
      const done = document.createElement('p');
      done.className = 'section-email__done';
      done.setAttribute('role', 'status');
      done.textContent = "Thanks â€” you're on the list.";
      form.append(done);
      form.querySelector('.section-email__submit').disabled = true;
    });
  }
}
```

Call from `installInteractions`.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run
```

Expected: PASS (including any Plan 2 assertions updated in Step 1).

- [ ] **Step 6: Commit Task 8**

```bash
git add template/section-renderer.js template/interactions.js tests/unit/template.test.mjs
git commit -m "feat: wire email capture with inline validation"
```

---

### Task 9: Interactive chrome styles

**Files:**

- Modify: `template/style.css`
- Modify: `template/config.json`
- Test: `tests/unit/template.test.mjs`

**CSS contract:**

- `.site-nav` â€” fixed chrome (e.g. bottom-center pill row on mobile, right edge on â‰¥ 900px), `env(safe-area-inset-*)`-aware, no entrance animation (frequently used chrome stays crisp, spec Â§2.3).
- `.waypoint-stepper` â€” fixed, â‰¥ 44Ã—44 px hit target.
- `.hotspot` â€” absolutely positioned via `left: var(--px); top: var(--py); translate: -50% -50%;`, visible dot â‰¤ 20px with a padded â‰¥ 44Ã—44 px hit area (padding or pseudo-element), `pointer-events: auto` (the overlay layer keeps `pointer-events: none`).
- `.lightbox` â€” native dialog: centered (modals stay centered, spec Â§2.3), `::backdrop` scrim, image `max-width`/`max-height` bounded to the viewport.
- `.config-picker` â€” chip row anchored to the sticky viewport's bottom, above overlays.
- `.scrub__tint` â€” absolutely fills the sticky viewport, `opacity: 0`, `transition: opacity 0.6s var(--ease)`, `.is-active { opacity: 0.35 }`, `pointer-events: none`. Compositor-friendly by construction; no per-frame variable writes.
- `.section-spec__row[role="button"]` â€” pointer cursor + visible `:focus-visible` outline.
- Every new pressable (`.site-nav__pill`, `.waypoint-stepper`, `.hotspot`, `.config-picker__option`, `.section-gallery__button`, `.lightbox__jump`, `.lightbox__close`, `.section-email__submit`) gets `:active { transform: scale(0.97) }` and a `:focus-visible` outline.
- `@media (prefers-reduced-motion: reduce)` removes the tint transition (instant set) and any transform transitions on the new chrome.
- No gradient text, no new `backdrop-filter` outside the existing `.overlay--panel` and the lightbox `::backdrop`.

- [ ] **Step 1: Write the failing CSS contract tests**

Add a `describe('interaction styles', ...)` block to `tests/unit/template.test.mjs` asserting the stylesheet contains: `.site-nav`, `.waypoint-stepper`, `.hotspot`, `.lightbox`, `::backdrop`, `.config-picker`, `.scrub__tint`, `.section-email__done`, a `:active` rule with `scale(0.97)`, `:focus-visible`, and that `.scrub__tint` transitions only `opacity`:

```js
describe('interaction styles', () => {
  const css = readFileSync(new URL('../../template/style.css', import.meta.url), 'utf8');

  it.each([
    '.site-nav', '.waypoint-stepper', '.hotspot', '.lightbox',
    '.config-picker', '.scrub__tint', '.section-email__done',
  ])('styles %s', (selector) => {
    expect(css).toContain(selector);
  });

  it('gives pressables press feedback and focus outlines', () => {
    expect(css).toMatch(/:active[^{]*\{[^}]*scale\(0\.97\)/s);
    expect(css).toMatch(/:focus-visible/);
  });

  it('keeps the tint layer on a compositor-friendly opacity transition', () => {
    expect(css).toMatch(/\.scrub__tint\s*\{[^}]*transition:\s*opacity/s);
  });

  it('disables interactive-chrome motion under reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*scrub__tint/);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/unit/template.test.mjs -t "interaction styles"
```

Expected: FAIL.

- [ ] **Step 3: Add the styles**

Implement the CSS contract above in `template/style.css`, following the file's existing token usage (`var(--accent)`, `var(--surface)`, `var(--radius)`, `var(--ease)`) and existing section-style organization. Hotspot core:

```css
.hotspot {
  position: absolute;
  left: var(--px);
  top: var(--py);
  translate: -50% -50%;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
}

.hotspot::after {
  content: '';
  display: block;
  inline-size: 14px;
  block-size: 14px;
  margin: auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
}
```

- [ ] **Step 4: Extend the demo config**

Add to `template/config.json` (keeping all existing content):

- `"hotspots": [{ "point": [0.72, 0.38], "target": 2, "label": "Light source" }]`
- `"config": { "options": [ { "id": "studio", "label": "Studio", "tint": "#1a1d22" }, { "id": "noir", "label": "Noir", "tint": "#050505" } ] }`
- `"jump": { "minMs": 500, "maxMs": 1400, "pxPerMs": 2.2 }` inside `"scrub"`
- `"navLabel"` on the masthead (`"Top"`), spec (`"Specs"`), gallery (`"Gallery"`), and cta (`"Buy"`) sections.

- [ ] **Step 5: Run focused and full unit tests**

```bash
npx vitest run tests/unit/template.test.mjs -t "interaction styles"
npx vitest run
```

Expected: PASS (the demo config must still pass `validateConfig` â€” the scaffold/template tests will catch a schema mistake).

- [ ] **Step 6: Commit Task 9**

```bash
git add template/style.css template/config.json tests/unit/template.test.mjs
git commit -m "feat: style interactive chrome"
```

---

### Task 10: Browser acceptance coverage

**Files:**

- Create: `tests/browser/interactions.spec.mjs`
- Modify: `tests/browser/fixture-server.mjs`

**Fixture routes (extend the existing referrer-based `fixture` query routing):**

- `/?fixture=interactive` â€” frames-mode config: the existing `sectionsConfig` plus `navLabel` on masthead/spec/gallery/cta, `hotspots: [{ point: [0.8, 0.35], target: 0, label: 'Fixture hotspot' }]`, `config: { options: [{ id: 'a', label: 'Fixture A', tint: '#102030' }, { id: 'b', label: 'Fixture B', tint: '#301020' }] }`, and `scrub.jump: { minMs: 400, maxMs: 900, pxPerMs: 2.2 }`.
- `/video/?fixture=interactive` â€” the existing `videoConfig` plus a config picker whose second option has `src: 'media/video.webm'` and `poster: 'media/poster.webp'` (reuse the existing fixture assets; no new encoding).
- Preserve all existing fixtures.

- [ ] **Step 1: Add the fixtures**

In `fixture-server.mjs`, alongside `sectionsConfig`:

```js
const interactiveConfig = {
  ...sectionsConfig,
  scrub: { ...sectionsConfig.scrub, jump: { minMs: 400, maxMs: 900, pxPerMs: 2.2 } },
  hotspots: [{ point: [0.8, 0.35], target: 0, label: 'Fixture hotspot' }],
  config: { options: [
    { id: 'a', label: 'Fixture A', tint: '#102030' },
    { id: 'b', label: 'Fixture B', tint: '#301020' },
  ] },
  sections: sectionsConfig.sections.map((section) =>
    ['masthead', 'spec', 'gallery', 'cta'].includes(section.type)
      ? { ...section, navLabel: 'Nav ' + section.type }
      : section),
};

const videoInteractiveConfig = {
  ...videoConfig,
  config: { options: [
    { id: 'base', label: 'Base' },
    { id: 'alt', label: 'Alt', src: 'media/video.webm', poster: 'media/poster.webp' },
  ] },
};
```

Route them in the config handler: `requestedFixture === 'interactive'` â†’ `isVideo ? videoInteractiveConfig : interactiveConfig`.

- [ ] **Step 2: Write the failing acceptance tests**

Create `tests/browser/interactions.spec.mjs`, following the setup conventions of `tests/browser/sections.spec.mjs` (same server bootstrap and viewport patterns). Cover:

```js
test('nav pills render for labeled sections and animate scroll on click', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const pills = page.locator('.site-nav__pill');
  await expect(pills).toHaveCount(4);
  const target = await page.locator('[data-section="cta"]').evaluate((node) => node.offsetTop);
  await pills.last().click();
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => scrollY);
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(target); // in flight: animated, not instant
  await page.waitForFunction((y) => Math.abs(scrollY - y) < 2, target);
});

test('manual wheel input cancels an in-flight jump', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const target = await page.locator('[data-section="cta"]').evaluate((node) => node.offsetTop);
  await page.locator('.site-nav__pill').last().click();
  await page.waitForTimeout(120);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1200); // longer than maxMs
  const settled = await page.evaluate(() => scrollY);
  expect(Math.abs(settled - target)).toBeGreaterThan(50);
});

test('reduced motion jumps instantly', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/?fixture=interactive');
  const target = await page.locator('[data-section="cta"]').evaluate((node) => node.offsetTop);
  await page.locator('.site-nav__pill').last().click();
  await expect
    .poll(() => page.evaluate(() => scrollY), { timeout: 300 })
    .toBeCloseTo(target, -1);
  await context.close();
});

test('hotspot is positioned, keyboard-reachable, and jumps to its beat', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const hotspot = page.locator('.hotspot');
  await expect(hotspot).toHaveCount(1);
  await expect(hotspot).toHaveAttribute('aria-label', 'Fixture hotspot');
  const box = await hotspot.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  await hotspot.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => scrollY > 0);
});

test('spec row activates by keyboard and scrubs toward its beat', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const row = page.locator('.section-spec__row[data-beat]');
  await expect(row).toHaveAttribute('role', 'button');
  await row.focus();
  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await page.waitForFunction((y) => Math.abs(scrollY - y) > 50, before);
});

test('gallery opens a lightbox; Escape closes it; jump button scrubs', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  await page.locator('.section-gallery__button').first().click();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await page.locator('.section-gallery__button').first().click();
  await page.locator('.lightbox__jump').click();
  await expect(dialog).not.toHaveAttribute('open', '');
});

test('config picker applies tint through the dedicated layer', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  await page.locator('.config-picker__option').nth(1).click();
  await expect(page.locator('.config-picker__option').nth(1))
    .toHaveAttribute('aria-checked', 'true');
  const opacity = await page.locator('#scrub-tint')
    .evaluate((node) => getComputedStyle(node).opacity);
  expect(Number(opacity)).toBeGreaterThan(0);
});

test('video config option swaps the scrub source', async ({ page }) => {
  // Follow the existing video-fixture availability guard from smoke.spec.mjs.
  await page.goto('/video/?fixture=interactive');
  await page.locator('.config-picker__option').nth(1).click();
  await expect(page.locator('#scrub-video')).toHaveAttribute('src', /media\/video\.webm/);
});

test('email form validates inline and confirms once', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const form = page.locator('.section-email');
  await form.locator('input').fill('not-an-email');
  await form.locator('.section-email__submit').click();
  await expect(form.locator('.section-email__done')).toHaveCount(0);
  await form.locator('input').fill('person@example.com');
  await form.locator('.section-email__submit').click();
  await expect(form.locator('.section-email__done')).toBeVisible();
  await expect(form.locator('.section-email__submit')).toBeDisabled();
});
```

- [ ] **Step 3: Run the new browser file and verify status**

```bash
npx playwright test tests/browser/interactions.spec.mjs
```

Expected: FAIL until fixtures route correctly; iterate to GREEN **without weakening assertions**. Timing-sensitive tests (in-flight sampling, cancel) may need tuned waits â€” adjust waits, never the assertion targets.

- [ ] **Step 4: Run the complete verification matrix**

```bash
npx vitest run
npx playwright test
```

Expected: all suites PASS with no regressions in the smoke, overlay-variant, or sections suites.

- [ ] **Step 5: Review the diff for Plan 3 scope**

```bash
git diff --check
git status --short
git diff main --stat
```

Confirm: no generated `site/` output staged; no intake/gate/`.pen` changes (Plans 4â€“5); no new `scroll` listeners; no framework or dependency added.

- [ ] **Step 6: Commit Task 10**

```bash
git add tests/browser/interactions.spec.mjs tests/browser/fixture-server.mjs
git commit -m "test: cover functional components in browser"
```

---

## Plan 3 Completion Gate

Before requesting code review:

- [ ] Run `npx vitest run`.
- [ ] Run `npx playwright test`.
- [ ] Run `git diff --check`.
- [ ] Verify a nav-pill click visibly scrubs through intermediate frames (animated scroll), and a wheel flick mid-jump cancels it instantly.
- [ ] Verify reduced motion makes every jump an instant set and leaves all components operable.
- [ ] Verify hotspots stay pinned to their footage point across a viewport resize (existing `positionAnnotations` pass).
- [ ] Verify keyboard-only operation: Tab reaches nav pills, stepper, hotspots, spec rows, gallery buttons, config options, lightbox controls, and the email form; Enter/Space activates each; Esc closes the lightbox.
- [ ] Verify a config with none of the new fields renders byte-identically to Plan 2 output (no nav, no stepper, no picker, no hotspots).
- [ ] Verify the scrub hot path gained no per-frame work (no new code inside `tick`).
- [ ] Use `superpowers:requesting-code-review` for a final spec-compliance review.
- [ ] Do not begin Plan 4 until this plan is reviewed and accepted.
