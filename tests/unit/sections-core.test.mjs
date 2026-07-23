import { describe, expect, it } from 'vitest';
import { assembleSections, currentPoster } from '../../template/sections-core.js';

const base = {
  brand: { name: 'Aster', tagline: 'Light, held in motion', imageAlt: 'Aster object' },
  frames: { poster: 'frames/frame-0001.webp' },
  overlays: [
    { title: 'Precision', stats: [{ label: 'Battery', value: '18 h' }] },
    { title: 'Detail', stats: [{ label: 'Weight', value: '1 kg' }] },
  ],
  outro: { headline: 'Made to move', body: 'Final thought', cta: { label: 'Buy', href: '#buy' } },
};

describe('sections core', () => {
  it('preserves explicit order without mutating source data', () => {
    const config = { sections: [
      { type: 'statement', text: 'First' },
      { type: 'scrub-hero' },
      { type: 'cta', headline: 'Last' },
    ] };
    const result = assembleSections(config);
    expect(result.map(({ type }) => type)).toEqual(['statement', 'scrub-hero', 'cta']);
    result[0].text = 'Changed';
    expect(config.sections[0].text).toBe('First');
    expect(assembleSections({ sections: [] })).toEqual([]);
  });

  it('selects frame and video posters', () => {
    expect(currentPoster(base)).toBe('frames/frame-0001.webp');
    expect(currentPoster({ video: { poster: 'media/poster.webp' } })).toBe('media/poster.webp');
  });

  it('synthesizes exact legacy and video compositions', () => {
    expect(assembleSections(base).map(({ type }) => type)).toEqual(['masthead', 'scrub-hero', 'cta']);
    expect(assembleSections({ ...base, brand: { name: 'Only' } }).map(({ type }) => type))
      .toEqual(['scrub-hero', 'cta']);
    expect(assembleSections({ ...base, video: { poster: 'media/poster.webp' } }).at(-1).background)
      .toBe('media/poster.webp');
  });

  it('synthesizes deterministic v3 default mixes and hooks', () => {
    const product = assembleSections({ ...base, register: 'product' });
    expect(product.map(({ type }) => type)).toEqual(['masthead', 'scrub-hero', 'spec', 'gallery', 'cta']);
    expect(product.find(({ type }) => type === 'spec').rows).toEqual([
      { label: 'Battery', value: '18 h', beat: 0 }, { label: 'Weight', value: '1 kg', beat: 1 },
    ]);
    expect(product.find(({ type }) => type === 'gallery').items[0]).toEqual({ beat: 0, alt: 'Precision' });
    expect(assembleSections({ ...base, register: 'full3d', archetype: 'teardown' }).map(({ type }) => type))
      .toEqual(['masthead', 'scrub-hero', 'spec', 'gallery', 'cta']);
    const flythrough = assembleSections({ ...base, register: 'full3d', archetype: 'flythrough' });
    expect(flythrough.map(({ type }) => type)).toEqual(['masthead', 'scrub-hero', 'statement', 'feature-split', 'cta']);
    expect(flythrough.find(({ type }) => type === 'statement').text).toBe('Light, held in motion');
    expect(flythrough.find(({ type }) => type === 'feature-split').media.src).toBe('frames/frame-0001.webp');
    expect(assembleSections({ ...base, register: 'full3d', archetype: 'walkthrough' }).map(({ type }) => type))
      .toEqual(['masthead', 'scrub-hero', 'statement', 'feature-split', 'cta']);
  });

  it('omits empty synthesized specs and galleries', () => {
    expect(assembleSections({ ...base, register: 'product', overlays: [] }).map(({ type }) => type))
      .toEqual(['masthead', 'scrub-hero', 'cta']);
  });
});