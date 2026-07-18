import { describe, expect, it } from 'vitest';

import {
  estimateRouteCost,
  filterProviderRoutes,
  rankProviderRoutes,
  recommendBeatCount,
} from '../../scripts/lib/generation.mjs';

describe('recommendBeatCount', () => {
  it('maps simple, normal, dense, and catalog use cases into 3..10 beats', () => {
    expect(recommendBeatCount({ claimCount: 1, sectionCount: 2 })).toBe(3);
    expect(recommendBeatCount({ claimCount: 4, sectionCount: 5 })).toBe(5);
    expect(recommendBeatCount({
      claimCount: 6,
      hasProcess: true,
      sectionCount: 6,
    })).toBe(7);
    expect(recommendBeatCount({
      catalogItems: 12,
      claimCount: 9,
      sectionCount: 8,
    })).toBe(10);
  });

  it('rejects negative and non-integer counts', () => {
    expect(() => recommendBeatCount({ claimCount: -1, sectionCount: 2 }))
      .toThrow(/claimCount/);
    expect(() => recommendBeatCount({ claimCount: 1.5, sectionCount: 2 }))
      .toThrow(/claimCount/);
  });
});

describe('provider planning', () => {
  const routes = [
    {
      available: true,
      costMicros: 0,
      id: 'none',
      noVideo: true,
      quality: 0,
      speed: 3,
    },
    {
      available: true,
      costMicros: 240000,
      durations: [8],
      firstFrame: true,
      id: 'cheap',
      lastFrame: true,
      maxReferences: 2,
      quality: 1,
      resolutions: ['720p'],
      speed: 3,
    },
    {
      available: true,
      costMicros: 1600000,
      durations: [8],
      firstFrame: true,
      id: 'quality',
      lastFrame: true,
      maxReferences: 3,
      quality: 3,
      resolutions: ['1080p'],
      speed: 1,
    },
    {
      available: false,
      costMicros: 100000,
      id: 'missing',
    },
  ];

  it('filters unavailable, over-budget, and capability-incompatible routes', () => {
    const result = filterProviderRoutes(routes, {
      budgetMicros: 500000,
      duration: 8,
      firstLast: true,
      resolution: '720p',
    });

    expect(result.eligible.map((route) => route.id)).toEqual(['none', 'cheap']);
    expect(result.excluded.map((item) => item.id)).toEqual(['quality', 'missing']);
    expect(result.excluded).toEqual([
      {
        id: 'quality',
        reasons: ['over-budget', 'resolution'],
      },
      {
        id: 'missing',
        reasons: [
          'unavailable',
          'duration',
          'resolution',
          'first-last',
        ],
      },
    ]);
  });

  it('keeps no-video routes only when they are available', () => {
    const result = filterProviderRoutes([
      { available: true, costMicros: 0, id: 'manual', noVideo: true },
      { available: false, costMicros: 0, id: 'disabled-manual', noVideo: true },
    ], {
      budgetMicros: 0,
      duration: 30,
      firstLast: true,
      referenceCount: 10,
      resolution: '4k',
    });

    expect(result.eligible.map((route) => route.id)).toEqual(['manual']);
    expect(result.excluded).toEqual([
      { id: 'disabled-manual', reasons: ['unavailable'] },
    ]);
  });

  it('excludes every paid route from the free preset despite a nonzero budget', () => {
    const result = filterProviderRoutes([
      {
        available: true,
        costMicros: 1,
        durations: [8],
        firstFrame: true,
        id: 'paid-video',
        lastFrame: true,
        maxReferences: 2,
        resolutions: ['720p'],
      },
      {
        available: true,
        costMicros: 1,
        id: 'paid-manual',
        noVideo: true,
      },
      {
        available: true,
        costMicros: 0,
        id: 'free-manual',
        noVideo: true,
      },
    ], {
      budgetMicros: 500000,
      duration: 8,
      firstLast: true,
      preset: 'free',
      referenceCount: 2,
      resolution: '720p',
    });

    expect(result.eligible.map((route) => route.id)).toEqual(['free-manual']);
    expect(result.excluded).toEqual([
      { id: 'paid-video', reasons: ['paid-on-free'] },
      { id: 'paid-manual', reasons: ['paid-on-free'] },
    ]);
  });

  it('applies the hard budget to manual and no-video routes', () => {
    const result = filterProviderRoutes([
      {
        available: true,
        costMicros: 500001,
        id: 'over-budget-manual',
        noVideo: true,
      },
      {
        available: true,
        costMicros: 500000,
        id: 'within-budget-manual',
        noVideo: true,
      },
    ], {
      budgetMicros: 500000,
      duration: 30,
      firstLast: true,
      preset: 'balanced',
      referenceCount: 10,
      resolution: '4k',
    });

    expect(result.eligible.map((route) => route.id))
      .toEqual(['within-budget-manual']);
    expect(result.excluded).toEqual([
      { id: 'over-budget-manual', reasons: ['over-budget'] },
    ]);
  });

  it('ranks cheapest by cost and quality-first by quality', () => {
    expect(rankProviderRoutes(routes.slice(0, 3), 'cheapest')[0].id).toBe('none');
    expect(rankProviderRoutes(routes.slice(0, 3), 'quality-first')[0].id)
      .toBe('quality');
  });

  it('estimates integer micro-unit costs', () => {
    expect(estimateRouteCost(30000, 8)).toBe(240000);
    expect(estimateRouteCost(30000, 1.25)).toBe(37500);
  });
});
