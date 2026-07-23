/i/usage# Scroll Wizard v3 — Art-Directed Modes, Functional Site Anatomy, Inspiration Loop

Date: 2026-07-23
Status: Approved design, pending per-subsystem implementation plans

## Problem

Scroll Wizard v2 ships a working budgeted, storyboard-first video-scrub pipeline,
but every generated site looks the same and reads as a "video with captions,"
not a site:

1. **One layout.** Every overlay is a card anchored to the bottom; only
   left/center/right varies. No vertical range, no hero moment, no editorial
   composition.
2. **Blank ending.** After the sticky scrub releases, `#outro` is a flat
   `var(--bg)` panel with centered text — an abrupt dead end.
3. **One hardcoded look.** Serif display + a single neon accent sprayed on kicker,
   CTA, stats, nav, and progress. Theme tokens recolor it but can't change the
   skeleton, so all sites feel identical.
4. **No site anatomy.** The page is `chrome + sticky scrub + outro`. There are no
   real sections (masthead, feature blocks, spec, gallery, composed CTA).
5. **Registers render identically.** "journey" and "product-scrub" produce the
   same template output despite being different experiences.
6. **Passive.** The output is a scroll movie. There are no functional components
   (working nav jumps, hotspots, config, spec accordion, gallery, forms).
7. **Late look-approval.** The user only sees the visual direction after building.
   There is no cheap, up-front approval of the intended look.

v3 keeps the entire v2 spine — the 7-gate workflow, budget ledger, manual/API
video generation, dual playback, mobile rules — and adds an art-direction and
site-design layer on top. **Production tech is unchanged: AI-generated video
(the "3D" is faked by video generation), scroll-scrubbed, static vanilla JS, no
build step, no WebGL, no framework.**

## Focus contract (project-wide constraint)

**Scroll motion is the product. Every feature must feed or ride the scroll
motion; nothing is a standalone app bolted on.** A feature that does not connect
to the scroll experience does not enter the skill. This is the guard against the
skill bloating into a generic site builder.

- Hotspot → triggers a cinematic-jump scrub.
- Config picker → swaps the *scrubbed* media / tint.
- Spec row → scrubs to its beat.
- Gallery → *is* the beats.
- React stays an escape hatch for a genuinely stateful island only; it is never
  the base. It adds no visual quality and janks the scroll hot path if animation
  routes through its state. The scroll core and all listed components are vanilla.

## Design

### 1. Mode gate and archetype sub-menu

Intake begins with one top-level choice, persisted to `values.json` as `register`:

- **`full3d`** — an immersive fake-3D world produced by video generation. Choosing
  it reveals a required **archetype** sub-question (`archetype`):
  - `flythrough` — camera travels through an environment.
  - `walkthrough` — camera moves through a space at human pace.
  - `teardown` — a product separates into components.
  (The archetype list is extensible; these three ship in v3.)
- **`product`** — one hero product shown/revealed (orbit, dolly, reveal). No
  archetype sub-question; intake proceeds straight to direction.

The archetype sub-menu is shown **only** when `register: "full3d"`. `register`
and `archetype` shape the video prompt craft (Step 4/storyboard), the default
section mix (§4), and the default overlay language (§5).

`register` is distinct from `scrub.mode` (`video` | `frames`), which remains the
playback-derivation choice from v2 and is unaffected.

### 2. Art directions

A required `direction` field selects one coherent design system. A direction is a
token + layout + motion + chrome package that restyles **every** section and
overlay — not a recolor. The scaffold applies it as a body class
(`dir-minimal` | `dir-cinematic` | `dir-technical` | `dir-bold`) plus a token
preset that pre-fills `theme`; explicit `theme` values in `values.json` still
override the preset.

Directions are anchored to **video-scroll** references verified first-hand
(screenshots captured 2026-07-23), not real-time WebGL sites:

| Direction | Reference (verified) | Tokens & behavior |
|---|---|---|
| `minimal` | Apple | System sans display, near-monochrome, one restrained accent used **only** on the primary CTA + progress bar, vast negative space, calm motion (fade + slight scale + blur-in), bare type over footage with a legibility scrim. |
| `cinematic` | **Izanami** (izanami-official.com) | High-contrast **serif** display, desaturated atmospheric palette, **continuous full-bleed footage behind content sections** (never cuts to a blank panel), narrow justified body with em-dash rhythm, rotated vertical section labels, hairline "View →" links with a rule lead-in, an editorial **meta strip** (world clocks / coordinates / `©`), minimal chrome. Calm, luxury. |
| `technical` | **Nothing** (nothing.tech) | Monospace / **dot-matrix** display (NType/NDot lineage), uppercase labels, monochrome + single accent, strict exposed grid, hairline rules, coordinate/index markers, spec-sheet framing, mechanical/stepped motion. |
| `bold` | **Alethia** (alethia.earth), NRG | Heavy grotesk sans display, dark saturated background + one bright accent (e.g. green/yellow), large confident headlines, floating hero subject, modern-corporate energy. |

Each direction defines a token set: `bg`, `text`, `muted`, `accent`, `surface`,
`radius`, `borderStyle`, font stacks (`display`, `body`, `mono`), motion
(`ease`, `springBounce`, `revealTravelPx`), `chromeStyle`, and `scrimStrength`.
Presets live in the skill as data (`references/directions.json`) and are the
single source; CSS reads them via CSS custom properties set on `:root`.

Color-usage discipline is part of the direction, not just the palette: `minimal`
forbids accent on eyebrow/stats/nav; `cinematic` keeps everything near-monochrome
and lets the footage carry mood; `technical` puts the single accent only on
active markers + primary CTA; `bold` allows one saturated field + bright accent.

### 2.1 Validated cross-cutting patterns (from first-hand reference review)

These recur across the verified references and are template features available to
any direction, toggled per project:

- **Chapter/zone color transitions** — the section/scrub background tints shift
  between beats (explanideo dark→amber; Izanami tonal shifts). Add an optional
  `tint` per beat/section; the runtime cross-fades `--bg`/scrim between them.
- **Waypoint progress rail** — a persistent vertical rail with dots per beat and
  a preview of the next (explanideo). This is the visible affordance for the
  cinematic-jump (§7); clicking a dot jumps to that beat.
- **Meta strip** — a small-caps editorial status line (clocks, coordinates,
  index, `©`) as seen in Izanami and Nothing. Optional chrome element.
- **Continuous footage under content** — content sections may render over the
  persistent scrub footage rather than on separate panels (Izanami). This is the
  general form of the "never a blank outro" fix (§4).
- **Per-beat CTA** — a beat/section may carry its own commerce CTA (explanideo
  "BUY"), not just the closing section.

### 2.2 Motion vocabulary (from first-hand flipbook capture)

Captured by dense flipbook (64–72 frames per site) compiled to GIF — the only way
to observe *how* text and scenes transition, not just their resting states. These
are the concrete transitions the implementer maps to per-direction motion tokens,
rather than inventing motion blind:

- **Fade-rise** — copy fades in with a short upward rise, lines staggered
  (Izanami, Apple). Default entrance for `minimal` and `cinematic`. Short travel,
  eased, never a long slide.
- **Footage drift** — the scrub footage drifts slowly and continuously behind
  near-static text (Izanami). Pairs with fade-rise for `cinematic`.
- **Mask-wipe** — an expanding shape/circular mask reveals the next scene with
  text emerging behind it (explanideo, frames 18→20). A chapter-change transition
  for `product`/narrative registers.
- **Tint cross-fade** — the background/scrim color cross-fades between chapters
  (explanideo dark→amber; Izanami tonal). Drives the `tint` pattern in §2.1.
- **Object settle / float** — hero objects drift with parallax depth and settle
  into place (Alethia; NRG papercraft diorama). Default for `bold`.
- **Stepped progression** — a numbered stepper advances through named stages as
  you scroll (NRG "1 Site Evaluation"). The build/journey form of the waypoint
  rail (§2.1, §7); suits `technical`'s mechanical feel.
- **Pinned autoplay + pause control** — a full-bleed hero video autoplays with an
  explicit pause affordance while pinned (Apple). Accessibility-relevant: any
  autoplaying hero must expose a pause control.

Direction → default motion: `minimal` = fade-rise, calm; `cinematic` = fade-rise
+ footage drift; `technical` = stepped/mechanical + index ticks; `bold` = object
settle + float + tint. All entrances are scroll-position-driven (1:1, inherently
interruptible) and cross-faded under `prefers-reduced-motion`.

### 2.3 Design-engineering craft rules

Non-negotiable implementation rules for every animation in the template. These are
the difference between "moves" and "feels right"; the implementer treats them as
acceptance criteria, not suggestions.

| Rule | Application here |
|---|---|
| **Never animate from `scale(0)`** | Overlay/section entrances start at `scale(.96)` + `opacity:0`, never `scale(0)`. Nothing appears from nothing. |
| **Custom easing, never the weak built-ins; never `ease-in` on UI** | Entrances = strong `ease-out` (`cubic-bezier(.23,1,.32,1)`); on-screen moves/mask-wipes = `ease-in-out` (`cubic-bezier(.77,0,.175,1)`); tint/color = `ease`; progress/marquee = `linear`. |
| **Exit faster than enter; press slow, release snappy** | CTA/hover press feedback 100–160ms; overlay exits shorter than their enters. |
| **`:active { scale(.97) }` on every pressable** | Nav pills, hotspots, config options, CTAs, gallery thumbs, form button — all get press feedback. |
| **Origin-aware popovers; modals stay centered** | Config/menu popovers scale from their trigger (`transform-origin`), the lightbox (modal) stays centered. |
| **Blur to mask imperfect crossfades** | The mask-wipe and tint cross-fade (§2.2) add a brief `filter: blur(≤8px)` through the transition to bridge the two states. |
| **Ease-out with exponential curves; no bounce/elastic by default** | Default reveals use ease-out-quart/expo. Bounce/overshoot is allowed **only** on a momentum/gesture release (a flicked drag, drawer), never on a plain reveal. `bold`'s "settle" is a damped ease-out, not a spring bounce. |
| **Stagger grouped entrances 30–80ms** | Overlay lines reveal eyebrow → title → body → stats staggered, not all at once (matches Izanami's staggered fade-rise). |
| **Transitions/springs, not keyframes, for anything interruptible** | The cinematic-jump (§7) and any gesture-reversible motion use transitions/springs so they retarget from the live value; keyframes restart from zero. |
| **Animate only `transform`/`opacity`** | No animating width/height/margin. GPU-friendly properties only. |
| **Frequency governs whether to animate at all** | Scroll-driven beats (seen rarely per session) can carry delight; frequently-clicked chrome (nav, config) stays crisp/near-instant. Never animate a keyboard action. |
| **Reduced motion = gentler, not gone** | Keep opacity/color/tint transitions that aid comprehension; drop movement/parallax; cinematic-jump becomes an instant set. |

**Perf catch (must-honor).** The chapter **tint cross-fade** sets a color token on
a shared ancestor (`--bg`/scrim). Changing a CSS variable on a parent recalculates
styles for **all** descendants — doing that every scroll frame will jank.
Implement tint transitions as a `transform`/`opacity` cross-fade between two
stacked background layers (or a compositor-friendly `opacity` on a tint overlay),
**not** by writing `--bg` on `:root` each frame. This mirrors the v2 rule that the
per-frame scrub loop only touches cheap properties.

**Reveal-safety (must-honor).** A reveal animation must *enhance* an
already-visible default — never gate content visibility on a scroll/class-triggered
transition. Transitions pause on hidden tabs and in headless renderers, so a
visibility-gated reveal ships the section **blank** (and would fail the flipbook
capture in §3). Content is visible by default; motion only refines its entrance.

**Verification tie-in.** The "review next day / play in slow-motion / frame-by-frame"
discipline maps to this skill's flipbook capture (§3): the generated site is
flipbook-captured and inspected frame-by-frame so timing/easing/origin bugs
invisible at full speed are caught before the `preview` gate.

### 2.4 Visual craft & anti-slop constraints

The generated site must not be identifiable as machine-made. These constraints are
acceptance criteria, and two of them **correct current template defaults**:

| Constraint | Application here |
|---|---|
| **Eyebrows are not default scaffolding** | The tiny uppercase tracked eyebrow is an AI tell when it sits above *every* beat/section. v3 makes `overlay.kicker` **opt-in**, not auto-rendered. It's legitimate only as genuine voice — e.g. `technical`'s coordinate/index markers — not sprayed everywhere. *(Refines today's always-on `.overlay__kicker`.)* |
| **Numbered markers only for real sequences** | `01 / 02` index markers are scaffolding unless the section genuinely *is* an ordered sequence (which scroll beats can be). Make `overlay.__index` opt-in per direction (natural for `technical`/stepped `product`; off for `cinematic`/`minimal`). *(Refines today's always-on `.overlay__index`.)* |
| **No gradient text** | Never `background-clip:text` + gradient. Emphasis via weight/size/color only. |
| **Glassmorphism is rare & purposeful** | The `panel` variant's `backdrop-filter` glass is reserved for stats/CTA moments only — never a default surface for ordinary copy. |
| **Avoid the hero-metric SaaS cliché** | The `metric` variant is one deliberate figure tied to the footage, not the "big number + small label + supporting stats + gradient accent" template. No gradient accent on it. |
| **Bare type over cards** | Overlays default to bare type with a scrim (§5), not cards. Cards (`panel`) are the exception, never nested. |
| **Contrast over footage** | Body text over footage must hit ≥4.5:1 via the scrim (§5) — not light-gray-on-image. Verify against the actual poster/frame, bump toward ink if close. |
| **Typography discipline** | Body/measure 65–75ch; `text-wrap: balance` on headings, `pretty` on prose; display `clamp()` max ≤ ~6rem; display letter-spacing floor ≥ −0.04em. |
| **Category-reflex test** | The chosen `direction` must not be guessable from the product category alone (first-order) or from category-plus-obvious-anti-reference (second-order). The 4 directions exist to break the single-look reflex; per project, confirm the pick isn't the domain's default move. |

### 3. Inspiration library and inspiration-approval gate

**Inspiration library.** The skill stores a curated set of reference websites,
indexed by `register`/`archetype` and by `direction`, several per bucket, in
`references/inspiration.json`. Each entry: `url`, `label`, `bucket`, `verified`
(bool), `shot` (path to a first-hand screenshot), and a one-line `note` on what to
borrow (motion/material cue only — never copy composition, copy, palette, or type
as a costume). **Only `video-scroll` sites qualify — real-time WebGL/WebGPU
references (e.g. Noomo ValenTime) are excluded because they are not this skill's
production tech.** No entry is locked until `verified: true` with a captured shot
(see Visual reference verification below).

Two distinct uses, don't conflate them:

- **Reference library** (shown at the inspiration gate) — only ✓ motion-captured
  sites go here, so the user approves a look they can actually click and see.
- **Motion concept** (feeds the Higgsfield/video-gen prompt) — a register or
  archetype whose *idea* is clear (e.g. exploded teardown, product orbit) needs no
  reference site at all; the concept is described in prose and prompts generation
  directly. Do **not** chase captures for these.

Captured library (as of 2026-07-23; ✓ = motion-captured first-hand):

- `full3d/flythrough|walkthrough`: **Izanami** ✓ (cinematic env travel), **NRG
  Build Your Data Center** ✓ (papercraft isometric build-world + numbered stepper,
  captured through its "Enter Site" splash).
- `product`: **explanideo** ✓ (per-beat product + chapter color + BUY + mask-wipe).
- `direction/minimal`: **Apple** ✓ (full-bleed video hero, pause control, clean
  sans, tiles).
- `direction/cinematic`: **Izanami** ✓.
- `direction/technical`: **Nothing** ✓ (dot-matrix).
- `direction/bold`: **Alethia** ✓ (floating objects + settle), **NRG** ✓.

Concept-only (no reference needed — prompt generation from the idea): `teardown`
(exploded product with annotated parts), `product` orbit/dolly/reveal, and any
motion in the §2.2 vocabulary a brief calls for.

**Visual reference verification (required for library entries).** A library entry
is locked only after first-hand viewing via dense **flipbook capture** — a
Playwright script drives 64–72 small wheel steps (clicking through consent /
"Enter Site" splash gates first) and screenshots each, compiled to a GIF with
ffmpeg so the *motion* (entrances, transitions, tint shifts) is observable, not
just resting frames. Sites that hard-block headless capture (bot walls, region
redirects) are simply not added to the library — their motion, if needed, becomes
a concept prompt instead. The generated site is likewise flipbook-captured and
compared against the approved reference before the `preview` gate. Text
descriptions never suffice to lock a visual target.

**Inspiration-approval gate (new light gate, before any paid generation).** After
mode + archetype + direction are chosen, the wizard prints the matching reference
links **as clickable URLs in the session** and asks the user to click through the
real sites and approve the look. Generation then follows that design language.
This front-loads look-agreement so a paid video generation is never spent on the
wrong vibe. It fits the v2 "approve before you pay" spine and is a light gate
(short summary, explicit go-ahead, receipt) — never auto-approved.

The gate persists the approved reference(s) to
`values.json.inspiration = { approvedRefs: [url], bucket }` and writes a
`status.mjs` receipt named `inspiration`.

### 4. Site anatomy — section library

The page becomes a data-driven ordered list of sections in
`values.json.sections`. Each entry has a `type` and type-specific fields. The
scrub is one section (`scrub-hero`), not the whole page. Section types:

- `masthead` — brand statement/intro before the scrub (headline, sub, optional
  eyebrow, scroll hint).
- `scrub-hero` — the existing sticky scroll-scrub (frames/video), carrying
  overlays (§5) and hotspots (§6). Unchanged engine, now one section among many.
- `feature-split` — media + text, alternating side; the media may be a beat
  still or a short looped clip.
- `statement` — full-bleed centered editorial line (big type, generous space).
- `spec` — spec accordion / metric grid (numbers + labels; rows can scrub to a
  beat, §6).
- `gallery` — grid/strip of beat stills; click opens a lightbox and/or scrubs to
  that beat.
- `cta` — composed closing section (replaces the blank outro): headline, accent
  rule, primary CTA, optional email-capture form, final beat frame carried behind
  a scrim so the page never cuts to a flat panel.

Sections are optional and ordered by the array. `register`/`archetype` set a
sensible **default** section mix that the storyboard step may edit:

- `product` / `teardown`: `masthead → scrub-hero → spec (annotations) → gallery → cta`.
- `full3d/flythrough|walkthrough`: `masthead → scrub-hero → statement → feature-split → cta`.

Reveal animations for non-scrub sections use native CSS scroll-driven animations
(`animation-timeline: view()`) with a no-JS static fallback for Safari/Firefox
(progressive enhancement). No new JS scroll listeners for section reveals.

### 5. Overlay vocabulary (over the scrub)

Overlays gain a `variant` and an orthogonal vertical `anchor`, extending v2's
horizontal-only `position`:

- `anchor`: `top` | `middle` | `bottom` (default `bottom`, back-compatible). Gives
  each beat its own on-screen position.
- `variant`: `bare` | `hero` | `caption` | `metric` | `panel` | `annotation`
  (default `bare`).
  - `bare` — eyebrow + display line + short body, no card, scrim for legibility.
  - `hero` — oversized centered statement, no card.
  - `caption` — small understated label, cornered.
  - `metric` — one large numeral + label.
  - `panel` — the only glass/`backdrop-filter` card, reserved for stats/CTA.
  - `annotation` — a label pinned to a normalized `point: [x, y]` on the frame
    with a leader line + dot to a component. Used for teardown callouts. The label
    position tracks the point across the responsive `object-fit: cover` crop, so
    it needs the same cover-rect math the canvas uses (`coverRect` in
    `scrub-core.js`) — this is real layout logic, not a CSS class alone.

`position` (`center` | `left` | `right`) is retained and composes with `anchor`.

### 6. Functional components (each rides the scroll)

All vanilla, keyboard-accessible, and wired to the scroll engine:

- **Nav** — pills jump to a section/beat via the cinematic-jump (§7), replacing
  v2's plain `scrollTo`.
- **Hotspots** — `values.json.hotspots: [{ point:[x,y], target:<beatIndex>,
  label }]`. Dots pinned to a frame point (same cover-rect mapping as
  annotations); click triggers a cinematic-jump to `target`.
- **Config picker** — `values.json.config: { options:[{ id, label, poster, src?,
  tint? }] }`. Selecting an option swaps the scrubbed media (`src`) or applies a
  tint; the scrub re-derives from the new source. Product register only.
- **Spec accordion / metric grid** — the `spec` section; a row may carry
  `beat:<index>` to scrub there on activation.
- **Gallery + lightbox** — the `gallery` section; thumbnails open a lightbox and
  optionally scrub to the beat.
- **CTA + email capture** — the `cta` section; the form validates inline
  (native constraint validation) and never blocks the page.

### 7. Cinematic-jump interaction (cross-mode)

A click-driven scrub that speeds through intermediate keyframes, available in
**both** `product` and `full3d`. Scroll is always live and coexists with it.

- **Mechanism:** a tuned `lenis.scrollTo(targetY, { duration, easing })` where
  `targetY` is the scroll position of the target beat's midpoint and `duration`
  scales with scroll distance (bounded, e.g. `clamp(0.5s, k·distance, 1.4s)`),
  eased `easeInOutCubic`. Animating scroll *is* animating the scrub, so all
  intermediate frames play and overlays/holds stay consistent for free.
- **Affordances:** `product` → hotspots + nav pills; `full3d` → a "next waypoint"
  stepper (and optional waypoint markers) + nav.
- **Interruptible (hard requirement):** any manual wheel/touch/keyboard scroll or
  a second click cancels the in-flight tween and hands control back to scroll
  immediately. No input lockout at any point.
- **Reduced motion:** instant jump (set scroll directly), no fast fly-through.
- Pure helpers (`jumpDuration(distancePx)`, target-Y computation from a beat's
  `at` range) live in `scrub-core.js` for unit tests.

### 8. `.pen` file per pause

For every **pause** (a beat with `hold: true`), the storyboard step scaffolds one
Pencil `.pen` file, seeded with that beat's still as the background and editable
overlay nodes (title/body/stats/CTA/annotation) pre-styled to the chosen
`direction`. The user opens it, adjusts composition/copy to taste — **even after
the design followed the inspiration reference** — and the wizard reads the
approved positions/copy/normalized `at`/`hold` back into `values.json`, exactly as
the v2 Pencil round-trip already does, now one file per pause.

When Pencil is unavailable, the flow degrades to numeric overlay editing and
never claims a `.pen` round-trip occurred (unchanged v2 behavior).

### 9. `values.json` schema additions

Additive and backward-compatible. Omitted fields fall back to v2 behavior
(`register` absent ⇒ treat as `product`; `direction` absent ⇒ `minimal`; no
`sections` ⇒ synthesize `[masthead?, scrub-hero, cta]` from existing
brand/overlays/outro so v2 configs still scaffold).

```jsonc
{
  "register": "full3d",              // "full3d" | "product"
  "archetype": "teardown",           // required iff register==="full3d"
  "direction": "technical",          // "minimal" | "expressive" | "technical"
  "inspiration": {                    // written by the inspiration gate
    "bucket": "full3d/teardown",
    "approvedRefs": ["https://…"]
  },
  "brand": { "name": "…", "tagline": "…", "imageAlt": "…" },
  "theme": { /* v2 tokens; direction preset fills any omitted */ },
  "frames": { /* v2 */ }, "video": { /* v2 */ },
  "scrub": {
    "heightVh": 400, "smoothing": 0.12, "linger": 0.35,
    "mode": "video",                 // v2 playback mode, unchanged
    "jump": { "minMs": 500, "maxMs": 1400, "pxPerMs": 2.2 }  // cinematic-jump tuning
  },
  "sections": [
    { "type": "masthead", "eyebrow": "…", "headline": "…", "sub": "…" },
    { "type": "scrub-hero" },
    { "type": "spec", "rows": [ { "label": "…", "value": "…", "beat": 2 } ] },
    { "type": "gallery", "items": [ { "beat": 1 }, { "beat": 3 } ] },
    { "type": "cta", "headline": "…", "cta": { "label": "…", "href": "…" },
      "emailCapture": true }
  ],
  "overlays": [
    { "at": [0.05,0.22], "variant": "hero", "anchor": "middle",
      "position": "center", "title": "…", "body": "…" },
    { "at": [0.40,0.58], "variant": "annotation", "point": [0.62,0.44],
      "hold": true, "title": "…", "body": "…",
      "stats": [ { "value": "18 h", "label": "Battery" } ] }
  ],
  "hotspots": [ { "point": [0.62,0.44], "target": 1, "label": "Cell" } ],
  "config": { "options": [ { "id": "graphite", "label": "Graphite",
    "poster": "…", "src": "…", "tint": "#333" } ] },
  "outro": { /* v2 retained; superseded by a `cta` section when present */ }
}
```

`validateConfig` (in `scrub-core.js`) must accept the new enums and shapes and
reject bad ones: `register`/`archetype`/`direction` enums, `archetype` required
when `register==="full3d"`, `variant`/`anchor` enums, `point`/`at` in `[0,1]`,
`hotspots[].target` within overlay bounds, `sections[].type` enum. Existing v2
validation stays.

### 10. Gates

Insert one light gate; reuse the existing storyboard gate for `.pen`-per-pause.

1. `brief`
2. **`inspiration`** *(new, light)* — mode/archetype/direction chosen, reference
   links shown and clicked, approved refs persisted.
3. `storyboard` — now also scaffolds one `.pen` per pause and reads it back.
4. `stills-preview`
5. `video`
6. `extraction`
7. `theme`
8. `preview`

Resume numbering shifts to 1–8 (9 = complete). v2 receipts without an
`inspiration` gate resume as before: a config lacking `register`/`direction` is
treated as a legacy `product`/`minimal` project and the `inspiration` gate is
auto-satisfied as `legacy` (never fabricated as a user approval — reported as a
legacy skip by `status.mjs`, mirroring the v2 `stills-preview` legacy skip rule).

## File-change map

- `template/index.html` — section-container markup driven by `sections`; nav /
  hotspot / config / spec / gallery / cta component hooks; `dir-*` body class.
- `template/style.css` — direction token presets (`:root` custom props per
  `dir-*`), section layouts, overlay `variant`/`anchor` classes incl.
  `annotation` leader-line, functional-component styles, composed `cta`,
  scroll-driven `view()` reveals + static fallback. *(Note: this file currently
  has two uncommitted WIP edits — vertical anchors/hero + an outro backdrop —
  that are down-payments on §5/§4. The implementing agent should treat them as a
  starting point or revert to clean; they are not committed.)*
- `template/scrub-engine.js` — render sections from `sections`; render overlays
  with `variant`/`anchor`; annotation + hotspot point-tracking via `coverRect`;
  cinematic-jump (interruptible Lenis `scrollTo`); config picker / spec / gallery
  / form wiring.
- `template/scrub-core.js` — extend `validateConfig`; add pure helpers
  `jumpDuration`, beat-`at`→targetY, and point→pixel mapping for tests.
- `template/config.json` — demo exercising register/archetype/direction/sections/
  overlays/hotspots.
- `scripts/scaffold-site.mjs` — assemble `sections` + apply `direction` preset +
  synthesize sections for legacy configs.
- `scripts/status.mjs` — add the `inspiration` gate, shift resume numbering, add
  legacy skip.
- `scripts/plan-generation.mjs` — archetype-aware prompt/beat guidance.
- `references/directions.json`, `references/inspiration.json` — new skill data.
- `SKILL.md` — mode gate, archetype sub-menu, direction, inspiration gate,
  `.pen`-per-pause, cinematic-jump, updated gate table and intake flow.

## Subsystem decomposition (one implementation plan each)

This spec spans independent subsystems. Per the writing-plans scope check, build
one plan per subsystem, each producing working, testable software on its own, in
this order (later plans depend on earlier ones):

1. **Direction + overlay vocabulary** — `directions.json`, `dir-*` token presets,
   `variant`/`anchor` CSS + render, `validateConfig` enums, annotation leader-line
   + `coverRect` point mapping. Tests: Vitest (validator, point mapping),
   Playwright (variants render, annotation tracks on resize).
2. **Site anatomy / section library** — `sections` schema, scaffold assembly +
   legacy synthesis, section render, composed `cta`, `view()` reveals + fallback.
   Tests: Vitest (assembly, legacy synthesis), Playwright (sections render, no
   horizontal overflow, reduced-motion).
3. **Functional components + cinematic-jump** — nav/hotspots/config/spec/gallery/
   form wiring; interruptible Lenis jump; `jumpDuration` + targetY helpers. Tests:
   Vitest (helpers), Playwright (jump scrubs frames, manual scroll interrupts,
   reduced-motion instant jump, keyboard access).
4. **Mode/archetype intake + inspiration gate** — `SKILL.md` intake flow,
   `inspiration.json`, `status.mjs` `inspiration` gate + resume renumber + legacy
   skip, archetype-aware `plan-generation.mjs`. Tests: Vitest (gate receipt,
   legacy skip, resume numbering), status-report assertions.
5. **`.pen`-per-pause** — `SKILL.md` storyboard step scaffolds one `.pen` per
   `hold` beat, direction-styled nodes, read-back into `values.json`. Verified
   manually via live Pencil MCP (as v2 Pencil round-trip is).

## Explicitly out of scope

- Real-time WebGL/Three.js or WebGPU. The "3D world" is faked by video generation.
- React/framework as the base output; output remains static vanilla JS. React
  only as an optional island around a genuinely stateful component, never core.
- New paid media routes, portrait renders, connector clips, automatic budget
  increases, or automatic rerolls (all unchanged from v2 out-of-scope).
- A custom browser-based frame editor (Pencil remains the design surface).
- Copying any reference site's identifiable composition, copy, palette, or type;
  references are motion/material cues only.

## Testing

- **Vitest (pure functions):** `validateConfig` for every new enum/shape and
  rejection; `jumpDuration`/targetY; point→pixel cover-rect mapping; section
  assembly and legacy synthesis; `inspiration` gate receipt, legacy skip, and
  resume renumbering.
- **Playwright:** each `variant`/`anchor` renders and is readable; annotation and
  hotspot points track across viewport resize and coarse pointers; sections render
  with no horizontal overflow and safe-area padding; cinematic-jump visibly scrubs
  intermediate frames and is cancelled by a manual scroll; reduced-motion does an
  instant jump and never loads scrub video; each direction applies its tokens;
  keyboard operation of nav/hotspots/config/accordion/gallery/form.
- **Regression:** a v2 config with no `register`/`direction`/`sections` still
  scaffolds and `status.mjs` resumes it without fabricating an `inspiration`
  approval (reported as a legacy skip).
- Browser video fixtures use VP9 WebM (Playwright Chromium limitation); production
  output remains MP4/H.264. Run `npx vitest run` and `npx playwright test`.
- Pencil `.pen`-per-pause round-trip is manually verified with screenshots
  against a live MCP session.
```
