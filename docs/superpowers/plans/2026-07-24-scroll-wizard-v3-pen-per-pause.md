# Scroll Wizard v3 — Plan 5: `.pen`-per-pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` for Task 1. Use `superpowers:test-driven-development` for the contract tests. The Manual Verification Protocol at the end is **controller/human-run against a live Pencil MCP session** — it cannot be dispatched to a subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the storyboard step so that, when Pencil is available, the wizard scaffolds **one `.pen` file per pause** (each `hold: true` beat) — seeded with that beat's still and its overlay content as editable nodes pre-styled to the chosen `direction` — then reads the approved composition back into `values.json`; and when Pencil is unavailable, degrades to numeric editing without ever claiming a `.pen` round-trip.

**Architecture:** This is a workflow/documentation subsystem. `.pen` files are created, screenshotted, and read back exclusively through the Pencil MCP tools (`get_editor_state`, `batch_design`, `get_screenshot`, `export_nodes`/`batch_get`, `get_variables`) driven by the agent following `SKILL.md` — there is no script that writes or reads `.pen` files (they are encrypted, MCP-only). The one automated task edits `SKILL.md` and adds source-text contract tests to `tests/unit/skill-workflow.test.mjs`. The live `.pen` round-trip itself is verified manually with a connected Pencil MCP, exactly as the v2 Pencil round-trip already is.

**Tech Stack:** `SKILL.md` prose, Vitest source-text contracts, Pencil MCP. No new script, runtime code, or dependency. Node 20+.

## Global Constraints

- Scope: implement spec subsystem 5 (spec §8) only. Do not add paid routes, alter the gate machinery (Plan 4), touch scaffolding/runtime code, or change any other `SKILL.md` step. This plan changes only the Pencil portion of `## Step 2: Storyboard` (plus the one Gates-table wording it references) and its contract tests.
- One `.pen` **per pause**: a `.pen` is scaffolded for each beat with `hold: true`, not one per beat (spec §8). Non-pause beats keep numeric `values.json` overlay editing.
- Each pause `.pen` is seeded with that beat's still (`input/keyframes/beat-<n>.<ext>`) as the background and its overlay content — title, body, stats, CTA, and the `point` leader for an `annotation` variant — as **editable nodes pre-styled to the chosen `direction`**, reading tokens from `references/directions.json` (title → `fonts.display`, body → `fonts.body`, CTA/active marker → `accent`, ground/scrim from `bg`/`surface`/`scrimStrength`, corner radius → `radius`).
- Read-back: the approved node positions/copy are read back and persisted as normalized `at`, `position`/`anchor`, `point` (for annotations), copy, and `hold` into `values.json` — exactly as the v2 Pencil round-trip already does — before the `storyboard` gate go-ahead.
- Composition may be adjusted in Pencil **even after the design followed the inspiration reference** (spec §8) — the `.pen` is the final composition surface, downstream of the Plan 4 inspiration gate.
- Degrade path (unchanged v2 behavior): when Pencil is unavailable, fall back to numeric `values.json` overlay editing and **never claim a `.pen` round-trip occurred**.
- The live `.pen` round-trip is verified manually against a connected Pencil MCP (spec Testing section: "Pencil `.pen`-per-pause round-trip is manually verified with screenshots against a live MCP session"). No automated test drives Pencil. Never call Pencil MCP tools from the test suite.
- Additive to docs only: existing `skill-workflow.test.mjs` contracts (`v2 workflow documentation contracts`, `mode, direction, and inspiration intake`, `visual ending treatment`) must all still pass — do not delete or reword any `SKILL.md` sentence they pin.
- Run `npx vitest run` before any completion claim.

---

### Task 1: `.pen`-per-pause storyboard step and contract tests

**Files:**

- Modify: `SKILL.md`
- Test: `tests/unit/skill-workflow.test.mjs`

**Interfaces:**

- Consumes: `references/directions.json` (direction token names, already shipped), the Pencil MCP tool names (`get_editor_state`, `batch_design`, `get_screenshot`, `export_nodes`), the overlay schema (`title`, `body`, `stats`, `cta`, `position`, `anchor`, `variant`, `point`, `at`, `hold`).
- Produces: `SKILL.md` prose the agent follows; `skill-workflow.test.mjs` contracts asserting that prose. No runtime code.

Note: `skill-workflow.test.mjs` asserts against `prose = skill.replace(/\s+/g, ' ')` (the whole file, whitespace collapsed). Every regex below is written to match the exact `SKILL.md` wording in Step 3 after that collapse. Markdown emphasis markers (`**`, backticks) survive the collapse, so do **not** wrap a phrase a regex must match across (e.g. never write `round-**trip**`); keep matched phrases in plain text with at most whole-token backticks the regex accounts for.

- [ ] **Step 1: Write the failing contract tests**

Add this `describe` block to `tests/unit/skill-workflow.test.mjs` (the file already defines `const skill = await readFile(...)` and `const prose = skill.replace(/\s+/g, ' ')` at the top — reuse them; do not redefine):

```js
describe('.pen-per-pause storyboard', () => {
  it('scaffolds one .pen file per pause (hold beat), not one per beat', () => {
    expect(prose).toMatch(/one `?\.pen`? file per pause/i);
    expect(prose).toMatch(/hold: true/i);
    expect(prose).not.toMatch(/one canvas per beat/i);
  });

  it('seeds each pause .pen with the beat still and direction-styled nodes', () => {
    expect(prose).toMatch(/pre-style/i);
    expect(prose).toMatch(/references\/directions\.json/);
    expect(prose).toMatch(/fonts\.display/);
    expect(prose).toMatch(/accent/);
  });

  it('reads the approved composition back into values.json', () => {
    expect(prose).toMatch(/read the approved node positions/i);
    expect(prose).toMatch(/normalized `?at`?/i);
    expect(prose).toMatch(/persist[^.]*values\.json/i);
  });

  it('degrades and never claims a .pen round-trip when Pencil is unavailable', () => {
    expect(prose).toMatch(/fall back to numeric/i);
    expect(prose).toMatch(/never claim a `?\.pen`? round-trip occurred/i);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/unit/skill-workflow.test.mjs -t ".pen-per-pause"`

Expected: FAIL — `SKILL.md` still says "one canvas per beat" and lacks the `.pen`-per-pause language.

- [ ] **Step 3: Rewrite the Pencil bullets in `## Step 2: Storyboard`**

In `SKILL.md`, replace the two existing Pencil bullets:

```markdown
- Probe Pencil once with `get_editor_state`. If unavailable, say so and fall back to
  numeric `values.json` overlay editing; never claim Pencil review occurred.
- When Pencil is available, create one canvas per beat with the still as background
  and title/body/stats/CTA as editable nodes. Iterate through screenshots with the
  user. Persist approved copy, `position`, normalized `at` ranges, and `hold` flags in
  `values.json` before asking for the `storyboard` gate go-ahead.
```

with:

```markdown
- Probe Pencil once with `get_editor_state`. If unavailable, say so and fall back to
  numeric `values.json` overlay editing; never claim a `.pen` round-trip occurred.
- When Pencil is available, scaffold one `.pen` file per pause — one for each beat with
  `hold: true`, not one per beat — seeded with that beat's still
  (`input/keyframes/beat-<n>.<ext>`) as the background and its overlay content
  (title, body, stats, CTA, and the `point` leader for an `annotation` variant) as
  editable nodes. Pre-style every node to the chosen `direction`, read from
  `references/directions.json`: title in `fonts.display`, body in `fonts.body`, the CTA
  and any active marker in `accent`, ground and scrim from `bg`/`surface`/`scrimStrength`,
  corner radius from `radius`. Non-pause beats keep numeric `values.json` overlay editing.
- Iterate through `get_screenshot` with the user on each pause `.pen`; the composition may
  be adjusted even after it followed the approved inspiration reference. Read the approved
  node positions and copy back, and persist normalized `at`, `position`/`anchor`, `point`
  (for annotations), copy, and `hold` into `values.json` before asking for the
  `storyboard` gate go-ahead.
```

Then update the Gates-table Storyboard row so its "Persist before asking" cell reflects per-pause `.pen`s. Change:

```markdown
| Storyboard | Light | active beat prompts, beat stills, and Pencil-reviewed overlays in values.json | storyboard |
```

to:

```markdown
| Storyboard | Light | active beat prompts, beat stills, and Pencil-reviewed pause compositions (one .pen per hold beat) read back into values.json | storyboard |
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run tests/unit/skill-workflow.test.mjs -t ".pen-per-pause"`

Expected: PASS.

- [ ] **Step 5: Run the whole workflow suite and the full suite**

```bash
npx vitest run tests/unit/skill-workflow.test.mjs
npx vitest run
```

Expected: PASS — the new block passes and every pre-existing `skill-workflow.test.mjs` contract (v2 workflow, mode/direction/inspiration intake, visual ending treatment) still passes, with no regressions elsewhere. If a pre-existing assertion breaks, you reworded a sentence it pins — restore that original sentence; the only intended edits are the Pencil bullets and the Storyboard table cell.

- [ ] **Step 6: Commit Task 1**

```bash
git add SKILL.md tests/unit/skill-workflow.test.mjs
git commit -m "docs: scaffold one .pen per pause in storyboard"
```

---

## Manual Verification Protocol (controller/human-run — not a subagent task)

The `.pen` round-trip cannot be exercised by the automated suite; verify it once against a **connected Pencil MCP session**, capturing screenshots, exactly as the v2 Pencil round-trip is verified. Do this after Task 1 lands and before declaring Plan 5 complete.

Use a project with at least two beats where **exactly one** has `hold: true` (so per-pause vs per-beat is observable).

- [ ] **Pencil connected — scaffolding:** run the storyboard step. Confirm exactly **one** `.pen` is created (for the hold beat), not one per beat. Confirm its background is that beat's still and that title/body/stats/CTA (and, for an `annotation` beat, the `point` leader) exist as editable nodes.
- [ ] **Direction styling:** via `get_screenshot`, confirm the title node uses the direction's `fonts.display`, body uses `fonts.body`, the CTA/active marker uses `accent`, and the ground/scrim/`radius` match the direction's `references/directions.json` tokens. Repeat against a second `direction` and confirm the node styling changes accordingly.
- [ ] **Read-back:** move a node and edit its copy in Pencil, then run the read-back. Confirm the corresponding overlay in `values.json` updates — normalized `at`, `position`/`anchor`, `point` (for the annotation), and copy — matching the new composition, and that `hold` stays set.
- [ ] **Post-inspiration adjustment:** confirm the composition can be changed in the `.pen` even though the project already passed the Plan 4 inspiration gate (the two are independent).
- [ ] **Pencil unavailable — degrade:** disconnect Pencil (or run where `get_editor_state` fails). Confirm the flow falls back to numeric `values.json` overlay editing and the wizard **never** states or implies a `.pen` round-trip occurred.
- [ ] Record the screenshots and the before/after `values.json` overlay diff in the session as the manual receipt.

---

## Plan 5 Completion Gate

Before requesting code review:

- [ ] Run `npx vitest run` — all suites green.
- [ ] Run `git diff --check`.
- [ ] Complete the Manual Verification Protocol above against a live Pencil MCP and capture its screenshots/`values.json` diff.
- [ ] Confirm the degrade path never fabricates a `.pen` round-trip claim when Pencil is absent.
- [ ] Confirm only the Pencil bullets and the Storyboard table cell in `SKILL.md` changed (no other step touched), and that all pre-existing `skill-workflow.test.mjs` contracts still pass.
- [ ] Use `superpowers:requesting-code-review` for a final spec-compliance review against spec §8 and the Testing section.
- [ ] Plan 5 is the last subsystem in the v3 spec; on acceptance the v3 spec is fully implemented.
