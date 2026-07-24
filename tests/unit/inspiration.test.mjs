import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const library = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../references/inspiration.json', import.meta.url)), 'utf8',
));

const BUCKETS = new Set([
  'full3d/flythrough', 'full3d/walkthrough', 'full3d/teardown', 'product',
  'direction/minimal', 'direction/cinematic', 'direction/technical', 'direction/bold',
]);

describe('inspiration.json', () => {
  it('is an object with a non-empty entries array', () => {
    expect(Array.isArray(library.entries)).toBe(true);
    expect(library.entries.length).toBeGreaterThan(0);
  });

  it('gives every entry the full contract with a known bucket', () => {
    for (const entry of library.entries) {
      expect(typeof entry.url, entry.url).toBe('string');
      expect(entry.url).toMatch(/^https:\/\//);
      expect(typeof entry.label && entry.label.trim(), entry.url).toBeTruthy();
      expect(BUCKETS.has(entry.bucket), entry.bucket).toBe(true);
      expect(typeof entry.verified, entry.url).toBe('boolean');
      expect(typeof entry.note && entry.note.trim(), entry.url).toBeTruthy();
    }
  });

  it('requires a captured shot path for every verified entry', () => {
    for (const entry of library.entries.filter((item) => item.verified)) {
      expect(typeof entry.shot, entry.url).toBe('string');
      expect(entry.shot, entry.url).toMatch(/^references\/inspiration-shots\/.+\.(png|webp|jpe?g)$/);
    }
  });

  it('covers every register/archetype bucket and every direction bucket at least once', () => {
    const covered = new Set(library.entries.map((entry) => entry.bucket));
    for (const bucket of BUCKETS) {
      expect(covered.has(bucket), 'missing bucket ' + bucket).toBe(true);
    }
  });

  it('excludes real-time WebGL references by not listing known-excluded hosts', () => {
    const hosts = library.entries.map((entry) => new URL(entry.url).host);
    expect(hosts).not.toContain('www.noomo.agency');
    expect(hosts).not.toContain('noomo.agency');
  });
});
