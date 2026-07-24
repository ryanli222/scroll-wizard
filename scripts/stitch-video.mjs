#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { isDirect } from './lib/cli.mjs';
import { pathExists } from './lib/files.mjs';
import { runFfprobe, videoVerdict } from './validate-media.mjs';

const execFileAsync = promisify(execFile);
const CLIP_NAME = /^clip-(\d{2})\.mp4$/;
const USAGE = 'Usage: stitch-video <projectDir>';

function firstLine(error) {
  const detail = error?.stderr ?? error?.message ?? String(error);
  return String(detail).split(/\r?\n/, 1)[0].trim() || 'Unknown stitch error.';
}

async function readMotionPlan(projectDir) {
  const planPath = join(projectDir, 'prompts', 'motion-plan.json');
  const value = JSON.parse(await readFile(planPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('prompts/motion-plan.json must contain a JSON object.');
  }
  if (!Array.isArray(value.clips) || value.clips.length === 0) {
    throw new Error('prompts/motion-plan.json must contain at least one clip.');
  }
  return value;
}

function clipFileName(index) {
  return `clip-${String(index).padStart(2, '0')}.mp4`;
}

async function verifyExpectedClips(projectDir, plan) {
  const clipsDir = join(projectDir, 'input', 'clips');
  const entries = await readdir(clipsDir, { withFileTypes: true });
  const numberedClips = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = CLIP_NAME.exec(entry.name);
      return match ? Number(match[1]) : null;
    })
    .filter((index) => index !== null)
    .sort((left, right) => left - right);

  const expected = plan.clips.map((clip) => clip.index).sort((left, right) => left - right);
  const missing = expected.find((index) => !numberedClips.includes(index));
  if (missing !== undefined) {
    throw new Error(`Missing required stitched clip: input/clips/${clipFileName(missing)}`);
  }
  const extra = numberedClips.find((index) => !expected.includes(index));
  if (extra !== undefined) {
    throw new Error(`Unexpected stitched clip: input/clips/${clipFileName(extra)}`);
  }

  return expected.map((index) => join(clipsDir, clipFileName(index)));
}

function concatLine(path) {
  return `file '${path.replaceAll("'", "'\\''").replaceAll('\\', '/')}'\n`;
}

async function replaceFileAtomic(preparedPath, targetPath) {
  if (!await pathExists(targetPath)) {
    await rename(preparedPath, targetPath);
    return;
  }

  const backupPath = targetPath + '.backup-' + randomUUID();
  await rename(targetPath, backupPath);
  try {
    await rename(preparedPath, targetPath);
  } catch (error) {
    try {
      await rename(backupPath, targetPath);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        firstLine(error) + '; existing video restoration failed: ' + firstLine(restoreError),
      );
    }
    throw error;
  }
  await rm(backupPath, { force: true });
}

export async function stitchVideo(projectDir, runner = execFileAsync) {
  const plan = await readMotionPlan(projectDir);
  const clips = await verifyExpectedClips(projectDir, plan);
  const tempDir = join(projectDir, '.tmp', 'stitch-video-' + randomUUID());
  const manifestPath = join(tempDir, 'concat.txt');
  const preparedVideoPath = join(tempDir, 'video.mp4');
  const finalVideoPath = join(projectDir, 'input', 'video.mp4');

  await mkdir(tempDir, { recursive: true });
  try {
    await writeFile(
      manifestPath,
      clips.map(concatLine).join(''),
      'utf8',
    );
    await runner('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', manifestPath,
      '-c', 'copy',
      preparedVideoPath,
    ]);

    const verdict = videoVerdict(await runFfprobe(preparedVideoPath, runner));
    if (!verdict.valid) {
      throw new Error('Stitched video failed validation: ' + verdict.errors[0]);
    }

    await mkdir(join(projectDir, 'input'), { recursive: true });
    await replaceFileAtomic(preparedVideoPath, finalVideoPath);
    return { outputPath: finalVideoPath };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2), io = console, runner = execFileAsync) {
  const projectDir = argv[0];
  if (!projectDir || argv.length !== 1 || projectDir.startsWith('--')) {
    io.error(USAGE);
    return 1;
  }

  try {
    const result = await stitchVideo(projectDir, runner);
    io.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.error('Stitch failed: ' + firstLine(error));
    return 2;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
