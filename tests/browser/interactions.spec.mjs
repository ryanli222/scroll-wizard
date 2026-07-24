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

test('spec row activates by keyboard and scrubs toward its beat', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const row = page.locator('.section-spec__row[data-beat]');
  await expect(row).toHaveAttribute('role', 'button');
  await row.focus();
  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await page.waitForFunction((y) => Math.abs(scrollY - y) > 50, before);
});

test('manual wheel input cancels an in-flight jump', async ({ page }) => {
  await page.goto('/?fixture=interactive');
  const target = await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-section]');
    return nodes[nodes.length - 1].offsetTop;
  });
  await page.locator('.site-nav__pill').last().click();
  await page.waitForTimeout(120);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1200); // longer than the fixture's maxMs (900)
  const settled = await page.evaluate(() => scrollY);
  expect(Math.abs(settled - target)).toBeGreaterThan(50);
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