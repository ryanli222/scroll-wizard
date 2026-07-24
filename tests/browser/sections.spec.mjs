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
test('exposes semantic content and data hooks for every explicit section', async ({ page }) => {
  await page.goto('/?fixture=sections');
  await expect(page.locator('[data-section]')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Fixture masthead' })).toBeVisible();
  await expect(page.getByAltText('Fixture media')).toBeVisible();
  await expect(page.locator('[data-section="spec"] [data-beat="0"]')).toContainText('Battery');
  await expect(page.locator('[data-section="gallery"] [data-beat="0"] img')).toHaveAttribute('alt', 'Fixture gallery image');
  await expect(page.locator('#outro .outro__cta')).toHaveAttribute('href', '#finish');
  await expect(page.getByLabel('Email address')).toBeVisible();
});

test('keeps every section visible and static under reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto('/?fixture=sections');
    await expect(page.locator('[data-section]')).toHaveCount(7);
    const states = await page.locator('.site-section:not([data-section="scrub-hero"]) .section-reveal').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { animation: style.animationName, transform: style.transform, opacity: style.opacity };
    }));
    for (const state of states) {
      expect(state.animation).toBe('none');
      expect(state.transform).toBe('none');
      expect(state.opacity).toBe('1');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  } finally { await context.close(); }
});

test('has no horizontal overflow at desktop and mobile after section media loads', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?fixture=sections');
    await expect(page.locator('[data-section]')).toHaveCount(7);
    for (const section of await page.locator('[data-section]').all()) await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});