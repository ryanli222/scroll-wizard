import { describe, expect, it } from 'vitest';
import {
  alphaToK,
  applyHolds,
  canvasSize,
  contrastRatio,
  coverRect,
  decodeWindow,
  frameFilename,
  holdFrames,
  overlayOpacity,
  progressToFrame,
  recommendHeightVh,
  scrollProgress,
  smooth,
  validateConfig,
} from '../../template/scrub-core.js';

const validConfig = {
  brand: { name: 'Aster', tagline: 'Light, held in motion' },
  theme: {
    bg: '#000000',
    text: '#ffffff',
    accent: '#dfff57',
    surface: 'rgba(0, 0, 0, 0.75)',
    radius: 10,
    fonts: { display: 'serif', body: 'sans-serif' },
  },
  frames: {
    count: 24,
    pattern: 'frames/frame-{index:4}.webp',
    poster: 'frames/frame-0001.webp',
  },
  scrub: { heightVh: 400, smoothing: 0.12 },
  overlays: [{
    at: [0.2, 0.4],
    title: 'Precision',
    body: 'A quiet reveal.',
    hold: true,
    position: 'left',
    stats: [{ value: '18 h', label: 'Battery' }],
    cta: { label: 'See the specs', href: '/specs' },
  }],
  outro: {
    headline: 'Made to move',
    body: 'A final thought.',
    cta: { label: 'Buy Aster', href: '#buy' },
  },
};

describe('scrub mapping', () => {
  it('clamps scroll progress and handles degenerate sections', () => {
    expect(scrollProgress(150, 100, 500, 100)).toBeCloseTo(0.125);
    expect(scrollProgress(-1, 0, 500, 100)).toBe(0);
    expect(scrollProgress(999, 0, 500, 100)).toBe(1);
    expect(scrollProgress(10, 0, 100, 100)).toBe(0);
  });

  it('creates continuous plateaus and redistributes moving progress', () => {
    const holds = [[0.25, 0.5]];
    expect(applyHolds(0, holds)).toBe(0);
    expect(applyHolds(0.25, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(0.4, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(0.5, holds)).toBeCloseTo(1 / 3);
    expect(applyHolds(1, holds)).toBe(1);
  });

  it('maps progress and hold plateaus to zero-based frames', () => {
    expect(progressToFrame(0.5, 5)).toBe(2);
    expect(progressToFrame(2, 5)).toBe(4);
    expect(holdFrames([[0.25, 0.5]], 10)).toEqual([3]);
  });

  it('uses frame-rate-independent smoothing', () => {
    const k = alphaToK(0.12);
    expect(smooth(0, 1, k, 1 / 60)).toBeCloseTo(0.12);
  });
});

describe('geometry and filenames', () => {
  it('computes centered cover crops and capped backing sizes', () => {
    expect(coverRect(1600, 900, 1000, 1000)).toEqual({
      sx: 350, sy: 0, sw: 900, sh: 900,
    });
    expect(canvasSize(500, 300, 3)).toEqual({ width: 1000, height: 600 });
  });

  it('expands one-based padded frame names', () => {
    expect(frameFilename(0, 'frames/frame-{index:4}.webp'))
      .toBe('frames/frame-0001.webp');
  });

  it('computes overlay fades and height recommendations', () => {
    expect(overlayOpacity(0.1, [0.1, 0.3], 0.05)).toBe(0);
    expect(overlayOpacity(0.125, [0.1, 0.3], 0.05)).toBeCloseTo(0.5);
    expect(recommendHeightVh(400, [[0.2, 0.7]])).toEqual({
      heightVh: 700,
      speedUp: 2,
    });
  });

  it('keeps a bounded, direction-biased decode set', () => {
    expect(decodeWindow(10, 2, 30, 0)).toEqual([8, 9, 10, 11, 12]);
    expect(decodeWindow(10, 2, 30, 1)).toEqual([9, 10, 11, 12, 13]);
    expect(decodeWindow(10, 2, 30, -1)).toEqual([7, 8, 9, 10, 11]);
    expect(decodeWindow(0, 2, 4, -1)).toEqual([0, 1, 2, 3]);
  });
});

describe('colors and config validation', () => {
  it('computes known WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
  });

  it('accepts a complete valid config', () => {
    expect(validateConfig(validConfig)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects unsafe and inaccessible values', () => {
    const result = validateConfig({
      ...validConfig,
      theme: { ...validConfig.theme, text: '#111111', surface: 'rgba(0,0,0,0.2)' },
      overlays: [{
        ...validConfig.overlays[0],
        cta: { label: 'Open', href: 'javascript:alert(1)' },
      }],
    });
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['contrast.text', 'theme.surface-alpha', 'cta.href']),
    );
  });

  it('rejects overlapping holds and font traversal', () => {
    const result = validateConfig({
      ...validConfig,
      theme: {
        ...validConfig.theme,
        fonts: { ...validConfig.theme.fonts, displayFile: 'fonts/../secret.woff2' },
      },
      overlays: [
        validConfig.overlays[0],
        { at: [0.3, 0.5], title: 'Overlap', hold: true },
      ],
    });
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['holds.overlap', 'font.path']),
    );
  });
});
