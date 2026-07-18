# Scroll Wizard v2 — Storyboard-First Pipeline, Budgeted Video Scrub, Pencil Loop

Date: 2026-07-18
Status: Approved design, pending revised implementation plan

## Problem

Scroll Wizard v1 exposes three problems, confirmed against the `scrollcar`
project:

1. **Runtime performance.** Generated sites extract and preload 100+ WebP frames
   before hiding the loader. Payload and startup cost grow with frame count.
2. **Late feedback.** Copy, layout, beat timing, and visual direction are reviewed
   only after expensive video generation.
3. **Hidden spending decisions.** Generation routes and rerolls do not share one
   durable hard budget with exact per-call approvals.

Research input: [oso95/scroll-world](https://github.com/oso95/scroll-world).
Adopted runtime ideas include blob-loaded native video, seek coalescing,
poster-until-first-paint, iOS priming, linger easing, and distance-based loading.
Rejected workflow ideas include the 2N-1 connector-clip cost model and mandatory
separate portrait renders. Scroll Wizard keeps one inexpensive storyboard-first
feedback loop and a static vanilla-JS output.

## Design

### 1. Adaptive storyboard intake

The wizard analyzes the supplied content, page length, number of distinct claims,
CTA complexity, and motion concept. It recommends a beat count from 3 to 10 and
explains the recommendation; the user has final control.

Guidance:

- 3 beats: simple hero, one value proposition, one CTA.
- 4–5 beats: normal product landing page with several features.
- 6–7 beats: information-heavy product, process, or narrative.
- 8–10 beats: detailed journey, catalog, or many distinct sections.

Each beat contains one still concept and one overlay specification: title, body,
stats, CTA, position, normalized timing range, and optional hold. Before any paid
generation, the wizard presents a free text-only beat outline for approval.

The product-scrub register defaults `scrub.linger` to 0.35 and favors one hero
product on clean ground with orbit, dolly, light-sweep, or peel-back motion. Holds
align with feature beats. The journey register remains available and unchanged.

### 2. Progressive storyboard feedback loop

After outline approval, the wizard collects one still per beat through one of:

- user-provided images;
- manual handoff cards for an external image tool; or
- individually approved image-generation calls.

Draft stills are preferred until composition and narrative are accepted. Every
accepted still is placed in a Pencil canvas with its overlay as editable nodes.
The user reviews screenshots and iterates on copy, hierarchy, composition, and
position. Approved copy, geometry, timing, and hold state export into
`values.json`.

When Pencil is unavailable, the flow degrades explicitly to numeric overlay
editing plus browser preview. It never claims that Pencil review occurred.

The storyboard gate approves the beat set as a whole. Its receipt covers prompts,
accepted stills, and a canonical digest of the overlay fields relevant to
storyboard approval. Later theme-only changes must not stale the storyboard.

### 3. First-class budget control

Intake offers four presets—Free, Cheapest, Balanced, and Quality-first—and lets
the user set an exact total hard cap. The Free preset permits no paid API calls;
it uses user-provided assets or manual tools already covered by the user's own
plan. Other presets may allocate budget to still generation, video generation,
and rerolls.

The wizard explains the preset and stores a durable `budget.json` ledger with:

- currency, preset, and hard cap;
- still, video, and reroll allocations;
- quoted, reserved, spent, and remaining amounts;
- provider, model, duration, and resolution for each approved call; and
- transaction status and timestamps.

Before every paid call, the wizard shows the exact prompt, provider/model,
maximum quoted cost, remaining budget after the call, and expected result. It
reserves the maximum quoted cost before starting. A call cannot start when the
reservation would exceed the hard cap. Completion reconciles the reservation
against the known actual cost.

Interrupted or billing-uncertain calls become `unknown` and must be reconciled
before retrying. This prevents accidental double-spend. Provider credentials and
secrets never enter project files.

When the cap is reached, generation stops and current work is preserved. The
wizard explains what a specific additional amount would buy—such as one reroll,
a higher-quality model, longer duration, or improved resolution—and which visible
weakness it is likely to improve. It does not guarantee improvement or raise the
cap automatically. The user may keep the current result, ship the stills-only
site, switch to a cheaper provider, reallocate unused budget, or explicitly raise
the cap by an exact amount.

### 4. Free stills-only preview

Immediately after storyboard approval, the wizard converts the accepted beat
stills into an N-frame sequence and scaffolds a frames-mode website. The site
crossfades between stills with live overlays. This step adds no video-generation
cost; acquiring the stills themselves follows the selected budget preset and
per-call approvals.

This is both:

- a shippable zero-video endpoint; and
- the required storyboard proof before optional video spending.

The stills-preview receipt is derived from stable storyboard inputs and preview
configuration, not the later mutable final `site/` tree. Theme and final-site
changes therefore do not invalidate an already approved storyboard preview.

### 5. Capability-driven video menu

After the stills preview is approved, the wizard probes the current session for
usable providers, credentials, CLIs, and manual tools. It displays only actionable
routes and always includes No video and Manual handoff.

Each route shows:

- provider and model;
- supported duration, resolution, and aspect ratio;
- first-frame, last-frame, and multiple-reference capabilities;
- estimated generation and reroll cost;
- availability, quota, or preview limitations; and
- expected quality, speed, and control tradeoffs.

Candidate routes include Veo, Seedance, Kling, Higgsfield, and any other verified
provider. Names in this list are not promises: the menu must hide or mark
non-actionable any route that preflight cannot use. Pricing is refreshed from the
available provider/session rather than hard-coded as timeless data.

The wizard recommends the best route inside the remaining budget. It weighs
reference control and the use case, not only price. Beat 1 anchors the first frame
and the final beat anchors the last frame when supported. Approved middle beats
are passed as references only when the selected provider supports them; otherwise
the wizard states that they guide the prompt and timing but are not frame-locked.

Every generation and reroll retains the per-call money gate. There are no
automatic rerolls.

### 6. Dual playback modes

`values.json` / generated `config.json` support
`scrub.mode: "video" | "frames"`. When the mode is omitted, video is selected if
a valid `video` block exists; otherwise frames is selected.

**Video mode** is the default after an approved video exists:

- fetch the local video into a Blob URL so seeking does not depend on HTTP range
  support;
- scrub `video.currentTime` from smoothed scroll progress;
- never issue a new seek while `video.seeking`;
- use a smaller seek epsilon on desktop and a larger one on coarse pointers;
- keep the poster visible until the first `seeked` event paints;
- prime muted playback on the first gesture for iOS; and
- apply optional linger easing with fixed endpoints.

The balanced encoding preset uses native-resolution H.264, no audio, faststart,
and a small GOP (`-g 8`) for substantially smaller payloads than all-intra video.
An all-intra (`-g 1`) maximum-seek-responsiveness preset remains available with an
explicit payload and load-time warning. Width and CRF remain intake knobs.

**Frames mode** remains available for the stills-only site, short sequences, and
fallback when measured video scrubbing is unsatisfactory. Its loader hides after
the poster and initial decode window paint; background preloading continues.

Reduced-motion mode never loads scrub video and does not preload a full frame
sequence. It shows the poster and readable, always-available content.

### 7. Mobile usability

Every generated site must be usable on phones with the same stills and video. No
separate portrait generation or additional mobile media spend is required.

- Landscape media uses deliberate `object-fit: cover` cropping.
- Overlay layout adapts to preserve subject visibility and readable line lengths.
- CTAs remain touch-sized and keyboard accessible.
- Notch and home-indicator safe areas are respected.
- Coarse pointers use the mobile seek epsilon.
- iOS video priming occurs on the first gesture.
- Height-only mobile address-bar resizes do not jump scroll layout.
- Expensive decorative effects are reduced on mobile/weak devices.
- Reduced-motion behavior remains complete and readable.

### 8. Gates and backward-compatible receipts

The v2 gate order is:

1. `brief`
2. `storyboard`
3. `stills-preview`
4. `video`
5. `extraction`
6. `theme`
7. `preview`

`extraction` remains the backward-compatible gate name for playback derivation:

- stills-only mode converts beat stills into frames;
- frames mode extracts frames from an approved video; and
- video mode encodes and validates scrub media.

Video mode skips the frame-extraction operation, not the gate. If the user selects
No video, the `video` gate is skipped and stills-derived playback completes the
`extraction` gate normally.

Legacy `keyframes` receipts map to `storyboard`. Existing v1 `extraction` receipts
remain valid when their manifests match. Resume step numbering is 1–7, with 8
meaning complete.

### 9. Failure behavior

- Provider preflight failures remove the route from the actionable menu.
- Provider failures preserve the storyboard, budget ledger, and current site.
- A failed request is never retried automatically.
- Repeated failures recommend a verified alternative without changing providers
  silently.
- Derived frames/media and generated sites use atomic directory replacement with
  rollback.
- Invalid or stale receipts block downstream approval with an actionable reason.
- The free stills-only route remains available after paid-path failures.

## Explicitly out of scope

- Multi-scene connector clips and the 2N-1 generation model.
- Separate mobile portrait renders.
- A custom browser-based frame editor.
- Framework integrations; output remains a static vanilla-JS site.
- Automatic budget increases or automatic paid rerolls.

## Testing

- Pure-function Vitest coverage for linger easing, video-time mapping, adaptive
  beat recommendations, provider capability filtering/ranking, and cost totals.
- Budget tests for hard-cap enforcement, reservations, reconciliation, cap
  increases, and interrupted/unknown calls.
- Receipt tests for overlay-sensitive storyboard staleness, stable
  stills-preview manifests, video/frames derivation, gate skips, and v1 aliases.
- CLI tests for argument parsing, exit codes, runner failures, JSON reports,
  atomic replacement, and rollback for every new pipeline script.
- Playwright scenarios for video mode, frames-mode initial-window loading,
  reduced motion, and narrow mobile viewports with touch-sized controls and safe
  layout.
- Browser video fixtures use VP9 WebM because Playwright Chromium cannot decode
  H.264 in this environment; production output remains MP4/H.264.
- Run the complete unit/integration suite with `npx vitest run` and the browser
  suite with `npx playwright test`.
- Run `status.mjs` against
  `C:\Users\ryanl\desktop\scrolltest\scrollcar` to prove v1 receipts resume
  without re-approval.
- Pencil round-trip remains manually verified with screenshots because it depends
  on a live MCP session.
