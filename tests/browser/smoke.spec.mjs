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
});

test('visibility controls inert and keyboard focus', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('[data-overlay-index="0"]');
  await expect(overlay).toHaveJSProperty('inert', true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.4));
  await expect(overlay).toHaveJSProperty('inert', false);
  await overlay.getByRole('link').focus();
  await expect(overlay.getByRole('link')).toBeFocused();
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
  await expect(page.locator('#scrub-canvas')).toBeVisible();
});

test('decoded bitmap count never exceeds the configured bound', async ({ page }) => {
  await page.goto('/');
  for (const fraction of [0.1, 0.3, 0.6, 0.9]) {
    await page.evaluate((value) =>
      scrollTo(0, document.body.scrollHeight * value), fraction);
  }
  await expect.poll(() => page.evaluate(() =>
    window.__SCROLL_WIZARD_DEBUG__?.decodedCount ?? 999)).toBeLessThanOrEqual(8);
});
