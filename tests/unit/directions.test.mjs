import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, validateConfig } from '../../template/scrub-core.js';

const presets = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../references/directions.json', import.meta.url)), 'utf8',
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

  it('each preset declares motion + chrome fields', () => {
    for (const preset of Object.values(presets)) {
      expect(typeof preset.motion.ease).toBe('string');
      expect(typeof preset.chromeStyle).toBe('string');
      expect(typeof preset.scrimStrength).toBe('number');
    }
  });
});
