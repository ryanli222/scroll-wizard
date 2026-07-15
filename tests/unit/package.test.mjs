import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

describe('package contract', () => {
  it('is ESM, Node 20+, and exposes all four CLIs', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.bin).toEqual({
      'scroll-wizard-validate': 'scripts/validate-media.mjs',
      'scroll-wizard-extract': 'scripts/extract-frames.mjs',
      'scroll-wizard-scaffold': 'scripts/scaffold-site.mjs',
      'scroll-wizard-status': 'scripts/status.mjs',
    });
  });

  it('ships the skill, scripts, template, readme, and third-party notice', () => {
    expect(pkg.files).toEqual([
      'scripts/',
      'template/',
      'SKILL.md',
      'README.md',
      'THIRD_PARTY_LICENSES.md',
    ]);
    expect(pkg.dependencies).toBeUndefined();
  });
});
