import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const presets = JSON.parse(readFileSync(fileURLToPath(
  new URL('../../references/directions.json', import.meta.url),
), 'utf8'));

const variants = ['bare', 'hero', 'caption', 'metric', 'panel', 'annotation'];

async function showVariantOverlays(page, path = '/?config=variants', fraction = 0.5) {
  await page.goto(path);
  await expect(page.locator('[data-overlay-index]')).toHaveCount(6);
  await page.evaluate((targetFraction) => {
    const scrub = document.getElementById('scrub');
    scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * targetFraction);
  }, fraction);
  await expect(page.locator('.overlay--bare .overlay__content')).toHaveAttribute('style', /--reveal/);
}

async function computedColors(page) {
  return page.evaluate(() => {
    const color = (selector, property = 'color') =>
      getComputedStyle(document.querySelector(selector))[property];
    return {
      accent: color('.progress-bar', 'backgroundColor'),
      text: color('body'),
      kicker: color('.overlay--bare .overlay__kicker'),
      index: color('.overlay--bare .overlay__index'),
      stat: color('.overlay--bare .stat__value'),
      cta: color('.overlay--bare .overlay__cta', 'backgroundColor'),
    };
  });
}

test.skip(
  !existsSync(chromium.executablePath()),
  'Playwright Chromium is not installed; overlay variants suite skipped.',
);

test.describe('overlay variants & direction runtime', () => {
  test('renders all six variants across all three anchors with only panel glass', async ({ page }) => {
    await showVariantOverlays(page);
    for (const variant of variants) {
      await expect(page.locator('.overlay--' + variant)).toHaveCount(1);
    }
    for (const anchor of ['top', 'middle', 'bottom']) {
      expect(await page.locator('.overlay--anchor-' + anchor).count()).toBeGreaterThan(0);
    }

    const heroSize = await page.locator('.overlay--hero .overlay__title').evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(heroSize).toBeGreaterThan(40);

    const styles = await page.locator('.overlay').evaluateAll((nodes) => nodes.map((node) => {
      const content = node.querySelector('.overlay__content');
      const body = node.querySelector('.overlay__body');
      return {
        variant: [...node.classList].find((name) => name.startsWith('overlay--')
          && !name.startsWith('overlay--anchor-')
          && !['overlay--left', 'overlay--center', 'overlay--right',
            'overlay--show-index', 'overlay--show-kicker'].includes(name)),
        backdrop: content ? getComputedStyle(content).backdropFilter : null,
        bodyOpacity: body ? getComputedStyle(body).opacity : null,
      };
    }));
    for (const style of styles) {
      if (style.variant === 'overlay--panel') {
        expect(style.backdrop).not.toBe('none');
      } else {
        expect(style.backdrop).toBe('none');
      }
      expect(style.bodyOpacity).toBe('1');
    }
  });

  test('uses one outer alpha near the visibility threshold', async ({ page }) => {
    await page.goto('/?config=variants');
    const overlay = page.locator('.overlay--bare');
    await expect(overlay).toBeAttached();
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      const progress = 0.05275;
      scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * progress);
    });
    await expect.poll(() => overlay.evaluate((node) =>
      Number.parseFloat(node.style.opacity))).toBeGreaterThan(0.045);
    await page.waitForTimeout(400);
    const alpha = await overlay.evaluate((node) => {
      const content = node.querySelector('.overlay__content');
      const outer = Number.parseFloat(getComputedStyle(node).opacity);
      const inner = Number.parseFloat(getComputedStyle(content).opacity);
      return { outer, inner, effective: outer * inner, inert: node.inert };
    });
    expect(alpha.outer).toBeGreaterThan(0.045);
    expect(alpha.outer).toBeLessThan(0.065);
    expect(alpha.inner).toBe(1);
    expect(alpha.effective).toBeCloseTo(alpha.outer, 4);
    expect(alpha.inert).toBe(false);
  });

  test('applies every generated preset token to root without CSS direction maps', async ({ page }) => {
    for (const [direction, preset] of Object.entries(presets)) {
      await page.goto('/?config=variants&direction=' + direction);
      await expect(page.locator('body')).toHaveClass(new RegExp('dir-' + direction));
      const applied = await page.locator('html').evaluate((root) => ({
        bg: root.style.getPropertyValue('--bg'),
        text: root.style.getPropertyValue('--text'),
        muted: root.style.getPropertyValue('--muted'),
        accent: root.style.getPropertyValue('--accent'),
        surface: root.style.getPropertyValue('--surface'),
        borderStyle: root.style.getPropertyValue('--border-style'),
        display: root.style.getPropertyValue('--display'),
        body: root.style.getPropertyValue('--body'),
        mono: root.style.getPropertyValue('--mono'),
        ease: root.style.getPropertyValue('--ease'),
        bounce: root.style.getPropertyValue('--spring-bounce'),
        travel: root.style.getPropertyValue('--reveal-travel'),
        scrim: root.style.getPropertyValue('--scrim-strength'),
        chromeStyle: document.body.dataset.chromeStyle,
      }));
      expect(applied).toMatchObject({
        bg: preset.theme.bg,
        text: preset.theme.text,
        muted: preset.theme.muted,
        accent: preset.theme.accent,
        surface: preset.theme.surface,
        borderStyle: preset.theme.borderStyle,
        display: preset.theme.fonts.display,
        body: preset.theme.fonts.body,
        mono: preset.theme.fonts.mono,
        ease: preset.motion.ease,
        bounce: String(preset.motion.springBounce),
        travel: preset.motion.revealTravelPx + 'px',
        scrim: String(preset.scrimStrength),
        chromeStyle: preset.chromeStyle,
      });
    }
  });

  test('uses accent only where each direction permits it', async ({ page }) => {
    await showVariantOverlays(page, '/?config=variants&direction=minimal');
    const minimal = await computedColors(page);
    expect(minimal.kicker).not.toBe(minimal.accent);
    expect(minimal.stat).not.toBe(minimal.accent);
    expect(minimal.index).not.toBe(minimal.accent);
    expect(minimal.cta).toBe(minimal.accent);

    await showVariantOverlays(page, '/?config=variants&direction=cinematic');
    const cinematic = await computedColors(page);
    expect(cinematic.kicker).not.toBe(cinematic.accent);
    expect(cinematic.stat).not.toBe(cinematic.accent);
    expect(cinematic.index).not.toBe(cinematic.accent);
    expect(cinematic.cta).toBe(cinematic.text);

    await showVariantOverlays(page, '/?config=variants&direction=technical');
    const technical = await computedColors(page);
    expect(technical.kicker).not.toBe(technical.accent);
    expect(technical.stat).not.toBe(technical.accent);
    expect(technical.index).toBe(technical.accent);
    expect(technical.cta).toBe(technical.accent);

    await showVariantOverlays(page, '/?config=variants&direction=bold');
    const bold = await computedColors(page);
    expect(bold.kicker).toBe(bold.accent);
    expect(bold.stat).toBe(bold.accent);
    expect(bold.cta).toBe(bold.accent);
  });

  test('localized scrims composite representative fixture pixels to at least 4.5:1', async ({ page }) => {
    await showVariantOverlays(page, '/?config=variants&direction=technical', 0.55);
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__?.lastFrame ?? -1)).toBeGreaterThanOrEqual(0);

    const samples = await page.locator('.overlay:not(.overlay--panel)').evaluateAll((nodes) => {
      const parseRgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const linear = (channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) => 0.2126 * linear(rgb[0])
        + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
      const ratio = (a, b) => {
        const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const canvas = document.getElementById('scrub-canvas');
      const canvasRect = canvas.getBoundingClientRect();
      const context = canvas.getContext('2d');
      const root = getComputedStyle(document.documentElement);
      const bgHex = root.getPropertyValue('--bg').trim();
      const scrimRgb = [1, 3, 5].map((offset) => Number.parseInt(bgHex.slice(offset, offset + 2), 16));
      const strength = Number.parseFloat(root.getPropertyValue('--scrim-strength'));

      return nodes.map((node) => {
        const content = node.querySelector('.overlay__content');
        const body = node.querySelector('.overlay__body');
        const rect = content.getBoundingClientRect();
        const x = Math.min(canvasRect.right - 1, Math.max(canvasRect.left,
          rect.left + rect.width / 2));
        const y = Math.min(canvasRect.bottom - 1, Math.max(canvasRect.top,
          rect.top + rect.height / 2));
        const pixel = context.getImageData(
          Math.floor((x - canvasRect.left) * canvas.width / canvasRect.width),
          Math.floor((y - canvasRect.top) * canvas.height / canvasRect.height),
          1, 1,
        ).data;
        const composited = scrimRgb.map((channel, index) =>
          channel * strength + pixel[index] * (1 - strength));
        const bodyStyle = getComputedStyle(body);
        const text = parseRgb(bodyStyle.color);
        const opacity = Number.parseFloat(bodyStyle.opacity);
        const effectiveText = text.map((channel, index) =>
          channel * opacity + composited[index] * (1 - opacity));
        const pseudo = getComputedStyle(content, '::before');
        return {
          variant: [...node.classList].find((name) => /^overlay--(bare|hero|caption|metric|annotation)$/.test(name)),
          pseudoBackground: pseudo.backgroundColor,
          bodyOpacity: opacity,
          ratio: ratio(effectiveText, composited),
        };
      });
    });

    expect(samples).toHaveLength(5);
    for (const sample of samples) {
      expect(sample.pseudoBackground, sample.variant).not.toBe('rgba(0, 0, 0, 0)');
      expect(sample.bodyOpacity, sample.variant).toBe(1);
      expect(sample.ratio, sample.variant).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('annotation leader endpoint is accurate and geometry vars stay stable during RAF scroll', async ({ page }) => {
    await showVariantOverlays(page);
    const annotation = page.locator('.overlay--annotation');
    await expect.poll(() => annotation.evaluate((element) =>
      element.style.getPropertyValue('--px'))).toMatch(/px$/);

    const geometry = await annotation.evaluate((node) => {
      const leader = node.querySelector('.overlay__leader');
      const transform = new DOMMatrixReadOnly(getComputedStyle(leader).transform);
      const startX = leader.offsetLeft;
      const startY = leader.offsetTop + leader.offsetHeight / 2;
      const endX = startX + transform.a * leader.offsetWidth;
      const endY = startY + transform.b * leader.offsetWidth;
      const px = Number.parseFloat(node.style.getPropertyValue('--px'));
      const py = Number.parseFloat(node.style.getPropertyValue('--py'));
      return {
        pxValue: node.style.getPropertyValue('--px'),
        pyValue: node.style.getPropertyValue('--py'),
        error: Math.hypot(endX - px, endY - py),
        outerTransform: getComputedStyle(node).transform,
      };
    });
    expect(geometry.pxValue).toMatch(/px$/);
    expect(geometry.pyValue).toMatch(/px$/);
    expect(geometry.error).toBeLessThanOrEqual(1.5);
    expect(geometry.outerTransform).toBe('none');

    const before = await annotation.evaluate((node) => [
      '--px', '--py', '--leader-x', '--leader-y', '--leader-len', '--leader-angle',
    ].map((name) => node.style.getPropertyValue(name)));
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * 0.72);
    });
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const after = await annotation.evaluate((node) => [
      '--px', '--py', '--leader-x', '--leader-y', '--leader-len', '--leader-angle',
    ].map((name) => node.style.getPropertyValue(name)));
    expect(after).toEqual(before);
  });

  test('annotations remap on resize and all content stays within responsive bounds', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await showVariantOverlays(page);
    const annotation = page.locator('.overlay--annotation');
    const wide = await annotation.evaluate((node) => node.style.getPropertyValue('--px'));

    await page.setViewportSize({ width: 600, height: 800 });
    await expect.poll(() => annotation.evaluate((node) =>
      node.style.getPropertyValue('--px'))).not.toBe(wide);
    await expect(page.locator('.overlay__content')).toHaveCount(6);
    const bounds = await page.locator('.overlay__content').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }));
    for (const rect of bounds) {
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(601);
      expect(rect.bottom).toBeLessThanOrEqual(801);
    }
  });

  test('coarse short landscape keeps every variant safely positioned', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await showVariantOverlays(page);
      await expect(page.locator('.overlay__content')).toHaveCount(6);
      const metrics = await page.locator('.overlay__content').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          maxHeight: Number.parseFloat(style.maxHeight),
          overflowY: style.overflowY,
        };
      }));
      for (const metric of metrics) {
        expect(metric.left).toBeGreaterThanOrEqual(-1);
        expect(metric.top).toBeGreaterThanOrEqual(-1);
        expect(metric.right).toBeLessThanOrEqual(845);
        expect(metric.bottom).toBeLessThanOrEqual(391);
        expect(metric.maxHeight).toBeLessThanOrEqual(390);
        expect(['auto', 'scroll']).toContain(metric.overflowY);
      }
    } finally {
      await context.close();
    }
  });

  test('coarse pointers keep overlay and outro CTA feedback motionless', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await page.goto('/?config=variants');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect(await page.evaluate(() =>
        matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);

      for (const selector of ['.overlay__cta', '.outro__cta']) {
        const cta = page.locator(selector).first();
        await cta.scrollIntoViewIfNeeded();
        await cta.hover();
        await expect(cta).toHaveCSS('transform', 'none');
        expect(await cta.evaluate((node) => getComputedStyle(node).transitionProperty))
          .not.toContain('transform');
        const box = await cta.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(cta).toHaveCSS('transform', 'none');
        await page.mouse.up();
      }
    } finally {
      await context.close();
    }
  });

  test('reduced motion shows a static six-variant list and suppresses leaders', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?config=variants');
    await expect(page.locator('.overlay')).toHaveCount(6);
    for (const overlay of await page.locator('.overlay').all()) {
      await expect(overlay).toBeVisible();
      expect(await overlay.evaluate((node) => getComputedStyle(node).position)).toBe('relative');
    }
    await expect(page.locator('.overlay__leader')).toHaveCSS('display', 'none');
    for (const content of await page.locator('.overlay__content').all()) {
      await expect(content).toHaveCSS('transform', 'none');
    }
    for (const selector of ['.overlay__cta', '.outro__cta']) {
      const cta = page.locator(selector).first();
      await cta.scrollIntoViewIfNeeded();
      await cta.hover();
      await expect(cta).toHaveCSS('transform', 'none');
      expect(await cta.evaluate((node) => getComputedStyle(node).transitionProperty))
        .not.toContain('transform');
      const box = await cta.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(cta).toHaveCSS('transform', 'none');
      await page.mouse.up();
    }
  });

  test('rejects a directed raw config that omits generated runtime preset data', async ({ page }) => {
    await page.goto('/?config=raw-cinematic');
    const fatal = page.locator('#fatal-error');
    await expect(fatal).toBeVisible();
    await expect(fatal).toContainText(/directionPreset.*cinematic|cinematic.*directionPreset/i);
    await expect(page.locator('body')).not.toHaveClass(/dir-cinematic/);
    const rootTheme = await page.locator('html').evaluate((root) =>
      root.style.getPropertyValue('--bg'));
    expect(rootTheme).toBe('');
  });

  test('video mode maps annotation geometry once and keeps it stable while scrubbing', async ({ page }) => {
    const status = await (await page.request.get('/video-fixture-status.json')).json();
    test.skip(!status.available, status.reason);
    await showVariantOverlays(page, '/video/?config=variants');
    const annotation = page.locator('.overlay--annotation');
    await expect.poll(() => annotation.evaluate((node) =>
      node.style.getPropertyValue('--px'))).toMatch(/px$/);
    const before = await annotation.evaluate((node) => [
      node.style.getPropertyValue('--px'), node.style.getPropertyValue('--py'),
    ]);
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub');
      scrollTo(0, scrub.offsetTop + (scrub.offsetHeight - innerHeight) * 0.8);
    });
    await expect.poll(() => page.evaluate(() =>
      window.__SCROLL_WIZARD_DEBUG__?.scrubProgress ?? 0)).toBeGreaterThan(0.5);
    const after = await annotation.evaluate((node) => [
      node.style.getPropertyValue('--px'), node.style.getPropertyValue('--py'),
    ]);
    expect(after).toEqual(before);
  });
});
