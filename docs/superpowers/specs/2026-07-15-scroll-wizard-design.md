# scroll-wizard — design spec

Date: 2026-07-15
Status: approved pending user review
Repo: `3dwebgen` (this repo IS the skill; npm-publishable layout)

## 1. Purpose

A cross-harness agent skill that builds **scroll-scrub video websites**: an AI-generated
video is sliced into frames with ffmpeg, and scroll position drives which frame renders
on a `<canvas>` (Apple product-page style — scrolling feels like moving through a 3D scene).

Two-layer architecture, strictly separated:

- **CLI core** — Node scripts + a static site template. Standalone-runnable without any
  agent: `node scripts/extract-frames.mjs in.mp4 out/ --count 150` works on its own; the
  template runs from any static file server. Everything testable lives here.
- **Skill layer** — `SKILL.md`, a gated step-by-step wizard that orchestrates the CLI
  core, writes generation prompts, critiques images, and stops for approval at every
  gate. It copies and configures the template — it never regenerates or hand-edits it.

## 2. Repo layout

```
3dwebgen/
  SKILL.md                  # the wizard (only agent-facing file)
  package.json              # name, bin, files fields set now; npm publish deferred
  README.md                 # install junctions, standalone CLI usage, deploy pointers
  scripts/
    validate-media.mjs      # <file> [--json] → ffprobe-based verdict (video OR image rules)
    extract-frames.mjs      # <in.mp4> <outDir> --count --width --format --quality --force
    scaffold-site.mjs       # <projectDir> --config <values.json> [--force]
    status.mjs              # <projectDir> [--json] → resume step + staleness report
  template/
    index.html
    style.css
    scrub-core.js           # pure functions, zero DOM — the tested brain
    scrub-engine.js         # DOM glue: canvas, rAF, preload, resize/DPR, Lenis init
    lenis.js                # vendored, version-pinned (deleting it degrades to native scroll)
    config.json             # working example config
  tests/
    unit/                   # vitest: scrub-core, verdict logic, arg parsing, frame plan
    integration/            # full pipeline against an ffmpeg-generated fixture
  docs/superpowers/specs/   # this file
```

- **Install** = junction/symlink per harness (documented one-liners, no install script):
  - Claude Code: `~/.claude/skills/scroll-wizard` → repo
  - Codex: `~/.agents/skills/scroll-wizard` → repo
  - Grok Build: `~/.grok/skills/scroll-wizard` → repo
- **npm-ready, not npm-published**: `package.json` declares `bin` entries
  (`scroll-wizard-validate`, `scroll-wizard-extract`, `scroll-wizard-scaffold`,
  `scroll-wizard-status`) and a `files` whitelist (`scripts/`, `template/`,
  `SKILL.md`). Publishing is a later task.
- **Dependencies**: zero runtime deps (webp encoding is done by ffmpeg itself). Dev
  deps: vitest + Playwright (smoke suite only). Node >= 20. ffmpeg/ffprobe are external
  prerequisites, checked at preflight.
- Scripts export their pure functions and detect direct CLI invocation, so vitest imports
  them without spawning processes.

## 3. Generated project layout

The wizard creates `<cwd>/<project-name>/` where invoked:

```
<project>/
  brief.md                  # step 1 artifact: brand, vibe, motion type, copy
  README.md                 # exact rerun commands (reproducibility without the skill)
  prompts/                  # ACTIVE prompts only, stable names = the plan record
    keyframe-first.txt      # roles: first, last, ref-1..ref-3 — all match keyframe-*
    keyframe-last.txt
    keyframe-ref-1.txt
    video.txt               # the active Veo 3.1 prompt
    history/                # superseded revisions move here (video-v1.txt, …);
                            # the active file is always unambiguous
  input/
    keyframes/first.png|jpg # role names are the wizard's output; user drops any names
    video.mp4               # the generated clip (any mp4/mov in input/ is accepted)
  values.json               # creative values (agent-written; human-editable standalone)
  approvals.json            # gate receipts: {step, artifact sha256, timestamp}
  frames/                   # extraction lands here; scaffold installs it into site/
  site/                     # the deliverable — self-contained static site
    index.html  style.css  scrub-core.js  scrub-engine.js  lenis.js  config.json
    frames/frame-0001.webp .. frame-NNNN.webp
    fonts/display.woff2     # optional single local display font
```

**Resume = filesystem + approval receipts, with staleness rules.** Artifacts alone
cannot prove a *gate* happened — they're written before approval is requested, so a
crashed session would otherwise resume past gates nobody passed. The one piece of true
state is therefore `approvals.json`, and its unit is the **gate manifest**, not a
single file hash — several gates approve compound state (a keyframe *set*, frames +
hold/poster decisions, theme tokens, the whole preview). Two rules make receipts
well-defined:

1. **Persist before approving.** Every decision a gate covers is written to disk
   *before* approval is requested — `values.json` grows progressively (intake writes
   copy/stops; the extraction gate writes nudged holds + `posterIndex`; the theme gate
   writes `theme`). No gate ever approves in-memory state.
2. **Receipt = manifest hash + upstream chain.** `status.mjs --approve <step>` builds
   the gate's canonical manifest — sorted `{path, sha256}` for every file the gate
   covers (brief: `brief.md`; keyframes: active prompts + images; video: the mp4;
   extraction: frames dir + `values.json`; theme: `values.json`; preview:
   `site/config.json` + frames) — and records `{step, manifestHash, basedOn:
   upstreamManifestHash, timestamp}`. Validity requires the whole chain to match:
   **re-approving an edited brief automatically invalidates every descendant receipt**
   (keyframes, video, …), which then read "needs re-review" — the wizard re-asks those
   gates; it never silently re-does money steps.

The wizard runs `--approve` **only after the user's explicit approval**. Resume is
computed by a pure, unit-tested function `resolveResume(inventory)` over
`{path, exists, mtime, sha256}` entries, the keyframe plan, and the receipts,
returning `{resumeStep, staleness[], incomplete[], unapproved[]}` (hashes verify
receipts; mtimes remain the cheap ordering signal for ungated derivations):

| Signal | Meaning |
|--------|---------|
| Artifact present + fresh + complete + receipt hash matches | step done |
| Artifact present but no/mismatched receipt (gated steps) | resume **at that gate** — never past it |
| `prompts/keyframe-*.txt` without a matching `input/keyframes/<role>.*` | keyframe set **incomplete** (the prompt files ARE the plan record) |
| `input/*.mp4` newer than the frames dir (project-level or `site/frames/`) | extraction **stale** |
| `<project>/frames/` newer than `site/frames/` | site build **stale** (re-extracted frames not yet installed) |
| `brief.md` or values newer than `site/config.json` | site build **stale** |
| `input/keyframes/*` newer than `input/*.mp4` | video **possibly stale** (report only) |

Free steps (extraction, scaffold) re-run automatically when stale. Money/time steps
(keyframes, video) are never auto-redone: the wizard reports the staleness and asks.
The mp4 on disk is still the checkpoint — but a checkpoint that can be *invalidated*,
not blindly trusted, and never a substitute for the gate that reviews it. Standalone
CLI users can ignore receipts entirely: `status.mjs` reports "ready (unapproved)"
distinctly from "done", and the scripts themselves never require approval to run.

## 4. Wizard flow (8 steps, hard gates)

Iron rules, stated bluntly at the top of SKILL.md and repeated per step:

1. **Never pass a hard gate without the user's explicit approval.** Show the artifact,
   ask, wait. On approval, record the receipt (`status.mjs --approve <step>`) so resume
   can trust it; a gate with no receipt is a gate that never happened. "Redo" loops the
   step with the user's feedback; the superseded prompt moves to `prompts/history/`
   and the revision takes the stable active filename — the active plan is never
   ambiguous.
2. **Never spend money without approval of the exact prompt** (API mode).
3. **Never hand-edit or regenerate the template files** — configuration happens only
   through `config.json` values.
4. All user interaction phrased harness-neutrally (see §8).

**Gates are tiered — density matches what's at stake, and differs by mode:**

- **Hard gates (both modes):** brief (1), video watched (3), preview (6) — the three
  moments that are creative commitments or expensive to unwind.
- **Light gates (both modes):** keyframe-set review (2), extraction + hold-frame review
  (4), theme tokens (5) — the wizard presents the artifact with a recommendation and
  proceeds on a simple go-ahead; cheap to revisit, so low ceremony.
- **Money gates (API mode only):** before *every* paid MCP call, the exact prompt and
  the fact that it costs money are shown and explicitly approved. Manual mode has no
  money gates — prompts are free to regenerate, so they ship with the handoff card
  instead of a separate stop.
- Honest limitation, stated in SKILL.md: conversation gates are enforced by the host
  model following instructions — there is no mechanical spend-lock in v1, because the
  agent calls MCP directly and no script of ours mediates it. (A wrapper that owns
  API-mode generation is a possible future hardening.)

**Manual handoff protocol** (steps 2 and 3 — the primary user journey): when it's the
user's turn to generate in Flow, the wizard prints a single **handoff card** — the
paste-ready prompt, the exact Flow feature to use, and the exact drop path — then
**ends its turn**. No polling, no timeouts, no "are you done yet": the next user
message (any message) triggers validation of whatever landed, and a fresh session gets
there through resume detection, so overnight round-trips cost nothing. File intake is
**forgiving**: any image/video files in the drop dirs are accepted regardless of name
or format (png/jpg/webp; mp4/mov); the agent views what arrived, proposes the
role mapping ("the wide dark one reads as `first` — confirm?"), renames to role names
itself, and asks only when genuinely ambiguous. Strict filenames are the wizard's
output convention, never the user's input burden.

Steps:

- **0 — Preflight.** `ffmpeg`/`ffprobe` on PATH (else per-OS install instructions and
  stop). Node >= 20. Mode: `manual` (default) or `api` if gemini-media-mcp tools are
  detected in the session. If the target project dir already exists, run resume detection.
- **1 — Intake** → `brief.md`. Brand name, vibe/palette, motion type (orbit / dolly /
  reveal / macro / morph / journey-flythrough / exploded-teardown / light-sweep /
  scale-travel / peel-back…), outro copy + CTA, project name, mode choice, frame budget
  (default 150). **Adaptive length — the happy path is short.** The wizard first
  establishes the **register** (§9) — it shapes every default that follows — then asks
  only the *minimum* needed to propose a complete draft brief (brand, vibe, motion
  type, stops yes/no; batched where natural, every question carrying a proposed
  default the user can wave through). A "product scrub, zero stops, one CTA" brief
  takes ~4 answers and lands at the gate. The detailed **stops questionnaire** runs
  only when stops > 0, one stop at a time (proposing defaults, e.g. 2–3 stops for a
  400vh scrub):
  1. **How many stops** (stopped scenes) the page should have — zero is fine.
  2. **What each stop is for** — feature callout, product highlight, plain caption,
     brand statement…
  3. **Which product** (if any) each stop showcases, and the copy for it (title/body).
  4. **Any clickable buttons** — per stop, an optional button label + destination URL
     (buy page, spec sheet, signup…), plus placement (center/left/right).
  The questionnaire surfaces the **hold tradeoff** in plain terms: stops consume
  scroll without motion, so the clip plays faster between them — every stop plan is
  presented with its computed speed-up and a recommended `heightVh`
  (`recommendHeightVh` in §6 keeps motion pace constant by growing the page), so
  "feels rushed" vs "page too tall" is a knob the user consciously sets, not a
  surprise. Non-stop overlays (captions that ride over motion) are gathered the same
  way. Intake also picks the **payload preset**: desktop-rich (150 frames @ 1600 px)
  or mobile-first (100 frames @ 1280 px, quality 75, ~half the bytes) — presented with
  estimated load time on a mid 4G connection, not just megabytes.
  *Gate (hard): approve the brief.*
- **2 — Keyframes (skippable).** The agent proposes a keyframe plan suited to the motion
  type:
  - `first` only (default) — image-to-video seed; e.g. a dolly-in needs one strong opener.
  - `first` + `last` — motion with a designed destination (orbit ending on the logo,
    a reveal ending open). Veo interpolates between them.
  - up to 3 `ref` images — Flow "Ingredients" mode, when subject consistency matters
    more than exact endpoints.
  One paste-ready prompt file per image. Manual mode: handoff card per the protocol
  above; the user generates in Flow (free on their plan) and drops files anywhere in
  `input/keyframes/` — the agent maps and renames to roles. API mode: image generation
  via MCP, each call behind a money gate. The agent **views every image** and
  critiques the set as a set — palette, subject, lighting coherence — because
  cross-frame coherence is what makes the scrub feel continuous. Validation: each file
  exists and ffprobe decodes it as an image; the set must satisfy the plan recorded in
  `prompts/` (a missing `last` is an incomplete step, not a done one). *Gate (light):
  approve the keyframe set.*
- **3 — Video** → `prompts/video.txt`. Veo 3.1-optimized prompt; names the Flow mode to
  use (Text / Image / Frames to Video / Ingredients) and references approved keyframes.
  Prompt-craft rules encoded in SKILL.md (§9). Manual: handoff card per the protocol;
  any mp4/mov landing in `input/` is accepted (multiple → ask which). API: MCP call
  behind a money gate; **any MCP failure falls back to manual with the same prompt
  file** (fallback costs nothing by construction). Then `validate-media.mjs` runs.
  *Gate (hard): user has watched the clip and approves.*
- **4 — Frame extraction.** `extract-frames.mjs input/video.mp4 frames/ --count N`
  into `<project>/frames/` — a plain data dir; `site/` does not exist yet, so nobody
  can browse into a half-built site mid-flow (scaffold *moves* the dir in, step 5).
  Reports count, dimensions, total MB against the chosen payload preset, plus
  estimated load time on mid-4G. Then the **hold-frame review**: `holdFrames(holds,
  count)` (§6) computes the exact frame each stop freezes on, and the agent **views
  every one of them** — plus 2–3 spaced samples — checking for motion blur, bad crop,
  mid-morph ugliness, and whether a scene chip's text stays legible over that frame.
  A bad freeze gets fixed by *nudging the hold range* a few frames (a free config
  change), never by regenerating. The agent also proposes the **poster**: the
  strongest still it saw (often mid-clip for orbits), default frame 1. Nudged holds
  and `posterIndex` are **written into `values.json` before the gate asks** (persist
  before approving, §3). *Gate (light): approve payload, quality, hold frames, poster.*
- **5 — Site build.** Starts with an **art-direction pass**: the agent views 2–3
  extracted frames and derives the theme *from the actual scene* — palette sampled from
  the imagery (bg from the scene's darks, accent from its most saturated material,
  `surface` as a translucent scene-dark), material mood → `radius` and font stacks,
  per §6's UI-in-the-scene rules. This is what keeps buttons and captions on-theme with
  the 3D world instead of generic UI. The derived `theme` is **written into
  `values.json` first** (persist before approving, §3), then the tokens + one line of
  rationale each (traced to the frames) are shown — theme is subjective and costs
  seconds to iterate, so it gets its own stop. *Gate (light): approve or tweak the
  theme tokens.* Then `scaffold-site.mjs <project> --config values.json` runs the
  transaction (§5): assembles a complete validated site in `site.tmp/` — template
  copy, frames installed (replacing any previous set), `frames` block derived from
  disk (single source of truth), config validated under §6 severity rules — and
  atomically swaps it live, writing the project README.
- **6 — Preview.** Any static server; documented default `npx serve site`. The
  check-list the agent hands the user: scrub smoothness, overlay timing, each stop's
  feel, mobile viewport, and a **throttled reload** (DevTools → Slow 4G) so load
  time is experienced, not imagined. *Gate (hard): user scrolled it and it feels
  right.* A rejection here routes to the **cheapest re-entry point by name** — theme
  tokens (re-scaffold, seconds), copy/stops/holds (edit values, re-scaffold, seconds),
  payload (re-extract, ~a minute), video (step 3, costs a generation) — never an
  undifferentiated "redo".
- **7 — Deploy (instructions only).** Paste-ready commands for Vercel, Netlify, GitHub
  Pages. No deploy automation is built or owned by this project.

## 5. CLI script contracts

### validate-media.mjs `<file> [--json]`
- Runs ffprobe; detects video vs image; applies per-type rules.
- Video report: width, height, duration, fps, codec. Warnings (never hard failures):
  duration > 15 s (payload), duration < 2 s (scrub too short), height < 1080.
- Image report: width, height, format. Warning: not 16:9-ish (tolerance ±5%).
- Exit codes: `0` valid (possibly with warnings), `1` file not found, `2` not decodable
  (one readable line summarizing ffprobe's stderr).
- Structure: thin `runFfprobe(file)` exec seam + pure `videoVerdict(probeJson)` /
  `imageVerdict(probeJson)` functions (unit-tested with canned ffprobe JSON).

### extract-frames.mjs `<in.mp4> <outDir> [--count 150] [--width 1600] [--format webp] [--quality 80] [--force]`
- Extracts **exactly `count`** frames, evenly sampled at timestamp midpoints
  (`t_i = (i + 0.5) · duration / count` — avoids t=0 junk frames and EOF seeks),
  scaled to `--width` (aspect preserved), named `frame-0001.<ext>` … 1-based, 4-padded.
  `count` must be 1..9999.
- Refuses a non-empty `outDir` without `--force`. `--force` means **wholesale atomic
  replacement, never in-place overwrite**: frames are written to a temp sibling dir,
  then swapped in (rename old out, rename new in, delete old) — so a 150-frame WebP
  set rerun as 100 JPGs can never leave a stale mixed tail behind.
- Prints summary: count, dimensions, total bytes, avg bytes/frame; warns when total
  > 12 MB with the knobs to turn (count, width, quality).
- Pure, exported, unit-tested: `framePlan(duration, count) → timestamps[]`, arg parsing,
  summary/budget computation. The ffmpeg invocation itself is covered by the
  integration test. Exact ffmpeg flags are an implementation-plan detail; the contract
  is exact count, even sampling, correct naming.

### scaffold-site.mjs `<projectDir> --config <values.json> [--force]`
- **Transactional: the live `site/` is only ever replaced by a complete, validated
  site.** Scaffold assembles `site.tmp/` — template copy, frames moved in, config
  derived and validated, README staged — and only after *everything* succeeds swaps it
  into place (`site` → `site.old` → `site.tmp` → `site`, then delete `site.old`). Any
  failure before the swap rolls back cleanly: frames move back to
  `<projectDir>/frames/`, `site/` and its old config remain exactly as they were. New
  frames paired with an old config is a state that cannot exist. (`--force` still
  gates replacing an existing site; re-scaffolding for a theme/copy tweak is the
  expected loop.)
- Frames install rule: if `<projectDir>/frames/` exists (fresh or re-extraction), it
  is moved into the new site (same-volume renames, zero copy) and replaces any
  previous set wholesale (regenerable from the mp4), with a printed notice. Only when
  no project-level `frames/` exists does the new site inherit the existing
  `site/frames/` (theme/copy-only re-scaffold — inherited by rename into `site.tmp/`
  before the swap). Neither present → clear error (extraction comes first).
  Re-extracted frames can therefore never be silently shadowed by the old published
  set.
- Derives `frames.count` and `frames.pattern` from disk, **validating the set is
  contiguous `1..N` in a single format** — gaps or mixed extensions are a blocking
  error naming the fix (re-run extraction). `frames.poster` comes from the creative
  values' `posterIndex` (default 1; error if outside `1..count`); merges; validates
  with the same `validateConfig` the template uses (template file is the single schema
  authority); writes `site/config.json` and `<projectDir>/README.md` (rerun commands).
  Errors block with a list; warnings print without blocking.
- Division of labor: creative translation (brief → values.json) is the agent's job —
  or a human's, in standalone use (documented example in README); deterministic assembly
  is the script's job.

### status.mjs `<projectDir> [--json] [--approve <step>]`
- Prints the resume report: per-step done / ready-unapproved / incomplete / stale, and
  the recommended resume step — the deterministic backbone of §3's resume rules, so
  the wizard runs a script instead of doing ad-hoc mtime math (and standalone users
  get a status command for free).
- `--approve <step>`: builds the gate's canonical manifest (sorted file hashes per §3),
  links it to the upstream gate's manifest hash, and writes the receipt into
  `approvals.json`. The wizard invokes this **only after** the user's explicit
  approval; it is the only writer of receipts.
- Core is the pure `resolveResume(inventory)` (inventory = paths + mtimes + keyframe
  plan parsed from `prompts/` filenames + receipts), unit-tested with synthetic
  inventories; the filesystem walk and hashing are thin seams.

## 6. Template and scrub engine

### config.json schema (v1)

```json
{
  "brand":    { "name": "…", "tagline": "…" },
  "theme":    {
    "bg": "#0a0a0a", "text": "#f5f5f5", "accent": "#e8ff47",
    "surface": "rgba(20, 20, 24, 0.55)", "radius": 10,
    "fonts": { "display": "…", "body": "…", "displayFile": "fonts/display.woff2" }
  },
  "frames":   { "count": 150, "pattern": "frames/frame-{index:4}.webp", "poster": "frames/frame-0001.webp" },
  "scrub":    { "heightVh": 400, "smoothing": 0.12 },
  "overlays": [
    { "at": [0.05, 0.25], "title": "…", "body": "…" },
    { "at": [0.35, 0.55], "title": "…", "body": "…", "hold": true, "position": "left",
      "stats": [ { "value": "…", "label": "…" } ],
      "cta": { "label": "…", "href": "…" } }
  ],
  "outro":    { "headline": "…", "body": "…", "cta": { "label": "…", "href": "#" } }
}
```

`{index:4}` = 1-based index, zero-padded to 4. `smoothing` = per-frame lerp alpha at a
60 fps reference (engine converts to a rate-independent decay constant). The
creative-values JSON passed to scaffold is this schema minus the `frames` block, plus
`posterIndex` (1-based frame number that becomes `frames.poster`; default 1). It lives
at `<project>/values.json` so staleness against `site/config.json` is checkable.

**Stopped scenes (`hold`)**: an overlay with `"hold": true` freezes the video during its
`at` range — the Apple pattern where motion pauses, a text/product callout lands, then
motion resumes. Implemented as a piecewise remap of scroll progress (see `applyHolds`):
hold ranges plateau, and the video's frames redistribute proportionally across the
moving segments, so scrub velocity stays constant and the mapping stays continuous and
monotonic. Overlay *opacity* is driven by raw scroll progress, so text appears while the
scene is stopped. `position` (`"center"` default, `"left"`, `"right"`) places the
caption via CSS classes so callouts can sit beside the subject.

**Overlay CTA**: any overlay (typically a hold) may carry `"cta": { "label", "href" }` —
rendered as a clickable button inside the caption, same shape as `outro.cta`. Clickability
requires the pointer-events split: the overlay layer is `pointer-events: none` (so
scrolling over the canvas never snags), interactive elements inside it are
`pointer-events: auto`. A stop with a product callout + buy button is the intended
Apple-style use.

**Overlay stats**: optional `"stats": [ { "value", "label" } ]` — a quiet row of
value+label chips inside the scene chip (battery hours, CO₂ per delivery, price). This
is the Tesla-configurator move adapted to scroll: the product holds center-stage while a
side-positioned panel presents its numbers and a CTA. Both registers use it (Apple spec
callouts, Zipline waypoint data).

**UI-in-the-scene rules** (how buttons and captions stay on-theme with the 3D world):

- Every visual token the UI uses comes from `theme` — the template hardcodes structure,
  never look. CSS custom properties are the only bridge.
- Overlay panels and buttons are **scene chips**: translucent `surface` fill +
  `backdrop-filter` blur + a 1px light-edge border — UI reads as glass floating in the
  scene (the canvas shows through), which is what makes it feel *inside* the world
  rather than pasted on. This chip treatment is the template's one signature element;
  everything else stays quiet. **Overlay text never sits raw on the canvas** — always
  on a chip — and `surface` alpha has a floor of 0.45 (a `validateConfig` error below
  it), because hex-vs-hex math can't see a busy video behind the text; the chip is the
  structural guarantee, and the hold-frame review (step 4) is the perceptual check.
  Graceful without backdrop-filter support: opaque-enough `surface` fallback.
- `radius` and `fonts` carry the scene's material mood into the UI (sharp/technical →
  small radius + grotesque stack; soft/organic → pill radius + humanist or serif
  stack). Fonts are free-form CSS font-family strings, system stacks by default, plus
  **at most one local display font**: `fonts.displayFile` names a `.woff2` the user (or
  wizard instructions) placed at `site/fonts/` — the engine registers it via the
  FontFace API (~6 lines), falling back to the `display` stack. Still zero network
  requests; without a file, type-led moods are executed through weight, tracking,
  case, and scale rather than pretending a system stack is Didot.
- Buttons say what they do ("Buy the lamp", "See the specs") — active voice, sentence
  case, no "Learn more" filler. Copy is design material; SKILL.md carries this rule
  into the stops questionnaire.
- Quality floor, non-negotiable and *enforced where computable*: visible keyboard
  focus (accent ring) on every interactive element; `prefers-reduced-motion` gets the
  static experience (below); AA contrast on deterministic pairs — `text` on `bg`, and
  CTA label on `surface` alpha-composited over `bg` — is a `validateConfig` **error**
  that blocks scaffold, not a warning. The agent picks the palette, so a blocked
  scaffold is the agent adjusting tokens, never the user fighting the tool. What math
  can't see (video behind a chip) is covered structurally (chips + alpha floor) and
  perceptually (hold-frame review).

### scrub-core.js — pure, zero DOM, fully unit-tested

| Function | Contract |
|---|---|
| `scrollProgress(scrollY, sectionTop, sectionHeight, viewportH)` | `clamp((scrollY − sectionTop) / (sectionHeight − viewportH), 0, 1)`; degenerate heights → 0 |
| `applyHolds(progress, holds)` | piecewise remap for stopped scenes: identity when `holds` is empty; plateaus during each `[start, end]`; continuous, monotonic, maps 0→0 and 1→1; video progress distributes over moving segments proportionally to their scroll length |
| `progressToFrame(progress, frameCount)` | `round(progress · (count − 1))`, clamped to `[0, count−1]` |
| `smooth(current, target, k, dt)` | exponential decay `current + (target − current) · (1 − e^(−k·dt))` — frame-rate-independent |
| `alphaToK(alpha)` | converts config `smoothing` (per-frame α @60 fps) to decay constant `k` |
| `coverRect(imgW, imgH, canvasW, canvasH)` | source crop `{sx, sy, sw, sh}`: cover-fit, centered |
| `canvasSize(cssW, cssH, dpr, maxDpr = 2)` | backing-store `{width, height}`, DPR capped |
| `frameFilename(index, pattern)` | expands `{index:N}` token, 1-based zero-pad |
| `overlayOpacity(progress, [start, end], fade)` | 0→1 ramp over `fade` at each edge, 1 inside, 0 outside; `fade` defaults to `min(0.05, (end−start)/2)` |
| `holdFrames(holds, frameCount)` | the exact frame index each hold freezes on (its plateau's effective progress through `progressToFrame`) — drives the step-4 hold-frame review |
| `recommendHeightVh(baseVh, holds)` | grows the page so motion pace stays constant. Scrollable distance is `height − 100vh` (the sticky viewport doesn't scrub), so: `100 + (baseVh − 100) / (1 − Σ hold spans)` — e.g. 400vh with 50% holds → 700vh, not 600. Also returns the between-stops speed-up factor for display |
| `decodeWindow(targetIndex, n, frameCount, direction)` | the set of frame indices that should hold decoded bitmaps: current ± n, biased toward scroll `direction`, clamped to `[0, count−1]` — the memory bound of the engine |
| `contrastRatio(colorA, colorB)` | WCAG 2.x relative-luminance contrast ratio (1–21), with rgba-over-bg compositing helper for `surface` |
| `validateConfig(obj)` | returns `{ errors, warnings }`, both typed and human-readable; valid = no errors. **Errors:** every `at` within `[0, 1]` with `start < end`; hold ranges non-overlapping and not covering all of `[0, 1]`; CTA (overlay and outro) if present needs non-empty `label` and an `href` whose scheme is allowed — `https:`, `http:`, `mailto:`, `tel:`, relative paths, or `#anchors`; `javascript:` and unknown schemes are errors; `stats` entries need non-empty `value` and `label`; theme colors parse as hex/rgba; `radius` non-negative; `surface` alpha ≥ 0.45; `fonts.displayFile` if present must be a normalized relative path of the form `fonts/<name>.woff2` — no URLs, no `..`, nothing outside `site/fonts/` (self-contained contract); AA (4.5:1) on `text`/`bg` and on CTA label / `surface`-composited-over-`bg`. **Warnings:** total frames outside 24–400; `displayFile` named but missing on disk (scaffold-side check; engine falls back to the stack) |

### scrub-engine.js — DOM glue, covered by the browser smoke suite

Fetches `config.json` (fails loudly on `validateConfig` errors, console-warns on
warnings). Loading: the poster is a **real `<img>` element** layered with the canvas —
canvas paints are not LCP candidates per the LCP processing model, so the `<img>` is
what makes the chosen strong frame the actual LCP (and it carries the alt text). It
loads first and fades out once the canvas takes over; the remaining frames preload
behind a quiet progress indicator — and **the page is scrollable the whole time**:
copy, overlays, and outro are live while the poster holds, so a slow connection delays
the scrub, never the site. **Memory is bounded**: preloading holds compressed bytes
only (the payload budget); decoded bitmaps live in a window of current ± N frames
(`decodeWindow` below, N ≈ 12), created via `createImageBitmap` prioritized toward the
lerp target and `close()`d on exit — never 150 × 1600 × 900 × 4 bytes of decoded RGBA
at once. Draws fall back to the compressed `Image` when a bitmap isn't ready (one-time
jank beats memory death); a frame that *fails to load* is skipped — the engine keeps
rendering the nearest loaded frame and console-warns once. rAF loop redraws only when
the smoothed frame index changes; ResizeObserver + DPR handling; Lenis initialized if
`lenis.js` is present; registers `fonts.displayFile` via the FontFace API when set.
Frame index is computed from
`applyHolds(rawProgress, holdRanges)`; overlay opacity from raw progress — that
ordering is what makes text land while the scene stands still. **Invisible means
inoperable:** when an overlay's opacity falls below ~0.05 the engine sets `inert` on
it (removing hit-testing, keyboard focus, and assistive-tech exposure in one
attribute) — opacity alone would leave ghost CTAs clickable and tab-reachable; the
pointer-events split governs only the *visible* state.

**Reduced motion = the static experience, not a tamer scrub.** Under
`prefers-reduced-motion` the engine skips frame preloading entirely (≈ the whole
payload saved), renders the poster as a fixed hero, and the template lays the overlays
out as ordinary stacked sections flowing into the outro — the content without the
motion, which is what that preference is asking for.

Pure logic (windowing, mapping) lives in `scrub-core.js` under unit tests; the DOM
behavior is exercised by the browser smoke suite (§7) plus the preview gate.

### index.html / style.css

Sticky full-viewport canvas inside a `scrub.heightVh`-tall section; overlay captions
absolutely positioned (position classes: center/left/right), opacity driven by
`overlayOpacity`, optional stats chips and CTA button per overlay (pointer-events split
per §above);
outro section (headline, body, CTA button) and minimal footer; theme colors applied
from config as CSS custom properties. Loading strategy v1: preload-all + poster-first paint (progressive loading
is out of scope).

## 7. Testing strategy (TDD, red/green/refactor, small commits)

- **Unit (vitest, no browser, no ffmpeg):**
  - every `scrub-core.js` function — mapping, clamping, NaN/degenerate inputs, cover
    math, DPR caps, opacity ramps, pattern expansion, config validation errors;
    `applyHolds`: identity with no holds, exact plateau across each hold, continuity at
    hold boundaries, monotonicity, 0→0 / 1→1, multiple holds, and validation rejection
    of overlapping/out-of-range holds, malformed CTAs (missing/empty label or href),
    and malformed stats entries;
    `contrastRatio`: black/white = 21, same color = 1, a known mid pair, rgba-over-bg
    compositing, and `validateConfig` **erroring** on an AA-failing theme and on
    `surface` alpha < 0.45;
    `holdFrames`: freeze-frame indices for zero/one/many holds, edges;
    `decodeWindow`: window contents at start/middle/end of range, direction bias,
    window ⊆ `[0, count−1]`, n ≥ count degenerates to all frames;
    `recommendHeightVh`: no holds = base; 400vh with 50% holds = 700vh; speed-up factor;
    href scheme allowlist (`javascript:` rejected, relative/`#`/`mailto:` accepted) and
    `displayFile` path rules (URL and `..` traversal rejected);
  - `resolveResume` with synthetic inventories: fresh chain with matching receipts
    (done), artifact present but receipt missing or manifest-mismatched (resume at
    that gate), **upstream re-approval invalidating every descendant receipt** (chain
    break → those gates read "needs re-review"), missing plan role (incomplete), video
    newer than frames (stale), project frames newer than site frames (site build
    stale), brief newer than config (stale), keyframes newer than video (report-only);
  - `videoVerdict` / `imageVerdict` fed canned ffprobe JSON (valid, warning-laden,
    garbage);
  - `extract-frames` arg parsing, `framePlan` (exact count, even spacing, midpoint
    offsets), budget summary + 4G load-estimate math;
  - `scaffold-site` config merge, frames-block derivation (contiguity + single-format
    validation: gaps and mixed extensions are blocking errors), frames install/replace
    semantics (fresh move; atomic replace when both dirs exist), `posterIndex` range
    validation, and **transaction rollback**: an induced validation failure leaves
    `site/`, its old config, and `<project>/frames/` exactly as they were (against a
    temp dir);
  - `extract-frames` `--force` swap semantics: rerun with a different count/format
    leaves exactly the new set, no stale tail.
- **Integration (requires ffmpeg; suite self-skips with a clear message when absent):**
  1. `beforeAll`: generate fixture `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=15`
     (no binary committed).
  2. `validate-media` on it → valid, expected warnings (< 1080p).
  3. `validate-media` on a text file renamed `.mp4` → exit 2, readable error.
  4. `extract-frames --count 24` into `<project>/frames/` → exactly 24 files
     `frame-0001..0024.webp`, all nonzero size.
  5. `scaffold-site` with a sample values.json (incl. `posterIndex: 12`) → `site/`
     contains every template file; `<project>/frames/` is gone and `site/frames/` has
     the 24; `config.json` parses; `frames.count === 24`; `frames.poster` resolves to
     frame 12; expanding `frames.pattern` for indices 1 and 24 resolves to files that
     exist; `index.html` references the engine and config.
  6. `status --approve` for each gated step, then `status` → all steps done; without
     the approvals, the same project reports ready-unapproved at the first gate. Touch
     the fixture mp4 to be newer than `site/frames/` → extraction reported stale.
  7. Re-extract `--count 12 --format jpg` + re-scaffold → `site/frames/` holds exactly
     12 jpgs, config says 12, old webps gone.
- **Browser smoke suite (Playwright + Chromium; self-skips with a clear message when
  browsers aren't installed):** one spec file against the integration-built site
  served locally. Asserts: poster `<img>` visible before frames finish; scrolling
  changes rendered canvas pixels; a hidden overlay is `inert` while a visible
  overlay's CTA is keyboard-focusable; `prefers-reduced-motion` emulation yields the
  static layout and requests no frame images; deleting one frame file still renders
  (nearest-loaded fallback, single console warning). Deliberately one file, a handful
  of assertions — a smoke test for the riskiest runtime behavior, not an E2E matrix.
- **Template/scripts are written once and tested** — the skill copies and configures
  them per project, never regenerates them. Tests import the actual shipped files
  (`template/scrub-core.js`, script exports), not copies.

## 8. Cross-harness support

The SKILL.md format is a cross-tool standard; the same file serves Claude Code, Codex,
and Grok Build (see §2 install junctions). Consequences for how SKILL.md is written:

- Frontmatter: `name: scroll-wizard` + a trigger-rich `description` (scroll-scrub video
  site, scrollytelling, Apple-style product page, canvas frame animation…). No
  harness-specific frontmatter fields.
- Body never names harness-specific tools. Gates: "show the user X, ask for explicit
  approval, wait." Images: "view the image file." Actions: plain shell (`node scripts/…`).
- Gating relies on the host model following instructions, so the gate rule appears
  redundantly: once in the iron rules, once per step.
- API mode phrased as "if gemini-media-mcp tools are available in this session" — all
  three harnesses support MCP; manual fallback is identical everywhere.
- Codex's optional `agents/openai.yaml` metadata: out of scope v1.

## 9. Prompt-craft guidance encoded in SKILL.md

- **Two registers, named after their inspirations.** The wizard classifies every brief
  into one and lets it drive keyframe plans, stop defaults, and copy tone:
  - **Product scrub (Apple register)** — one hero subject, camera orbits/dollies/reveals
    around it; stops are feature callouts beside the subject; UI whisper-quiet, type-led;
    outro CTA is the purchase/signup moment. Keyframe default: `first` (+ `last` for
    orbit/reveal endpoints). Strong variants: **exploded-teardown** (Ray-Ban Meta — the
    product decomposes into labeled components as you scroll, still one continuous take),
    **peel-back** (AVATR — layers strip away, exterior to interior), **light-sweep**
    (Chanel J12 — camera near-still while light travels across the material; the light
    is the motion).
  - **Journey (Zipline register)** — the camera *travels* (fly-through, descent, route);
    stops are waypoints in a story, often data/stat callouts ("2 g CO₂ per delivery"),
    with scale shifts (macro ↔ aerial) as the drama; outro lands the destination.
    Keyframe default: `first` + `last` (origin and destination are the narrative), stops
    planned as waypoints at intake. Strong variants: **scale-travel** (Chizzy — one
    continuous zoom from cosmic to subatomic; iCoMat — factory floor to fiber), and
    **world-as-brand** (Igloo.inc — the journey traverses a built world that *is* the
    brand identity).
  These are registers to reason from, not sites to copy — palette and type still derive
  from this brief's own scene (§6).
- **Mood vocabulary for the art-direction pass** — internal reference points for the
  agent, not a menu (register = narrative shape; mood = surface treatment):
  - *Quiet premium* (Apple) — near-black or near-white field, type-led, one accent.
  - *Data journey* (Zipline) — stats as protagonists, cartographic restraint.
  - *Glossy object-world* (Nothin', noth.in) — playful tactile 3D materials (foil,
    balloon, candy-wrap), bold statement type with generous spacing; suits expressive
    briefs where the subject IS a rendered object.
  - *Engineer minimal* (haoqi.design; wireframe extension: Terminal Industries) —
    monochrome + one selective accent, utility type, ambient metadata as texture
    (coordinates, timestamps, frame counter — the frame counter is already honest data
    the scrub engine has); blueprint/wireframe texture for deep-tech briefs.
  - *Configurator stop* (Tesla; Scout Motors) — a stopped scene treated as a spec
    panel: product centered, side panel with `stats` rows and a decisive CTA;
    immersion that accelerates the purchase decision instead of delaying it.
  - *Cinematic story* (Valentime by Noomo) — scroll as film: narrative chapters with
    emotional pacing, elegant restrained type over atmospheric scenes, whitespace as
    drama; suits journey-register briefs that are stories rather than data.
  - *Luxury material* (Chanel J12, Cartier Watches & Wonders) — the material is the
    protagonist: light on ceramic, jewel detailing; serif elegance, deep dark field,
    very few words; pairs naturally with the light-sweep motion type.
  - *Soft editorial* (Microsoft.ai) — the warm counterpoint: paper tones, organic
    texture, humanist type, journal-like rhythm; for briefs that should feel human and
    calm rather than dark and technical.
  **Guardrail — no explicit borrowing without a strong match.** This vocabulary is for
  the agent's private reasoning. The vibe question stays open-ended; the agent matches
  the user's answers against the vocabulary silently, and only surfaces or applies a
  named mood when the user's own prompting is a strong match — their brief clearly
  evokes it, or they name the site/brand themselves. Default is always direction
  derived from this brief's copy and this scene's frames; a matched mood is a starting
  point to blend, never a costume. The stops questionnaire offers `stats` whenever a
  stop is a product highlight or waypoint (that's a feature, not a look). The
  art-direction pass also steers *away* from the stock AI-generated looks (near-black
  field + single acid accent; warm cream + terracotta serif; broadsheet hairlines)
  unless the brief itself asks for one — deriving from the frames is the antidote.
- **One continuous shot, no cuts** — a scene cut destroys the scrub illusion; this is
  the single most important constraint and appears in every video prompt.
- Slow, constant-velocity camera motion matched to the brief's motion type; 6–8 s
  duration target; no on-screen text (overlays are the site's job); high-detail static
  subject, moving camera (or slow subject morph) rather than fast action.
- Keyframe-plan heuristics per motion type (dolly → `first`; orbit/reveal → `first`+`last`;
  exploded-teardown → `first` assembled + `last` exploded; scale-travel → `first` wide +
  `last` close; product consistency → `ref` set), and image prompts specify 16:9, no
  text, no watermarks, consistent palette drawn from the brief.
- When the brief includes stopped scenes, the video prompt asks for composed "beats" —
  moments mid-motion where the framing reads well as a held still (subject fully in
  frame, no motion blur) — so hold plateaus land on frames worth stopping on.
- Veo 3.1 / Flow mode mapping: which Flow feature to use per keyframe plan
  (Text / Image / Frames to Video / Ingredients), kept adaptable since Flow's UI evolves.

## 10. Error handling

| Failure | Behavior |
|---|---|
| ffmpeg/ffprobe missing | Preflight stops with per-OS install instructions (winget/brew/apt) |
| `input/` has no mp4 | Re-show the handoff card, end turn (manual protocol §4) |
| `input/` has multiple mp4s | Ask the user which one; never guess |
| AA contrast error / surface alpha < 0.45 | Scaffold blocks; the agent adjusts theme tokens and re-runs (user never fights it) |
| `posterIndex` outside `1..count` | Scaffold error |
| Artifact stale on resume (§3) | Free steps re-run automatically; money steps reported + asked |
| Gated artifact present but receipt missing/mismatched | Resume lands AT that gate — approval is re-requested, never assumed |
| Corrupt / fake mp4 (HTML saved as .mp4) | `validate-media` exit 2 with one-line cause |
| Non-empty extraction outDir | Refuse without `--force` |
| MCP unavailable/fails in api mode | Fall back to manual with the same prompt file |
| Invalid merged config | `scaffold-site` exits nonzero listing `validateConfig` errors |
| Gate rejection | Loop step with feedback; superseded prompt → `prompts/history/`, revision takes the active name |
| count > 9999 or < 1 | Arg validation error (pattern is 4-padded) |

## 11. Out of scope (v1)

Progressive/adaptive frame loading, multi-resolution frame sets, multiple template
themes (one template, config-themed), AVIF, deploy automation, custom preview server,
state files, npm publishing (layout ready only), Codex `openai.yaml` metadata,
cross-browser test matrix (the single Chromium smoke suite IS in scope), webfont
fetching/subsetting (one user-supplied local `.woff2` IS supported), image slots in
overlays (the video is the product shot), ambient audio / sound toggle (a Valentime
signature, but out of scope), mechanical API spend-lock (a wrapper owning MCP
generation calls — gates are instruction-enforced in v1).

## 12. Deferred to implementation plan

Exact ffmpeg invocation for exact-N extraction (N seeks vs select filter), webp encoder
options, Lenis version to vendor and pin, SKILL.md description wording, vitest config
details, the 4G throughput constant used in load estimates, exact payload-preset
numbers.
