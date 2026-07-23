import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);
const lock = JSON.parse(
  await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'),
);

describe('package contract', () => {
  it('is ESM, Node 20+, and exposes all six CLIs', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.bin).toEqual({
      'scroll-wizard-validate': 'scripts/validate-media.mjs',
      'scroll-wizard-extract': 'scripts/extract-frames.mjs',
      'scroll-wizard-scaffold': 'scripts/scaffold-site.mjs',
      'scroll-wizard-status': 'scripts/status.mjs',
      'scroll-wizard-plan-generation': 'scripts/plan-generation.mjs',
      'scroll-wizard-budget': 'scripts/budget.mjs',
    });
  });

  it('ships the skill, scripts, template, preset references, readme, and notices', () => {
    expect(pkg.files).toEqual([
      'scripts/',
      'template/',
      'references/',
      'SKILL.md',
      'README.md',
      'THIRD_PARTY_LICENSES.md',
    ]);
    expect(pkg.dependencies).toBeUndefined();
  });

  it('exposes the exact test scripts and development dependencies', () => {
    expect(pkg.scripts).toEqual({
      test: 'npm run test:unit && npm run test:integration',
      'test:unit': 'vitest run tests/unit',
      'test:integration': 'vitest run tests/integration',
      'test:browser': 'playwright test',
      'test:all': 'npm test && npm run test:browser',
    });
    expect(pkg.devDependencies).toEqual({
      '@playwright/test': '1.61.1',
      vitest: '4.1.10',
    });
  });

  it('resolves Vite with support for the full Node 20 range', () => {
    expect(pkg.overrides).toEqual({ vite: '6.4.3' });
    expect(lock.packages['node_modules/vite']).toMatchObject({
      version: '6.4.3',
      engines: { node: '^18.0.0 || ^20.0.0 || >=22.0.0' },
    });
  });

  it('includes user docs and license notices', async () => {
    await expect(access(new URL('../../README.md', import.meta.url))).resolves.toBeUndefined();
    await expect(access(new URL('../../LICENSE', import.meta.url))).resolves.toBeUndefined();
    const notices = await readFile(
      new URL('../../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8',
    );
    expect(notices).toContain('Lenis 1.3.25');
    expect(notices).toContain('MIT License');
    expect(notices).toContain('darkroom.engineering');
  });
});
