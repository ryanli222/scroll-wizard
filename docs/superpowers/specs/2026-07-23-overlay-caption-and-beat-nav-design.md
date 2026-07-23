# Overlay Caption Restyle + Beat Nav

Date: 2026-07-23
Status: Approved design, pending implementation plan

## Problem

Running a real project (`bubble-tea`) through the wizard surfaced two complaints
about the generated site's default look:

1. **Overlay text reads as generic AI output.** The current `.overlay` treatment
   is a translucent rounded card (background, blur, border-radius, top accent
   border) with a bold serif title — the "stock hero card" look, disliked
   regardless of what copy fills it.
2. **No way to jump around.** The site is pure scroll-scrub with no sense of
   overall progression or a way to skip to a specific beat. The user pointed at
   [oso95/scroll-world](https://github.com/oso95/scroll-world) (MIT-licensed) as
   a reference for a floating top nav that shows chapter progression and lets you
   click to jump.

Both are visual/interaction defaults in `template/`, so they apply to every
project scaffolded from scroll-wizard, not just `bubble-tea`. This is scoped as
a reusable template change, confirmed with the user rather than a one-off hack
inside `bubble-tea/site/` (which would be silently overwritten on the next
scaffold).

## Design

### 1. Overlay restyle (CSS-only, no schema or DOM-structure change)

`.overlay` drops the card chrome: `background`, `backdrop-filter`,
`border-radius`, `border-top` are removed. In their place, a left accent-line
rule (`border-left: 2px solid var(--accent)`, text indented via padding).
`.overlay__title` becomes italic serif with a `text-shadow` for legibility
against moving footage (there is no more background scrim behind it).
`.overlay__body` becomes a small, muted caption line under the title, also
shadowed.

The existing mobile / coarse-pointer safety net — `max-height`, `overflow-y:
auto`, `overscroll-behavior: contain`, `scrollbar-gutter: stable` — stays
exactly as-is. `tests/browser/smoke.spec.mjs` already asserts that a tall
stat list + CTA becomes reachable via internal scroll on small viewports; this
spec only removes the "box" visual properties, not the structural sizing
those tests depend on.

`overlay--center` / `--left` / `--right` positioning is unchanged; the accent
line sits at the left edge of the text block in all three, including center
(a deliberate accepted asymmetry, not a bug).

The `--surface` theme token, previously only consumed by `.overlay`'s
background, is now consumed by the new nav pill's background (section 2) so
it stays a meaningful, validated token rather than going unused.

This is a visual change to every project's default look, not just
`bubble-tea`'s. Given only one real project exists so far, that's accepted as
a net improvement rather than something needing a version flag.

### 2. Beat nav — new opt-in feature

New top-level `values.json` field: `nav: true`. Omitted or `false` → no nav is
rendered and nothing else changes; this keeps every existing/future project
that doesn't set it byte-for-byte behaviorally identical to today.

When `nav: true`, the engine renders a floating pill bar: fixed position, top
center, `--surface` background with `backdrop-filter: blur`, one button per
overlay that has a `title`. Clicking a button smooth-scrolls the page so that
beat's `at[0]` becomes the current scroll progress. As the user scrolls
normally, the pill matching the current beat gets an `is-active` (solid
accent) state.

Hidden entirely below the existing 700px mobile breakpoint used elsewhere in
`style.css` — mobile relies on scroll + the caption overlays only, per the
user's choice, matching the reference site's own mobile behavior.

Skipped for reduced-motion sessions: that path already renders a simplified
static view with no scroll-driven engine running, and adding nav there is out
of scope for this change.

### 3. Implementation surface

- `template/index.html`: add `<nav id="beat-nav" class="beat-nav"
  aria-label="Chapters" hidden></nav>` after `#progress-bar`.
- `template/scrub-core.js`: two new pure functions, unit-tested alongside the
  existing ones in `tests/unit/scrub-core.test.mjs`:
  - `progressToScrollY(progress, sectionTop, sectionHeight, viewportH)` — exact
    inverse of the existing `scrollProgress`, used to compute a nav click's
    scroll target.
  - `nearestOverlayIndex(progress, overlays)` — given raw scroll progress and
    the overlay list, returns the index of the overlay whose `at` range
    contains it, falling back to the closest preceding one; drives the active
    pill state.
  - `validateConfig` gains one optional check: `config.nav`, if present, must
    be a boolean.
- `template/scrub-engine.js`:
  - Capture the `Lenis` instance (currently a function-local `new
    globalThis.Lenis(...)` with no reference kept) into a variable the nav can
    reach, so a click calls `lenis.scrollTo(y, { immediate: reducedMotion })`
    when Lenis is active, falling back to native `window.scrollTo({ top,
    behavior: 'smooth' })` otherwise. Native `window.scrollTo` while Lenis owns
    the virtual scroll state would desync the two and cause a stutter on the
    next real scroll input.
  - `renderNav(config)`: builds the nav buttons (skipped if `config.nav !==
    true` or there are no titled overlays), wires each button's click to a
    `jumpTo(index)` call.
  - `updateNav(raw)`: called from both `runEngine`'s and `runVideoEngine`'s
    per-frame `tick()`, right alongside the existing `updateOverlays` call,
    using `nearestOverlayIndex` to toggle `.is-active`.
- `template/style.css`: `.beat-nav` (fixed, top-center, pill, `--surface`
  background, `z-index: 11` — one above `.progress-bar`'s `10`), `.beat-nav__item`,
  `.beat-nav__item.is-active`, and a `@media (max-width: 700px) { .beat-nav {
  display: none } }` rule alongside the existing mobile breakpoint block.

### 4. Test coverage

- `tests/unit/scrub-core.test.mjs`: cases for `progressToScrollY` (round-trips
  against `scrollProgress`), `nearestOverlayIndex` (containing range, gap
  fallback, before-first-beat fallback), and the new `nav` boolean validation
  (accepts `true`/`false`/absent, rejects a non-boolean).
- `tests/browser/smoke.spec.mjs`: a fixture project with `nav: true` — clicking
  a nav button jumps scroll position and moves the `is-active` class; the nav
  is not present (or not visible) at a mobile viewport width.

### 5. Rollout to `bubble-tea`

Not part of the template change itself, done as a follow-up once the template
lands:

- Write short one-liner captions for each of the 5 beats in the accent-rule
  style (replacing the current single-word `body`-less labels), e.g. "Pour" /
  "Held cold, poured slow."
- Set `"nav": true` in `bubble-tea/values.json`.
- Re-run `scaffold-site.mjs --force`.

Changing overlay copy re-opens the `storyboard` gate (its receipt hashes the
overlay projection), which cascades `status.mjs` back through
`stills-preview` → `video` → `extraction` → `theme` → `preview` needing
re-approval — the same chain-validity mechanic already hit once earlier in
this project. Nothing else needs to be redone (frames/video/theme artifacts
are unchanged); it's a handful of quick re-approvals, not re-generation.

## Out of scope

- Mobile nav fallback (dots, compact labels) — explicitly declined in favor of
  hiding it outright.
- Per-project opt-out of the overlay restyle — it's a default style change,
  not a flagged option.
- Reduced-motion nav support.
- Any change to `overlay__cta` / `stats` rendering or styling beyond the box
  removal already covered in section 1.
