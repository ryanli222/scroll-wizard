import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium, expect, test } from '@playwright/test';

test.skip(
  !existsSync(chromium.executablePath()),
  'Playwright Chromium is not installed; browser smoke suite skipped.',
);

const videoFixtureUrl = '/video/';

async function requireVideoFixture(request) {
  const response = await request.get('/video-fixture-status.json');
  const status = await response.json();
  test.skip(!status.available, status.reason);
}

function waitForServer(child, message) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(message)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error('Fixture server exited with ' + code + ': ' + output));
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

test('poster appears before delayed sequence and canvas scrubs', async ({ page }) => {
  let observeFirstEngineFetch;
  const firstEngineFetchObserved = new Promise((resolve) => {
    observeFirstEngineFetch = resolve;
  });
  let releaseEngineFetches;
  const engineFetchesReleased = new Promise((resolve) => {
    releaseEngineFetches = resolve;
  });
  let observedEngineFetch = false;

  await page.route('**/frames/frame-*.webp', async (route) => {
    const request = route.request();
    const isFirstFrame = request.url().endsWith('frame-0001.webp');
    if (request.resourceType() === 'image') {
      await route.continue();
      return;
    }
    if (!observedEngineFetch) {
      observedEngineFetch = true;
      observeFirstEngineFetch();
    }
    await engineFetchesReleased;
    if (!isFirstFrame) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await firstEngineFetchObserved;
    await expect(page.locator('#poster')).toBeVisible();
    await expect(page.locator('#poster')).not.toHaveClass(/is-hidden/);
  } finally {
    releaseEngineFetches();
  }

  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 0)).toBeGreaterThan(0);
  const first = await page.evaluate(() =>
    [...document.querySelector('#scrub-canvas').getContext('2d').getImageData(0, 0, 1, 1).data]);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.65));
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1)).toBeGreaterThan(1);
  const later = await page.evaluate(() =>
    [...document.querySelector('#scrub-canvas').getContext('2d').getImageData(0, 0, 1, 1).data]);
  expect(later).not.toEqual(first);
  // The engine hides the poster only after the first successful canvas draw.
  await expect(page.locator('#poster')).toHaveClass(/is-hidden/);
});

test('loader hides after the first painted frame while background frames load', async ({ page }) => {
  await page.route('**/frames/frame-*.webp', async (route) => {
    const frame = Number(route.request().url().match(/frame-(\d+)\.webp$/)?.[1]);
    if (frame > 13) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    await route.continue();
  });
  await page.goto('/');

  await expect(page.locator('#loader')).toBeHidden();
  const state = await page.evaluate(() => ({
    lastFrame: window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1,
    decodedCount: window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 0,
  }));
  expect(state.lastFrame).toBeGreaterThanOrEqual(0);
  expect(state.decodedCount).toBeLessThan(30);
});

test('visibility controls inert and keyboard focus', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('[data-overlay-index="0"]');
  await expect(overlay).toHaveJSProperty('inert', true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
  await expect(overlay).toHaveJSProperty('inert', false);
  await overlay.getByRole('link').focus();
  await expect(overlay.getByRole('link')).toBeFocused();
  // The overlay layer must be click-through outside overlay content:
  // hit-testing a point inside the layer's box (but clear of the left-
  // positioned overlay panel) must land on something below the layer.
  const passesThrough = await page.evaluate(() => {
    const layer = document.getElementById('overlay-layer');
    const box = layer.getBoundingClientRect();
    const hit = document.elementFromPoint(box.right - 10, box.top + box.height / 2);
    return hit !== null && !layer.contains(hit);
  });
  expect(passesThrough).toBe(true);
});

test('reduced motion requests only the poster frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requested = [];
  page.on('request', (request) => {
    if (request.url().includes('/frames/')) requested.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#scrub-canvas')).toBeHidden();
  await expect(page.locator('[data-overlay-index="0"]')).toHaveJSProperty('inert', false);
  await page.waitForTimeout(200);
  expect(requested.map((url) => url.split('/').pop())).toEqual(['frame-0001.webp']);
});

test('one missing frame warns once and keeps rendering', async ({ page }) => {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/frames/frame-0004.webp', (route) =>
    route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.5));
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.failedFrames.includes(3))).toBe(true);
  expect(warnings.filter((line) => line.includes('Frame 4 failed'))).toHaveLength(1);
  // Rendering continues: a fallback frame was actually drawn to the canvas.
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1)).toBeGreaterThanOrEqual(0);
});

test('decoded bitmap count never exceeds the configured bound', async ({ page }) => {
  // Fixture has 30 frames; the engine's decode window is radius 12 ->
  // min(count, 25) frames, so exceeding 25 means eviction is broken.
  await page.goto('/');
  const decodedCount = () => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 999);
  for (const fraction of [0.1, 0.3, 0.6, 0.9]) {
    await page.evaluate((value) =>
      scrollTo(0, document.body.scrollHeight * value), fraction);
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 0)).toBeGreaterThan(0);
    expect(await decodedCount()).toBeLessThanOrEqual(25);
  }
  // Settle: the full window decodes (floor proves the check isn't vacuous
  // at zero decodes), yet the count stays at or below the 25-frame bound.
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 0)).toBeGreaterThanOrEqual(20);
  expect(await decodedCount()).toBeLessThanOrEqual(25);
});

test('frames fixture stays available when ffmpeg is missing', async () => {
  const child = spawn(process.execPath, ['tests/browser/fixture-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: '',
      PORT: '4174',
      SCROLL_WIZARD_FFMPEG: 'scroll-wizard-missing-ffmpeg',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child, 'http://127.0.0.1:4174');
    const [frameSite, status] = await Promise.all([
      fetch('http://127.0.0.1:4174/'),
      fetch('http://127.0.0.1:4174/video-fixture-status.json'),
    ]);
    expect(frameSite.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ available: false });
  } finally {
    await stopChild(child);
  }
});

test('video mode scrubs the video with scroll', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.goto(videoFixtureUrl);
  await page.waitForSelector('#loader', { state: 'hidden' });
  await page.mouse.wheel(0, 4000);
  await page.waitForFunction(() =>
    window.__SCROLL_WIZARD_DEBUG__
      && window.__SCROLL_WIZARD_DEBUG__.videoTime > 0.2);
  await expect(page.locator('#poster')).toHaveClass(/is-hidden/);
});

test('video gesture priming is installed before loading and runs only once', async ({ page, request }) => {
  await requireVideoFixture(request);
  const configuredRequests = [];
  page.on('request', (mediaRequest) => {
    if (mediaRequest.url().endsWith('/media/video.webm')) {
      configuredRequests.push(mediaRequest.resourceType());
    }
  });
  await page.addInitScript(() => {
    window.__PRIME_CALLS__ = { emptyRejects: 0, pause: 0, play: 0, sources: [] };
    HTMLMediaElement.prototype.play = function play() {
      window.__PRIME_CALLS__.play += 1;
      window.__PRIME_CALLS__.sources.push(this.currentSrc);
      if (!this.currentSrc) {
        window.__PRIME_CALLS__.emptyRejects += 1;
        return Promise.reject(new Error('No playable source'));
      }
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      window.__PRIME_CALLS__.pause += 1;
    };
  });
  await page.route('**/media/video.webm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  const videoRequest = page.waitForRequest('**/media/video.webm');
  await page.goto(videoFixtureUrl, { waitUntil: 'domcontentloaded' });
  await videoRequest;
  await page.dispatchEvent('body', 'pointerdown');
  await page.dispatchEvent('body', 'touchstart');
  await expect.poll(() => page.evaluate(() => window.__PRIME_CALLS__.pause)).toBe(1);
  const priming = await page.evaluate(() => window.__PRIME_CALLS__);
  expect(priming.emptyRejects).toBe(0);
  expect(priming.play).toBe(1);
  await page.waitForSelector('#loader', { state: 'hidden' });
  expect(configuredRequests).toEqual(['fetch']);
  expect(priming.sources[0]).toMatch(/^data:video\/mp4;base64,/);
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('scrub-video').currentSrc.startsWith('blob:'))).toBe(true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
  await page.waitForFunction(() => window.__SCROLL_WIZARD_DEBUG__.videoTime > 0.2);
  expect(await page.evaluate(() =>
    document.getElementById('scrub-video').currentSrc)).toContain('blob:');
});

test('video setup error removes pending priming handlers', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.addInitScript(() => {
    window.__SETUP_ERROR_PLAY_CALLS__ = 0;
    HTMLMediaElement.prototype.play = function play() {
      window.__SETUP_ERROR_PLAY_CALLS__ += 1;
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.route('**/media/poster.webp', (route) => route.fulfill({
    status: 404,
    body: 'missing poster',
  }));
  await page.goto(videoFixtureUrl);
  await expect(page.locator('#fatal-error')).toBeVisible();
  await page.dispatchEvent('body', 'pointerdown');
  await page.dispatchEvent('body', 'touchstart');
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__SETUP_ERROR_PLAY_CALLS__)).toBe(0);
});

test('video seek contract coalesces seeks and waits for first seeked paint', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.addInitScript(() => {
    window.__SEEK_LOG__ = [];
    window.__REVOKED_BLOB_URLS__ = [];
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.__REVOKED_BLOB_URLS__.push(url);
      revokeObjectURL(url);
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype, 'currentTime',
    );
    const seekingDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype, 'seeking',
    );
    const forcedSeekingUntil = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'seeking', {
      configurable: seekingDescriptor.configurable,
      enumerable: seekingDescriptor.enumerable,
      get() {
        return performance.now() < (forcedSeekingUntil.get(this) ?? 0)
          || seekingDescriptor.get.call(this);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if (this.id === 'scrub-video') {
          window.__SEEK_LOG__.push({ at: performance.now(), overlap: this.seeking, value });
          if (window.__SEEK_LOG__.length === 1) {
            forcedSeekingUntil.set(this, performance.now() + 300);
          }
        }
        return descriptor.set.call(this, value);
      },
    });
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function addDelayedListener(type, listener, options) {
      if (this instanceof HTMLVideoElement && this.id === 'scrub-video' && type === 'seeked') {
        const delayed = (event) => setTimeout(() => listener.call(this, event), 300);
        return addEventListener.call(this, type, delayed, options);
      }
      return addEventListener.call(this, type, listener, options);
    };
  });
  await page.goto(videoFixtureUrl);
  await page.waitForSelector('#loader', { state: 'hidden' });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.55));
  await page.waitForFunction(() => window.__SEEK_LOG__.length > 0);
  await expect(page.locator('#poster')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#poster')).toHaveClass(/is-hidden/);

  const state = await page.evaluate(() => ({
    duration: window.__SCROLL_WIZARD_DEBUG__.videoDuration,
    epsilon: window.__SCROLL_WIZARD_DEBUG__.seekEpsilon,
    seeks: window.__SEEK_LOG__,
  }));
  expect(state.duration).toBeCloseTo(2, 1);
  expect(state.epsilon).toBe(0.008);
  expect(state.seeks.length).toBeGreaterThan(0);
  expect(state.seeks.every((seek) => !seek.overlap)).toBe(true);
  if (state.seeks.length > 1) {
    expect(state.seeks[1].at - state.seeks[0].at).toBeGreaterThanOrEqual(250);
  }
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(() => page.evaluate(() =>
    window.__REVOKED_BLOB_URLS__.length)).toBe(1);
});

test('video reduced motion uses poster and requests no video bytes', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const videoRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/media/video.webm')) videoRequests.push(request.url());
  });
  await page.goto(videoFixtureUrl);
  await expect(page.locator('#scrub-video')).toBeHidden();
  await expect(page.locator('#poster')).toBeVisible();
  const overlay = page.locator('[data-overlay-index="0"]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveJSProperty('inert', false);
  await expect(overlay.locator('.overlay__body')).toContainText('Fixture overlay body copy.');
  await page.waitForTimeout(200);
  expect(videoRequests).toHaveLength(0);
});

test('video load error revokes its Blob URL', async ({ page, request }) => {
  await requireVideoFixture(request);
  await page.addInitScript(() => {
    window.__REVOKED_BLOB_URLS__ = [];
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.__REVOKED_BLOB_URLS__.push(url);
      revokeObjectURL(url);
    };
  });
  await page.route('**/media/video.webm', (route) => route.fulfill({
    body: 'not a video',
    contentType: 'video/webm',
  }));
  await page.goto(videoFixtureUrl);
  await expect(page.locator('#fatal-error')).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    window.__REVOKED_BLOB_URLS__.length)).toBe(1);
});

test('phone viewport keeps video scrub content usable through a height resize', async ({ browser, request }) => {
  await requireVideoFixture(request);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(videoFixtureUrl);
    await page.waitForSelector('#loader', { state: 'hidden' });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
    await page.waitForFunction(() =>
      window.__SCROLL_WIZARD_DEBUG__
        && window.__SCROLL_WIZARD_DEBUG__.videoTime > 0.2);

    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const overlay = document.querySelector('[data-overlay-index="0"]');
      const cta = overlay.querySelector('.overlay__cta');
      const overlayRect = overlay.getBoundingClientRect();
      const ctaRect = cta.getBoundingClientRect();
      return {
        noHorizontalOverflow: root.scrollWidth <= root.clientWidth,
        overlayInsideViewport: overlayRect.left >= 0
          && overlayRect.right <= innerWidth
          && overlayRect.top >= 0
          && overlayRect.bottom <= innerHeight,
        ctaWidth: ctaRect.width,
        ctaHeight: ctaRect.height,
      };
    });
    expect(layout.noHorizontalOverflow).toBe(true);
    expect(layout.overlayInsideViewport).toBe(true);
    expect(layout.ctaWidth).toBeGreaterThanOrEqual(44);
    expect(layout.ctaHeight).toBeGreaterThanOrEqual(44);

    await page.waitForTimeout(800);
    const beforeResize = await page.evaluate(() => ({
      distance: document.getElementById('scrub').offsetHeight - innerHeight,
      progress: window.__SCROLL_WIZARD_DEBUG__.scrubProgress,
      time: window.__SCROLL_WIZARD_DEBUG__.videoTime,
    }));
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(800);
    const afterResize = await page.evaluate(() => ({
      distance: document.getElementById('scrub').offsetHeight - innerHeight,
      progress: window.__SCROLL_WIZARD_DEBUG__.scrubProgress,
      time: window.__SCROLL_WIZARD_DEBUG__.videoTime,
    }));
    expect(Math.abs(afterResize.distance - beforeResize.distance)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterResize.progress - beforeResize.progress)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(afterResize.time - beforeResize.time)).toBeLessThanOrEqual(0.02);

    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrollTo(0, scrub.offsetTop + scrub.offsetHeight - innerHeight);
    });
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__.scrubProgress)).toBeGreaterThan(0.995);
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__.videoTime)).toBeGreaterThan(1.8);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(100);
    const grown = await page.evaluate(() => ({
      distance: document.getElementById('scrub').offsetHeight - innerHeight,
      progress: window.__SCROLL_WIZARD_DEBUG__.scrubProgress,
    }));
    expect(Math.abs(grown.distance - beforeResize.distance)).toBeLessThanOrEqual(1);
    expect(grown.progress).toBeGreaterThan(0.995);
    await page.evaluate(() => scrollTo(0, document.getElementById('scrub').offsetTop));
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__.scrubProgress)).toBeLessThan(0.005);
  } finally {
    await context.close();
  }
});

test('phone viewport supports coarse short landscape with the same video media', async ({ browser, request }) => {
  await requireVideoFixture(request);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(videoFixtureUrl);
    await page.waitForSelector('#loader', { state: 'hidden' });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
    await page.waitForFunction(() =>
      window.__SCROLL_WIZARD_DEBUG__?.videoTime > 0.2);
    const layout = await page.evaluate(() => {
      const overlay = document.querySelector('[data-overlay-index="0"]');
      const rect = overlay.getBoundingClientRect();
      const style = getComputedStyle(overlay);
      return {
        mediaSrc: document.getElementById('scrub-video').src,
        insideViewport: rect.left >= 0 && rect.right <= innerWidth
          && rect.top >= 0 && rect.bottom <= innerHeight,
        maxHeight: style.maxHeight,
        backdropFilter: style.backdropFilter,
        epsilon: window.__SCROLL_WIZARD_DEBUG__.seekEpsilon,
      };
    });
    expect(layout.mediaSrc).toContain('blob:');
    expect(layout.insideViewport).toBe(true);
    expect(layout.maxHeight).not.toBe('none');
    expect(layout.backdropFilter).not.toContain('18px');
    expect(layout.epsilon).toBe(0.02);
  } finally {
    await context.close();
  }
});

test('phone viewport keeps tall landscape overlay content reachable', async ({ browser, request }) => {
  await requireVideoFixture(request);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.route('**/video/config.json', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      config.overlays[0].body = Array(40).fill('Tall fixture body copy.').join(' ');
      config.overlays[0].stats = Array.from({ length: 20 }, (_value, index) => ({
        label: 'Metric ' + (index + 1),
        value: String(index + 1),
      }));
      await route.fulfill({ response, json: config });
    });
    await page.goto(videoFixtureUrl);
    await page.waitForSelector('#loader', { state: 'hidden' });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
    const overlay = page.locator('[data-overlay-index="0"]');
    await expect(overlay).toHaveJSProperty('inert', false);
    const initial = await overlay.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const title = node.querySelector('.overlay__title').getBoundingClientRect();
      return {
        clientHeight: node.clientHeight,
        overflowY: getComputedStyle(node).overflowY,
        rect: { bottom: rect.bottom, top: rect.top },
        scrollHeight: node.scrollHeight,
        title: { bottom: title.bottom, top: title.top },
      };
    });
    expect(initial.overflowY).toBe('auto');
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.rect.top).toBeGreaterThanOrEqual(0);
    expect(initial.rect.bottom).toBeLessThanOrEqual(390);
    expect(initial.title.top).toBeGreaterThanOrEqual(initial.rect.top);
    expect(initial.title.bottom).toBeLessThanOrEqual(initial.rect.bottom);

    await overlay.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const reachable = await overlay.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const stats = node.querySelector('.stats').getBoundingClientRect();
      const cta = node.querySelector('.overlay__cta').getBoundingClientRect();
      return {
        ctaBottom: cta.bottom,
        ctaTop: cta.top,
        rectBottom: rect.bottom,
        rectTop: rect.top,
        statsBottom: stats.bottom,
      };
    });
    expect(reachable.statsBottom).toBeLessThanOrEqual(reachable.rectBottom);
    expect(reachable.ctaTop).toBeGreaterThanOrEqual(reachable.rectTop);
    expect(reachable.ctaBottom).toBeLessThanOrEqual(reachable.rectBottom);
  } finally {
    await context.close();
  }
});

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

test('phone viewport keeps tall portrait overlay content reachable', async ({ browser, request }) => {
  await requireVideoFixture(request);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.route('**/video/config.json', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      config.overlays[0].body = Array(60).fill('Tall portrait fixture body copy.').join(' ');
      config.overlays[0].stats = Array.from({ length: 20 }, (_value, index) => ({
        label: 'Portrait metric ' + (index + 1),
        value: String(index + 1),
      }));
      await route.fulfill({ response, json: config });
    });
    await page.goto(videoFixtureUrl);
    await page.waitForSelector('#loader', { state: 'hidden' });
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * 0.4);
    });
    const overlay = page.locator('[data-overlay-index="0"]');
    await expect(overlay).toHaveJSProperty('inert', false);
    const initial = await overlay.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const title = node.querySelector('.overlay__title').getBoundingClientRect();
      return {
        clientHeight: node.clientHeight,
        overflowY: getComputedStyle(node).overflowY,
        rect: { bottom: rect.bottom, top: rect.top },
        scrollHeight: node.scrollHeight,
        title: { bottom: title.bottom, top: title.top },
      };
    });
    expect(initial.overflowY).toBe('auto');
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.rect.top).toBeGreaterThanOrEqual(0);
    expect(initial.rect.bottom).toBeLessThanOrEqual(844);
    expect(initial.title.top).toBeGreaterThanOrEqual(initial.rect.top);
    expect(initial.title.bottom).toBeLessThanOrEqual(initial.rect.bottom);

    await overlay.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const reachable = await overlay.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const stats = node.querySelector('.stats').getBoundingClientRect();
      const cta = node.querySelector('.overlay__cta').getBoundingClientRect();
      return {
        ctaBottom: cta.bottom,
        ctaTop: cta.top,
        rectBottom: rect.bottom,
        rectTop: rect.top,
        statsBottom: stats.bottom,
      };
    });
    expect(reachable.statsBottom).toBeLessThanOrEqual(reachable.rectBottom);
    expect(reachable.ctaTop).toBeGreaterThanOrEqual(reachable.rectTop);
    expect(reachable.ctaBottom).toBeLessThanOrEqual(reachable.rectBottom);
  } finally {
    await context.close();
  }
});
