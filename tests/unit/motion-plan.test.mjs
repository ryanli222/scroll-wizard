import { describe, expect, it } from 'vitest';
import { planMotionClips } from '../../scripts/motion-plan.mjs';

describe('planMotionClips', () => {
  it('derives total duration and greedy stitchable clips from beat demand', () => {
    expect(planMotionClips([
      { motion: 'ordinary' }, { motion: 'high' }, { motion: 'ordinary' },
    ], 6)).toEqual({
      maxClipDurationSeconds: 6,
      totalDurationSeconds: 8,
      clips: [
        { index: 1, durationSeconds: 6, beatStart: 1, beatEnd: 2 },
        { index: 2, durationSeconds: 2, beatStart: 3, beatEnd: 3 },
      ],
      continuity: [{ fromClip: 1, toClip: 2, handoff: 'last-frame-to-first-frame' }],
    });
  });

  it('uses ordinary motion when a beat has no motion field', () => {
    expect(planMotionClips([{}, {}], 8).totalDurationSeconds).toBe(4);
  });

  it('rejects an invalid maximum or a beat that cannot fit in one clip', () => {
    expect(() => planMotionClips([{}], 1)).toThrow(/2.*15/);
    expect(() => planMotionClips([{ motion: 'high' }], 3)).toThrow(/high-motion beat/i);
  });
});
