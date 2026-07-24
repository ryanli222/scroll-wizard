# Catalog Grid + Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two opt-in template features from
`docs/superpowers/specs/2026-07-23-catalog-grid-carousel-design.md`: a
hover-swap catalog product grid and a native-scroll-snap carousel, both
driven by a shared `catalog.items` list, plus the scaffold-time asset
staging and `SKILL.md` intake changes needed to actually populate them on
a real project.

**Architecture:** Two independent opt-in `values.json`/`config.json`
fields (`catalog.grid`, `catalog.carousel`) over one shared `catalog.items`
array. Images are user-provided only (no paid generation), staged into
`site/catalog/` by `scaffold-site.mjs` the same way `media/`/`frames/`
already are, but via copy-then-post-commit-cleanup (mirroring how `media/`
is handled) rather than move-then-rollback (how `frames/` is handled) —
simpler, since nothing destructive happens to the project source before
the whole scaffold transaction commits. Hover-swap is pure CSS (no JS);
the carousel is a native CSS `scroll-snap` track with two button click
handlers as its entire JS surface — no new dependency, no hand-rolled drag
logic.

**Tech Stack:** Vanilla JS (ES modules), vanilla CSS, vitest (unit),
Playwright (browser smoke). No new npm dependencies.

## Global Constraints

- Node 20+; no new npm dependencies.
- `template/scrub-core.js` holds only pure functions; DOM wiring lives in
  `template/scrub-engine.js`.
- Every new config field is optional; its absence must leave existing
  generated sites byte-for-byte behaviorally identical to today.
- This plan is built against current `main` (not the still-open
  process/parallax/cursor-accent PR branch); it does not assume or depend
  on that branch's generic scroll-reveal primitive.
- Do not add a `Co-Authored-By: Claude` trailer to any commit message in
  this repo.
- Commit after every task (message style: existing history, e.g. `feat:
  …`, `fix: …`, `docs: …`).
- Run unit tests with `npx vitest run <file>`; browser tests with `npx
  playwright test`.
- Repo root: `c:\Users\ryanh\Documents\scroll-wizard`. All paths below are
  relative to it. Do this work in its own git worktree/branch, not
  directly on `main`.

---

### Task 1: `validateConfig` for `catalog`

**Files:**
- Modify: `template/scrub-core.js`
- Test: `tests/unit/scrub-core.test.mjs`

**Interfaces:**
- Produces: `validateConfig` accepts an optional top-level `catalog: {
  items: [{name, image, hoverImage?, cta?}], grid?, carousel? }`. `items`
  needs 1-12 entries, each with a non-empty `name` and a valid `image`
  path under `catalog/` (mirrors `frames.poster`'s path-safety checks);
  `hoverImage` (optional) uses the same path check; `cta` (optional)
  reuses the existing `validateCta` helper. `catalog.grid`/`catalog.carousel`
  are optional booleans.

- [ ] **Step 1: Write the failing tests.** Append to
  `tests/unit/scrub-core.test.mjs` (it already has a `validConfig` fixture
  and a `base()`-style clone pattern used by other `describe` blocks in
  this file — reuse that same clone approach):

```js
describe('validateConfig catalog', () => {
  const base = () => JSON.parse(JSON.stringify(validConfig));

  it('accepts a valid catalog block', () => {
    const config = base();
    config.catalog = {
      items: [
        {
          name: 'Original',
          image: 'catalog/original.webp',
          hoverImage: 'catalog/original-alt.webp',
          cta: { label: 'Shop', href: '#shop' },
        },
        { name: 'Oolong', image: 'catalog/oolong.webp' },
      ],
      grid: true,
      carousel: true,
    };
    expect(validateConfig(config).errors).toEqual([]);
  });

  it('rejects too few/too many items and missing name/image', () => {
    const tooFew = base();
    tooFew.catalog = { items: [] };
    expect(validateConfig(tooFew).errors.map((e) => e.code)).toContain('catalog.items');

    const tooMany = base();
    tooMany.catalog = {
      items: Array.from({ length: 13 }, (_, i) => ({ name: 'n' + i, image: 'catalog/n' + i + '.webp' })),
    };
    expect(validateConfig(tooMany).errors.map((e) => e.code)).toContain('catalog.items');

    const noName = base();
    noName.catalog = { items: [{ name: '', image: 'catalog/x.webp' }] };
    expect(validateConfig(noName).errors.map((e) => e.code)).toContain('catalog.item.name');

    const badImage = base();
    badImage.catalog = { items: [{ name: 'X', image: 'frames/x.webp' }] };
    expect(validateConfig(badImage).errors.map((e) => e.code)).toContain('catalog.item.image');

    const badHover = base();
    badHover.catalog = { items: [{ name: 'X', image: 'catalog/x.webp', hoverImage: 'not-catalog/y.webp' }] };
    expect(validateConfig(badHover).errors.map((e) => e.code)).toContain('catalog.item.hoverImage');

    const badCta = base();
    badCta.catalog = { items: [{ name: 'X', image: 'catalog/x.webp', cta: { label: '', href: '#' } }] };
    expect(validateConfig(badCta).errors.map((e) => e.code)).toContain('cta.label');
  });

  it('validates catalog.grid and catalog.carousel as booleans', () => {
    const badGrid = base();
    badGrid.catalog = { items: [{ name: 'X', image: 'catalog/x.webp' }], grid: 'yes' };
    expect(validateConfig(badGrid).errors.map((e) => e.code)).toContain('catalog.grid');

    const badCarousel = base();
    badCarousel.catalog = { items: [{ name: 'X', image: 'catalog/x.webp' }], carousel: 1 };
    expect(validateConfig(badCarousel).errors.map((e) => e.code)).toContain('catalog.carousel');

    const good = base();
    good.catalog = { items: [{ name: 'X', image: 'catalog/x.webp' }], grid: true, carousel: false };
    expect(validateConfig(good).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** —
  `npx vitest run tests/unit/scrub-core.test.mjs` — expect FAIL (no
  `catalog.*` error codes produced).

- [ ] **Step 3: Implement in `template/scrub-core.js`.**

  Add near the other `safe*Path` helpers (after `safePosterPath`):

```js
function safeCatalogPath(value) {
  return safeAssetPath(value, 'catalog/') && /\.(webp|jpe?g|png)$/i.test(value);
}
```

  In `validateConfig`, immediately before `return { errors, warnings };`
  add:

```js
  if (config.catalog !== undefined) {
    if (!config.catalog || typeof config.catalog !== 'object' || Array.isArray(config.catalog)) {
      addError('catalog.type', 'catalog', 'Catalog must be an object.');
    } else {
      const items = config.catalog.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 12) {
        addError('catalog.items', 'catalog.items', 'Catalog needs 1 to 12 items.');
      } else {
        items.forEach((item, index) => {
          const path = 'catalog.items[' + index + ']';
          if (!item || typeof item.name !== 'string' || !item.name.trim()) {
            addError('catalog.item.name', path + '.name', 'Each catalog item needs a non-empty name.');
          }
          if (!item || !safeCatalogPath(item.image)) {
            addError('catalog.item.image', path + '.image',
              'Each catalog item needs a valid image path under catalog/.');
          }
          if (item?.hoverImage !== undefined && !safeCatalogPath(item.hoverImage)) {
            addError('catalog.item.hoverImage', path + '.hoverImage',
              'hoverImage must be a valid path under catalog/.');
          }
          if (item?.cta) validateCta(item.cta, path + '.cta', addError);
        });
      }
      if (config.catalog.grid !== undefined && typeof config.catalog.grid !== 'boolean') {
        addError('catalog.grid', 'catalog.grid', 'catalog.grid must be a boolean.');
      }
      if (config.catalog.carousel !== undefined && typeof config.catalog.carousel !== 'boolean') {
        addError('catalog.carousel', 'catalog.carousel', 'catalog.carousel must be a boolean.');
      }
    }
  }
```

- [ ] **Step 4: Run tests** —
  `npx vitest run tests/unit/scrub-core.test.mjs` — expect PASS, including
  all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add template/scrub-core.js tests/unit/scrub-core.test.mjs
git commit -m "feat: validate optional catalog grid/carousel config"
```

---

### Task 2: `scaffold-site.mjs` catalog asset staging

**Files:**
- Modify: `scripts/scaffold-site.mjs`
- Test: `tests/unit/scaffold-site.test.mjs`

**Interfaces:**
- Consumes: `config.catalog` (Task 1's validated shape) — `assembleConfig`
  needs no changes, since `catalog` passes through automatically via its
  existing `{...defaults, ...creative}` spread, exactly like `outro` does
  today.
- Produces: when `values.catalog` is present, `scaffoldProject` copies a
  `catalog/` image directory (fresh from `project/catalog`, or inherited
  from an existing `site/catalog`) into the staged site, and returns
  `catalogSet: true` in its result. Absent `values.catalog` → no `catalog`
  directory, no behavior change, `catalogSet` is not set.

- [ ] **Step 1: Read `scripts/scaffold-site.mjs` in full first**, in
  particular `scaffoldProject`'s frames/media staging block (search for
  `projectMediaPath`, `stageMediaSet`, `freshMediaConsumed`,
  `removeConsumedMedia`) and its post-commit best-effort block (search for
  `readmeTmpPath`). Also read `tests/unit/scaffold-site.test.mjs`'s
  `seedFreshMedia`, `seedLiveSite`, and one full `scaffoldProject` test
  case (e.g. "assembles a video-mode site from fresh project media") to
  match existing helper/test conventions exactly.

- [ ] **Step 2: Write the failing tests.** In
  `tests/unit/scaffold-site.test.mjs`, add a new helper near
  `seedFreshMedia`:

```js
async function seedFreshCatalog(projectDir, names) {
  const catalogDir = join(projectDir, 'catalog');
  await mkdir(catalogDir, { recursive: true });
  await Promise.all(names.map((name) => writeFile(join(catalogDir, name), 'image')));
}
```

  Extend `seedLiveSite`'s signature and body (it currently destructures
  `{ marker, frames, media } = {}`) to also accept `catalog`:

```js
async function seedLiveSite(projectDir, { marker, frames, media, catalog } = {}) {
  const sitePath = join(projectDir, 'site');
  await mkdir(sitePath, { recursive: true });
  if (marker !== undefined) {
    await writeFile(join(sitePath, 'marker.txt'), marker, 'utf8');
  }
  if (frames) {
    const framesDir = join(sitePath, 'frames');
    await mkdir(framesDir, { recursive: true });
    await Promise.all(frames.map((name) => writeFile(join(framesDir, name), 'frame')));
  }
  if (media) {
    await seedMedia(join(sitePath, 'media'), media);
  }
  if (catalog) {
    const catalogDir = join(sitePath, 'catalog');
    await mkdir(catalogDir, { recursive: true });
    await Promise.all(catalog.map((name) => writeFile(join(catalogDir, name), 'image')));
  }
}
```

  Add these `describe('scaffoldProject')` cases (append inside the
  existing `describe('scaffoldProject', () => { ... })` block, after any
  existing test):

```js
  it('stages fresh catalog images into the site and removes them from the project', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await seedFreshCatalog(projectDir, ['original.webp', 'oolong.webp']);
    await writeValues(projectDir, {
      ...creativeValues,
      catalog: {
        items: [
          { name: 'Original', image: 'catalog/original.webp' },
          { name: 'Oolong', image: 'catalog/oolong.webp' },
        ],
        grid: true,
      },
    });

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.catalogSet).toBe(true);
    expect((await readdir(join(projectDir, 'site', 'catalog'))).sort())
      .toEqual(['oolong.webp', 'original.webp']);
    expect(await readdir(projectDir)).not.toContain('catalog');
    const config = JSON.parse(await readFile(join(projectDir, 'site', 'config.json'), 'utf8'));
    expect(config.catalog.items).toHaveLength(2);
  });

  it('copies inherited catalog images for a theme-only rebuild', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { frames: ['frame-0001.webp'], catalog: ['original.webp'] });
    await writeValues(projectDir, {
      ...creativeValues,
      catalog: { items: [{ name: 'Original', image: 'catalog/original.webp' }], grid: true },
    });

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
    });

    expect(result.catalogSet).toBe(true);
    await expect(readdir(join(projectDir, 'site', 'catalog'))).resolves.toEqual(['original.webp']);
  });

  it('rejects a catalog config with no available catalog images', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValues(projectDir, {
      ...creativeValues,
      catalog: { items: [{ name: 'Original', image: 'catalog/original.webp' }], grid: true },
    });

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    })).rejects.toThrow(/No catalog images available/);
  });

  it('does not touch catalog assets when values has no catalog field', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.catalogSet).toBeUndefined();
    await expect(readdir(join(projectDir, 'site'))).resolves.not.toContain('catalog');
  });
```

- [ ] **Step 3: Run to verify failure** —
  `npx vitest run tests/unit/scaffold-site.test.mjs` — expect FAIL (no
  `catalogSet` handling exists yet; the "no available catalog images" case
  will fail because nothing throws that message yet).

- [ ] **Step 4: Implement in `scripts/scaffold-site.mjs`.**

  Add a new path const next to `projectMediaPath`:

```js
  const projectCatalogPath = join(projectDir, 'catalog');
```

  After the existing `if (videoMode) { ... } else { ... }` frames/media
  block closes (right before the `const liveFontsPath = ...` line), add:

```js
    let catalogSet;
    let freshCatalogConsumed = false;
    if (values.catalog) {
      const liveCatalogPath = join(sitePath, 'catalog');
      const catalogSourcePath = await pathExists(projectCatalogPath)
        ? projectCatalogPath
        : await pathExists(liveCatalogPath) ? liveCatalogPath : null;
      if (!catalogSourcePath) {
        throw new Error(
          'No catalog images available: drop images into project/catalog, '
          + 'or scaffold over an existing site that already has catalog/.',
        );
      }
      await cp(catalogSourcePath, join(siteTmpPath, 'catalog'), { recursive: true });
      freshCatalogConsumed = catalogSourcePath === projectCatalogPath;
      catalogSet = true;
    }
```

  (Note: `catalog/` is staged by copy, not the rename-then-rollback-on-error
  dance `frames/` uses, because — like `media/` — the project's original
  source is never touched until the whole scaffold transaction has already
  committed; there is nothing to roll back on an earlier failure, so no
  `freshCatalogMoved`/catch-block changes are needed, and no change to
  `recoverInterruptedRun` is needed either — an interrupted run's orphaned
  `site.tmp-*/catalog` is just a copy, safely discarded by that function's
  existing generic `rm(tmpPath, { recursive: true, force: true })` cleanup,
  since `project/catalog` itself was never moved away.)

  In the post-commit best-effort block (search for
  `if (freshMediaConsumed) await removeConsumedMedia(projectMediaPath);`),
  add right after it:

```js
      if (freshCatalogConsumed) await rm(projectCatalogPath, { recursive: true, force: true });
```

  Add `catalogSet` to the returned object (find the existing `return {
  sitePath, frameSet, mediaSet, framesSource, config, warnings, readmePath,
  };` and add `catalogSet,` to it):

```js
    return {
      sitePath, frameSet, mediaSet, framesSource, config, warnings, readmePath, catalogSet,
    };
```

  In `main()`, after the existing `io.log('README: ' + result.readmePath);`
  line, add:

```js
    if (result.catalogSet) io.log('Catalog: catalog/');
```

- [ ] **Step 5: Run tests** —
  `npx vitest run tests/unit/scaffold-site.test.mjs` — expect PASS
  (old cases too).

- [ ] **Step 6: Commit**

```bash
git add scripts/scaffold-site.mjs tests/unit/scaffold-site.test.mjs
git commit -m "feat: stage catalog images when scaffolding a catalog-enabled site"
```

---

### Task 3: Catalog grid rendering

**Files:**
- Modify: `template/index.html`
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Modify: `tests/browser/fixture-server.mjs`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `config.catalog` (Task 1's validated shape).
- Produces: `<section id="catalog-grid">` renders one `.catalog-card` per
  `config.catalog.items` entry (hidden entirely unless
  `config.catalog.grid === true`); each card with a `hoverImage` swaps to
  it on `:hover` via pure CSS opacity, no JS.

- [ ] **Step 1: Read the current `template/index.html`,
  `template/style.css`, and `template/scrub-engine.js`** (`renderCopy`,
  `element`, `linkButton`, and `start()`) before editing.

- [ ] **Step 2: Add a `/catalog/` fixture route.** In
  `tests/browser/fixture-server.mjs`, this task generalizes the
  video-only path-prefix handling into a small reusable helper so this
  task and Task 4 don't duplicate prefix-stripping logic (two prefixes is
  the point past which a shared helper earns its keep — `/video/` alone
  didn't need one, `/video/` + `/catalog/` does).

  Replace:

```js
async function serveStatic(res, pathname) {
  const sitePath = pathname === '/video' || pathname === '/video/'
    ? '/index.html'
    : pathname.startsWith('/video/')
      ? pathname.slice('/video'.length)
      : pathname;
  const relative = normalize(sitePath === '/' ? '/index.html' : sitePath)
    .replace(/^([/\\]\.\.)+/, '');
```

  with:

```js
const FIXTURE_PREFIXES = ['/video', '/catalog'];

function stripFixturePrefix(pathname) {
  for (const prefix of FIXTURE_PREFIXES) {
    if (pathname === prefix || pathname === prefix + '/') return '/index.html';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

async function serveStatic(res, pathname) {
  const sitePath = stripFixturePrefix(pathname);
  const relative = normalize(sitePath === '/' ? '/index.html' : sitePath)
    .replace(/^([/\\]\.\.)+/, '');
```

  Add a `catalogConfig` next to `videoConfig` (reuses video mode so no
  frame-path prefix problem arises — `/catalog/` never needs
  `/frames/frame-*.webp`):

```js
const catalogConfig = {
  ...videoConfig,
  catalog: {
    items: [
      { name: 'Original', image: 'catalog/original.webp', hoverImage: 'catalog/original-alt.webp' },
      { name: 'Oolong', image: 'catalog/oolong.webp' },
    ],
    grid: true,
    carousel: true,
  },
};
```

  Replace the `/config.json` route handler:

```js
  if (pathname === '/config.json' || pathname === '/video/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(pathname.startsWith('/video/') ? videoConfig : config));
    return;
  }
```

  with:

```js
  if (pathname === '/config.json' || pathname === '/video/config.json'
      || pathname === '/catalog/config.json') {
    const body = pathname === '/video/config.json' ? videoConfig
      : pathname === '/catalog/config.json' ? catalogConfig
      : config;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }
```

  Add media/catalog-image routes right after the existing
  `/video/media/poster.webp` block:

```js
  if (pathname === '/catalog/media/video.webm') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webm'] });
    res.end(await readFile(videoPath));
    return;
  }

  if (pathname === '/catalog/media/poster.webp') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webp'] });
    res.end(await readFile(videoPosterPath));
    return;
  }

  const catalogImageMatch = /^\/catalog\/catalog\/(original|original-alt|oolong)\.webp$/.exec(pathname);
  if (catalogImageMatch) {
    // Same convention as the /frames/frame-*.webp route below: a .webp-named
    // URL served as a tiny synthesized PNG, since content is sniffed from
    // bytes, not the URL extension.
    res.writeHead(200, { 'Content-Type': 'image/png' });
    const shade = { original: 200, 'original-alt': 80, oolong: 140 }[catalogImageMatch[1]];
    res.end(makePng(shade, 120, 60));
    return;
  }
```

- [ ] **Step 3: Write the failing browser tests.** Append to
  `tests/browser/smoke.spec.mjs`:

```js
test('catalog grid is absent until scrub.catalog.grid is enabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#catalog-grid')).toBeHidden();
});

test('catalog grid renders cards and swaps to the hover image', async ({ page }) => {
  await requireVideoFixture(page.request);
  await page.goto('/catalog/');
  await expect(page.locator('#catalog-grid')).toBeVisible();
  const cards = page.locator('.catalog-card');
  await expect(cards).toHaveCount(2);
  const firstCard = cards.first();
  const altImage = firstCard.locator('.catalog-card__image--alt');
  await expect(altImage).toHaveCSS('opacity', '0');
  await firstCard.hover();
  await expect(altImage).toHaveCSS('opacity', '1');
});
```

- [ ] **Step 4: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "catalog grid"` — expect FAIL
  (`#catalog-grid` doesn't exist yet, `/catalog/` 404s).

- [ ] **Step 5: Add markup in `template/index.html`.** Insert between
  `</section>` (closing `#scrub`) and `<section id="outro"
  class="outro">`:

```html
    <section id="catalog-grid" class="catalog-grid" aria-label="Catalog" hidden></section>
```

- [ ] **Step 6: Add CSS.** In `template/style.css`, add after the
  `.outro` rules:

```css
.catalog-carousel[hidden], .catalog-grid[hidden] { display: none; }
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.5rem;
  padding: 6vh 8vw;
  max-width: 72rem;
  margin: 0 auto;
}
.catalog-card__media {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--radius);
}
.catalog-card__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.catalog-card__image--alt { opacity: 0; transition: opacity 200ms ease; }
.catalog-card:hover .catalog-card__image--alt { opacity: 1; }
.catalog-card__name { margin: .75rem 0 0; font-size: 1rem; }
.catalog-card__cta {
  display: inline-block;
  margin-top: .5rem;
  font-size: .85rem;
  text-decoration: underline;
  color: var(--accent);
}
```

- [ ] **Step 7: Implement rendering in `template/scrub-engine.js`.**

  Add a new top-level const:

```js
const catalogGridSection = document.getElementById('catalog-grid');
```

  Add near `renderOutro`:

```js
function renderCatalogCard(item) {
  const card = element('article', 'catalog-card');
  const media = element('div', 'catalog-card__media');
  const image = element('img', 'catalog-card__image');
  image.src = item.image;
  image.alt = item.name;
  media.append(image);
  if (item.hoverImage) {
    const altImage = element('img', 'catalog-card__image catalog-card__image--alt');
    altImage.src = item.hoverImage;
    altImage.alt = '';
    media.append(altImage);
  }
  card.append(media, element('h3', 'catalog-card__name', item.name));
  if (item.cta) card.append(linkButton(item.cta, 'catalog-card__cta'));
  return card;
}

function renderCatalogGrid(config) {
  if (!config.catalog?.grid) return;
  const cards = config.catalog.items.map(renderCatalogCard);
  catalogGridSection.append(...cards);
  catalogGridSection.hidden = false;
}
```

  In `start()`, right after `overlayNodes = renderCopy(config);` add:

```js
    renderCatalogGrid(config);
```

- [ ] **Step 8: Run** `npx playwright test tests/browser/smoke.spec.mjs
  --grep "catalog grid"` — expect PASS. Then run the full suite (`npx
  playwright test`) — expect PASS with no regressions.

- [ ] **Step 9: Commit**

```bash
git add template/index.html template/style.css template/scrub-engine.js tests/browser/fixture-server.mjs tests/browser/smoke.spec.mjs
git commit -m "feat: add opt-in hover-swap catalog grid"
```

---

### Task 4: Catalog carousel rendering

**Files:**
- Modify: `template/index.html`
- Modify: `template/style.css`
- Modify: `template/scrub-engine.js`
- Test: `tests/browser/smoke.spec.mjs`

**Interfaces:**
- Consumes: `config.catalog` (Task 1).
- Produces: `<section id="catalog-carousel">` renders one slide per
  `config.catalog.items` entry (hidden entirely unless
  `config.catalog.carousel === true`); `renderCatalogCarousel(config)`
  populates `.catalog-carousel__track` and wires the prev/next buttons to
  `scrollBy` on a native CSS scroll-snap track.

- [ ] **Step 1: Read the current `template/index.html`'s `#catalog-grid`
  section (added in Task 3) and `template/scrub-engine.js`'s `start()`**
  before editing.

- [ ] **Step 2: Write the failing browser test.** Append to
  `tests/browser/smoke.spec.mjs` (reuses the `/catalog/` fixture from
  Task 3 — no fixture changes needed):

```js
test('catalog carousel scrolls via next/prev controls', async ({ page }) => {
  await requireVideoFixture(page.request);
  await page.goto('/catalog/');
  await expect(page.locator('#catalog-carousel')).toBeVisible();
  const track = page.locator('.catalog-carousel__track');
  const before = await track.evaluate((el) => el.scrollLeft);
  await page.click('.catalog-carousel__next');
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  const afterNext = await track.evaluate((el) => el.scrollLeft);
  await page.click('.catalog-carousel__prev');
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeLessThan(afterNext);
});

test('catalog carousel is absent until scrub.catalog.carousel is enabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#catalog-carousel')).toBeHidden();
});
```

- [ ] **Step 3: Run to verify failure** — `npx playwright test
  tests/browser/smoke.spec.mjs --grep "catalog carousel"` — expect FAIL
  (`#catalog-carousel` doesn't exist yet, `/catalog/` 404s on it).

- [ ] **Step 4: Add markup in `template/index.html`.** Insert immediately
  before `<section id="catalog-grid" class="catalog-grid" ...>` (added in
  Task 3):

```html
    <section id="catalog-carousel" class="catalog-carousel" aria-label="Flavors" hidden>
      <button type="button" class="catalog-carousel__prev" aria-label="Previous">&lsaquo;</button>
      <div class="catalog-carousel__track"></div>
      <button type="button" class="catalog-carousel__next" aria-label="Next">&rsaquo;</button>
    </section>
```

- [ ] **Step 5: Add CSS.** In `template/style.css`, add after the
  `.catalog-grid`/`.catalog-card*` rules from Task 3:

```css
.catalog-carousel { position: relative; padding: 4vh 0; }
.catalog-carousel__track {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 0 8vw;
  scrollbar-width: none;
}
.catalog-carousel__track::-webkit-scrollbar { display: none; }
.catalog-carousel__item { flex: 0 0 min(70vw, 320px); scroll-snap-align: center; }
.catalog-carousel__image { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: var(--radius); display: block; }
.catalog-carousel__name { margin: .5rem 0 0; font-size: .95rem; text-align: center; }
.catalog-carousel__prev, .catalog-carousel__next {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  backdrop-filter: blur(10px);
  cursor: pointer;
}
.catalog-carousel__prev { left: 1rem; }
.catalog-carousel__next { right: 1rem; }
```

- [ ] **Step 6: Implement in `template/scrub-engine.js`.** Add new
  top-level consts alongside `catalogGridSection`:

```js
const catalogCarouselSection = document.getElementById('catalog-carousel');
const catalogCarouselTrack = catalogCarouselSection.querySelector('.catalog-carousel__track');
const catalogCarouselPrev = catalogCarouselSection.querySelector('.catalog-carousel__prev');
const catalogCarouselNext = catalogCarouselSection.querySelector('.catalog-carousel__next');
```

  Add near `renderCatalogGrid`:

```js
function renderCatalogCarousel(config) {
  if (!config.catalog?.carousel) return;
  for (const item of config.catalog.items) {
    const slide = element('div', 'catalog-carousel__item');
    const image = element('img', 'catalog-carousel__image');
    image.src = item.image;
    image.alt = item.name;
    slide.append(image, element('p', 'catalog-carousel__name', item.name));
    catalogCarouselTrack.append(slide);
  }
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const scrollByOneItem = (direction) => {
    const item = catalogCarouselTrack.querySelector('.catalog-carousel__item');
    const amount = (item?.getBoundingClientRect().width ?? 300) + 16;
    catalogCarouselTrack.scrollBy({ left: direction * amount, behavior });
  };
  catalogCarouselPrev.addEventListener('click', () => scrollByOneItem(-1));
  catalogCarouselNext.addEventListener('click', () => scrollByOneItem(1));
  catalogCarouselSection.hidden = false;
}
```

  In `start()`, right after `renderCatalogGrid(config);` (added in Task 3)
  add:

```js
    renderCatalogCarousel(config);
```

- [ ] **Step 7: Run** `npx playwright test` — expect PASS for the entire
  suite, including Task 3's catalog-grid tests and all pre-existing
  scenarios.

- [ ] **Step 8: Commit**

```bash
git add template/index.html template/style.css template/scrub-engine.js tests/browser/smoke.spec.mjs
git commit -m "feat: add opt-in native-scroll-snap catalog carousel"
```

---

### Task 5: `SKILL.md` — collect catalog items at intake

**Files:**
- Modify: `SKILL.md`

**Interfaces:**
- Consumes: nothing new (workflow-only change).
- Produces: Step 1 (Intake) collects per-item name/image/hoverImage/CTA
  when the user wants a catalog section, and persists it to
  `values.json#catalog`.

- [ ] **Step 1: Read `SKILL.md`'s current `## Step 1: Intake` section**
  to match surrounding tone and bullet style exactly.

- [ ] **Step 2: Edit Step 1.** In the bullet that currently reads:

```
- Ask brand, vibe, motion, stopped scenes ("holds"), and CTA. Also collect claim count,
  section count, whether the story has a process, and catalog-item count.
```

  add a new bullet immediately after it:

```
- When the catalog-item count is nonzero and the user actually wants a catalog
  section, collect each item's name, a dropped-in image (and an optional
  hover-swap alternate), and an optional CTA, then persist them to
  `values.json#catalog` along with whether to render the grid, the carousel,
  or both. Catalog images are user-provided only — there is no paid
  generation route for them.
```

- [ ] **Step 3: Verify the edit landed correctly.**

```bash
grep -n "values.json#catalog" SKILL.md
```

  Expect a matching line.

- [ ] **Step 4: Commit**

```bash
git add SKILL.md
git commit -m "docs: collect catalog items at intake"
```
