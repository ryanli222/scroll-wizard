# Scroll Wizard v2 — Storyboard-First Pipeline, Video Scrub, Pencil Loop

Date: 2026-07-18
Status: Approved design, pending implementation plan

## Problem

Three inadequacies in the current skill, confirmed against the `scrollcar` project:

1. **Runtime performance.** The generated site extracts 100+ webp frames from the
   video and preloads all of them before hiding the loader. Payload is several MB
   and startup blocks on the full fetch.
2. **Workflow cost/speed.** Feedback arrives only after the paid/time-expensive
   video generation. Overlay copy, layout, and beat placement are iterated blind.
3. **Visual quality.** Overlay placement and beat timing are guessed numerically in
   `values.json` instead of seen and adjusted.

Research input: [oso95/scroll-world](https://github.com/oso95/scroll-world). Key
findings adopted: native `<video>` seek-scrubbing instead of frame extraction
(blob-load, seek coalescing, poster-until-first-paint, iOS priming), linger easing,
distance-based lazy loading. Key finding rejected: multi-scene connector-clip
pipeline (~2N-1 paid video generations for N scenes — the cost structure we are
explicitly avoiding).

## Design

### 1. Dual playback modes

`values.json` / `config.json` gain `scrub.mode: "video" | "frames"` (default
`"video"` when a video exists, `"frames"` otherwise).

**Video mode** (new, default):

- A local ffmpeg step re-encodes `input/video.mp4` all-intra (`-g 1`) so every
  frame is a keyframe and seeking is instant. Free, local, no quality gate needed
  beyond the existing video gate.
- Engine blob-loads the mp4 (`fetch` → `blob:` URL), scrubs `video.currentTime`
  from smoothed scroll progress.
- Seek coalescing: never issue a seek while `video.seeking`; adaptive seek epsilon
  (smaller on desktop, larger on coarse pointers).
- The existing poster `<img>` stays visible until the first `seeked` event paints,
  then swaps via a class toggle.
- iOS priming: muted `play()` → `pause()` on first user gesture so the first seek
  paints instead of staying blank.
- Linger easing: optional per-hold cubic remap that slows playback where overlay
  copy peaks and accelerates between beats. Pure function in `scrub-core.js` with
  endpoints fixed at f(0)=0, f(1)=1.
- Reduced motion: video never loads; poster + always-visible overlays (current
  behavior).

**Frames mode** (existing engine, kept):

- Used for the stills-only site (§3), as fallback where video scrubbing proves
  choppy, and for very short sequences.
- Fix the startup block: hide the loader once the poster plus the initial decode
  window are ready, not after `preloadAll` completes; `preloadAll` continues in
  the background.

Payload becomes an explicit intake knob, always presented with an estimated
size and mid-4G load time: in frames mode it is extraction density
(count / width / format / quality); in video mode it is the re-encode's
resolution and quality (CRF).

### 2. Storyboard step (new; replaces the keyframes step)

Between intake and video:

- Intake asks for a **beat count** (3–10). Each beat = one still + one overlay
  (title/body/stats/CTA/position/hold).
- One still per beat is produced through the existing keyframe machinery: manual
  Flow handoff cards by default, or per-image money-gated API calls.
- **Pencil review loop:** each accepted still is loaded into a Pencil canvas —
  still as background layer, overlay content as editable text/frame nodes. The
  user iterates visually (position, copy, hierarchy); screenshots verify state.
  On approval, node geometry and copy export back into `values.json` overlays:
  `position`, normalized `at` ranges, `hold` flags, copy text.
- Pencil availability is checked at preflight. When absent, the loop degrades to
  the current flow (numeric overlay editing in `values.json` + browser preview).
- Gate: the existing `keyframes` gate becomes the **storyboard** gate — approve
  the reviewed beat set (stills + overlays) as a whole.

### 3. Stills-only preview site (free tier)

Immediately after the storyboard gate, scaffold a site from the beats alone:
frames mode with N = beat count, crossfading between stills, overlays live. Two
uses:

- **Zero-video budget mode.** Shippable as-is; no video is ever generated.
- **Storyboard proof.** The approved stills become the video generation's
  keyframes (first / last / refs), so the one paid generation is aimed by cheap
  iteration instead of guesswork.

### 4. Video generation budget menu

At the point video is chosen (after the storyboard gate), present a menu of
generation routes with cost character — never assume a single vendor:

| Route | Cost character | Notes |
|---|---|---|
| Manual handoff (Flow or any tool the user has) | User's own plan credits | Default, current behavior |
| Seedance / Kling API | Per-clip API pricing | Frame-locked models; needed if seams ever matter |
| Higgsfield API | Per-clip, typically pricier | scroll-world's default; offered, not assumed |
| Shorter/lower-res variant of any route | Cheapest paid | 4–6 s, 720p; fine for scrub since playback is scroll-paced |
| No video | Free | Stills-only site from §3 |

Rules: only offer API routes actually available in the current session
(preflight-verified, per the existing "never promise unconfirmed capability"
rule); every API call keeps the existing per-call money gate (exact prompt +
cost statement + approval). The menu shows an estimated cost per route before
the user picks.

### 5. Apple product register (deepened at intake)

The existing product-scrub register gains:

- Prompt craft aimed at a hero product on clean ground: orbit / dolly /
  light-sweep / peel-back, no environment fly-through.
- Holds aligned to feature beats, with composed blur-free frames requested at
  each hold point.
- Linger easing on by default in this register so motion settles where overlays
  peak.

The journey register is unchanged. Register is chosen at intake as today.

### 6. Gates (v2 order)

brief → **storyboard** (stills + Pencil-reviewed overlays) → **stills preview**
(light; browser check of the free site) → *(optional)* video → extraction
(**skipped in video mode**; replaced by the all-intra re-encode + validation) →
theme → preview.

Receipts, staleness tracking, and `status.mjs` semantics are unchanged; the
`keyframes` gate is renamed/reshaped to `storyboard`, and a `stills-preview`
light gate is added. `status.mjs` must handle projects created by v1 (existing
`keyframes` receipts remain valid for resumed projects).

## Explicitly out of scope

- Multi-scene connector clips (scroll-world's 2N-1 cost model).
- Separate mobile portrait renders; CSS cover-crop stays until proven inadequate.
- A custom browser-based frame editor (Pencil covers it; revisit only if Pencil
  proves unavailable for the user's real workflow).
- Framework integrations; output stays a static vanilla-JS site.

## Testing

- `scrub-core.js` additions (linger easing, video-time mapping) are pure
  functions with vitest coverage, matching the existing pattern.
- Playwright: one scenario per mode — video-mode site scrubs and paints past the
  poster; frames-mode loader hides after the initial window (not full preload).
- Pipeline scripts (`reencode`, storyboard scaffold) get the same CLI test
  treatment as `extract-frames.mjs`.
- Pencil round-trip is manual-verified (screenshot before/after) since it depends
  on a live MCP session.
