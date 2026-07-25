import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, validateConfig } from '../../template/scrub-core.js';

const presets = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../references/directions.json', import.meta.url)), 'utf8',
));
const packageManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8',
));

const baseConfig = {
  brand: { name: 'Test' },
  frames: { count: 24, pattern: 'frames/frame-{index:4}.webp', poster: 'frames/frame-0001.webp' },
  scrub: { heightVh: 400, smoothing: 0.12 },
  overlays: [],
};

describe('directions.json', () => {
  it('defines all four directions', () => {
    expect(Object.keys(presets).sort()).toEqual(['bold', 'cinematic', 'minimal', 'technical']);
  });

  it('ships the runtime preset source in the npm package', () => {
    expect(packageManifest.files).toContain('references/');
  });

  it('each preset theme passes validateConfig contrast rules', () => {
    for (const [name, preset] of Object.entries(presets)) {
      const { errors } = validateConfig({ ...baseConfig, direction: name, theme: preset.theme });
      expect(errors, name + ': ' + JSON.stringify(errors)).toEqual([]);
    }
  });

  it('each preset has body text >= 4.5:1 on its bg', () => {
    for (const [name, preset] of Object.entries(presets)) {
      expect(contrastRatio(preset.theme.text, preset.theme.bg), name)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('declares the complete theme, motion, chrome, and scrim token contract', () => {
    for (const [name, preset] of Object.entries(presets)) {
      expect(preset.theme, name).toMatchObject({
        bg: expect.any(String),
        text: expect.any(String),
        muted: expect.any(String),
        accent: expect.any(String),
        surface: expect.any(String),
        radius: expect.any(Number),
        borderStyle: expect.any(String),
        fonts: {
          display: expect.any(String),
          body: expect.any(String),
          mono: expect.any(String),
        },
      });
      expect(preset.motion, name).toEqual({
        ease: expect.any(String),
        springBounce: expect.any(Number),
        revealTravelPx: expect.any(Number),
      });
      expect(typeof preset.chromeStyle, name).toBe('string');
      expect(preset.scrimStrength, name).toBeGreaterThanOrEqual(0);
      expect(preset.scrimStrength, name).toBeLessThanOrEqual(1);
    }
  });

  it('keeps minimal and technical reveals damped with no spring bounce', () => {
    expect(presets.minimal.motion.springBounce).toBe(0);
    expect(presets.technical.motion.springBounce).toBe(0);
  });

  it('gives bold and cinematic a nonzero overshoot bounce', () => {
    expect(presets.bold.motion.springBounce).toBeGreaterThan(0);
    expect(presets.cinematic.motion.springBounce).toBeGreaterThan(0);
    expect(presets.cinematic.motion.springBounce)
      .toBeLessThan(presets.bold.motion.springBounce);
  });
});
