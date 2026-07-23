import { existsSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';

test.skip(
  !existsSync(chromium.executablePath()),
  'Playwright Chromium is not installed; overlay variants suite skipped.',
);

async function showVariantOverlays(page) {
  await page.goto('/?config=variants');
  await expect(page.locator('[data-overlay-index]').first()).toBeAttached();
  await page.evaluate(() => {
    const scrub = document.getElementById('scrub');
    scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * 0.5);
  });
}

test.describe('overlay variants & anchors', () => {
  test('hero variant is centered and large', async ({ page }) => {
    await showVariantOverlays(page);
    const hero = page.locator('.overlay--hero').first();
    await expect(hero).toHaveClass(/overlay--anchor-middle/);
    const fontSize = await hero.locator('.overlay__title').evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(fontSize).toBeGreaterThan(40);
  });

  test('annotation renders a visible leader line element', async ({ page }) => {
    await showVariantOverlays(page);
    await expect(page.locator('.overlay--annotation .overlay__leader').first()).toBeVisible();
  });

  test('body gets the direction class', async ({ page }) => {
    await page.goto('/?config=variants');
    await expect(page.locator('body')).toHaveClass(/dir-technical/);
  });

  test('annotation leader point tracks the box on resize', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await showVariantOverlays(page);
    const annotation = page.locator('.overlay--annotation').first();
    await expect.poll(() => annotation.evaluate((element) =>
      element.style.getPropertyValue('--px'))).not.toBe('');
    const wide = await annotation.evaluate((element) =>
      element.style.getPropertyValue('--px'));

    await page.setViewportSize({ width: 600, height: 800 });
    await expect.poll(() => annotation.evaluate((element) =>
      element.style.getPropertyValue('--px'))).not.toBe(wide);
    const narrow = await annotation.evaluate((element) =>
      element.style.getPropertyValue('--px'));

    expect(wide).not.toBe(narrow);
  });
});
