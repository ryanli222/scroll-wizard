import { expect, test } from '@playwright/test';

test('renders explicit section composition in declared order', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?fixture=sections');
  await expect(page.locator('[data-section]')).toHaveCount(7);
  await expect(page.locator('[data-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.section)))
    .resolves.toEqual(['masthead', 'scrub-hero', 'feature-split', 'statement', 'spec', 'gallery', 'cta']);
  await expect(page.locator('#scrub[data-section="scrub-hero"]')).toHaveCount(1);
  await expect(page.locator('#outro[data-section="cta"]')).toHaveCount(1);
  await expect(page.getByLabel('Email address')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('synthesizes the legacy masthead scrub CTA composition without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/?fixture=legacy');
  await expect(page.locator('[data-section]')).toHaveCount(3);
  await expect(page.locator('[data-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.section)))
    .resolves.toEqual(['masthead', 'scrub-hero', 'cta']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});