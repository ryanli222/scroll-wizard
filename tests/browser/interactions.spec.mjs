import { expect, test } from '@playwright/test';

test('interactive fixture exposes nav, hotspot, picker, gallery and email controls', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  await expect(page.locator('.site-nav__pill')).toHaveCount(4);
  await expect(page.locator('.hotspot')).toHaveCount(1);
  await expect(page.locator('.config-picker__option')).toHaveCount(2);
  await expect(page.locator('.section-gallery__button')).toHaveCount(1);
  await expect(page.locator('.section-email')).toHaveCount(1);
});

test('interactive controls are keyboard operable and picker activates the tint', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const hotspot = page.locator('.hotspot');
  await hotspot.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => scrollY > 0);
  await page.locator('.config-picker__option').nth(1).click();
  await expect(page.locator('.config-picker__option').nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.locator('#scrub-tint').evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
});

test('gallery lightbox and inline email confirmation work', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  await page.locator('.section-gallery__button').click();
  await expect(page.locator('dialog.lightbox')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.lightbox')).not.toHaveAttribute('open', '');
  const form = page.locator('.section-email');
  await form.locator('input').fill('person@example.com');
  await form.locator('.section-email__submit').click();
  await expect(form.locator('.section-email__done')).toBeVisible();
});