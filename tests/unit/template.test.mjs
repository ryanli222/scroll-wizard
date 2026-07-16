import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(
  new URL('../../template/index.html', import.meta.url), 'utf8',
);
const config = JSON.parse(await readFile(
  new URL('../../template/config.json', import.meta.url), 'utf8',
));

describe('template contract', () => {
  it('contains semantic runtime hooks and a real poster image', () => {
    expect(html).toContain('id="poster"');
    expect(html).toContain('id="scrub-canvas"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('id="overlay-layer"');
    expect(html).toContain('id="outro"');
    expect(html).toContain('type="module" src="scrub-engine.js"');
  });

  it('ships a complete valid example', async () => {
    const { validateConfig } = await import('../../template/scrub-core.js');
    expect(validateConfig(config).errors).toEqual([]);
    expect(config.brand.imageAlt).toBeTruthy();
  });
});
