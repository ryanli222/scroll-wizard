import { execFile } from 'node:child_process';
import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../scripts/plan-generation.mjs';

const execFileAsync = promisify(execFile);
const temporaryRoots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'scroll-wizard-generation-'));
  temporaryRoots.push(root);
  return root;
}

function fakeIo() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  };
}

function routeArgs(file, overrides = []) {
  return [
    'routes',
    file,
    '--budget-micros', '500000',
    '--preset', 'balanced',
    '--duration', '8',
    '--resolution', '720p',
    '--first-last',
    '--references', '2',
    ...overrides,
  ];
}

const runtimeRoutes = [
  {
    available: true,
    costMicros: 300000,
    durations: [8],
    firstFrame: true,
    id: 'veo-runtime-route',
    lastFrame: true,
    maxReferences: 2,
    quality: 2,
    resolutions: ['720p'],
    speed: 2,
  },
  {
    available: true,
    costMicros: 900000,
    durations: [8],
    firstFrame: true,
    id: 'seedance-runtime-route',
    lastFrame: true,
    maxReferences: 2,
    quality: 3,
    resolutions: ['720p'],
    speed: 2,
  },
  {
    available: false,
    costMicros: 100000,
    durations: [8],
    firstFrame: true,
    id: 'kling-runtime-route',
    lastFrame: true,
    maxReferences: 2,
    quality: 3,
    resolutions: ['720p'],
    speed: 3,
  },
  {
    available: true,
    costMicros: 200000,
    durations: [8],
    firstFrame: true,
    id: 'higgsfield-runtime-route',
    lastFrame: false,
    maxReferences: 1,
    quality: 2,
    resolutions: ['1080p'],
    speed: 3,
  },
];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('plan-generation main', () => {
  it('prints an adaptive beat recommendation', async () => {
    const io = fakeIo();

    expect(await main([
      'beats', '--claims', '4', '--sections', '5',
    ], io)).toBe(0);

    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({ beatCount: 5 });
    expect(io.error).not.toHaveBeenCalled();
  });

  it('reads runtime routes, filters capabilities and budget, and ranks eligible routes', async () => {
    const root = await temporaryRoot();
    const routesFile = join(root, 'routes.json');
    await writeFile(routesFile, JSON.stringify(runtimeRoutes));
    const io = fakeIo();

    expect(await main(routeArgs(routesFile), io)).toBe(0);

    const output = JSON.parse(io.log.mock.calls[0][0]);
    expect(output.recommended.id).toBe('veo-runtime-route');
    expect(output.eligible.map((route) => route.id)).toEqual(['veo-runtime-route']);
    expect(output.excluded).toEqual([
      { id: 'seedance-runtime-route', reasons: ['over-budget'] },
      { id: 'kling-runtime-route', reasons: ['unavailable'] },
      {
        id: 'higgsfield-runtime-route',
        reasons: ['resolution', 'first-last', 'references'],
      },
    ]);
  });

  it('uses the injected route-file runner', async () => {
    const io = fakeIo();
    const runner = vi.fn().mockResolvedValue(JSON.stringify([
      {
        available: true,
        costMicros: 0,
        id: 'manual-runtime-route',
        noVideo: true,
        quality: 0,
        speed: 0,
      },
    ]));

    expect(await main(routeArgs('runtime-routes.json'), io, runner)).toBe(0);

    expect(runner).toHaveBeenCalledWith(resolve('runtime-routes.json'), 'utf8');
    expect(JSON.parse(io.log.mock.calls[0][0]).recommended.id)
      .toBe('manual-runtime-route');
  });

  it('never recommends a paid route for free despite a nonzero budget', async () => {
    const io = fakeIo();
    const runner = vi.fn().mockResolvedValue(JSON.stringify([
      {
        available: true,
        costMicros: 1,
        durations: [8],
        firstFrame: true,
        id: 'paid-runtime-route',
        lastFrame: true,
        maxReferences: 2,
        quality: 3,
        resolutions: ['720p'],
        speed: 3,
      },
    ]));
    const argv = routeArgs('runtime-routes.json').map((value) => (
      value === 'balanced' ? 'free' : value
    ));

    expect(await main(argv, io, runner)).toBe(0);

    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({
      eligible: [],
      excluded: [{ id: 'paid-runtime-route', reasons: ['paid-on-free'] }],
      recommended: null,
    });
  });

  it('excludes over-budget manual routes for non-free planning', async () => {
    const io = fakeIo();
    const runner = vi.fn().mockResolvedValue(JSON.stringify([
      {
        available: true,
        costMicros: 500001,
        id: 'over-budget-manual-route',
        noVideo: true,
        quality: 2,
        speed: 2,
      },
    ]));

    expect(await main(routeArgs('runtime-routes.json'), io, runner)).toBe(0);

    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({
      eligible: [],
      excluded: [{
        id: 'over-budget-manual-route',
        reasons: ['over-budget'],
      }],
      recommended: null,
    });
  });

  it('returns 2 for malformed runtime JSON', async () => {
    const root = await temporaryRoot();
    const routesFile = join(root, 'routes.json');
    await writeFile(routesFile, '{not json');
    const io = fakeIo();

    expect(await main(routeArgs(routesFile), io)).toBe(2);
    expect(io.error.mock.calls.flat().join('\n')).toMatch(/Could not read routes/);
  });

  it.each([
    [['beats', '--claims', '-1', '--sections', '5'], /claims/],
    [['beats', '--claims', '4', '--sections', '5', '--unknown'], /Unknown option/],
    [routeArgs('routes.json').map((value) => (
      value === 'balanced' ? 'fastest' : value
    )), /preset/],
  ])('returns 1 for invalid flags: %j', async (argv, message) => {
    const io = fakeIo();

    expect(await main(argv, io, vi.fn())).toBe(1);
    expect(io.error.mock.calls.flat().join('\n')).toMatch(message);
  });
});

describe('plan-generation direct CLI', () => {
  it('runs main through the standard isDirect boundary', async () => {
    const script = resolve('scripts/plan-generation.mjs');
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      'beats',
      '--claims', '4',
      '--sections', '5',
    ]);

    expect(JSON.parse(stdout)).toEqual({ beatCount: 5 });
  });
});
