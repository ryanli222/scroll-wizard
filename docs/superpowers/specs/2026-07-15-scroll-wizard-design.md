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
  (`scroll-wizard-validate`, `scroll-wizard-extract`, `scroll-wizard-scaffold`) and a
  `files` whitelist (`scripts/`, `template/`, `SKILL.md`). Publishing is a later task.
- **Dependencies**: zero runtime deps (webp encoding is done by ffmpeg itself). Dev deps:
  vitest only. Node >= 20. ffmpeg/ffprobe are external prerequisites, checked at preflight.
- Scripts export their pure functions and detect direct CLI invocation, so vitest imports
  them without spawning processes.

## 3. Generated project layout

The wizard creates `<cwd>/<project-name>/` where invoked:

```
<project>/
  brief.md                  # step 1 artifact: brand, vibe, motion type, copy
  README.md                 # exact rerun commands (reproducibility without the skill)
  prompts/
    keyframe-first.txt      # paste-ready Flow prompts, one file per image
    keyframe-last.txt       # (only the files the keyframe plan calls for)
    ref-1.txt .. ref-3.txt
    video.txt               # Veo 3.1 prompt; revisions saved as video-v2.txt, never overwritten
  input/
    keyframes/first.png|jpg # fixed role names: first, last, ref-1..ref-3
    video.mp4               # the generated clip (any single *.mp4 in input/ is accepted)
  site/                     # the deliverable — self-contained static site
    index.html  style.css  scrub-core.js  scrub-engine.js  lenis.js  config.json
    frames/frame-0001.webp .. frame-NNNN.webp
```

**Resume = filesystem-as-state.** No state file. Re-invoking the skill inspects the
project dir and offers to continue at the first incomplete step:

| Artifact present            | Step considered done |
|-----------------------------|----------------------|
| `brief.md`                  | 1 intake             |
| `input/keyframes/*` valid   | 2 keyframes          |
| `input/*.mp4` valid         | 3 video              |
| `site/frames/*` non-empty   | 4 extraction         |
| `site/config.json` valid    | 5 site build         |

Money is never re-spent: the mp4 on disk is the checkpoint.

## 4. Wizard flow (8 steps, hard gates)

Iron rules, stated bluntly at the top of SKILL.md and repeated per step:

1. **Never pass a gate without the user's explicit approval.** Show the artifact, ask,
   wait. "Redo" loops the step with the user's feedback; revised prompts get `-v2`, `-v3`
   suffixes.
2. **Never spend money without approval of the exact prompt** (API mode).
3. **Never hand-edit or regenerate the template files** — configuration happens only
   through `config.json` values.
4. All user interaction phrased harness-neutrally (see §8).

Steps:

- **0 — Preflight.** `ffmpeg`/`ffprobe` on PATH (else per-OS install instructions and
  stop). Node >= 20. Mode: `manual` (default) or `api` if gemini-media-mcp tools are
  detected in the session. If the target project dir already exists, run resume detection.
- **1 — Intake** → `brief.md`. Brand name, vibe/palette, motion type (orbit / dolly /
  reveal / macro / morph / journey-flythrough…), outro copy + CTA, project name, mode
  choice, frame budget (default 150). The wizard first establishes the **register**
  (§9): product scrub or journey — it shapes every default that follows. Then the **stops questionnaire** — the wizard asks the user explicitly,
  one question at a time (proposing defaults, e.g. 2–3 stops for a 400vh scrub):
  1. **How many stops** (stopped scenes) the page should have — zero is fine.
  2. **What each stop is for** — feature callout, product highlight, plain caption,
     brand statement…
  3. **Which product** (if any) each stop showcases, and the copy for it (title/body).
  4. **Any clickable buttons** — per stop, an optional button label + destination URL
     (buy page, spec sheet, signup…), plus placement (center/left/right).
  Non-stop overlays (captions that ride over motion) are gathered the same way.
  *Gate: approve the brief.*
- **2 — Keyframes (skippable).** The agent proposes a keyframe plan suited to the motion
  type:
  - `first` only (default) — image-to-video seed; e.g. a dolly-in needs one strong opener.
  - `first` + `last` — motion with a designed destination (orbit ending on the logo,
    a reveal ending open). Veo interpolates between them.
  - up to 3 `ref` images — Flow "Ingredients" mode, when subject consistency matters
    more than exact endpoints.
  One paste-ready prompt file per image. Manual mode: user generates in Flow (free on
  their plan) and drops files into `input/keyframes/` under role names. API mode:
  image generation via MCP after prompt approval. The agent **views every image** and
  critiques the set as a set — palette, subject, lighting coherence — because
  cross-frame coherence is what makes the scrub feel continuous. `first` doubles as the
  site's instant-load poster. Validation: each file exists and ffprobe decodes it as an
  image. *Gate: approve the keyframe set.*
- **3 — Video** → `prompts/video.txt`. Veo 3.1-optimized prompt; names the Flow mode to
  use (Text / Image / Frames to Video / Ingredients) and references approved keyframes.
  Prompt-craft rules encoded in SKILL.md (§9). Manual: generate in Flow, drop
  `input/video.mp4`. API: MCP call; **any MCP failure falls back to manual with the same
  prompt file** (fallback costs nothing by construction). Then `validate-media.mjs` runs.
  *Gate: user has watched the clip and approves.*
- **4 — Frame extraction.** `extract-frames.mjs input/video.mp4 site/frames/ --count N`
  (extraction targets `site/frames/` directly even though scaffold runs later — avoids
  copying 150 files; `scaffold-site` treats an existing `frames/` as data, never clobbers
  it). Reports frame count, dimensions, total MB against a ~12 MB soft budget. The agent
  views 2–3 sample frames to sanity-check visual quality. *Gate: approve payload + quality.*
- **5 — Site build.** Starts with an **art-direction pass**: the agent views 2–3
  extracted frames and derives the theme *from the actual scene* — palette sampled from
  the imagery (bg from the scene's darks, accent from its most saturated material,
  `surface` as a translucent scene-dark), material mood → `radius` and font stacks,
  per §6's UI-in-the-scene rules. This is what keeps buttons and captions on-theme with
  the 3D world instead of generic UI. The agent then writes the creative-values JSON
  (brief copy + derived theme) and runs `scaffold-site.mjs <project> --config values.json`.
  The script copies the template verbatim, derives the `frames` block from what is
  actually on disk (single source of truth), merges, validates (blocking on errors,
  printing contrast warnings), writes `site/config.json` and the project README. No
  separate gate — but the theme rationale (each token + one line of why, traced to the
  frames) is presented alongside the preview URL at the step-6 gate.
- **6 — Preview.** Any static server; documented default `npx serve site`. The agent
  reminds the user what to check: scrub smoothness, overlay timing, mobile viewport.
  *Gate: user scrolled it and it feels right.*
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
- Refuses a non-empty `outDir` without `--force`.
- Prints summary: count, dimensions, total bytes, avg bytes/frame; warns when total
  > 12 MB with the knobs to turn (count, width, quality).
- Pure, exported, unit-tested: `framePlan(duration, count) → timestamps[]`, arg parsing,
  summary/budget computation. The ffmpeg invocation itself is covered by the
  integration test. Exact ffmpeg flags are an implementation-plan detail; the contract
  is exact count, even sampling, correct naming.

### scaffold-site.mjs `<projectDir> --config <values.json> [--force]`
- Copies `template/` → `<projectDir>/site/` (existing `site/frames/` is preserved;
  other existing template-owned files require `--force`).
- Requires non-empty `site/frames/` (extraction precedes it in the flow); errors with a
  clear message otherwise.
- Derives `frames.count`, `frames.pattern`, `frames.poster` from disk; merges with the
  creative values JSON; validates the merged config with the same `validateConfig` the
  template uses (template file is the single schema authority); writes `site/config.json`
  and `<projectDir>/README.md` (rerun commands). Exits nonzero listing errors; prints
  warnings (e.g. AA contrast failures) without blocking.
- Division of labor: creative translation (brief → values.json) is the agent's job —
  or a human's, in standalone use (documented example in README); deterministic assembly
  is the script's job.

## 6. Template and scrub engine

### config.json schema (v1)

```json
{
  "brand":    { "name": "…", "tagline": "…" },
  "theme":    {
    "bg": "#0a0a0a", "text": "#f5f5f5", "accent": "#e8ff47",
    "surface": "rgba(20, 20, 24, 0.55)", "radius": 10,
    "fonts": { "display": "…", "body": "…" }
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
creative-values JSON passed to scaffold is this schema minus the `frames` block.

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
  everything else stays quiet. Graceful without backdrop-filter support: opaque-enough
  `surface` fallback.
- `radius` and `fonts` carry the scene's material mood into the UI (sharp/technical →
  small radius + grotesque stack; soft/organic → pill radius + humanist or serif
  stack). Fonts are free-form CSS font-family strings but **system stacks only** — the
  site stays self-contained with zero font downloads (local font files: out of scope v1).
- Buttons say what they do ("Buy the lamp", "See the specs") — active voice, sentence
  case, no "Learn more" filler. Copy is design material; SKILL.md carries this rule
  into the stops questionnaire.
- Quality floor, non-negotiable: visible keyboard focus (accent ring) on every
  interactive element; `prefers-reduced-motion` respected; text-on-bg and
  CTA-label-on-surface must clear WCAG AA (see `contrastRatio` below).

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
| `contrastRatio(hexA, hexB)` | WCAG 2.x relative-luminance contrast ratio (1–21); used by `validateConfig` to enforce the AA floor |
| `validateConfig(obj)` | returns `{ errors, warnings }`, both typed and human-readable; valid = no errors. Error rules: every `at` within `[0, 1]` with `start < end`; hold ranges must not overlap each other or cover the entire `[0, 1]` range; CTA (overlay and outro alike) if present needs non-empty `label` and `href`; `stats` entries if present need non-empty `value` and `label`; theme colors parse as hex/rgba, `radius` a non-negative number. Warning rules: `theme.text` vs `theme.bg` or CTA label vs `surface`-over-`bg` contrast below 4.5:1; total frames outside 24–400 |

### scrub-engine.js — DOM glue, untested by design

Fetches `config.json` (fails loudly on `validateConfig` errors, console-warns on
warnings), paints poster immediately,
preloads all frames with a progress bar, rAF loop that redraws only when the smoothed
frame index changes, ResizeObserver + DPR handling, initializes Lenis if `lenis.js` is
present, honors `prefers-reduced-motion` (direct index mapping, no lerp, no Lenis).
Frame index is computed from `applyHolds(rawProgress, holdRanges)`; overlay opacity from
raw progress — that ordering is what makes text land while the scene stands still.
Covered by the preview gate and integration file-level assertions, not unit tests.

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
    `contrastRatio`: black/white = 21, same color = 1, a known mid pair, and
    `validateConfig` emitting a contrast warning for a failing theme while still
    returning zero errors;
  - `videoVerdict` / `imageVerdict` fed canned ffprobe JSON (valid, warning-laden,
    garbage);
  - `extract-frames` arg parsing, `framePlan` (exact count, even spacing, midpoint
    offsets), budget summary math;
  - `scaffold-site` config merge + frames-block derivation (against a temp dir).
- **Integration (requires ffmpeg; suite self-skips with a clear message when absent):**
  1. `beforeAll`: generate fixture `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=15`
     (no binary committed).
  2. `validate-media` on it → valid, expected warnings (< 1080p).
  3. `validate-media` on a text file renamed `.mp4` → exit 2, readable error.
  4. `extract-frames --count 24` → exactly 24 files `frame-0001..0024.webp`, all
     nonzero size.
  5. `scaffold-site` with a sample values.json → `site/` contains every template file;
     `config.json` parses; `frames.count === 24`; expanding `frames.pattern` for
     indices 1 and 24 resolves to files that exist; `index.html` references the engine
     and config.
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
    orbit/reveal endpoints).
  - **Journey (Zipline register)** — the camera *travels* (fly-through, descent, route);
    stops are waypoints in a story, often data/stat callouts ("2 g CO₂ per delivery"),
    with scale shifts (macro ↔ aerial) as the drama; outro lands the destination.
    Keyframe default: `first` + `last` (origin and destination are the narrative), stops
    planned as waypoints at intake.
  These are registers to reason from, not sites to copy — palette and type still derive
  from this brief's own scene (§6).
- **Mood vocabulary for the art-direction pass** (register = narrative shape; mood =
  surface treatment; the pass may blend, always traced to this brief's frames):
  - *Quiet premium* (Apple) — near-black or near-white field, type-led, one accent.
  - *Data journey* (Zipline) — stats as protagonists, cartographic restraint.
  - *Glossy object-world* (Nothin', noth.in) — playful tactile 3D materials (foil,
    balloon, candy-wrap), bold statement type with generous spacing; suits expressive
    briefs where the subject IS a rendered object.
  - *Engineer minimal* (haoqi.design) — monochrome + one selective accent, utility
    type, ambient metadata as texture (coordinates, timestamps, frame counter) — the
    frame counter is already honest data the scrub engine has.
  - *Configurator stop* (Tesla) — a stopped scene treated as a spec panel: product
    centered, side panel with `stats` rows and a decisive CTA.
  Intake's vibe question offers this vocabulary; the stops questionnaire offers `stats`
  whenever a stop is a product highlight or waypoint.
- **One continuous shot, no cuts** — a scene cut destroys the scrub illusion; this is
  the single most important constraint and appears in every video prompt.
- Slow, constant-velocity camera motion matched to the brief's motion type; 6–8 s
  duration target; no on-screen text (overlays are the site's job); high-detail static
  subject, moving camera (or slow subject morph) rather than fast action.
- Keyframe-plan heuristics per motion type (dolly → `first`; orbit/reveal → `first`+`last`;
  product consistency → `ref` set), and image prompts specify 16:9, no text, no
  watermarks, consistent palette drawn from the brief.
- When the brief includes stopped scenes, the video prompt asks for composed "beats" —
  moments mid-motion where the framing reads well as a held still (subject fully in
  frame, no motion blur) — so hold plateaus land on frames worth stopping on.
- Veo 3.1 / Flow mode mapping: which Flow feature to use per keyframe plan
  (Text / Image / Frames to Video / Ingredients), kept adaptable since Flow's UI evolves.

## 10. Error handling

| Failure | Behavior |
|---|---|
| ffmpeg/ffprobe missing | Preflight stops with per-OS install instructions (winget/brew/apt) |
| `input/` has no mp4 | Wait state: remind user where to drop the file |
| `input/` has multiple mp4s | Ask the user which one; never guess |
| Corrupt / fake mp4 (HTML saved as .mp4) | `validate-media` exit 2 with one-line cause |
| Non-empty extraction outDir | Refuse without `--force` |
| MCP unavailable/fails in api mode | Fall back to manual with the same prompt file |
| Invalid merged config | `scaffold-site` exits nonzero listing `validateConfig` errors |
| Gate rejection | Loop step with feedback; new prompt files suffixed `-v2`, `-v3` |
| count > 9999 or < 1 | Arg validation error (pattern is 4-padded) |

## 11. Out of scope (v1)

Progressive/adaptive frame loading, multi-resolution frame sets, multiple template
themes (one template, config-themed), AVIF, deploy automation, custom preview server,
state files, npm publishing (layout ready only), Codex `openai.yaml` metadata,
browser-based E2E tests, local font files (system stacks only in v1), image slots in
overlays (the video is the product shot).

## 12. Deferred to implementation plan

Exact ffmpeg invocation for exact-N extraction (N seeks vs select filter), webp encoder
options, Lenis version to vendor and pin, SKILL.md description wording, vitest config
details.
