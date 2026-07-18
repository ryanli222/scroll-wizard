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

import { hasFlag, isDirect } from './lib/cli.mjs';
import {
  pathExists,
  replaceDirectory,
  writeJsonAtomic,
} from './lib/files.mjs';
import {
  MID_4G_BYTES_PER_SECOND,
  REQUEST_OVERHEAD_SECONDS,
} from './extract-frames.mjs';
import { runFfprobe, videoVerdict } from './validate-media.mjs';

const execFileAsync = promisify(execFile);
const VALUE_FLAGS = new Set(['--crf', '--width', '--gop', '--poster-at']);

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

function boundedNumber(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function parseReencodeArgs(argv) {
  const positional = [];
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force' || argument === '--all-intra') continue;
    if (argument.startsWith('--')) {
      if (!VALUE_FLAGS.has(argument)) throw new Error('Unknown option: ' + argument);
      if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
        throw new Error('Missing value for ' + argument);
      }
      if (values.has(argument)) throw new Error('Duplicate option: ' + argument);
      values.set(argument, argv[index + 1]);
      index += 1;
      continue;
    }
    positional.push(argument);
  }
  if (positional.length !== 2) {
    throw new Error('Expected an input video and output directory.');
  }
  if (hasFlag(argv, '--all-intra') && values.has('--gop')) {
    throw new Error('--gop and --all-intra cannot be used together.');
  }

  return {
    input: positional[0],
    outDir: positional[1],
    crf: boundedInteger(values.get('--crf') ?? '23', 'crf', 10, 40),
    width: boundedInteger(values.get('--width') ?? '1600', 'width', 16, 8192),
    gop: hasFlag(argv, '--all-intra')
      ? 1
      : boundedInteger(values.get('--gop') ?? '8', 'gop', 1, 120),
    posterAt: boundedNumber(values.get('--poster-at') ?? '0', 'poster-at', 0, 3600),
    force: hasFlag(argv, '--force'),
  };
}

export function buildReencodeArgs(options) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', options.input,
    '-an',
    '-vf', 'scale=' + options.width + ':-2:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(options.crf),
    '-g', String(options.gop), '-keyint_min', String(options.gop), '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    options.output,
  ];
}

export function buildPosterArgs(options) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(options.posterAt),
    '-i', options.input,
    '-frames:v', '1',
    '-vf', 'scale=' + options.width + ':-2:flags=lanczos',
    '-c:v', 'libwebp', '-quality', '82',
    options.output,
  ];
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown re-encode error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown re-encode error.';
}

export async function main(argv = process.argv.slice(2), io = console, runner = execFileAsync) {
  let options;
  try {
    options = parseReencodeArgs(argv);
  } catch (error) {
    if (argv.length > 0) io.error(firstLine(error));
    io.error('Usage: reencode-video <input> <output-dir> [--crf N] [--width N] [--gop N|--all-intra] [--poster-at S] [--force]');
    return 1;
  }

  const target = resolve(options.outDir);
  try {
    if (!await pathExists(options.input)) {
      io.error('Input not found: ' + options.input);
      return 1;
    }
    if (await pathExists(target) && !options.force) {
      io.error('Output already exists; use --force to replace it: ' + target);
      return 1;
    }
  } catch (error) {
    io.error('Could not inspect input or output: ' + firstLine(error));
    return 1;
  }

  const parent = dirname(target);
  const prepared = join(parent, '.' + basename(target) + '.tmp-' + randomUUID());
  let replacement;
  let summary;
  try {
    const inputVerdict = videoVerdict(await runFfprobe(options.input, runner));
    if (!inputVerdict.valid) {
      io.error('Invalid video: ' + inputVerdict.errors[0]);
      return 2;
    }

    await mkdir(parent, { recursive: true });
    await mkdir(prepared);
    const videoOut = join(prepared, 'video.mp4');
    const posterOut = join(prepared, 'poster.webp');
    await runner('ffmpeg', buildReencodeArgs({ ...options, output: videoOut }));
    await runner('ffmpeg', buildPosterArgs({ ...options, output: posterOut }));

    const outputVerdict = videoVerdict(await runFfprobe(videoOut, runner));
    if (!outputVerdict.valid) {
      throw new Error('Re-encoded video failed validation: ' + outputVerdict.errors[0]);
    }
    const { duration, width, height } = outputVerdict.metadata;
    await writeJsonAtomic(join(prepared, 'media.json'), {
      duration,
      width,
      height,
      crf: options.crf,
      gop: options.gop,
    });

    const [videoStat, posterStat] = await Promise.all([stat(videoOut), stat(posterOut)]);
    if (!videoStat.isFile() || videoStat.size <= 0) {
      throw new Error('Re-encoded video must be a nonzero file.');
    }
    if (!posterStat.isFile() || posterStat.size <= 0) {
      throw new Error('Poster must be a nonzero file.');
    }
    summary = {
      videoBytes: videoStat.size,
      posterBytes: posterStat.size,
      duration,
      width,
      height,
      estimatedSeconds: Number(((videoStat.size + posterStat.size)
        / MID_4G_BYTES_PER_SECOND + REQUEST_OVERHEAD_SECONDS).toFixed(2)),
    };

    replacement = await replaceDirectory(prepared, target, options.force);
  } catch (error) {
    io.error('Re-encode failed: ' + firstLine(error));
    return 2;
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }

  try {
    io.log(JSON.stringify(summary, null, 2));
  } catch {
    // Reporting cannot change the result of an already committed replacement.
  }
  if (replacement.cleanupError) {
    try {
      io.warn(
        'Warning: media was replaced, but the old backup could not be removed: '
        + replacement.backupPath + ' (' + firstLine(replacement.cleanupError) + ').',
      );
    } catch {
      // Reporting cannot change the result of an already committed replacement.
    }
  }
  return 0;
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
