# Richer Scroll Interactivity: Process Section, Overlay Stagger, Parallax, Cursor Accent

Date: 2026-07-23
Status: Approved design, pending implementation plan

## Problem

The generated site is a single hero scrub (video or frames) with overlay
cards fading in and out, then a section (`#outro`) that has CSS classes
(`.outro__headline`, `.outro__body`, `.outro__cta`) but is never populated
by any code, then a footer. That is the entire page.

Reference sites the user likes (marinabudarina.github.io/chimes,
terminal-industries.com, en.manayerbamate.com) are long-form pages built
from many distinct content modules — staggered reveal-on-scroll blocks,
parallax decorative layers, progressive-disclosure steps, small
pointer-reactive decorative elements — not a single continuous scrub.
The complaint ("very limited interactiveness," "I like how scrolling loads
more stuff") is that scroll-wizard sites stop after the hero; nothing new
appears or reacts as you keep scrolling, and the hero's own motion is a
single uniform fade.

Intake already asks whether the story "has a process" (`plan-generation.mjs
beats --process`), but today that answer only nudges a beat-count
recommendation — it is never rendered anywhere. This design gives that
signal (and a few new opt-in ones) somewhere to land.

## Architecture

Every addition here is opt-in and additive, following the same convention
already used for `scrub.mode` and `nav: true`: a new `values.json` field
controls a new behavior; its absence leaves today's output byte-for-byte
identical. Nothing here changes an existing default.

Two mechanisms, both largely already present in the codebase, do all the
work — no third pattern is introduced:

1. **Continuous tick → CSS custom property.** `runEngine`/`runVideoEngine`
   already recompute scroll progress every animation frame and write it to
   `--reveal` for overlay opacity. Parallax offsets and per-child overlay
   stagger reuse this same loop and the same "JS computes a number, CSS
   does the paint" split — no new render loop.
2. **IntersectionObserver one-shot reveal.** For content below the
   continuously-scrubbed hero (process steps, outro), a single generic
   observer toggles `.is-visible` the first time an element with a
   `data-reveal` attribute crosses ~25% into the viewport, then unobserves
   it. Native browser API, no dependency, no per-frame cost for content
   that isn't otherwise animating.

`scrub-core.js` stays pure-functions-only per the existing project
convention; DOM wiring for both mechanisms lives in `scrub-engine.js`.

CSS-native scroll-driven animations (`animation-timeline: view()`) were
considered instead of IntersectionObserver and rejected for now: Safari
support is too recent to trust for a skill that already special-cases iOS
compatibility (first-gesture video priming, `env(safe-area-inset-*)`).
Worth revisiting once support is universal; not worth a fallback path today
for a single feature.

All four pieces below independently no-op under
`prefers-reduced-motion: reduce`, matching the existing reduced-motion
block in `style.css` (static content, no scroll-driven JS running).

## Component 1: Process section + outro content

**Schema** (`values.json`, both optional, no default content):

```json
{
  "process": { "steps": [{ "title": "Steep", "body": "18 hours, cold." }] },
  "outro": { "headline": "Try it.", "body": "...", "cta": { "label": "Order", "href": "https://..." } }
}
```

`validateConfig` (scrub-core.js): if `process` is present, `steps` must be
an array of 1-8 entries, each a non-empty string `title` and `body`. If
`outro` is present, `headline` and `body` are required non-empty strings;
`cta`, if present, requires non-empty `label` and `href`.

**Rendering** (scrub-engine.js): `renderProcess(config)` and
`renderOutro(config)`, called from `start()` alongside the existing
`renderCopy(config)`. Both build DOM with `document.createElement` +
`textContent` (never `innerHTML` — copy is user-authored brief content, not
markup, so this also closes off any injection surface). `index.html` gains
`<section id="process" class="process" aria-label="How it works"
hidden></section>` between `#scrub` and `#outro`; both functions unhide
their section only when the corresponding config key is present, and both
mark every top-level child they create with `data-reveal` so the generic
observer (`initScrollReveal`) picks them up automatically — no
process-specific or outro-specific observer code.

**Stagger**: each `.step` gets `style.setProperty('--i', index)` at render
time; CSS does `transition-delay: calc(var(--i, 0) * 90ms)` on top of the
shared `.is-visible` transition. One-time reveal (no re-hide on scrolling
back up) — the standard scrollytelling convention, and simpler than
tracking direction.

## Component 2: Overlay stagger

Today `updateOverlays` sets one `opacity`/`--reveal` value per overlay node
from `overlayOpacity(raw, data.at)`, and every child (title, body, stats,
CTA) fades as one block. New pure function in `scrub-core.js`,
unit-tested next to `lingerEase`/`overlayOpacity`:

```js
export function staggeredReveal(reveal, offset, span) {
  // maps the overlay's single 0..1 reveal ramp to a child-specific
  // 0..1 ramp starting at `offset` and finishing `span` later
}
```

`updateOverlays` calls this once per child role with fixed offsets (title
0, body 0.15, stats 0.3, cta 0.45; span 0.55 each, clamped to [0,1]) and
sets `--reveal-title`/`--reveal-body`/`--reveal-stats`/`--reveal-cta` on
the overlay node; CSS reads the matching variable per child instead of the
parent's single `--reveal`.

## Component 3: Parallax layers

`scrub.parallax: true` (validated as boolean, same shape as the existing
`config.nav` check). When enabled, a new `renderParallax(config)` inserts
2-3 `.parallax-layer` elements inside `.scrub__sticky` — CSS radial/linear
gradients built from `--accent`, `--bg`, `--surface` tokens already in the
theme, so this adds zero new image/video payload. Each layer carries a
fixed `data-rate` (e.g. 0.15, 0.3, 0.5). The existing per-tick `raw` scroll
progress (already computed every frame in both engines) sets a unitless
`--parallax` custom property per layer as `raw * rate`; CSS consumes it
with `translate: 0 calc(var(--parallax, 0) * 60px)`, the same
unitless-number-in, CSS-does-the-paint split already used for `--reveal`.
No new observer, no new loop — one extra small function call inside the
existing `tick()`.

## Component 4: Cursor/physics accent

`scrub.cursorAccent: true`. A small cluster (4-6) of decorative dot
elements, `pointer-events: none`, absolutely positioned over the hero.
Desktop/mouse: each dot's target is the pointer position (with a small
per-dot offset so they don't overlap); each dot's current position springs
toward that target every frame using the **existing** `smooth(current,
target, k, dt)` helper already exported from `scrub-core.js` for scrub
smoothing — no new physics code, just reusing the spring math with a
per-dot `k`. Touch/coarse-pointer (`matchMedia('(pointer: coarse)')`):
there is no persistent pointer to follow, so instead of hiding the effect
entirely, each dot's target follows a slow deterministic drift computed
from `performance.now()` (a couple of out-of-phase sine waves) — ambient
motion rather than a dead decoration. Runs its own tiny `requestAnimationFrame`
loop, started only when `scrub.cursorAccent` is enabled, stopped/never
started under reduced motion.

## Test coverage

- `tests/unit/scrub-core.test.mjs`: `staggeredReveal` (endpoints, offset/span
  clamping, ordering); `validateConfig` for `process`, `outro`,
  `scrub.parallax`, `scrub.cursorAccent` (accepts valid, rejects malformed
  steps/cta/non-boolean flags).
- `tests/browser/smoke.spec.mjs`: a fixture with `process` steps — scrolling
  down reveals steps progressively (`.step.is-visible` count increases, in
  order); a fixture with `outro` — headline/body/cta text and href render;
  reduced-motion shows all process/outro content immediately with no
  observer needed; a fixture with `scrub.parallax: true` — a parallax
  layer's computed `--parallax` value differs at two scroll positions; a
  fixture with `scrub.cursorAccent: true` — dispatching `pointermove`
  moves a dot toward the pointer over several frames; the same at a
  coarse-pointer viewport confirms no pointermove-driven behavior (ambient
  drift only) and reduced-motion hides the accent entirely (`display:
  none` from the existing reduced-motion CSS block).

## Skill workflow update

None of this is reachable if `SKILL.md` never asks for it. Step 1 (Intake)
already asks "whether the story has a process" for the beat-count
heuristic; it needs to also collect the actual step copy (title/body per
step) and persist it to `values.json#process` when the user has one. Step
6 (Art-direct and scaffold) gains one short question: offer `parallax` and
`cursorAccent` as optional theme-level toggles, off by default, explained
in one sentence each (decorative only, no payload cost, no new generation
call). Outro headline/body/CTA copy is collected once, during the same
brief conversation that already gathers brand/CTA at intake.

## Out of scope

- Any interactive widgets seen on the reference sites beyond the four
  components above (accordions, tabs, calculators, carousels, hover-swap
  product grids). These are plausible future additions but weren't
  selected as in-scope; adding them now would be speculative.
- Catalog/product grid and stats/claims-strip sections — explicitly
  deferred by the user in scoping.
- Un-hiding the cursor accent or parallax layers on narrow/mobile
  viewports beyond what's described above.
- Any new npm dependency; everything above is vanilla JS/CSS, matching the
  project's existing global constraint.
