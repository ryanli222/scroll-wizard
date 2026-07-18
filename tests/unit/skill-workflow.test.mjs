import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const skill = await readFile(new URL('../../SKILL.md', import.meta.url), 'utf8');
const prose = skill.replace(/\s+/g, ' ');

describe('v2 workflow documentation contracts', () => {
  it('always exposes Manual and No video in the provider menu', () => {
    expect(prose).toMatch(/Always include Manual and No video as unconditional menu entries/i);
  });

  it('asks for outline approval and ends the turn before still acquisition', () => {
    expect(prose).toMatch(
      /Ask for explicit approval of the free text-only outline and end the turn before acquiring stills or making any paid generation call/i,
    );
  });

  it('initializes explicit still, video, and reroll allocations', () => {
    expect(prose).toMatch(
      /budget\.mjs <project> init.*?--still-micros.*?--video-micros.*?--reroll-micros/i,
    );
  });

  it('limits the light-gate exception to a status-reported legacy skip', () => {
    expect(prose).toMatch(
      /The only light-gate exception is `stills-preview` when `status\.mjs` explicitly reports that legacy skip/i,
    );
  });

  it('settles definitively unbilled failures at zero', () => {
    expect(prose).toMatch(
      /When a failed call is definitively unbilled, settle it with actual cost 0 to release the reservation/i,
    );
  });
});
