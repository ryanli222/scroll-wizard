import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPosterArgs,
  buildReencodeArgs,
  main,
  parseReencodeArgs,
} from '../../scripts/reencode-video.mjs';

const temporaryRoots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'scroll-wizard-reencode-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function fakeIo() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

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

const outputProbe = {
  streams: [{
    codec_type: 'video',
    codec_name: 'h264',
    width: 1280,
    height: 720,
    avg_frame_rate: '30/1',
    nb_frames: '240',
  }],
  format: { duration: '8', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
};

function fakeReencodeRunner({ input, failProbe = false, failFfmpeg = false } = {}) {
  let ffmpegCalls = 0;
  return vi.fn(async (command, args) => {
    if (command === 'ffprobe') {
      if (failProbe) throw Object.assign(new Error('probe failed'), { stderr: 'bad probe\nmore' });
      return {
        stdout: JSON.stringify(args.at(-1) === input ? inputProbe : outputProbe),
      };
    }
    if (command !== 'ffmpeg') throw new Error('unexpected command');
    ffmpegCalls += 1;
    const output = args.at(-1);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, ffmpegCalls === 1 ? Buffer.alloc(1_000, 1) : Buffer.alloc(100, 2));
    if (failFfmpeg && ffmpegCalls === 2) {
      throw Object.assign(new Error('ffmpeg failed'), { stderr: 'poster failed\nmore' });
    }
    return { stdout: '', stderr: '' };
  });
}

describe('parseReencodeArgs', () => {
  it('applies defaults', () => {
    expect(parseReencodeArgs(['in.mp4', 'out'])).toEqual({
      input: 'in.mp4', outDir: 'out', crf: 23, width: 1600,
      gop: 8, posterAt: 0, force: false,
    });
  });

  it('parses supported overrides', () => {
    expect(parseReencodeArgs([
      'in.mp4', 'out', '--crf', '20', '--width', '1280', '--gop', '12',
      '--poster-at', '2.5', '--force',
    ])).toEqual({
      input: 'in.mp4', outDir: 'out', crf: 20, width: 1280,
      gop: 12, posterAt: 2.5, force: true,
    });
  });

  it('rejects out-of-range crf', () => {
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--crf', '99'])).toThrow(/crf/);
  });

  it('rejects missing positionals', () => {
    expect(() => parseReencodeArgs(['in.mp4'])).toThrow(/input video and output directory/);
  });

  it('rejects malformed, duplicate, unknown, and conflicting options', () => {
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--width', '1.5'])).toThrow(/width/);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--gop', '0'])).toThrow(/gop/);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--poster-at', '-1'])).toThrow(/poster-at/);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--crf'])).toThrow(/--crf/);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--crf', '20', '--crf', '21']))
      .toThrow(/duplicate.*--crf/i);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--wat'])).toThrow(/--wat/);
    expect(() => parseReencodeArgs(['in.mp4', 'out', '--gop', '8', '--all-intra']))
      .toThrow(/gop.*all-intra/i);
  });
});

describe('buildReencodeArgs', () => {
  it('encodes small-GOP h264 with faststart', () => {
    const args = buildReencodeArgs({
      input: 'in.mp4', width: 1280, crf: 20, gop: 8, output: 'out/video.mp4',
    });
    expect(args).toContain('-g');
    expect(args[args.indexOf('-g') + 1]).toBe('8');
    expect(args[args.indexOf('-keyint_min') + 1]).toBe('8');
    expect(args).toContain('+faststart');
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(args[args.indexOf('-vf') + 1]).toContain('scale=1280:-2');
    expect(args.at(-1)).toBe('out/video.mp4');
  });

  it('uses GOP 1 only for the explicit all-intra preset', () => {
    expect(parseReencodeArgs(['in.mp4', 'out', '--all-intra']).gop).toBe(1);
  });
});

describe('buildPosterArgs', () => {
  it('grabs one webp frame at the requested time', () => {
    const args = buildPosterArgs({
      input: 'in.mp4', width: 1280, posterAt: 2.5, output: 'out/poster.webp',
    });
    expect(args[args.indexOf('-ss') + 1]).toBe('2.5');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args.at(-1)).toBe('out/poster.webp');
  });
});

describe('reencode CLI', () => {
  it('reports usage and rejects missing inputs without invoking tools', async () => {
    const root = await temporaryRoot();
    const io = fakeIo();
    const runner = vi.fn();

    expect(await main([], io, runner)).toBe(1);
    expect(io.error).toHaveBeenLastCalledWith(
      'Usage: reencode-video <input> <output-dir> [--crf N] [--width N] [--gop N|--all-intra] [--poster-at S] [--force]',
    );
    expect(await main([join(root, 'missing.mp4'), join(root, 'media')], io, runner)).toBe(1);
    expect(io.error).toHaveBeenLastCalledWith(`Input not found: ${join(root, 'missing.mp4')}`);
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    ['ffprobe failure', { failProbe: true }, /Re-encode failed: bad probe/],
    ['ffmpeg failure', { failFfmpeg: true }, /Re-encode failed: poster failed/],
  ])('returns 2 on %s', async (_name, runnerOptions, expected) => {
    const root = await temporaryRoot();
    const input = join(root, 'input.mp4');
    await writeFile(input, 'video');
    const io = fakeIo();

    expect(await main(
      [input, join(root, 'media')],
      io,
      fakeReencodeRunner({ input, ...runnerOptions }),
    )).toBe(2);
    expect(io.error.mock.calls.at(-1)[0]).toMatch(expected);
  });

  it('writes media atomically and emits the JSON report', async () => {
    const root = await temporaryRoot();
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'media');
    await writeFile(input, 'video');
    const io = fakeIo();

    expect(await main([
      input, outDir, '--width', '1280', '--crf', '20', '--gop', '12',
    ], io, fakeReencodeRunner({ input }))).toBe(0);

    expect(await readdir(outDir)).toEqual(['media.json', 'poster.webp', 'video.mp4']);
    expect(JSON.parse(await readFile(join(outDir, 'media.json'), 'utf8'))).toEqual({
      duration: 8, width: 1280, height: 720, crf: 20, gop: 12,
    });
    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual({
      videoBytes: 1000,
      posterBytes: 100,
      duration: 8,
      width: 1280,
      height: 720,
      estimatedSeconds: 0.15,
    });
    expect(io.error).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(['input.mp4', 'media']);
  });

  it('preserves a pre-existing output byte-for-byte when a forced run fails', async () => {
    const root = await temporaryRoot();
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'media');
    await writeFile(input, 'video');
    await mkdir(join(outDir, 'nested'), { recursive: true });
    await writeFile(join(outDir, 'video.mp4'), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(outDir, 'nested', 'keep.bin'), Buffer.from([9, 8, 7]));
    const beforeVideo = await readFile(join(outDir, 'video.mp4'));
    const beforeNested = await readFile(join(outDir, 'nested', 'keep.bin'));

    expect(await main(
      [input, outDir, '--force'],
      fakeIo(),
      fakeReencodeRunner({ input, failFfmpeg: true }),
    )).toBe(2);

    expect(await readFile(join(outDir, 'video.mp4'))).toEqual(beforeVideo);
    expect(await readFile(join(outDir, 'nested', 'keep.bin'))).toEqual(beforeNested);
    expect(await readdir(root)).toEqual(['input.mp4', 'media']);
  });

  it('rejects an existing output without force and leaves it untouched', async () => {
    const root = await temporaryRoot();
    const input = join(root, 'input.mp4');
    const outDir = join(root, 'media');
    await writeFile(input, 'video');
    await mkdir(outDir);
    await writeFile(join(outDir, 'old.txt'), 'old');
    const runner = vi.fn();

    expect(await main([input, outDir], fakeIo(), runner)).toBe(1);
    await expect(readFile(join(outDir, 'old.txt'), 'utf8')).resolves.toBe('old');
    expect(runner).not.toHaveBeenCalled();
  });
});
