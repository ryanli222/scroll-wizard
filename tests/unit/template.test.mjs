import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(
  new URL('../../template/index.html', import.meta.url), 'utf8',
);
const config = JSON.parse(await readFile(
  new URL('../../template/config.json', import.meta.url), 'utf8',
));
const engine = await readFile(
  new URL('../../template/scrub-engine.js', import.meta.url), 'utf8',
);
const css = await readFile(
  new URL('../../template/style.css', import.meta.url), 'utf8',
);
const presets = JSON.parse(await readFile(
  new URL('../../references/directions.json', import.meta.url), 'utf8',
));

describe('template contract', () => {
  it('contains semantic runtime hooks and a real poster image', () => {
    expect(html).toContain('id="poster"');
    expect(html).toContain('id="scrub-canvas"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('id="overlay-layer"');
    expect(html).toContain('id="outro"');
    expect(html).toContain('type="module" src="scrub-engine.js"');
  });

  it('ships a complete valid example', async () => {
    const { validateConfig } = await import('../../template/scrub-core.js');
    expect(validateConfig(config).errors).toEqual([]);
    expect(config.brand.imageAlt).toBeTruthy();
  });

  it('keeps deferred Plan 3 chrome, smooth navigation, and pointer tilt out of Plan 1', () => {
    expect(html).not.toMatch(/class="chrome|id="chrome-|pointermove|--rx|--ry/);
    expect(engine).not.toMatch(/renderChrome|updateChrome|behavior:\s*['"]smooth['"]|DIRECTION_TRAVEL/);
    expect(css).not.toMatch(/\.chrome(?:__|\s|\{|,)/);
  });

  it('keeps direction motion data out of CSS and animates an inner content wrapper', () => {
    expect(css).not.toMatch(/body\.dir-[\w-]+\s*\{[^}]*--(?:ease|reveal-travel|scrim-strength)/s);
    expect(engine).toContain("element('div', 'overlay__content')");
    expect(css).toMatch(/\.overlay__content\s*\{[^}]*transform:/s);
    expect(css).toMatch(/\.overlay\s*\{[^}]*transform:\s*none/s);
  });

  it('caches overlay content and applies reveal without squaring RAF opacity', () => {
    const updateBlock = engine.match(
      /function updateOverlays\([\s\S]*?\n}\n\nfunction updateProgressBar/,
    )?.[0] ?? '';
    expect(engine).toContain('return { node: panel, content };');
    expect(engine).toContain('return { data, node, content };');
    expect(updateBlock).toContain('for (const { data, node, content } of overlayNodes)');
    expect(updateBlock).not.toContain('querySelector');
    expect(updateBlock).toContain("content.style.setProperty('--reveal', String(opacity))");
    expect(css).not.toMatch(/\.overlay__content\s*\{[^}]*opacity:\s*var\(--reveal/s);
  });

  it('ships runtime data matching the example direction preset exactly', () => {
    const preset = presets[config.direction];
    expect(config.directionPreset).toEqual({
      motion: preset.motion,
      chromeStyle: preset.chromeStyle,
      scrimStrength: preset.scrimStrength,
    });
  });

  it('scopes CTA movement to fine hover and neutralizes both CTAs under reduced motion', () => {
    const fineHover = css.match(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n}/,
    )?.[0] ?? '';
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\n}/)?.[0] ?? '';

    expect(fineHover).toMatch(
      /\.overlay__cta:hover,\s*\.outro__cta:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/s,
    );
    expect(fineHover).toMatch(
      /\.overlay__cta:active,\s*\.outro__cta:active\s*\{[^}]*transform:\s*scale\(\.97\)/s,
    );
    expect(reduced).toMatch(
      /\.overlay__cta,\s*\.outro__cta\s*\{[^}]*transition:\s*opacity 160ms ease;/s,
    );
    expect(reduced).toMatch(
      /\.overlay__cta:hover,\s*\.outro__cta:hover,\s*\.overlay__cta:active,\s*\.outro__cta:active\s*\{[^}]*transform:\s*none/s,
    );
  });
});
