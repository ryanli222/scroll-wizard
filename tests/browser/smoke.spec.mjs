import { existsSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';

test.skip(
  !existsSync(chromium.executablePath()),
  'Playwright Chromium is not installed; browser smoke suite skipped.',
);

test('poster appears before delayed sequence and canvas scrubs', async ({ page }) => {
  await page.route('**/frames/frame-*.webp', async (route) => {
    if (!route.request().url().endsWith('frame-0001.webp')) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#poster')).toBeVisible();
  await expect(page.locator('#poster')).not.toHaveClass(/is-hidden/);

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
