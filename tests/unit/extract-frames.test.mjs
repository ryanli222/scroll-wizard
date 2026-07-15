import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFfmpegArgs,
  framePlan,
  main,
  parseExtractArgs,
  summarizeFrames,
} from '../../scripts/extract-frames.mjs';
import {
  canonicalJson,
  directoryNonEmpty,
  listFilesRecursive,
  pathExists,
  replaceDirectory,
  sha256File,
  sha256Text,
  writeJsonAtomic,
} from '../../scripts/lib/files.mjs';

const temporaryRoots = [];

async function temporaryRoot(prefix = 'scroll-wizard-files-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('frame extraction planning', () => {
  it('uses exact midpoint timestamps', () => {
    expect(framePlan(8, 4)).toEqual([1, 3, 5, 7]);
  });

  it('parses defaults', () => {
    expect(parseExtractArgs(['in.mp4', 'frames'])).toEqual({
      input: 'in.mp4',
      outDir: 'frames',
      count: 150,
      width: 1600,
      format: 'webp',
      quality: 80,
      force: false,
    });
  });

  it('parses every supported override', () => {
    expect(parseExtractArgs([
      'in.mp4',
      'frames',
      '--count', '24',
      '--width', '1280',
      '--format', 'jpg',
      '--quality', '75',
      '--force',
    ])).toEqual({
      input: 'in.mp4',
      outDir: 'frames',
      count: 24,
      width: 1280,
      format: 'jpg',
      quality: 75,
      force: true,
    });
  });

  it.each([
    [['in.mp4', 'frames', '--count', '0'], /count/],
    [['in.mp4', 'frames', '--count', '10000'], /count/],
    [['in.mp4', 'frames', '--count', '1.5'], /count/],
    [['in.mp4', 'frames', '--width', '15'], /width/],
    [['in.mp4', 'frames', '--width', '8193'], /width/],
    [['in.mp4', 'frames', '--quality', '0'], /quality/],
    [['in.mp4', 'frames', '--quality', '101'], /quality/],
    [['in.mp4', 'frames', '--format', 'png'], /format/],
  ])('rejects an out-of-range option in %j', (argv, expected) => {
    expect(() => parseExtractArgs(argv)).toThrow(expected);
  });

  it('rejects missing paths, missing option values, and unknown options', () => {
    expect(() => parseExtractArgs([])).toThrow(/input.*output/i);
    expect(() => parseExtractArgs(['in.mp4'])).toThrow(/input.*output/i);
    expect(() => parseExtractArgs(['in.mp4', 'frames', '--count'])).toThrow(/--count/);
    expect(() => parseExtractArgs(['in.mp4', 'frames', '--wat'])).toThrow(/--wat/);
  });

  it.each([
    ['--count', '2', '3'],
    ['--width', '16', '17'],
    ['--format', 'webp', 'jpg'],
    ['--quality', '2', '3'],
  ])(
    'rejects duplicate value option %s',
    (flag, first, second) => {
      expect(() => parseExtractArgs([
        'in.mp4', 'frames', flag, first, flag, second,
      ])).toThrow(new RegExp('duplicate.*' + flag, 'i'));
    },
  );

  it('uses one shifted fps filter and caps WebP output count', () => {
    expect(buildFfmpegArgs({
      input: 'in.mp4',
      outputPattern: 'tmp/frame-%04d.webp',
      duration: 8,
      count: 4,
      width: 1600,
      format: 'webp',
      quality: 80,
    })).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '1',
      '-i', 'in.mp4',
      '-an',
      '-vf', 'fps=4/8:start_time=0:round=near,scale=1600:-2:flags=lanczos',
      '-frames:v', '4',
      '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6',
      '-quality', '80',
      'tmp/frame-%04d.webp',
    ]);
  });

  it('uses the mapped JPEG quality argument', () => {
    expect(buildFfmpegArgs({
      input: 'in.mp4',
      outputPattern: 'tmp/frame-%04d.jpg',
      duration: 10,
      count: 5,
      width: 1280,
      format: 'jpg',
      quality: 75,
    })).toEqual([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '1',
      '-i', 'in.mp4',
      '-an',
      '-vf', 'fps=5/10:start_time=0:round=near,scale=1280:-2:flags=lanczos',
      '-frames:v', '5',
      '-q:v', '9',
      'tmp/frame-%04d.jpg',
    ]);
  });

  it('uses the mobile budget and exact load estimate', () => {
    expect(summarizeFrames([
      { bytes: 1_000_000, width: 1280, height: 720 },
      { bytes: 1_000_000, width: 1280, height: 720 },
    ], { count: 100, width: 1280, quality: 75 })).toEqual({
      count: 2,
      width: 1280,
      height: 720,
      totalBytes: 2_000_000,
      averageBytes: 1_000_000,
      budgetBytes: 6 * 1024 * 1024,
      overBudget: false,
      estimatedSeconds: 4.15,
    });
  });

  it('uses the desktop budget when any mobile limit is exceeded', () => {
    expect(summarizeFrames([
      { bytes: 13 * 1024 * 1024, width: 1600, height: 900 },
    ], { count: 101, width: 1600, quality: 80 })).toMatchObject({
      budgetBytes: 12 * 1024 * 1024,
      overBudget: true,
    });
  });
});

describe('shared file helpers', () => {
  it('canonicalizes object keys recursively while retaining array order', () => {
    expect(canonicalJson({ z: 1, a: [{ y: 2, x: 3 }, 'last'] }))
      .toBe('{\u0022a\u0022:[{\u0022x\u0022:3,\u0022y\u0022:2},\u0022last\u0022],\u0022z\u0022:1}');
  });

  it('hashes text and file bytes with SHA-256', async () => {
    const root = await temporaryRoot();
    const file = join(root, 'hello.txt');
    await writeFile(file, 'hello');

    const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    expect(sha256Text('hello')).toBe(expected);
    await expect(sha256File(file)).resolves.toBe(expected);
  });

  it('writes formatted JSON atomically without leaving temporary files', async () => {
    const root = await temporaryRoot();
    const destination = join(root, 'nested', 'data.json');

    await writeJsonAtomic(destination, { answer: 42 });

    await expect(readFile(destination, 'utf8')).resolves.toBe(
      '{\n  \u0022answer\u0022: 42\n}\n',
    );
    expect(await readdir(join(root, 'nested'))).toEqual(['data.json']);
  });

  it('reports path existence and whether directories contain entries', async () => {
    const root = await temporaryRoot();
    const empty = join(root, 'empty');
    const full = join(root, 'full');
    await mkdir(empty);
    await mkdir(full);
    await writeFile(join(full, 'frame.webp'), 'frame');

    await expect(pathExists(empty)).resolves.toBe(true);
    await expect(pathExists(join(root, 'missing'))).resolves.toBe(false);
    await expect(directoryNonEmpty(empty)).resolves.toBe(false);
    await expect(directoryNonEmpty(full)).resolves.toBe(true);
    await expect(directoryNonEmpty(join(root, 'missing'))).resolves.toBe(false);
  });

  it('uses lstat existence semantics and propagates inspection errors', async () => {
    const present = vi.fn().mockResolvedValue({ isSymbolicLink: () => true });
    const missing = vi.fn().mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    const denied = vi.fn().mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EACCES' }),
    );

    await expect(pathExists('dangling-link', present)).resolves.toBe(true);
    await expect(pathExists('missing', missing)).resolves.toBe(false);
    await expect(pathExists('private', denied)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('lists nested files in stable relative-path order', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'z'));
    await mkdir(join(root, 'a'));
    await writeFile(join(root, 'z', 'two.txt'), 'two');
    await writeFile(join(root, 'a', 'one.txt'), 'one');

    expect(await listFilesRecursive(root)).toEqual([
      { path: join('a', 'one.txt'), absolutePath: join(root, 'a', 'one.txt') },
      { path: join('z', 'two.txt'), absolutePath: join(root, 'z', 'two.txt') },
    ]);
  });

  it('leaves exactly the new format and count after forced replacement', async () => {
    const root = await temporaryRoot('scroll-wizard-replace-');
    const target = join(root, 'frames');
    const prepared = join(root, 'prepared');
    await mkdir(target);
    await mkdir(prepared);
    await writeFile(join(target, 'frame-0002.webp'), 'old');
    await writeFile(join(prepared, 'frame-0001.jpg'), 'new');

    await replaceDirectory(prepared, target, true);

    expect(await readdir(target)).toEqual(['frame-0001.jpg']);
    expect(await readdir(root)).toEqual(['frames']);
  });

  it('rejects an existing target without force and changes nothing', async () => {
    const root = await temporaryRoot('scroll-wizard-replace-');
    const target = join(root, 'frames');
    const prepared = join(root, 'prepared');
    await mkdir(target);
    await mkdir(prepared);
    await writeFile(join(target, 'old.webp'), 'old');
    await writeFile(join(prepared, 'new.webp'), 'new');

    await expect(replaceDirectory(prepared, target, false)).rejects.toThrow(/force/i);
    await expect(readFile(join(target, 'old.webp'), 'utf8')).resolves.toBe('old');
    await expect(readFile(join(prepared, 'new.webp'), 'utf8')).resolves.toBe('new');
  });

  it('restores the old target when prepared-directory promotion fails', async () => {
    const root = await temporaryRoot('scroll-wizard-replace-');
    const target = join(root, 'frames');
    const missingPrepared = join(root, 'missing-prepared');
    await mkdir(target);
    await writeFile(join(target, 'old.webp'), 'old');

    await expect(replaceDirectory(missingPrepared, target, true)).rejects.toThrow();

    await expect(readFile(join(target, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(await readdir(root)).toEqual(['frames']);
  });

  it('commits replacement and preserves the backup when backup cleanup fails', async () => {
    const root = await temporaryRoot('scroll-wizard-replace-');
    const target = join(root, 'frames');
    const prepared = join(root, 'prepared');
    await mkdir(target);
    await mkdir(prepared);
    await writeFile(join(target, 'old.webp'), 'old');
    await writeFile(join(prepared, 'new.webp'), 'new');
    const cleanupError = Object.assign(new Error('backup locked'), { code: 'EPERM' });
    const remove = vi.fn(async (path, options) => {
      if (path.startsWith(target + '.backup-')) throw cleanupError;
      return rm(path, options);
    });

    const result = await replaceDirectory(prepared, target, true, { remove });

    expect(result).toMatchObject({
      committed: true,
      backupPath: expect.stringContaining('frames.backup-'),
      cleanupError,
    });
    await expect(readFile(join(target, 'new.webp'), 'utf8')).resolves.toBe('new');
    await expect(readFile(join(result.backupPath, 'old.webp'), 'utf8'))
      .resolves.toBe('old');
  });
});

const inputProbe = {
  streams: [{
    codec_type: 'video',
    codec_name: 'h264',
    width: 1920,
    height: 1080,
    avg_frame_rate: '30/1',
    nb_frames: '240',
  }],
  format: { duration: '8', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
};

const frameProbe = {
  streams: [{
    codec_type: 'video',
    codec_name: 'mjpeg',
    width: 1280,
    height: 720,
    avg_frame_rate: '25/1',
    nb_frames: '1',
  }],
  format: { format_name: 'image2' },
};

function fakeExtractionRunner({
  input,
  count,
  bytes = 3,
  omitLast = false,
  zeroFirst = false,
  extra = false,
  failFfmpeg = false,
  failFrameProbe = false,
  wrongName = false,
  afterFrames,
  probe = inputProbe,
} = {}) {
  return vi.fn(async (command, args) => {
    if (command === 'ffprobe') {
      const file = args.at(-1);
      if (file === input) return { stdout: JSON.stringify(probe) };
      if (failFrameProbe) throw new Error('frame probe failed');
      return { stdout: JSON.stringify(frameProbe) };
    }
    if (command !== 'ffmpeg') throw new Error('unexpected command');

    const outputPattern = args.at(-1);
    await mkdir(dirname(outputPattern), { recursive: true });
    if (failFfmpeg) {
      await writeFile(outputPattern.replace('%04d', '0001'), 'partial');
      throw Object.assign(new Error('ffmpeg failed'), { stderr: 'encoder failed\nmore' });
    }
    const last = omitLast ? count - 1 : count;
    for (let index = 1; index <= last; index += 1) {
      const length = zeroFirst && index === 1 ? 0 : bytes;
      const output = wrongName && index === last
        ? join(
          dirname(outputPattern),
          'frame-9999.' + (outputPattern.endsWith('.jpg') ? 'jpg' : 'webp'),
        )
        : outputPattern.replace('%04d', String(index).padStart(4, '0'));
      await writeFile(
        output,
        Buffer.alloc(length, 1),
      );
    }
    if (extra) {
      await writeFile(join(dirname(outputPattern), 'stale.webp'), 'extra');
    }
    await afterFrames?.();
    return { stdout: '', stderr: '' };
  });
}

function fakeIo() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('frame extraction CLI', () => {
  it('extracts once, replaces stale output wholesale, and prints JSON', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'frame-0003.webp'), 'stale');
    const runner = fakeExtractionRunner({ input, count: 2 });
    const io = fakeIo();

    expect(await main([
      input, outDir,
      '--count', '2',
      '--width', '1280',
      '--format', 'jpg',
      '--quality', '75',
      '--force',
    ], io, runner)).toBe(0);

    expect(await readdir(outDir)).toEqual(['frame-0001.jpg', 'frame-0002.jpg']);
    expect(runner.mock.calls.filter(([command]) => command === 'ffmpeg')).toHaveLength(1);
    const ffmpegArgs = runner.mock.calls.find(([command]) => command === 'ffmpeg')[1];
    expect(ffmpegArgs).toEqual(buildFfmpegArgs({
      input,
      outputPattern: ffmpegArgs.at(-1),
      duration: 8,
      count: 2,
      width: 1280,
      format: 'jpg',
      quality: 75,
    }));
    expect(JSON.parse(io.log.mock.calls[0][0])).toMatchObject({
      count: 2,
      width: 1280,
      height: 720,
      totalBytes: 6,
      overBudget: false,
    });
    expect(io.warn).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(['frames', 'input.mp4']);
  });

  it('allows an existing empty output without force', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    const runner = fakeExtractionRunner({ input, count: 1 });

    expect(await main([
      input, outDir, '--count', '1',
    ], fakeIo(), runner)).toBe(0);
    expect(await readdir(outDir)).toEqual(['frame-0001.webp']);
  });

  it('reports usage and rejects missing inputs without invoking tools', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const io = fakeIo();
    const runner = vi.fn();

    expect(await main([], io, runner)).toBe(1);
    expect(io.error).toHaveBeenLastCalledWith(
      'Usage: extract-frames <input> <output-dir> [options]',
    );
    expect(await main([
      join(root, 'missing.mp4'), join(root, 'frames'),
    ], io, runner)).toBe(1);
    expect(io.error).toHaveBeenLastCalledWith(
      `Input not found: ${join(root, 'missing.mp4')}`,
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects a non-empty output without force and leaves it untouched', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.webp'), 'old');
    const io = fakeIo();
    const runner = vi.fn();

    expect(await main([input, outDir], io, runner)).toBe(1);

    await expect(readFile(join(outDir, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(runner).not.toHaveBeenCalled();
    expect(io.error.mock.calls.at(-1)[0]).toMatch(/--force/);
  });

  it('requires a valid video and preserves forced output on rejection', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.webp'), 'old');
    const runner = fakeExtractionRunner({
      input,
      count: 1,
      probe: { streams: [], format: {} },
    });

    expect(await main([input, outDir, '--force'], fakeIo(), runner)).toBe(2);

    await expect(readFile(join(outDir, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(runner.mock.calls.filter(([command]) => command === 'ffmpeg')).toHaveLength(0);
  });

  it.each([
    ['missing tail', { omitLast: true }, /exactly 2 contiguous/],
    ['zero-byte frame', { zeroFirst: true }, /nonzero/],
    ['unexpected extra file', { extra: true }, /exactly 2 contiguous/],
    ['equal count with wrong filename', { wrongName: true }, /exactly 2 contiguous/],
  ])('rejects %s and cleans preparation while retaining old output', async (
    _name,
    runnerOptions,
    expectedError,
  ) => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.webp'), 'old');
    const runner = fakeExtractionRunner({ input, count: 2, ...runnerOptions });
    const io = fakeIo();

    expect(await main([
      input, outDir, '--count', '2', '--force',
    ], io, runner)).toBe(2);

    await expect(readFile(join(outDir, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(await readdir(root)).toEqual(['frames', 'input.mp4']);
    expect(io.error.mock.calls.at(-1)[0]).toMatch(expectedError);
  });

  it.each([
    ['ffmpeg failure', { failFfmpeg: true }],
    ['output probe failure', { failFrameProbe: true }],
  ])('preserves output and cleans partial files after %s', async (_name, options) => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.webp'), 'old');
    const runner = fakeExtractionRunner({ input, count: 1, ...options });

    expect(await main([
      input, outDir, '--count', '1', '--force',
    ], fakeIo(), runner)).toBe(2);

    await expect(readFile(join(outDir, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(await readdir(root)).toEqual(['frames', 'input.mp4']);
  });

  it('prints a human-readable warning when the frame set exceeds budget', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    const runner = fakeExtractionRunner({ input, count: 1, bytes: 13 * 1024 * 1024 });
    const io = fakeIo();

    expect(await main([
      input, outDir, '--count', '1',
    ], io, runner)).toBe(0);

    expect(JSON.parse(io.log.mock.calls[0][0]).overBudget).toBe(true);
    expect(io.warn.mock.calls[0][0]).toMatch(/budget/i);
  });

  it('preserves content added to an initially empty output during extraction', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    const runner = fakeExtractionRunner({
      input,
      count: 1,
      afterFrames: () => writeFile(join(outDir, 'arrived.txt'), 'keep'),
    });

    expect(await main([
      input, outDir, '--count', '1',
    ], fakeIo(), runner)).toBe(2);

    await expect(readFile(join(outDir, 'arrived.txt'), 'utf8')).resolves.toBe('keep');
    expect(await readdir(outDir)).toEqual(['arrived.txt']);
    expect(await readdir(root)).toEqual(['frames', 'input.mp4']);
  });

  it('refuses a target recreated after final empty-directory removal', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    const runner = fakeExtractionRunner({ input, count: 1 });
    const removeEmptyDirectory = vi.fn(async (path) => {
      await rmdir(path);
      await mkdir(path);
      await writeFile(join(path, 'recreated.txt'), 'keep');
    });

    expect(await main(
      [input, outDir, '--count', '1'],
      fakeIo(),
      runner,
      { removeEmptyDirectory },
    )).toBe(2);

    expect(removeEmptyDirectory).toHaveBeenCalledWith(outDir);
    await expect(readFile(join(outDir, 'recreated.txt'), 'utf8')).resolves.toBe('keep');
    expect(await readdir(outDir)).toEqual(['recreated.txt']);
  });

  it('returns success and warns with the preserved backup path on cleanup failure', async () => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.webp'), 'old');
    const runner = fakeExtractionRunner({ input, count: 1 });
    const io = fakeIo();
    const remove = vi.fn(async (path, options) => {
      if (path.startsWith(outDir + '.backup-')) {
        throw Object.assign(new Error('backup locked'), { code: 'EPERM' });
      }
      return rm(path, options);
    });

    expect(await main(
      [input, outDir, '--count', '1', '--force'],
      io,
      runner,
      { replacementOperations: { remove } },
    )).toBe(0);

    expect(await readdir(outDir)).toEqual(['frame-0001.webp']);
    const backup = (await readdir(root)).find((name) => name.startsWith('frames.backup-'));
    expect(backup).toBeDefined();
    await expect(readFile(join(root, backup, 'old.webp'), 'utf8')).resolves.toBe('old');
    expect(io.warn.mock.calls.flat().join('\n')).toContain(join(root, backup));
    expect(io.error).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON output', 3, (io) => io.log.mockImplementation(() => {
      throw new Error('log failed');
    })],
    ['budget warning', 13 * 1024 * 1024, (io) => io.warn.mockImplementation(() => {
      throw new Error('warn failed');
    })],
  ])('does not turn a committed extraction into failure when %s throws', async (
    _name,
    bytes,
    breakReporter,
  ) => {
    const root = await temporaryRoot('scroll-wizard-extract-');
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'frames');
    await writeFile(input, 'video');
    const runner = fakeExtractionRunner({ input, count: 1, bytes });
    const io = fakeIo();
    breakReporter(io);

    expect(await main([
      input, outDir, '--count', '1',
    ], io, runner)).toBe(0);

    expect(await readdir(outDir)).toEqual(['frame-0001.webp']);
    expect(io.error).not.toHaveBeenCalled();
  });
});
