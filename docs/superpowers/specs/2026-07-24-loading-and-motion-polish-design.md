# Loading Animation + Spring Reveals + Hover Micro-interactions

Date: 2026-07-24
Status: Approved design, pending implementation plan

## Problem

The current template (post v3 reconstruction: `site-design-update` +
`scroll-wizard-v3` merged to `main`) has real gaps in motion polish:

1. **The loader has no motion design.** `#loader`/`#load-progress`
   (`template/index.html`) exist and are functionally wired (frames mode
   reports real fractional progress; video mode does not), but they are
   toggled via the `hidden` attribute with zero transition — they snap
   in/out. There's also no fallback progress signal for video mode.
2. **`--spring-bounce` is dead.** Every entry in `references/directions.json`
   defines `motion.springBounce`, `applyTheme()` in `scrub-engine.js` sets
   it as a CSS custom property, and it is currently `0` everywhere with
   nothing in `style.css` reading it. The reveal animations (`.overlay__content`
   transition, the `@keyframes section-reveal` scroll-timeline animation)
   use a flat `--ease` curve only.
3. **No pointer-driven hover interactions anywhere.** `interactions.js`
   only wires click/keyboard activation (nav pills, hotspots, gallery,
   spec rows, config picker). Existing hover feedback is limited to CTA
   buttons' `opacity`/`translateY(-1px)` under
   `@media (hover:hover) and (pointer:fine)`. Gallery images, feature-split
   media, and spec rows have no hover treatment at all.

This spec covers all three, since they're independent, additive, and
address the same underlying ask (bring the reference-site "fun,
interactive" feel into the template) without inventing a second parallel
motion system alongside the one that already exists.

## Architecture

Every change here extends an existing mechanism rather than adding a new
one:

- The loader gets a **class-based hidden state**
  (`.loader.is-hidden { opacity: 0; pointer-events: none }` with a
  transition) instead of the `hidden` attribute, so it can actually
  animate out. `hidden` cannot participate in a CSS transition (removing
  an element from the accessibility tree and `display: none`-ing it is not
  transitionable), so this is a required mechanical change, not a style
  preference.
- Video-mode load progress reuses the **exact same signal shape** frames
  mode already provides (`loadProgress.value = fraction`), just sourced
  from a streamed `fetch` read instead of `FrameStore`'s per-frame
  callback — no new progress-reporting abstraction.
- Spring bounce is computed **once, in `applyTheme()`**, into a new
  `--ease-spring` custom property (a cubic-bezier string), following the
  exact pattern already used for `--ease` itself. CSS consumers swap
  `var(--ease)` for `var(--ease-spring)` only on the two reveal animations
  called out below — nothing else changes.
- Hover micro-interactions are **pure CSS**, added to the same
  `@media (hover:hover) and (pointer:fine)` block structure the CTA hover
  already uses, and nulled in the same reduced-motion block that already
  nulls CTA hover transforms. No new JS, no new event listeners.

## Component 1: Loading animation

**Loader fade** (`template/style.css`, `.loader` rule): add
`transition: opacity 320ms var(--ease), transform 320ms var(--ease)` and a
`.loader.is-hidden { opacity: 0; transform: translateY(4px); pointer-events: none }`
rule. In `template/scrub-engine.js`, every current
`loader.hidden = true` call site (frames-mode first-frame-drawn,
video-mode immediate-hide, video-mode first-`seeked`) is replaced with
`loader.classList.add('is-hidden')`. The element stays in the DOM/a11y
tree slightly longer (through the transition) rather than disappearing
the instant loading completes — this is the intended visible fade, not a
bug.

**Progress bar restyle**: style the native `<progress>` element's fill
(`#load-progress::-webkit-progress-value`, `#load-progress::-moz-progress-bar`)
to use `var(--accent)`, and add a subtle pulse
(`@keyframes loader-pulse { 50% { opacity: .6 } }`, `animation: loader-pulse
1.4s ease-in-out infinite` on `#load-progress`) while the loader is
visible. Both rules sit inside the existing reduced-motion block to be
nulled (`animation: none`) there, matching how every other motion effect
in this file already behaves under reduced motion.

**Real video-mode progress**: `loadScrubVideo(config, onProgress)` in
`scrub-engine.js` gains a second parameter. Instead of
`await response.blob()`, it reads `response.body.getReader()` in a loop,
accumulating chunk byte lengths against
`Number(response.headers.get('content-length'))`, calling
`onProgress(received / total)` per chunk (skipping progress reporting
entirely if `content-length` is missing or non-numeric — falls back to
today's immediate-hide behavior rather than dividing by zero or guessing).
Accumulated chunks are reassembled into a `Blob` exactly as `response.blob()`
already would, so nothing downstream (`URL.createObjectURL`, `scrubVideo.src`)
changes. `runVideoEngine`'s caller passes
`(fraction) => { loadProgress.value = fraction; }` — the identical
callback shape `FrameStore` already uses, so both modes drive the same
`<progress>` element the same way.

## Component 2: Spring/bounce reveals

In `applyTheme()` (`scrub-engine.js`), after the existing
`root.setProperty('--ease', theme.motion.ease)` line, add:

```js
const bounce = Number(theme.motion?.springBounce) || 0;
const overshoot = 1 + bounce; // 0 bounce -> 1 (no overshoot, standard ease-out shape)
root.setProperty('--ease-spring', `cubic-bezier(0.34, ${overshoot}, 0.64, 1)`);
```

This is a standard "back-ease" curve shape (the same family as the
widely-used `cubic-bezier(0.34, 1.56, 0.64, 1)` "easeOutBack") — the
`1 + bounce` term is what produces the visible overshoot-past-100%-then-
settle motion within a single CSS `transition`, entirely through the
easing curve's control points; no keyframe animation or JS spring
simulation is needed. At `bounce: 0` this reduces to
`cubic-bezier(0.34, 1, 0.64, 1)`, a flat ease-out with no overshoot —
byte-for-byte equivalent in visible behavior to today's `--ease`-driven
motion for any preset that stays at 0.

Two consumers switch from `var(--ease)` to `var(--ease-spring)`:
- `.overlay__content` transition (`style.css`) — the scrub overlay reveal.
- `@keyframes section-reveal` / the `animation-timeline: view()` rule
  (`style.css`) — the generic section-reveal animation.

`references/directions.json` preset changes: `bold.motion.springBounce`
and `cinematic.motion.springBounce` change from `0` to a nonzero value
(exact numbers decided during implementation by visually tuning against
the actual template — this spec fixes the *mechanism*, not the tuned
constant). `minimal` and `technical` stay at `0`.

## Component 3: Hover micro-interactions

All additions are CSS-only, added inside (or alongside, reusing the exact
media-query structure) the existing
`@media (hover: hover) and (pointer: fine) { .overlay__cta:hover, ... }`
block in `style.css`, and nulled in the existing reduced-motion block the
same way CTA hover transforms already are.

- **Gallery images** (`.gallery__item img` or equivalent selector from
  `section-renderer.js`'s `buildGallery`): `transform: scale(1.04)` on
  `:hover`, `transition: transform 220ms var(--ease)`.
- **Feature-split media** (`.section-feature__media` or equivalent):
  same scale treatment, since both are "media the user might want to look
  closer at."
- **Spec rows** (`.spec__row` or equivalent, from `buildSpec` — already
  clickable jump-to-beat targets per `interactions.js`): a hover
  background-tint (`background: var(--surface)`) plus a small
  `translateX(2px)` shift, `transition: background 160ms var(--ease),
  transform 160ms var(--ease)` — signals "this row is interactive"
  without needing new JS, since the click handling already exists.

Exact selector names are confirmed against `section-renderer.js`'s actual
output during implementation (this spec describes the treatment and
target elements, not unverified selector strings).

## Test coverage

- `tests/unit/scrub-core.test.mjs` or a new focused test file: none of
  this component's logic is pure/testable in `scrub-core.js` except
  nothing new is added there — the spring-bounce-to-cubic-bezier
  computation lives in `scrub-engine.js` (DOM-adjacent), so it's covered
  by a browser test instead (below), not a unit test.
- `tests/browser/smoke.spec.mjs` (or a new focused spec file):
  - Loader: assert `#loader` gains `is-hidden` class (not just checking
    `hidden` state) once the first frame is drawn / video is ready, and
    that computed opacity actually transitions to `0` rather than
    disappearing instantly.
  - Video-mode progress: assert `#load-progress`'s `value` increases
    (polled) during a throttled/delayed video fetch, rather than jumping
    straight from `0` to hidden.
  - Spring easing: assert `getComputedStyle(overlayContentEl).transitionTimingFunction`
    (or reading the `--ease-spring` custom property directly) reflects the
    preset's `springBounce` value for a fixture using the `bold` or
    `cinematic` direction, and reflects the flat curve for `minimal`.
  - Hover: assert a gallery image's computed `transform` changes on
    simulated hover at a fine-pointer viewport, and does *not* change at a
    coarse-pointer (touch) viewport.
  - Reduced motion: assert the loader pulse animation, spring easing
    overshoot, and hover transforms are all inert
    (`prefers-reduced-motion: reduce` emulated) — matching the existing
    reduced-motion test pattern already used for other features in this
    suite.

## Out of scope

- Any cursor-follow / pointer-tracking decorative element (a "cursor
  accent" style effect) — not requested in this round; the hover
  micro-interactions here are all `:hover`-triggered, not
  `pointermove`-tracked.
- A JS fallback/polyfill for browsers without `animation-timeline`
  support for the section-reveal animation — a real gap, explicitly
  deferred (not part of this spec) per the user's selection.
- Animated stat/number count-ups — not selected this round.
- Retuning `minimal`/`technical`'s springBounce away from `0`, or
  changing any other theme token — this spec only wires the mechanism and
  sets two presets' bounce value.
- A full-screen branded splash/intro sequence — the user chose the
  "animated progress reveal" option over a custom splash moment.
