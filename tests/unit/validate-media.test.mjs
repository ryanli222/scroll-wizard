import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  detectMediaType,
  imageVerdict,
  main,
  runFfprobe,
  videoVerdict,
} from '../../scripts/validate-media.mjs';
import {
  hasFlag,
  isDirect,
  valueAfter,
} from '../../scripts/lib/cli.mjs';

const video = {
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

const image = {
  streams: [{
    codec_type: 'video',
    codec_name: 'png',
    width: 1600,
    height: 900,
    avg_frame_rate: '25/1',
    nb_frames: '1',
  }],
  format: { format_name: 'image2' },
};

describe('shared CLI helpers', () => {
  it('recognizes direct invocation from a resolved file URL', () => {
    const script = resolve('scripts/validate-media.mjs');

    expect(isDirect(pathToFileURL(script).href, script)).toBe(true);
    expect(isDirect(pathToFileURL(script).href, resolve('scripts/other.mjs'))).toBe(false);
    expect(isDirect(pathToFileURL(script).href, '')).toBe(false);
  });

  it('reads flag values and rejects missing ones', () => {
    expect(valueAfter(['--count', '24'], '--count', '12')).toBe('24');
    expect(valueAfter([], '--count', '12')).toBe('12');
    expect(() => valueAfter(['--count'], '--count', '12'))
      .toThrow('Missing value for --count');
    expect(() => valueAfter(['--count', '--force'], '--count', '12'))
      .toThrow('Missing value for --count');
  });

  it('detects boolean flags', () => {
    expect(hasFlag(['video.mp4', '--json'], '--json')).toBe(true);
    expect(hasFlag(['video.mp4'], '--json')).toBe(false);
  });
});

describe('ffprobe seam', () => {
  it('passes the exact ffprobe argument list without shell options', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: JSON.stringify(video) });

    await expect(runFfprobe('input.mp4', runner)).resolves.toEqual(video);
    expect(runner).toHaveBeenCalledWith('ffprobe', [
      '-v', 'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames:format=duration,format_name',
      '-of', 'json',
      'input.mp4',
    ]);
  });
});

describe('media verdicts', () => {
  it('distinguishes image2 from timed video', () => {
    expect(detectMediaType(video)).toBe('video');
    expect(detectMediaType(image)).toBe('image');
  });

  it('uses a one-frame stream without a finite duration as an image fallback', () => {
    expect(detectMediaType({
      streams: [{ codec_type: 'video', nb_frames: '1' }],
      format: { format_name: 'png_pipe' },
    })).toBe('image');
    expect(detectMediaType({ streams: [], format: {} })).toBe('unknown');
  });

  it('returns expected video metadata', () => {
    expect(videoVerdict(video)).toMatchObject({
      valid: true,
      type: 'video',
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
        fps: 30,
        codec: 'h264',
      },
      warnings: [],
    });
  });

  it('returns expected image metadata', () => {
    expect(imageVerdict(image)).toEqual({
      valid: true,
      type: 'image',
      errors: [],
      warnings: [],
      metadata: { width: 1600, height: 900, format: 'png' },
    });
  });

  it('warns for long, short, low-resolution, and non-16:9 media', () => {
    expect(videoVerdict({
      ...video,
      streams: [{ ...video.streams[0], height: 720 }],
      format: { ...video.format, duration: '16' },
    }).warnings.map((item) => item.code)).toEqual(['video.long', 'video.height']);
    expect(videoVerdict({
      ...video,
      format: { ...video.format, duration: '1' },
    }).warnings.map((item) => item.code)).toEqual(['video.short']);
    expect(imageVerdict({
      ...image,
      streams: [{ ...image.streams[0], width: 1000, height: 1000 }],
    }).warnings.map((item) => item.code)).toEqual(['image.aspect']);
  });

  it('keeps threshold values warning-free', () => {
    expect(videoVerdict({
      ...video,
      streams: [{ ...video.streams[0], height: 1080 }],
      format: { ...video.format, duration: '15' },
    }).warnings).toEqual([]);
    expect(videoVerdict({
      ...video,
      format: { ...video.format, duration: '2' },
    }).warnings).toEqual([]);
  });

  it('returns invalid verdicts for undecodable streams', () => {
    expect(videoVerdict({ streams: [], format: {} })).toEqual({
      valid: false,
      type: 'video',
      errors: ['No decodable timed video stream.'],
      warnings: [],
      metadata: {},
    });
    expect(imageVerdict({ streams: [], format: {} })).toEqual({
      valid: false,
      type: 'image',
      errors: ['No decodable image stream.'],
      warnings: [],
      metadata: {},
    });
  });
});

describe('CLI output and failures', () => {
  it('prints usage for a missing path', async () => {
    const io = { log: vi.fn(), error: vi.fn() };

    expect(await main([], io, vi.fn(), vi.fn())).toBe(1);
    expect(io.error).toHaveBeenCalledWith('Usage: validate-media <file> [--json]');
  });

  it('returns 1 for missing files and 2 for ffprobe failures', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    expect(await main(['missing.mp4'], io, vi.fn(), vi.fn().mockResolvedValue(false)))
      .toBe(1);
    const runner = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed'), { stderr: 'Invalid data found\nextra detail' }),
    );
    expect(await main(['fake.mp4'], io, runner, vi.fn().mockResolvedValue(true))).toBe(2);
    expect(io.error).toHaveBeenLastCalledWith('Not decodable: Invalid data found');
  });

  it('returns 2 for malformed JSON and unknown media', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exists = vi.fn().mockResolvedValue(true);

    expect(await main(
      ['malformed.mp4'],
      io,
      vi.fn().mockResolvedValue({ stdout: '{' }),
      exists,
    )).toBe(2);
    expect(io.error.mock.calls.at(-1)[0]).toMatch(/^Not decodable: .+/);

    expect(await main(
      ['unknown.bin'],
      io,
      vi.fn().mockResolvedValue({ stdout: '{"streams":[],"format":{}}' }),
      exists,
    )).toBe(2);
    expect(io.error).toHaveBeenLastCalledWith('Not decodable: Unknown media type.');
  });

  it('prints the full verdict as JSON when requested', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const runner = vi.fn().mockResolvedValue({ stdout: JSON.stringify(video) });

    expect(await main(
      ['input.mp4', '--json'],
      io,
      runner,
      vi.fn().mockResolvedValue(true),
    )).toBe(0);
    expect(JSON.parse(io.log.mock.calls[0][0])).toEqual(videoVerdict(video));
    expect(io.error).not.toHaveBeenCalled();
  });

  it('prints readable metadata and warnings in human mode', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const warningVideo = {
      ...video,
      streams: [{ ...video.streams[0], height: 720 }],
    };

    expect(await main(
      ['input.mp4'],
      io,
      vi.fn().mockResolvedValue({ stdout: JSON.stringify(warningVideo) }),
      vi.fn().mockResolvedValue(true),
    )).toBe(0);
    expect(io.log.mock.calls.flat().join('\n')).toContain('video');
    expect(io.log.mock.calls.flat().join('\n')).toContain('1920x720');
    expect(io.log.mock.calls.flat().join('\n')).toContain('video.height');
  });
});
