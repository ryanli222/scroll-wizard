# Catalog Grid + Carousel

Date: 2026-07-23
Status: Approved design, pending implementation plan

## Problem

Intake already asks for a "catalog-item count" (`plan-generation.mjs beats
--catalog N`), but — like `hasProcess` before the process-section work —
that answer only feeds the beat-count heuristic. Nothing in the template
ever renders a catalog. Reference sites the user likes (e.g.
en.manayerbamate.com) get a large share of their "immersive" feel not from
hero footage quality but from breadth of small interactive modules: a
hover-swap product grid and a rotating flavor carousel among them. This
gives scroll-wizard sites the same two modules, as independent opt-in
template sections — the same "new field, no field, no behavior change"
pattern already used for `process`/`nav`/`scrub.parallax`.

This is built against current `main`, in parallel with the still-open
process/parallax/cursor-accent/stagger PR. It does not depend on that PR
and does not reuse its generic scroll-reveal primitive (`data-reveal` /
`initScrollReveal`) — the catalog sections render without a scroll-triggered
fade-in for now. Wiring them into that shared primitive is a small, natural
follow-up once that PR merges, not part of this spec.

## Schema

New optional top-level `values.json`/`config.json` field:

```json
"catalog": {
  "items": [
    {
      "name": "Original",
      "image": "catalog/original.webp",
      "hoverImage": "catalog/original-alt.webp",
      "cta": { "label": "Shop", "href": "#" }
    }
  ],
  "grid": true,
  "carousel": true
}
```

- `items`: 1-12 entries. Each requires non-empty `name` and a valid
  `image` path; `hoverImage` and `cta` are optional per item.
- Asset paths live under a new `catalog/` prefix, validated exactly like
  `frames/`/`media/` already are: reuse the existing `safeAssetPath(value,
  prefix)` helper in `scrub-core.js` with `'catalog/'`, requiring a
  `.webp`/`.jpg`/`.jpeg`/`.png` extension (mirrors `safePosterPath`).
- `grid` / `carousel`: independent optional booleans. Either, both, or
  neither may be `true`; absence of the whole `catalog` block means
  neither section exists, byte-for-byte identical to today's output.
- Images are user-provided only (dropped into the project like beat
  stills today) — no paid generation route for catalog images. This
  keeps the feature entirely free and matches the skill's existing
  budget-conscious posture: a project with no catalog images simply
  doesn't set `catalog`, and nothing changes.

`validateConfig` gains: item count bounds, per-item name/image/hoverImage/
cta checks (reusing the existing `validateCta` helper for each item's
`cta`), and boolean checks for `catalog.grid`/`catalog.carousel`.

## Rendering

Two independent sections, added to `template/index.html` (hidden by
default, matching the `#process`/`.parallax-layers` convention), populated
client-side in `scrub-engine.js` exactly like overlays/process are today —
`createElement`/`textContent`, never `innerHTML`.

### Grid (`#catalog-grid`)

CSS grid of cards (`repeat(auto-fit, minmax(...))`, responsive without a
breakpoint list). Hover-swap is **pure CSS, no JS**: each card stacks a
base `<img>` and an optional alt `<img>` absolutely, alt at `opacity: 0`;
`.catalog__card:hover .catalog__image--alt { opacity: 1 }`. Cards without
a `hoverImage` just render the base image with no hover rule — no
conditional JS needed either way. Touch/tap either triggers the browser's
own simulated-hover-on-tap or simply shows the base image; no special
handling required.

### Carousel (`#catalog-carousel`)

A native CSS **scroll-snap** track (`scroll-snap-type: x mandatory` on the
container, `scroll-snap-align: center` on each item) instead of a
hand-rolled JS carousel. Prev/next `<button>`s call
`track.scrollBy({ left: ±trackItemWidth, behavior })` — that's the entire
JS surface. Touch/trackpad swipe works for free via the browser's native
scroll-snap; no drag-tracking code needed. No autoplay (accessibility
best practice, and consistent with this project never auto-driving motion
the user didn't initiate). `behavior` is `'auto'` instead of `'smooth'`
under `prefers-reduced-motion: reduce` — the carousel itself stays
functional and visible under reduced motion (it's real content/navigation,
not decoration like parallax/cursor-accent), only the smooth-scroll
animation is suppressed.

## Test coverage

- `tests/unit/scrub-core.test.mjs`: `validateConfig` cases for `catalog`
  (valid block; too few/many items; missing name/image; invalid
  hoverImage/cta; `grid`/`carousel` boolean checks); a `safeCatalogPath`-style
  check via the existing `safeAssetPath` pattern.
- `tests/browser/smoke.spec.mjs`: a fixture with `catalog.grid: true` —
  cards render, hovering a card with a `hoverImage` swaps the visible
  image (computed opacity); a fixture with `catalog.carousel: true` —
  clicking next/prev scrolls the track (assert `scrollLeft` changes);
  reduced motion — carousel remains visible and scrollable, `behavior`
  is `'auto'` (or equivalent assertion); a project with no `catalog` key
  — neither section exists in the DOM.

## Skill workflow update

`SKILL.md` Step 1 (Intake) already asks for catalog-item count for the
beat heuristic; add one bullet so that, when the user actually wants a
catalog section, their per-item name/image/hoverImage/CTA gets collected
and persisted to `values.json#catalog` in the same conversation — mirroring
exactly how the process-section rollout added its own intake bullet.

## Out of scope

- Reusing PR #3's generic `data-reveal` scroll-reveal primitive for these
  sections — natural follow-up once that PR merges, not part of this spec.
- Any paid/generated catalog imagery — user-provided only.
- Autoplay, infinite-loop wraparound, or multi-item-per-view carousel
  variants.
- A shared `catalog.mode` switch collapsing grid/carousel into one
  component — explicitly rejected in favor of two independent flags.
