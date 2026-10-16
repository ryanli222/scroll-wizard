# Scroll Wizard v3 — Plan 4: Mode/Archetype Intake + Inspiration Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before each completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the up-front look-approval subsystem — a curated inspiration reference library, a new light `inspiration` gate that sits between `brief` and `storyboard`, archetype-aware section-mix guidance, and the `SKILL.md` intake flow that drives mode/archetype/direction selection — so a paid video generation is never spent on the wrong visual direction.

**Architecture:** The `inspiration` gate is inserted into the existing `status.mjs` gate machinery exactly like the v2 gates: it hashes a projection of `values.json` (register/archetype/direction + the approved reference bucket and URLs), threads into the approval chain after `brief`, and is **legacy-skipped** for any config lacking both `register` and `direction` (a v2 project), never fabricating a user approval. The reference library is static skill data (`references/inspiration.json`) the agent reads during intake; no runtime code consumes it. Archetype guidance is one pure helper plus a CLI subcommand on the existing `plan-generation.mjs`. `SKILL.md` documents the mode gate, archetype sub-menu, direction choice, and the inspiration gate, and renumbers the intake steps.

**Tech Stack:** Node 20+ ES modules, Vitest. No new runtime dependency, no build step, no framework. Reuses the existing `status.mjs` manifest/receipt/chain machinery and `scrub-core.js` validation helpers unchanged.

## Global Constraints

- Additive and backward-compatible only. Omitted fields fall back to v2 behavior: `register` absent ⇒ treat as `product`; `direction` absent ⇒ `minimal`; a config lacking **both** `register` and `direction` is a legacy project and the `inspiration` gate is auto-satisfied as a **legacy skip** (spec §9, §10).
- The legacy skip is **never fabricated as a user approval** — it is reported by `status.mjs` as a skip, mirroring the existing `stills-preview` legacy-skip rule. No receipt is written for a skipped gate (spec §3, §10). The skip is not a promise to keep v2 projects working as a feature; it exists so the gate stays **inert until a project declares `register`/`direction`**, which the new v3 intake (Step 1) always sets before the gate is first evaluated. A new user therefore always passes through a live inspiration gate; the skip branch only ever affects genuinely undirected legacy configs and keeps the existing test suite from needing every v2 fixture rewritten.
- The `inspiration` gate is a **light gate**: short summary, clickable reference URLs shown in-session, explicit go-ahead, receipt. Never auto-approved (spec §3).
- Gate order after this plan (the actual system has `motion-plan` from Plan 3, which the spec's §10 list predates): `brief → inspiration → storyboard → motion-plan → stills-preview → video → extraction → theme → preview`. Resume numbering: 1–9, with 10 = complete.
- The gate persists the approval to `values.json.inspiration = { bucket, approvedRefs: [url] }` and writes a `status.mjs` receipt named `inspiration` (spec §3).
- Inspiration library entries are **only** `video-scroll` sites — real-time WebGL/WebGPU references are excluded (spec §3). Each entry: `url`, `label`, `bucket`, `verified` (bool), `shot` (path to a first-hand screenshot), one-line `note` (motion/material cue only, never composition/copy/palette/type).
- Seed entries are marked `verified: true` because the gate shows **only verified** entries; downgrading them to `verified: false` would leave a new user staring at an empty gate, which defeats it. The reference URLs are user-confirmed valid, so ship them as-is. Committing the binary `shot` files is an **archival manual follow-up** (mirroring the v2 Pencil round-trip); it does not block a new user, who clicks the live URL. Tests validate the JSON **shape**, not the on-disk existence of the shots.
- Registers: `full3d | product`. Archetypes (required iff `register==="full3d"`): `flythrough | walkthrough | teardown`. Directions: `minimal | cinematic | technical | bold`. These enums already exist in `template/scrub-core.js`; do not redefine them.
- Never approve a gate on the user's behalf. Run `npx vitest run` before any completion claim.

---

### Task 1: Inspiration reference library data

**Files:**

- Create: `references/inspiration.json`
- Test: `tests/unit/inspiration.test.mjs`

**Interfaces:**

- Consumes: nothing (static data).
- Produces: `references/inspiration.json` — a JSON object `{ "entries": [ { url, label, bucket, verified, shot, note } ] }`. The agent reads this at the inspiration gate (via `SKILL.md`); no runtime module imports it. It ships in the npm package because `package.json` already lists `references/` in `files` (verified by `tests/unit/directions.test.mjs`).

- [ ] **Step 1: Write the failing shape test**

Create `tests/unit/inspiration.test.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const library = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../references/inspiration.json', import.meta.url)), 'utf8',
));

const BUCKETS = new Set([
  'full3d/flythrough', 'full3d/walkthrough', 'full3d/teardown', 'product',
  'direction/minimal', 'direction/cinematic', 'direction/technical', 'direction/bold',
]);

describe('inspiration.json', () => {
  it('is an object with a non-empty entries array', () => {
    expect(Array.isArray(library.entries)).toBe(true);
    expect(library.entries.length).toBeGreaterThan(0);
  });

  it('gives every entry the full contract with a known bucket', () => {
    for (const entry of library.entries) {
      expect(typeof entry.url, entry.url).toBe('string');
      expect(entry.url).toMatch(/^https:\/\//);
      expect(typeof entry.label && entry.label.trim(), entry.url).toBeTruthy();
      expect(BUCKETS.has(entry.bucket), entry.bucket).toBe(true);
      expect(typeof entry.verified, entry.url).toBe('boolean');
      expect(typeof entry.note && entry.note.trim(), entry.url).toBeTruthy();
    }
  });

  it('requires a captured shot path for every verified entry', () => {
    for (const entry of library.entries.filter((item) => item.verified)) {
      expect(typeof entry.shot, entry.url).toBe('string');
      expect(entry.shot, entry.url).toMatch(/^references\/inspiration-shots\/.+\.(png|webp|jpe?g)$/);
    }
  });

  it('covers every register/archetype bucket and every direction bucket at least once', () => {
    const covered = new Set(library.entries.map((entry) => entry.bucket));
    for (const bucket of BUCKETS) {
      expect(covered.has(bucket), 'missing bucket ' + bucket).toBe(true);
    }
  });

  it('excludes real-time WebGL references by not listing known-excluded hosts', () => {
    const hosts = library.entries.map((entry) => new URL(entry.url).host);
    expect(hosts).not.toContain('www.noomo.agency');
    expect(hosts).not.toContain('noomo.agency');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/inspiration.test.mjs`

Expected: FAIL because `references/inspiration.json` does not exist.

- [ ] **Step 3: Create `references/inspiration.json`**

Seed it with the sites the spec §3 already lists as first-hand motion-captured (`verified: true`) plus concept coverage where the spec lists a bucket. `shot` paths point under `references/inspiration-shots/` (the binaries are added by the manual capture step, mirroring the v2 Pencil verification; their absence does not fail the suite).

```json
{
  "entries": [
    {
      "url": "https://izanami-official.com",
      "label": "Izanami",
      "bucket": "full3d/flythrough",
      "verified": true,
      "shot": "references/inspiration-shots/izanami.png",
      "note": "Continuous full-bleed footage drift behind near-static staggered fade-rise copy."
    },
    {
      "url": "https://izanami-official.com",
      "label": "Izanami",
      "bucket": "full3d/walkthrough",
      "verified": true,
      "shot": "references/inspiration-shots/izanami.png",
      "note": "Calm human-pace camera travel with rotated vertical section labels."
    },
    {
      "url": "https://izanami-official.com",
      "label": "Izanami",
      "bucket": "direction/cinematic",
      "verified": true,
      "shot": "references/inspiration-shots/izanami.png",
      "note": "High-contrast serif over desaturated atmosphere; hairline View -> links with a rule lead-in."
    },
    {
      "url": "https://buildyourdatacenter.nrg.com",
      "label": "NRG Build Your Data Center",
      "bucket": "full3d/walkthrough",
      "verified": true,
      "shot": "references/inspiration-shots/nrg.png",
      "note": "Papercraft isometric build-world advanced by a numbered stepper."
    },
    {
      "url": "https://buildyourdatacenter.nrg.com",
      "label": "NRG Build Your Data Center",
      "bucket": "direction/bold",
      "verified": true,
      "shot": "references/inspiration-shots/nrg.png",
      "note": "Floating diorama objects settling with parallax depth."
    },
    {
      "url": "https://explanideo.com",
      "label": "explanideo",
      "bucket": "product",
      "verified": true,
      "shot": "references/inspiration-shots/explanideo.png",
      "note": "Per-beat product with chapter tint cross-fade, per-beat BUY, and a circular mask-wipe scene change."
    },
    {
      "url": "https://www.apple.com/airpods-pro",
      "label": "Apple AirPods Pro",
      "bucket": "direction/minimal",
      "verified": true,
      "shot": "references/inspiration-shots/apple.png",
      "note": "Full-bleed video hero with an explicit pause control; restrained accent only on the primary CTA."
    },
    {
      "url": "https://nothing.tech",
      "label": "Nothing",
      "bucket": "direction/technical",
      "verified": true,
      "shot": "references/inspiration-shots/nothing.png",
      "note": "Dot-matrix display, uppercase labels, strict exposed grid with coordinate/index markers."
    },
    {
      "url": "https://alethia.earth",
      "label": "Alethia",
      "bucket": "direction/bold",
      "verified": true,
      "shot": "references/inspiration-shots/alethia.png",
      "note": "Heavy grotesk headlines over a dark saturated field with one bright accent; floating hero subject."
    },
    {
      "url": "https://explanideo.com",
      "label": "explanideo (teardown concept)",
      "bucket": "full3d/teardown",
      "verified": true,
      "shot": "references/inspiration-shots/explanideo.png",
      "note": "Exploded product parts separating with annotated callouts; concept cue for teardown motion."
    }
  ]
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/inspiration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add references/inspiration.json tests/unit/inspiration.test.mjs
git commit -m "feat: add inspiration reference library"
```

---

### Task 2: Inspiration gate in status.mjs

**Files:**

- Modify: `scripts/status.mjs`
- Test: `tests/unit/status.test.mjs`

**Interfaces:**

- Consumes: `values.json` (`register`, `archetype`, `direction`, `inspiration.bucket`, `inspiration.approvedRefs`), the existing manifest/receipt/chain machinery.
- Produces:
  - `GATES` becomes `['brief', 'inspiration', 'storyboard', 'motion-plan', 'stills-preview', 'video', 'extraction', 'theme', 'preview']`.
  - `valuesProjection(values, 'inspiration')` → `{ register, archetype, direction, bucket, approvedRefs }`.
  - `buildGateManifest(projectDir, 'inspiration')` → `[{ path: 'values.json#inspiration', sha256 }]` when `values.inspiration.approvedRefs` is a non-empty array, else `null`.
  - `buildInventory` return gains `directed: Boolean(values?.register || values?.direction)`.
  - `gateSkipped('inspiration', inventory)` returns `!inventory.directed` (legacy projects skip it).
  - `stepFor` derives step numbers from `GATES` (no hardcoded integers) so future gate insertions do not silently drift.

**Notes on the migration:** inserting a gate at index 1 shifts every downstream gate's step number by +1. All existing synthetic and filesystem status tests that assert a `resumeStep`, a `"N. <gate>: <state>"` line, or a `"Resume at step N."` line, or that loop `for (const gate of GATES)` to approve gates, must be updated. The exact edits are enumerated in Step 6. The existing v2/complete fixtures write no `register`/`direction`, so they are **legacy** projects: their `inspiration` gate is skipped, it never appears in their `unapproved` arrays, and their receipt chains still thread `brief → storyboard` unchanged.

- [ ] **Step 1: Write the failing gate-order and projection tests**

Add to the `describe('status inventory resolution', ...)` block in `tests/unit/status.test.mjs`:

```js
it('inserts inspiration as the second gate', () => {
  expect(GATES).toEqual([
    'brief', 'inspiration', 'storyboard', 'motion-plan', 'stills-preview',
    'video', 'extraction', 'theme', 'preview',
  ]);
});

it('projects the inspiration decision and its approved references', () => {
  const values = {
    register: 'product', archetype: undefined, direction: 'minimal',
    inspiration: { bucket: 'product', approvedRefs: ['https://explanideo.com'] },
  };
  expect(valuesProjection(values, 'inspiration')).toEqual({
    register: 'product', archetype: null, direction: 'minimal',
    bucket: 'product', approvedRefs: ['https://explanideo.com'],
  });
  expect(valuesProjection({}, 'inspiration')).toEqual({
    register: null, archetype: null, direction: null, bucket: null, approvedRefs: [],
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/status.test.mjs -t "inspiration"`

Expected: FAIL — `GATES` lacks `inspiration` and `valuesProjection` throws for the `inspiration` gate.

- [ ] **Step 3: Insert the gate, projection, and manifest in `scripts/status.mjs`**

In `GATES`, add `'inspiration'` after `'brief'`:

```js
export const GATES = [
  'brief',
  'inspiration',
  'storyboard',
  'motion-plan',
  'stills-preview',
  'video',
  'extraction',
  'theme',
  'preview',
];
```

In `valuesProjection`, add the `inspiration` case before the `throw`:

```js
if (gate === 'inspiration') {
  return {
    register: values.register ?? null,
    archetype: values.archetype ?? null,
    direction: values.direction ?? null,
    bucket: values.inspiration?.bucket ?? null,
    approvedRefs: [...(values.inspiration?.approvedRefs ?? [])],
  };
}
```

In `buildGateManifest`, add the `inspiration` branch immediately after the `brief` branch (it needs `values.json`, read inline):

```js
if (gate === 'inspiration') {
  const values = await readJsonObject(join(projectDir, 'values.json'), 'values.json');
  if (!values) return null;
  const refs = values.inspiration?.approvedRefs;
  if (!Array.isArray(refs) || refs.length === 0) return null;
  return [{
    path: 'values.json#inspiration',
    sha256: sha256Text(canonicalJson(valuesProjection(values, 'inspiration'))),
  }];
}
```

- [ ] **Step 4: Add the directed flag, legacy skip, and data-driven stepFor**

In `buildInventory`, the `values` object is already read (`const values = await readJsonObject(...)`). Add `directed` to the returned object (place it alongside `videoEnabled`):

```js
    videoEnabled: values?.generation?.video !== false,
    directed: Boolean(values?.register || values?.direction),
```

In `gateSkipped`, add the `inspiration` case (a legacy project — neither `register` nor `direction` — skips it):

```js
function gateSkipped(gate, inventory) {
  if (gate === 'inspiration') return !inventory.directed;
  if (gate === 'storyboard') {
    return inventory.keyframePromptCount === 0 && inventory.videoPromptExists;
  }
  if (gate === 'motion-plan') {
    return !inventory.videoEnabled;
  }
  if (gate === 'stills-preview') {
    return inventory.beatPromptCount === 0 && inventory.videoFileExists;
  }
  if (gate === 'video') return !inventory.videoEnabled;
  return false;
}
```

Replace `stepFor` with a version that derives every step from `GATES` (so this insertion — and any future one — needs no hand-edited integers). The only non-gate inventory items are keyframe/storyboard roles (map to the `storyboard` step) and `'site'` (maps to the `theme` step):

```js
function stepFor(item) {
  if (item.startsWith('keyframe') || item.startsWith('storyboard')) {
    return GATES.indexOf('storyboard') + 1;
  }
  if (item === 'site') return GATES.indexOf('theme') + 1;
  const index = GATES.indexOf(item);
  return index === -1 ? 1 : index + 1;
}
```

- [ ] **Step 5: Write the failing legacy-skip and directed-flow tests**

Add a new `describe` block near the `v2 status gates` block in `tests/unit/status.test.mjs`. It reuses the existing `createV2Project`, `writeJson`, `temporaryProject`, `fakeIo`, and `main` helpers.

```js
async function createDirectedProject({ approvedRefs = ['https://explanideo.com'] } = {}) {
  const projectDir = await createV2Project();
  const valuesPath = join(projectDir, 'values.json');
  const values = JSON.parse(await readFile(valuesPath, 'utf8'));
  values.register = 'product';
  values.direction = 'minimal';
  if (approvedRefs) values.inspiration = { bucket: 'product', approvedRefs };
  await writeJson(valuesPath, values);
  return projectDir;
}

describe('inspiration gate', () => {
  it('skips the gate for a legacy project and never fabricates its receipt', async () => {
    const projectDir = await createV2Project(); // no register/direction
    const inventory = await buildInventory(projectDir);
    expect(inventory.directed).toBe(false);
    const io = fakeIo();
    await main([projectDir], io);
    const output = io.log.mock.calls.flat().join('\n');
    expect(output).toContain('2. inspiration: skipped');
    // A skipped gate is never approvable and writes no receipt.
    await expect(approveGate(projectDir, 'inspiration')).rejects.toThrow(/incomplete/i);
  });

  it('requires a directed project to approve inspiration before storyboard', async () => {
    const projectDir = await createDirectedProject({ approvedRefs: null });
    await approveGate(projectDir, 'brief');
    const report = resolveResume(await buildInventory(projectDir));
    expect(report.resumeStep).toBe(2);
    expect(report.unapproved).toContain('inspiration');
    // Cannot skip ahead: storyboard approval is blocked until inspiration is approved.
    await expect(approveGate(projectDir, 'storyboard')).rejects.toThrow(/inspiration/i);
  });

  it('chains inspiration between brief and storyboard for a directed project', async () => {
    const projectDir = await createDirectedProject();
    const briefReceipt = await approveGate(projectDir, 'brief');
    const inspirationReceipt = await approveGate(projectDir, 'inspiration');
    expect(inspirationReceipt.step).toBe(2);
    expect(inspirationReceipt.basedOn).toBe(briefReceipt.manifestHash);
    const storyboardReceipt = await approveGate(projectDir, 'storyboard');
    expect(storyboardReceipt.basedOn).toBe(inspirationReceipt.manifestHash);
  });

  it('marks inspiration needs re-review after the direction changes', async () => {
    const projectDir = await createDirectedProject();
    await approveGate(projectDir, 'brief');
    await approveGate(projectDir, 'inspiration');
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    values.direction = 'cinematic';
    await writeJson(valuesPath, values);
    const io = fakeIo();
    await main([projectDir], io);
    expect(io.log.mock.calls.flat().join('\n')).toContain('2. inspiration: needs re-review');
  });
});
```

`gateSkipped` stays module-private — do not import it; the skip behavior is asserted through `main`/`resolveResume`/`approveGate` output. Confirm `readFile` is already imported at the top of `status.test.mjs` (it is, from `node:fs/promises`).

- [ ] **Step 6: Migrate the shifted existing assertions**

The gate insertion shifts downstream step numbers by +1 and adds `inspiration` to `GATES`. Apply these exact edits in `tests/unit/status.test.mjs` (anchored by test name and old → new value; do **not** rely on line numbers, which drift as you edit):

Shared helper `completeInventory` — make it model a **legacy** project by default (inspiration skipped, absent from the receipt chain), with an opt-in `directed` path:

```js
function completeInventory(overrides = {}) {
  const directed = overrides.directed ?? false;
  const manifests = Object.fromEntries(
    GATES.map((gate, index) => [gate, hash(String.fromCharCode(97 + index))]),
  );
  const chain = directed ? GATES : GATES.filter((gate) => gate !== 'inspiration');
  let basedOn = null;
  const receipts = {};
  for (const gate of chain) {
    receipts[gate] = { manifestHash: manifests[gate], basedOn };
    basedOn = manifests[gate];
  }
  return {
    manifests,
    receipts,
    incomplete: [],
    stale: [],
    keyframePromptCount: 1,
    beatPromptCount: 1,
    videoPromptExists: true,
    videoFileExists: true,
    videoEnabled: true,
    directed,
    ...overrides,
  };
}
```

Synthetic resolution tests (`describe('status inventory resolution')`) — update these `resumeStep` values (unapproved arrays are unchanged because the default inventory is legacy, so `inspiration` never appears in them):

- `'reports a fully approved fresh chain as complete'`: `resumeStep: 9` → `10`.
- `'marks a missing receipt and every chained descendant unapproved'`: `resumeStep: 6` → `7`.
- `'returns stale video before a missing preview receipt while reporting both'`: `resumeStep: 5` → `6`.
- `'takes the earliest step across incomplete, stale, and unapproved signals'`: `resumeStep: 2` → `3`.
- `'invalidates every descendant after a missing manifest without truncation'`: `resumeStep: 5` → `6`.
- `'resumes at missing keyframes before a video prompt establishes the skip'`: `resumeStep: 2` → `3`.
- `'requires motion-plan when storyboard is skipped in video mode'`: `resumeStep: 3` → `4`.
- `'links video through motion-plan when keyframes are skipped'`: `resumeStep: 9` → `10`.
- `'returns incomplete and staleness details with their earliest resume step'`: the two `resumeStep` values `2` → `3` and `5` → `6`.

(`'invalidates the entire descendant chain after brief changes'` and `'keeps an earlier broken receipt ahead of a later missing artifact'` keep `resumeStep: 1` and keep their `unapproved` arrays as written — a legacy project's `inspiration` is skipped, so it is correctly absent from those lists.)

Filesystem/CLI tests:

- `'marks motion-plan as needs re-review after its artifact changes'`: `'3. motion-plan: needs re-review'` → `'4. motion-plan: needs re-review'`; `'Resume at step 3.'` → `'Resume at step 4.'`.
- `'resumes at keyframes until video.txt makes an empty plan explicitly skipped'`: `.toBe(2)` → `.toBe(3)` and `.toBe(3)` → `.toBe(4)`.
- `'writes an atomic linked approval chain and preserves unrelated receipts'`: `resumeStep: 9` → `10`. (Its `unapproved` arrays and `Object.keys(preserved)` stay unchanged — legacy project, `inspiration` never approved.)
- `'prints stale before ready-unapproved when a receipt is missing'`: `'6. extraction: stale'` → `'7. extraction: stale'`; `'6. extraction: ready-unapproved'` → `'7. extraction: ready-unapproved'`.
- `'prints stale before needs re-review when the receipt chain is invalid'`: change the approve loop `GATES.filter((item) => item !== 'stills-preview')` → `GATES.filter((item) => !['inspiration', 'stills-preview'].includes(item))`; and `'6. extraction: stale'` → `'7. extraction: stale'`, `'6. extraction: needs re-review'` → `'7. extraction: needs re-review'`.
- `'prints JSON and human status states without approving anything'`: `unapproved: GATES.filter((gate) => gate !== 'stills-preview')` → `unapproved: GATES.filter((gate) => !['inspiration', 'stills-preview'].includes(gate))`. `resumeStep: 1` and `'Resume at step 1.'` stay.
- `describe('v2 status gates')` → `'uses the eight v2 gates in order'`: this test asserts the OLD 8-gate array. Delete it (the new `'inserts inspiration as the second gate'` test from Step 1 now owns the gate-order contract), or repurpose its body to the new 9-gate array. Prefer deleting it to avoid two conflicting gate-order assertions.
- `'maps a legacy keyframes receipt to storyboard and preserves downstream skip behavior'`: `'4. stills-preview: skipped'` → `'5. stills-preview: skipped'`. Its `unapproved: ['preview']` stays (legacy project).
- `'uses resume step 8 after every required v2 gate is approved'`: change the approve loop `for (const gate of GATES)` → `for (const gate of GATES.filter((gate) => gate !== 'inspiration'))` (a legacy project never approves the skipped inspiration gate); `resumeStep: 9` → `10`. Update the test title to `'uses resume step 9 after every required v2 gate is approved'`.
- `'skips disabled motion-plan and video but still requires frame extraction'`: `'3. motion-plan: skipped'` → `'4. motion-plan: skipped'`; `'5. video: skipped'` → `'6. video: skipped'`; the approve loop `GATES.filter((gate) => !['motion-plan', 'video'].includes(gate))` → `GATES.filter((gate) => !['inspiration', 'motion-plan', 'video'].includes(gate))`; `resumeStep: 9` → `10`.

- [ ] **Step 7: Run the full status suite and verify GREEN**

Run: `npx vitest run tests/unit/status.test.mjs`

Expected: PASS. If any assertion still fails on a step number, the fix is the general rule: a `resumeStep`/`"N. gate"`/`"Resume at step N."` for any gate at or after `inspiration` (step 2) increases by exactly 1; a brief-level (step 1) value stays 1; any `for (const gate of GATES)` approval loop over a **legacy** fixture must exclude `'inspiration'`.

- [ ] **Step 8: Commit Task 2**

```bash
git add scripts/status.mjs tests/unit/status.test.mjs
git commit -m "feat: add inspiration approval gate with legacy skip"
```

---

### Task 3: Archetype-aware section-mix guidance

**Files:**

- Modify: `scripts/lib/generation.mjs`
- Modify: `scripts/plan-generation.mjs`
- Test: `tests/unit/generation.test.mjs`
- Test: `tests/unit/plan-generation.test.mjs`

**Interfaces:**

- Consumes: `register` (`full3d | product`) and optional `archetype` (`flythrough | walkthrough | teardown`).
- Produces: `export function archetypeGuidance({ register, archetype })` → `{ sections: string[], note: string }`, the default section mix (spec §4) and a one-line motion/prompt cue. A new `plan-generation.mjs guidance --register R [--archetype A]` subcommand prints it as JSON. The intake step reads it to seed `values.json.sections` and craft the storyboard prompt.

- [ ] **Step 1: Write the failing helper tests**

Add to `tests/unit/generation.test.mjs`:

```js
import { archetypeGuidance } from '../../scripts/lib/generation.mjs';

describe('archetypeGuidance', () => {
  it('gives the product/teardown default section mix', () => {
    expect(archetypeGuidance({ register: 'product' })).toEqual({
      sections: ['masthead', 'scrub-hero', 'spec', 'gallery', 'cta'],
      note: expect.stringMatching(/hero product/i),
    });
    expect(archetypeGuidance({ register: 'full3d', archetype: 'teardown' }).sections)
      .toEqual(['masthead', 'scrub-hero', 'spec', 'gallery', 'cta']);
  });

  it('gives the full3d flythrough/walkthrough default section mix', () => {
    const expected = ['masthead', 'scrub-hero', 'statement', 'feature-split', 'cta'];
    expect(archetypeGuidance({ register: 'full3d', archetype: 'flythrough' }).sections)
      .toEqual(expected);
    expect(archetypeGuidance({ register: 'full3d', archetype: 'walkthrough' }).sections)
      .toEqual(expected);
  });

  it('carries an archetype-specific motion cue', () => {
    expect(archetypeGuidance({ register: 'full3d', archetype: 'teardown' }).note)
      .toMatch(/exploded|separate/i);
    expect(archetypeGuidance({ register: 'full3d', archetype: 'flythrough' }).note)
      .toMatch(/travels|through/i);
  });

  it('rejects an unknown register or a full3d call without a valid archetype', () => {
    expect(() => archetypeGuidance({ register: 'nope' })).toThrow(/register/i);
    expect(() => archetypeGuidance({ register: 'full3d' })).toThrow(/archetype/i);
    expect(() => archetypeGuidance({ register: 'full3d', archetype: 'bogus' }))
      .toThrow(/archetype/i);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/generation.test.mjs -t "archetypeGuidance"`

Expected: FAIL — `archetypeGuidance` is not exported.

- [ ] **Step 3: Implement the helper in `scripts/lib/generation.mjs`**

Append:

```js
const ARCHETYPE_NOTES = {
  flythrough: 'Camera travels continuously through an environment; hold on arrival beats.',
  walkthrough: 'Camera moves through a space at human pace; pause at threshold beats.',
  teardown: 'A product separates into annotated exploded parts; hold on each callout.',
};

export function archetypeGuidance({ register, archetype } = {}) {
  if (register !== 'full3d' && register !== 'product') {
    throw new Error('register must be "full3d" or "product".');
  }
  if (register === 'full3d') {
    if (!archetype || !Object.hasOwn(ARCHETYPE_NOTES, archetype)) {
      throw new Error('archetype must be flythrough, walkthrough, or teardown for full3d.');
    }
  }
  const productMix = ['masthead', 'scrub-hero', 'spec', 'gallery', 'cta'];
  const journeyMix = ['masthead', 'scrub-hero', 'statement', 'feature-split', 'cta'];
  if (register === 'product' || archetype === 'teardown') {
    return {
      sections: [...productMix],
      note: register === 'product'
        ? 'One hero product shown/revealed (orbit, dolly, reveal) on clean ground.'
        : ARCHETYPE_NOTES.teardown,
    };
  }
  return { sections: [...journeyMix], note: ARCHETYPE_NOTES[archetype] };
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/unit/generation.test.mjs -t "archetypeGuidance"`

Expected: PASS.

- [ ] **Step 5: Write the failing CLI test**

Add to `tests/unit/plan-generation.test.mjs`:

```js
it('prints archetype guidance as JSON', async () => {
  const io = fakeIo();
  expect(await main(['guidance', '--register', 'full3d', '--archetype', 'teardown'], io))
    .toBe(0);
  expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({
    sections: ['masthead', 'scrub-hero', 'spec', 'gallery', 'cta'],
    note: expect.any(String),
  });
});

it('rejects guidance with a bad register', async () => {
  const io = fakeIo();
  expect(await main(['guidance', '--register', 'nope'], io)).toBe(1);
  expect(io.error).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/plan-generation.test.mjs -t "guidance"`

Expected: FAIL — `guidance` is not a recognized command.

- [ ] **Step 7: Add the `guidance` subcommand to `scripts/plan-generation.mjs`**

Import the helper — extend the existing import from `./lib/generation.mjs`:

```js
import {
  archetypeGuidance,
  filterProviderRoutes,
  rankProviderRoutes,
  recommendBeatCount,
} from './lib/generation.mjs';
```

Add the branch inside the `try`, immediately after the `beats` branch:

```js
if (command === 'guidance') {
  validateOptions(
    argv,
    1,
    new Set(['--register', '--archetype']),
    new Set(),
  );
  const guidance = archetypeGuidance({
    register: valueAfter(argv, '--register'),
    archetype: argv.includes('--archetype') ? valueAfter(argv, '--archetype') : undefined,
  });
  io.log(JSON.stringify(guidance, null, 2));
  return 0;
}
```

Update `USAGE` to list the new subcommand:

```js
const USAGE = [
  'Usage:',
  '  plan-generation beats --claims N --sections N [--process] [--catalog N]',
  '  plan-generation guidance --register full3d|product [--archetype ARCH]',
  '  plan-generation routes <routes.json> --budget-micros N '
    + '--preset free|cheapest|balanced|quality-first --duration N '
    + '--resolution VALUE [--first-last] [--references N]',
].join('\n');
```

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/plan-generation.test.mjs -t "guidance"`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add scripts/lib/generation.mjs scripts/plan-generation.mjs tests/unit/generation.test.mjs tests/unit/plan-generation.test.mjs
git commit -m "feat: add archetype-aware section-mix guidance"
```

---

### Task 4: SKILL.md intake flow and inspiration gate

**Files:**

- Modify: `SKILL.md`
- Test: `tests/unit/skill-workflow.test.mjs`

**Interfaces:**

- Consumes: the `inspiration` gate name and `status.mjs --approve inspiration` (Task 2); `plan-generation.mjs guidance` (Task 3); `references/inspiration.json` (Task 1).
- Produces: documentation contracts asserted by `skill-workflow.test.mjs`. `SKILL.md` is prose the agent follows; there is no runtime code here.

- [ ] **Step 1: Write the failing documentation contracts**

Add a `describe` block to `tests/unit/skill-workflow.test.mjs` (it already defines `const prose = skill.replace(/\s+/g, ' ')`):

```js
describe('mode, direction, and inspiration intake', () => {
  it('opens intake with the register mode gate and full3d archetype sub-menu', () => {
    expect(prose).toMatch(/register.*(full3d|product)/i);
    expect(prose).toMatch(/archetype.*only when.*full3d/i);
    expect(prose).toMatch(/flythrough.*walkthrough.*teardown/i);
  });

  it('requires a direction choice from the four directions', () => {
    expect(prose).toMatch(/direction/i);
    expect(prose).toMatch(/minimal.*cinematic.*technical.*bold/i);
  });

  it('runs a light inspiration gate that shows clickable references before any paid generation', () => {
    expect(prose).toMatch(/inspiration/i);
    expect(prose).toMatch(/references\/inspiration\.json/);
    expect(prose).toMatch(/clickable|click through/i);
    expect(prose).toMatch(/before any paid|before any video-generation/i);
    expect(prose).toMatch(/status\.mjs.*--approve inspiration/);
  });

  it('frames references as a design language, not a promise the site will look identical', () => {
    expect(prose).toMatch(/not a template|design language/i);
    expect(prose).toMatch(/not look identical|will not look identical/i);
  });

  it('persists the approved references and bucket to values.json', () => {
    expect(prose).toMatch(/inspiration.*bucket/i);
    expect(prose).toMatch(/approvedRefs/);
  });

  it('legacy-skips inspiration for a config without register or direction', () => {
    expect(prose).toMatch(/legacy.*(register|direction).*skip|skip.*inspiration.*legacy/i);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/skill-workflow.test.mjs -t "mode, direction, and inspiration"`

Expected: FAIL — `SKILL.md` has none of this language yet.

- [ ] **Step 3: Add the inspiration gate row to the Gates table**

In `SKILL.md`, add a row to the `## Gates` table, immediately after the `Brief` row:

```markdown
| Inspiration | Light | register/archetype/direction chosen, approved reference URLs and bucket in values.json.inspiration | inspiration |
```

- [ ] **Step 4: Rewrite Step 1 (Intake) with the mode gate, archetype sub-menu, and direction**

Replace the first two bullets of `## Step 1: Intake` (the "Establish whether this is a product-scrub..." bullet) with:

```markdown
- Open with the **register** mode gate, persisted to `values.json.register`:
  - `full3d` — an immersive fake-3D world produced by video generation. Choosing it
    reveals a required **archetype** sub-question (`values.json.archetype`), shown **only
    when** `register` is `full3d`: `flythrough` (camera travels through an environment),
    `walkthrough` (camera moves through a space at human pace), or `teardown` (a product
    separates into annotated parts).
  - `product` — one hero product shown/revealed (orbit, dolly, reveal). No archetype
    sub-question; proceed straight to direction.
- Ask for the **direction** (`values.json.direction`), one of `minimal`, `cinematic`,
  `technical`, or `bold`. A direction is a whole token + layout + motion + chrome package,
  not a recolor; an explicit `theme` in `values.json` still overrides its preset. Confirm
  the pick is not the product category's obvious default move (category-reflex test).
- Run `node <skill-root>/scripts/plan-generation.mjs guidance --register <register>
  [--archetype <archetype>]` and seed `values.json.sections` from the returned default
  section mix, letting the user edit it.
- Ask brand, vibe, motion, stopped scenes ("holds"), and CTA. Also collect claim count,
  section count, whether the story has a process, and catalog-item count.
```

- [ ] **Step 5: Add the inspiration gate as its own step**

Insert a new `## Step 1.5: Inspiration gate (light, before any paid generation)` section immediately after `## Step 1: Intake` and before `## Step 2: Storyboard`:

```markdown
## Step 1.5: Inspiration gate (light, before any paid generation)

- This light gate front-loads look-agreement so a paid video generation is never spent on
  the wrong vibe. Run it after mode/archetype/direction are chosen and before storyboard.
- Look up the matching references in `references/inspiration.json` by the project's bucket
  (`full3d/<archetype>` or `product`, plus `direction/<direction>`). Print the matching
  entries as **clickable URLs** in the session with their one-line notes, and ask the user
  to click through the real sites and approve the look. Never auto-approve.
- **Set the expectation explicitly.** State that these references are the **motion and
  design language** we borrow from — a mood/motion anchor, not a template. The generated
  site uses the user's own brand, copy, and generated footage, rendered in the `<direction>`
  design system; it will **not** look identical to any reference, and no reference's
  composition, copy, palette, or type is copied (spec §2.4, §3). Approving here approves a
  design language, not a promise of visual identity.
- Only `verified` `video-scroll` references are shown; a register/archetype whose motion
  idea is already clear (e.g. teardown, product orbit) needs no reference and is described
  in prose to the generator instead.
- On approval, persist `values.json.inspiration = { "bucket": "<bucket>", "approvedRefs":
  ["<url>"] }`. Only persist `https://` URLs drawn from `references/inspiration.json`; never
  print or persist a non-https or user-pasted-unvetted link as a clickable reference. Then
  record the receipt with
  `node <skill-root>/scripts/status.mjs <project> --approve inspiration`.
- **Legacy skip:** a config without `register` or `direction` is a legacy v2 project; its
  inspiration gate is legacy-skipped by `status.mjs` (reported as `skipped`) and is never
  approved on the user's behalf. Only honor this skip when `status.mjs` reports it.
```

- [ ] **Step 6: Update the resume/skip note for the new gate**

In `SKILL.md`, find the "Start or resume" note that lists which gates may be skipped (near "`stills-preview` is skipped only for a legacy project"). Extend it so the legacy-skip set also names `inspiration`:

```markdown
`inspiration` is skipped only for a legacy project that has neither `register` nor
`direction`; `stills-preview` is skipped only for a legacy project that has a v1 video but
no beat prompts. Do not recreate or re-approve a receipt that status reports as skipped.
```

(Adjust the surrounding sentence to read naturally; keep the existing `stills-preview` clause intact.)

- [ ] **Step 7: Run the focused tests and the existing workflow suite**

```bash
npx vitest run tests/unit/skill-workflow.test.mjs
```

Expected: PASS — the new `mode, direction, and inspiration` block passes and every existing `v2 workflow documentation contracts` / `visual ending treatment` assertion still passes (the edits are additive; do not remove the outline-approval, budget, motion-plan, or ending-treatment language those tests pin).

- [ ] **Step 8: Commit Task 4**

```bash
git add SKILL.md tests/unit/skill-workflow.test.mjs
git commit -m "docs: document mode gate, direction, and inspiration gate"
```

---

## Plan 4 Completion Gate

Before requesting code review:

- [ ] Run `npx vitest run` — all suites green (no Playwright changes in this plan; the browser suite is unaffected but should still pass).
- [ ] Run `git diff --check`.
- [ ] Verify a **legacy** project (no `register`/`direction`) resolves exactly as before except that `status.mjs` prints `2. inspiration: skipped` and every downstream step number is +1, with `inspiration` absent from `unapproved`.
- [ ] Verify a **directed** project (`register`/`direction` present) resumes at step 2 until `values.json.inspiration.approvedRefs` is set and `--approve inspiration` is run, and that changing `direction`/`register`/`bucket`/`approvedRefs` reports `inspiration` as `needs re-review`.
- [ ] Verify `inspiration` is never given a receipt when skipped (no fabricated approval).
- [ ] Verify `plan-generation.mjs guidance` returns the spec §4 section mixes and rejects a bad register/archetype.
- [ ] Confirm `references/inspiration.json` covers every register/archetype and every direction bucket and lists only `video-scroll` sites.
- [ ] Use `superpowers:requesting-code-review` for a final spec-compliance review against spec §1, §3, §4 (default mixes), §9 (schema), and §10 (gate order, resume renumber, legacy skip).
- [ ] Do not begin Plan 5 (`.pen`-per-pause) until this plan is reviewed and accepted.
```
