#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { hasFlag, isDirect } from './lib/cli.mjs';

const execFileAsync = promisify(execFile);

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function runFfprobe(file, runner = execFileAsync) {
  const { stdout } = await runner('ffprobe', [
    '-v', 'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames:format=duration,format_name',
    '-of', 'json',
    file,
  ]);
  return JSON.parse(stdout);
}

export function detectMediaType(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  if (!stream) return 'unknown';
  const formats = String(probe?.format?.format_name ?? '').split(',');
  const duration = Number(probe?.format?.duration);
  return formats.includes('image2')
    || (!Number.isFinite(duration) && String(stream.nb_frames) === '1')
    ? 'image'
    : 'video';
}

const ratio = (value) => {
  const [top, bottom] = String(value ?? '0/1').split('/').map(Number);
  return bottom ? top / bottom : 0;
};

export function videoVerdict(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(probe?.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) {
    return {
      valid: false,
      type: 'video',
      errors: ['No decodable timed video stream.'],
      warnings: [],
      metadata: {},
    };
  }
  const warnings = [];
  if (duration > 15) {
    warnings.push({ code: 'video.long', message: 'Duration exceeds 15 seconds.' });
  }
  if (duration < 2) {
    warnings.push({ code: 'video.short', message: 'Duration is under 2 seconds.' });
  }
  if (Number(stream.height) < 1080) {
    warnings.push({ code: 'video.height', message: 'Video height is below 1080 pixels.' });
  }
  return {
    valid: true,
    type: 'video',
    errors: [],
    warnings,
    metadata: {
      width: Number(stream.width),
      height: Number(stream.height),
      duration,
      fps: ratio(stream.avg_frame_rate),
      codec: stream.codec_name,
    },
  };
}

export function imageVerdict(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  if (!stream || !Number(stream.width) || !Number(stream.height)) {
    return {
      valid: false,
      type: 'image',
      errors: ['No decodable image stream.'],
      warnings: [],
      metadata: {},
    };
  }
  const aspect = Number(stream.width) / Number(stream.height);
  const offRatio = Math.abs(aspect - 16 / 9) / (16 / 9);
  return {
    valid: true,
    type: 'image',
    errors: [],
    warnings: offRatio > 0.05
      ? [{ code: 'image.aspect', message: 'Image is more than 5% away from 16:9.' }]
      : [],
    metadata: {
      width: Number(stream.width),
      height: Number(stream.height),
      format: stream.codec_name,
    },
  };
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown ffprobe error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown ffprobe error.';
}

function printHuman(verdict, io) {
  const { metadata } = verdict;
  if (verdict.type === 'video') {
    io.log(
      `Valid video: ${metadata.width}x${metadata.height}, `
      + `${metadata.duration}s, ${metadata.fps}fps, ${metadata.codec}`,
    );
  } else {
    io.log(`Valid image: ${metadata.width}x${metadata.height}, ${metadata.format}`);
  }
  verdict.warnings.forEach((warning) => {
    io.log(`Warning [${warning.code}]: ${warning.message}`);
  });
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  runner = execFileAsync,
  exists = fileExists,
) {
  const file = argv.find((value) => !value.startsWith('--'));
  if (!file) {
    io.error('Usage: validate-media <file> [--json]');
    return 1;
  }
  if (!await exists(file)) {
    io.error(`File not found: ${file}`);
    return 1;
  }

  let probe;
  try {
    probe = await runFfprobe(file, runner);
  } catch (error) {
    io.error(`Not decodable: ${firstLine(error)}`);
    return 2;
  }

  const type = detectMediaType(probe);
  if (type === 'unknown') {
    io.error('Not decodable: Unknown media type.');
    return 2;
  }

  const verdict = type === 'image' ? imageVerdict(probe) : videoVerdict(probe);
  if (hasFlag(argv, '--json')) {
    io.log(JSON.stringify(verdict, null, 2));
  } else if (verdict.valid) {
    printHuman(verdict, io);
  } else {
    io.error(`Not decodable: ${verdict.errors[0]}`);
  }
  return verdict.valid ? 0 : 2;
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
