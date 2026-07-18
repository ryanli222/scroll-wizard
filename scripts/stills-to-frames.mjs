#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { isDirect } from './lib/cli.mjs';
import {
  listFilesRecursive,
  pathExists,
  replaceDirectory,
} from './lib/files.mjs';
import { summarizeFrames } from './extract-frames.mjs';
import { imageVerdict, runFfprobe } from './validate-media.mjs';

const execFileAsync = promisify(execFile);
const BEAT_NAME = /^beat-(\d{1,2})\.(png|jpe?g|webp)$/i;

export function planBeats(fileNames) {
  const beats = fileNames
    .map((name) => ({ name, match: BEAT_NAME.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({ index: Number(match[1]), name }))
    .sort((left, right) => left.index - right.index);

  if (beats.length < 2) {
    throw new Error('Need at least 2 beat stills (beat-1, beat-2, ...).');
  }
  for (const [position, beat] of beats.entries()) {
    if (position > 0 && beats[position - 1].index === beat.index) {
      throw new Error('Duplicate beat index: beat-' + beat.index);
    }
    if (beat.index !== position + 1) {
      throw new Error('Beat indices must be contiguous starting at beat-1 (gap found).');
    }
  }
  return beats.map((beat) => beat.name);
}

function bounded(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || parsed < minimum || parsed > maximum) {
    throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return parsed;
}

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? 'Unknown conversion error.';
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown conversion error.';
}

function parseOptions(argv) {
  const projectDir = argv[0];
  if (!projectDir || projectDir.startsWith('--')) {
    throw new Error('A project directory is required.');
  }
  const values = new Map();
  let force = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (!['--width', '--quality'].includes(argument)) {
      throw new Error('Unknown option: ' + argument);
    }
    if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
      throw new Error('Missing value for ' + argument);
    }
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  return {
    force,
    projectDir,
    quality: bounded(values.get('--quality') ?? '80', 'quality', 1, 100),
    width: bounded(values.get('--width') ?? '1600', 'width', 16, 8192),
  };
}

async function inspectFrames(prepared, count, runner) {
  const expected = Array.from({ length: count }, (_value, index) =>
    'frame-' + String(index + 1).padStart(4, '0') + '.webp');
  const files = await listFilesRecursive(prepared);
  if (
    files.length !== expected.length
    || files.some((file, index) => file.path !== expected[index])
  ) {
    throw new Error(
      'Expected exactly ' + count
      + ' contiguous frame files, received ' + files.length + '.',
    );
  }

  const frames = [];
  for (const file of files) {
    const details = await stat(file.absolutePath);
    if (!details.isFile() || details.size <= 0) {
      throw new Error('Every converted frame must be a nonzero file.');
    }
    const verdict = imageVerdict(await runFfprobe(file.absolutePath, runner));
    if (!verdict.valid) {
      throw new Error(verdict.errors[0] ?? 'Converted frame is not a decodable image.');
    }
    frames.push({
      bytes: details.size,
      height: verdict.metadata.height,
      path: file.path,
      width: verdict.metadata.width,
    });
  }
  return frames;
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  runner = execFileAsync,
  fileOperations = {},
) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    io.error(firstLine(error));
    io.error('Usage: stills-to-frames <projectDir> [--width N] [--quality N] [--force]');
    return 1;
  }

  const project = resolve(options.projectDir);
  const keyframesDir = join(project, 'input', 'keyframes');
  const target = join(project, 'frames');
  const prepared = join(
    dirname(target),
    '.' + basename(target) + '.tmp-' + randomUUID(),
  );
  let replacement;
  let summary;

  try {
    if (!await pathExists(keyframesDir)) {
      io.error('No input/keyframes directory in ' + options.projectDir);
      return 1;
    }
    const names = (await readdir(keyframesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const ordered = planBeats(names);

    await mkdir(prepared, { recursive: true });
    for (const [position, name] of ordered.entries()) {
      const output = join(
        prepared,
        'frame-' + String(position + 1).padStart(4, '0') + '.webp',
      );
      await runner('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', join(keyframesDir, name),
        '-vf', 'scale=' + options.width + ':-2:flags=lanczos',
        '-c:v', 'libwebp', '-quality', String(options.quality),
        output,
      ]);
    }

    const frames = await inspectFrames(prepared, ordered.length, runner);
    summary = summarizeFrames(frames, {
      count: frames.length,
      quality: options.quality,
      width: options.width,
    });
    replacement = await replaceDirectory(
      prepared,
      target,
      options.force,
      fileOperations.replacementOperations,
    );
  } catch (error) {
    io.error('Stills-to-frames failed: ' + firstLine(error));
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
        'Warning: frames were replaced, but the old backup could not be removed: '
        + replacement.backupPath + ' (' + firstLine(replacement.cleanupError) + ').',
      );
    } catch {
      // Reporting cannot change the result of an already committed replacement.
    }
  }
  if (summary.overBudget) {
    try {
      io.warn(
        'Warning: converted frames exceed the '
        + Math.round(summary.budgetBytes / 1024 / 1024)
        + ' MiB budget.',
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
