import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, planBeats } from '../../scripts/stills-to-frames.mjs';

const temporaryRoots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'scroll-wizard-stills-'));
  temporaryRoots.push(root);
  return root;
}

function fakeIo() {
  return {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
}

async function seedBeats(root, names = ['beat-1.png', 'beat-2.jpg']) {
  const directory = join(root, 'input', 'keyframes');
  await mkdir(directory, { recursive: true });
  await Promise.all(names.map((name) => writeFile(join(directory, name), name)));
  return directory;
}

function conversionRunner({ failConversion, invalidProbe = false } = {}) {
  let conversions = 0;
  return vi.fn(async (command, args) => {
    if (command === 'ffmpeg') {
      conversions += 1;
      if (conversions === failConversion) throw new Error('conversion failed');
      await mkdir(dirname(args.at(-1)), { recursive: true });
      await writeFile(args.at(-1), Buffer.alloc(100, conversions));
      return { stdout: '', stderr: '' };
    }
    if (command === 'ffprobe') {
      return {
        stdout: JSON.stringify({
          streams: invalidProbe
            ? []
            : [{
              codec_name: 'webp',
              codec_type: 'video',
              height: 720,
              width: 1280,
            }],
        }),
        stderr: '',
      };
    }
    throw new Error('Unexpected command: ' + command);
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('planBeats', () => {
  it('orders beats numerically', () => {
    expect(planBeats([
      'beat-2.png',
      'beat-10.webp',
      'beat-1.jpg',
      'beat-9.png',
      'beat-3.png',
      'beat-8.png',
      'beat-4.png',
      'beat-7.png',
      'beat-5.png',
      'beat-6.png',
    ])).toEqual([
      'beat-1.jpg',
      'beat-2.png',
      'beat-3.png',
      'beat-4.png',
      'beat-5.png',
      'beat-6.png',
      'beat-7.png',
      'beat-8.png',
      'beat-9.png',
      'beat-10.webp',
    ]);
  });

  it('rejects gaps, duplicates, and fewer than 2 beats', () => {
    expect(() => planBeats(['beat-1.png', 'beat-3.png'])).toThrow(/contiguous/);
    expect(() => planBeats(['beat-1.png', 'beat-1.webp'])).toThrow(/duplicate/i);
    expect(() => planBeats(['beat-1.png'])).toThrow(/at least 2/);
  });

  it('ignores non-beat files', () => {
    expect(planBeats(['beat-1.png', 'beat-2.png', 'notes.txt', 'first.png']))
      .toEqual(['beat-1.png', 'beat-2.png']);
  });
});

describe('stills-to-frames main', () => {
  it('returns 1 when input/keyframes is missing', async () => {
    const root = await temporaryRoot();
    const io = fakeIo();
    const runner = conversionRunner();

    expect(await main([root], io, runner)).toBe(1);
    expect(runner).not.toHaveBeenCalled();
    expect(io.error.mock.calls.flat().join('\n')).toMatch(/input\/keyframes/);
  });

  it('returns 2 and preserves existing frames when conversion fails', async () => {
    const root = await temporaryRoot();
    await seedBeats(root);
    const frames = join(root, 'frames');
    await mkdir(frames);
    await writeFile(join(frames, 'old.webp'), 'old frame');
    const io = fakeIo();

    expect(await main(
      [root, '--force'],
      io,
      conversionRunner({ failConversion: 2 }),
    )).toBe(2);

    await expect(readFile(join(frames, 'old.webp'), 'utf8')).resolves.toBe('old frame');
    expect(await readdir(root)).toEqual(['frames', 'input']);
    expect(io.error.mock.calls.flat().join('\n')).toContain('conversion failed');
  });

  it('validates staged frames before replacing existing frames', async () => {
    const root = await temporaryRoot();
    await seedBeats(root);
    const frames = join(root, 'frames');
    await mkdir(frames);
    await writeFile(join(frames, 'old.webp'), 'old frame');

    expect(await main(
      [root, '--force'],
      fakeIo(),
      conversionRunner({ invalidProbe: true }),
    )).toBe(2);

    await expect(readFile(join(frames, 'old.webp'), 'utf8')).resolves.toBe('old frame');
    expect(await readdir(root)).toEqual(['frames', 'input']);
  });

  it('converts ordered beats, emits the standard summary, and replaces atomically', async () => {
    const root = await temporaryRoot();
    await seedBeats(root, ['beat-2.png', 'notes.txt', 'beat-1.jpg']);
    const frames = join(root, 'frames');
    await mkdir(frames);
    await writeFile(join(frames, 'old.webp'), 'old frame');
    const io = fakeIo();
    const runner = conversionRunner();

    expect(await main(
      [root, '--width', '1280', '--quality', '75', '--force'],
      io,
      runner,
    )).toBe(0);

    const ffmpegCalls = runner.mock.calls.filter(([command]) => command === 'ffmpeg');
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls.map(([, args]) => args[args.indexOf('-i') + 1])).toEqual([
      join(root, 'input', 'keyframes', 'beat-1.jpg'),
      join(root, 'input', 'keyframes', 'beat-2.png'),
    ]);
    expect(ffmpegCalls.map(([, args]) => args.at(-1).split(/[\\/]/).at(-1))).toEqual([
      'frame-0001.webp',
      'frame-0002.webp',
    ]);
    expect(await readdir(frames)).toEqual(['frame-0001.webp', 'frame-0002.webp']);
    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({
      averageBytes: 100,
      budgetBytes: 6 * 1024 * 1024,
      count: 2,
      estimatedSeconds: 0.15,
      height: 720,
      overBudget: false,
      totalBytes: 200,
      width: 1280,
    });
    expect(await readdir(root)).toEqual(['frames', 'input']);
  });

  it('rolls back a failed promotion without changing existing frames', async () => {
    const root = await temporaryRoot();
    await seedBeats(root);
    const frames = join(root, 'frames');
    await mkdir(frames);
    await writeFile(join(frames, 'old.webp'), 'old frame');
    const promotionError = new Error('promotion failed');
    const renamePath = vi.fn(async (source, destination) => {
      if (destination === frames && source.includes('.frames.tmp-')) throw promotionError;
      return rename(source, destination);
    });

    expect(await main(
      [root, '--force'],
      fakeIo(),
      conversionRunner(),
      { replacementOperations: { rename: renamePath } },
    )).toBe(2);

    await expect(readFile(join(frames, 'old.webp'), 'utf8')).resolves.toBe('old frame');
    expect(await readdir(root)).toEqual(['frames', 'input']);
  });
});
