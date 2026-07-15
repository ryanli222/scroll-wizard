#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rm,
  stat,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { promisify } from 'node:util';
import { hasFlag, isDirect, valueAfter } from './lib/cli.mjs';
import {
  directoryNonEmpty,
  listFilesRecursive,
  pathExists,
  replaceDirectory,
} from './lib/files.mjs';
import { runFfprobe, videoVerdict } from './validate-media.mjs';

const execFileAsync = promisify(execFile);

export const MID_4G_BYTES_PER_SECOND = 500_000;
export const REQUEST_OVERHEAD_SECONDS = 0.15;

const VALUE_FLAGS = new Set(['--count', '--width', '--format', '--quality']);

function boundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function parseExtractArgs(argv) {
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') continue;
    if (argument.startsWith('--')) {
      if (!VALUE_FLAGS.has(argument)) {
        throw new Error(`Unknown option: ${argument}`);
      }
      if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;
      continue;
    }
    positional.push(argument);
  }
  if (positional.length !== 2) {
    throw new Error('Expected an input video and output directory.');
  }

  const format = valueAfter(argv, '--format', 'webp');
  if (!['webp', 'jpg'].includes(format)) {
    throw new Error('format must be webp or jpg.');
  }

  return {
    input: positional[0],
    outDir: positional[1],
    count: boundedInteger(valueAfter(argv, '--count', '150'), 'count', 1, 9999),
    width: boundedInteger(valueAfter(argv, '--width', '1600'), 'width', 16, 8192),
    format,
    quality: boundedInteger(valueAfter(argv, '--quality', '80'), 'quality', 1, 100),
    force: hasFlag(argv, '--force'),
  };
}

export function framePlan(duration, count) {
  return Array.from({ length: count }, (_value, index) =>
    (index + 0.5) * duration / count);
}

export function buildFfmpegArgs(options) {
  const half = options.duration / options.count / 2;
  const filter = [
    'fps=' + options.count + '/' + options.duration + ':start_time=0:round=near',
    'scale=' + options.width + ':-2:flags=lanczos',
  ].join(',');
  const encoder = options.format === 'webp'
    ? ['-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6',
      '-quality', String(options.quality)]
    : ['-q:v', String(Math.max(2, Math.round(31 - options.quality * 0.29)))];
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(half),
    '-i', options.input,
    '-an',
    '-vf', filter,
    '-frames:v', String(options.count),
    ...encoder,
    options.outputPattern,
  ];
}

export function summarizeFrames(frames, preset) {
  const totalBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
  const mobile = preset.count <= 100 && preset.width <= 1280 && preset.quality <= 75;
  return {
    count: frames.length,
    width: frames[0]?.width ?? preset.width,
    height: frames[0]?.height,
    totalBytes,
    averageBytes: frames.length ? Math.round(totalBytes / frames.length) : 0,
    budgetBytes: (mobile ? 6 : 12) * 1024 * 1024,
    overBudget: totalBytes > (mobile ? 6 : 12) * 1024 * 1024,
    estimatedSeconds: Number(
      (totalBytes / MID_4G_BYTES_PER_SECOND + REQUEST_OVERHEAD_SECONDS).toFixed(2),
    ),
  };
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown extraction error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown extraction error.';
}

async function inspectOutputFrames(prepared, options, runner) {
  const extension = options.format === 'jpg' ? 'jpg' : 'webp';
  const expected = Array.from({ length: options.count }, (_value, index) =>
    'frame-' + String(index + 1).padStart(4, '0') + '.' + extension);
  const files = await listFilesRecursive(prepared);
  if (
    files.length !== expected.length
    || files.some((file, index) => file.path !== expected[index])
  ) {
    throw new Error(
      'Expected exactly ' + options.count
      + ' contiguous frame files, received ' + files.length + '.',
    );
  }

  const sizes = await Promise.all(files.map((file) => stat(file.absolutePath)));
  if (sizes.some((item) => !item.isFile() || item.size <= 0)) {
    throw new Error('Every extracted frame must be a nonzero file.');
  }

  const probe = await runFfprobe(files[0].absolutePath, runner);
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (
    !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0
  ) {
    throw new Error('Could not determine extracted frame dimensions.');
  }

  return files.map((file, index) => ({
    path: file.path,
    bytes: sizes[index].size,
    width,
    height,
  }));
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  runner = execFileAsync,
) {
  let options;
  try {
    options = parseExtractArgs(argv);
  } catch (error) {
    if (argv.length > 0) io.error(firstLine(error));
    io.error('Usage: extract-frames <input> <output-dir> [options]');
    return 1;
  }

  const target = resolve(options.outDir);
  let targetExists;
  try {
    if (!await pathExists(options.input)) {
      io.error('Input not found: ' + options.input);
      return 1;
    }
    targetExists = await pathExists(target);
    if (targetExists && !options.force && await directoryNonEmpty(target)) {
      io.error('Output is not empty; use --force to replace it: ' + options.outDir);
      return 1;
    }
  } catch (error) {
    io.error('Could not inspect input or output: ' + firstLine(error));
    return 1;
  }

  let verdict;
  try {
    verdict = videoVerdict(await runFfprobe(options.input, runner));
  } catch (error) {
    io.error('Could not probe input video: ' + firstLine(error));
    return 2;
  }
  if (!verdict.valid) {
    io.error('Invalid video: ' + verdict.errors[0]);
    return 2;
  }

  const parent = dirname(target);
  const prepared = join(
    parent,
    '.' + basename(target) + '.tmp-' + randomUUID(),
  );
  try {
    await mkdir(parent, { recursive: true });
    await mkdir(prepared);
    const extension = options.format === 'jpg' ? 'jpg' : 'webp';
    const outputPattern = join(prepared, 'frame-%04d.' + extension);
    await runner('ffmpeg', buildFfmpegArgs({
      ...options,
      outputPattern,
      duration: verdict.metadata.duration,
    }));

    const frames = await inspectOutputFrames(prepared, options, runner);
    const summary = summarizeFrames(frames, options);
    await replaceDirectory(
      prepared,
      target,
      options.force || targetExists,
    );

    io.log(JSON.stringify(summary, null, 2));
    if (summary.overBudget) {
      io.warn(
        'Warning: extracted frames exceed the '
        + Math.round(summary.budgetBytes / 1024 / 1024)
        + ' MiB budget.',
      );
    }
    return 0;
  } catch (error) {
    io.error('Extraction failed: ' + firstLine(error));
    return 2;
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
