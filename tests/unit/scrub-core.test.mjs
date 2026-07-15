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

  it('rejects traversal, backslashes, external relative resolution, and unsafe CTA hrefs', () => {
    const unsafeHrefs = [
      '../admin',
      '/safe/../secret',
      '/safe/%2e%2e/secret',
      '/safe/%252e%252e/secret',
      '/safe\\secret',
      '/safe/%5csecret',
      '\\\\server\\share',
      '//example.com/path',
      ' /path',
      '/path ',
      '/pa\u0000th',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'ftp://example.com/file',
    ];

    unsafeHrefs.forEach((href) => {
      const result = validateConfig({
        ...validConfig,
        overlays: [{
          ...validConfig.overlays[0],
          cta: { label: 'Open', href },
        }],
      });
      expect(result.errors.map((entry) => entry.code), href).toContain('cta.href');
    });
  });

  it('allows same-origin relative forms and approved explicit CTA schemes', () => {
    const safeHrefs = [
      '/path',
      './path',
      '?query=value',
      '#anchor',
      'https://example.com/path',
      'http://example.com/path',
      'mailto:hello@example.com',
      'tel:+14165550123',
    ];

    safeHrefs.forEach((href) => {
      const result = validateConfig({
        ...validConfig,
        overlays: [{
          ...validConfig.overlays[0],
          cta: { label: 'Open', href },
        }],
      });
      expect(result.errors.map((entry) => entry.code), href).not.toContain('cta.href');
    });
  });

  it('requires normalized frame patterns contained under frames', () => {
    const unsafePatterns = [
      '/frames/frame-{index:4}.webp',
      'frames\\frame-{index:4}.webp',
      'frames/../frame-{index:4}.webp',
      'frames/%2e%2e/frame-{index:4}.webp',
      'frames/%252e%252e/frame-{index:4}.webp',
      'frames/./frame-{index:4}.webp',
      'frames//frame-{index:4}.webp',
      'https://example.com/frames/frame-{index:4}.webp',
    ];

    unsafePatterns.forEach((pattern) => {
      const result = validateConfig({
        ...validConfig,
        frames: { ...validConfig.frames, pattern },
      });
      expect(result.errors, pattern).toContainEqual(expect.objectContaining({
        code: 'frames.pattern',
        path: 'frames.pattern',
      }));
    });
  });

  it('requires normalized poster paths contained under frames', () => {
    const unsafePosters = [
      '/frames/frame-0001.webp',
      'frames\\frame-0001.webp',
      'frames/../frame-0001.webp',
      'frames/%2e%2e/frame-0001.webp',
      'frames/%252e%252e/frame-0001.webp',
      'frames/./frame-0001.webp',
      'frames//frame-0001.webp',
      'https://example.com/frames/frame-0001.webp',
    ];

    unsafePosters.forEach((poster) => {
      const result = validateConfig({
        ...validConfig,
        frames: { ...validConfig.frames, poster },
      });
      expect(result.errors, poster).toContainEqual(expect.objectContaining({
        code: 'frames.poster',
        path: 'frames.poster',
      }));
    });
  });

  it('returns a structured error for non-array overlays', () => {
    const result = validateConfig({ ...validConfig, overlays: null });

    expect(result.errors).toContainEqual({
      code: 'overlays.type',
      path: 'overlays',
      message: 'Overlays must be an array.',
    });
  });

  it('returns structured errors for invalid overlay entries without throwing', () => {
    const result = validateConfig({
      ...validConfig,
      overlays: [null, 42, 'invalid', []],
    });

    expect(result.errors.filter((entry) => entry.code === 'overlay.type')).toEqual([
      {
        code: 'overlay.type',
        path: 'overlays[0]',
        message: 'Overlay must be an object.',
      },
      {
        code: 'overlay.type',
        path: 'overlays[1]',
        message: 'Overlay must be an object.',
      },
      {
        code: 'overlay.type',
        path: 'overlays[2]',
        message: 'Overlay must be an object.',
      },
      {
        code: 'overlay.type',
        path: 'overlays[3]',
        message: 'Overlay must be an object.',
      },
    ]);
  });
});
