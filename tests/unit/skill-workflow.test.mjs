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

  it('requires an explicit motion-plan approval stop before any video-generation call', () => {
    expect(prose).toMatch(/ask only for .*max(?:imum)? per-clip seconds/i);
    expect(prose).toMatch(/derived clip\/cost plan|derived clip and cost plan/i);
    expect(prose).toMatch(
      /end the turn for explicit `motion-plan` approval before any video-generation call/i,
    );
  });

  it('settles definitively unbilled failures at zero', () => {
    expect(prose).toMatch(
      /When a failed call is definitively unbilled, settle it with actual cost 0 to release the reservation/i,
    );
  });
});

describe('mode, direction, and inspiration intake', () => {
  it('opens intake with the register mode gate and full3d archetype sub-menu', () => {
    expect(prose).toMatch(/register.*(full3d|product)/i);
    expect(prose).toMatch(/archetype.*only when.*full3d/i);
    expect(prose).toMatch(/flythrough.*walkthrough.*teardown/i);
  });

  it('requires a direction choice from the four directions', () => {
    expect(prose).toMatch(/direction/i);
    expect(prose).toMatch(/minimal.*cinematic.*technical.*bold/i);
  });

  it('runs a light inspiration gate that shows clickable references before any paid generation', () => {
    expect(prose).toMatch(/inspiration/i);
    expect(prose).toMatch(/references\/inspiration\.json/);
    expect(prose).toMatch(/clickable|click through/i);
    expect(prose).toMatch(/before any paid|before any video-generation/i);
    expect(prose).toMatch(/status\.mjs.*--approve inspiration/);
  });

  it('frames references as a design language, not a promise the site will look identical', () => {
    expect(prose).toMatch(/not a template|design language/i);
    expect(prose).toMatch(/not look identical|will not look identical/i);
  });

  it('persists the approved references and bucket to values.json', () => {
    expect(prose).toMatch(/inspiration.*bucket/i);
    expect(prose).toMatch(/approvedRefs/);
  });

  it('legacy-skips inspiration for a config without register or direction', () => {
    expect(prose).toMatch(/legacy.*(register|direction).*skip|skip.*inspiration.*legacy/i);
  });
});

describe('visual ending treatment', () => {
  it('asks whether the page ends on-frame or continues to a solid text section', () => {
    expect(prose).toMatch(/How should the page finish visually/i);
    expect(prose).toMatch(/Final-frame hold.*page ends there/i);
    expect(prose).toMatch(/Solid text continuation.*solid theme-background statement/i);
    expect(prose).toMatch(/never navigates to another URL/i);
  });
});

describe('.pen-per-pause storyboard', () => {
  it('accepts Pencil-reviewed pauses when available or user-approved numeric overlays when skipped', () => {
    expect(prose).toMatch(/when Pencil is available, Pencil-reviewed pause compositions/i);
    expect(prose).toMatch(/otherwise, user-approved numeric overlay compositions in values\.json/i);
  });
  it('scaffolds one .pen file per hold beat, not one per beat', () => {
    expect(prose).toMatch(/one `?\.pen`? file per pause/i);
    expect(prose).toMatch(/`?hold: true`?, not one per beat/i);
    expect(prose).not.toMatch(/one canvas per beat/i);
  });
  it('seeds each pause .pen with the beat still and direction-styled nodes', () => {
    expect(prose).toMatch(/input\/keyframes\/beat-<n>\.<ext>/i);
    expect(prose).toMatch(/editable nodes/i);
    expect(prose).toMatch(/title, body, stats, CTA/i);
    expect(prose).toMatch(/point.*leader.*annotation/i);
    expect(prose).toMatch(/pre-style/i);
    expect(prose).toMatch(/references\/directions\.json/);
    expect(prose).toMatch(/fonts\.display/);
    expect(prose).toMatch(/fonts\.body/);
    expect(prose).toMatch(/accent/);
    expect(prose).toMatch(/bg.*surface.*scrimStrength/i);
    expect(prose).toMatch(/radius/);
  });
  it('keeps non-pause beats in numeric values.json overlay editing', () => {
    expect(prose).toMatch(/Non-pause beats keep numeric `?values\.json`? overlay editing/i);
  });
  it('reviews adjustable pause compositions and reads them back into values.json', () => {
    expect(prose).toMatch(/get_screenshot/i);
    expect(prose).toMatch(/adjusted even after.*approved inspiration reference/i);
    expect(prose).toMatch(/read the approved node positions/i);
    expect(prose).toMatch(/normalized `?at`?/i);
    expect(prose).toMatch(/position`?\/`?anchor/i);
    expect(prose).toMatch(/point.*annotations/i);
    expect(prose).toMatch(/copy, and `?hold`?/i);
    expect(prose).toMatch(/into `?values\.json`? before asking for the `?storyboard`? gate/i);
  });
  it('lets the user skip unavailable Pencil review and never claims a .pen round-trip', () => {
    expect(prose).toMatch(/Pencil.*unavailable/i);
    expect(prose).toMatch(/user.*choose.*skip Pencil review/i);
    expect(prose).toMatch(/numeric `?values\.json`? overlay editing/i);
    expect(prose).toMatch(/never claim a `?\.pen`? round-trip occurred/i);
  });
});
