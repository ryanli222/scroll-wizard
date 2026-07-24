#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isDirect, valueAfter } from './lib/cli.mjs';
import { writeJsonAtomic } from './lib/files.mjs';

const BEAT_PROMPT = /^keyframe-beat-(\d{1,2})\.txt$/;
const MIN_CLIP_SECONDS = 2;
const MAX_CLIP_SECONDS = 15;
const ORDINARY_SECONDS = 2;
const HIGH_MOTION_SECONDS = 4;

const USAGE = 'Usage: motion-plan create <projectDir> --max-clip-seconds N';

function beatCost(beat) {
  return beat?.motion === 'high' ? HIGH_MOTION_SECONDS : ORDINARY_SECONDS;
}

export function planMotionClips(beats, maxClipDurationSeconds) {
  if (
    !Number.isFinite(maxClipDurationSeconds)
    || maxClipDurationSeconds < MIN_CLIP_SECONDS
    || maxClipDurationSeconds > MAX_CLIP_SECONDS
  ) {
    throw new Error(
      `maxClipDurationSeconds must be a finite number from ${MIN_CLIP_SECONDS} to ${MAX_CLIP_SECONDS}.`,
    );
  }

  const costs = beats.map((beat, index) => {
    const cost = beatCost(beat);
    if (cost > maxClipDurationSeconds) {
      throw new Error(
        `high-motion beat ${index + 1} needs ${cost}s and cannot fit in one `
        + `${maxClipDurationSeconds}s clip.`,
      );
    }
    return cost;
  });

  const clips = [];
  let clipStart = 0;
  let clipDuration = 0;

  for (let index = 0; index < costs.length; index += 1) {
    const cost = costs[index];
    if (clipDuration > 0 && clipDuration + cost > maxClipDurationSeconds) {
      clips.push({
        index: clips.length + 1,
        durationSeconds: clipDuration,
        beatStart: clipStart + 1,
        beatEnd: index,
      });
      clipStart = index;
      clipDuration = 0;
    }
    clipDuration += cost;
  }

  if (costs.length > 0) {
    clips.push({
      index: clips.length + 1,
      durationSeconds: clipDuration,
      beatStart: clipStart + 1,
      beatEnd: costs.length,
    });
  }

  const continuity = [];
  for (let index = 0; index < clips.length - 1; index += 1) {
    continuity.push({
      fromClip: clips[index].index,
      toClip: clips[index + 1].index,
      handoff: 'last-frame-to-first-frame',
    });
  }

  return {
    maxClipDurationSeconds,
    totalDurationSeconds: costs.reduce((sum, cost) => sum + cost, 0),
    clips,
    continuity,
  };
}

async function readBeatPrompts(projectDir) {
  const promptsDir = join(projectDir, 'prompts');
  let entries;
  try {
    entries = await readdir(promptsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = BEAT_PROMPT.exec(entry.name);
      return match ? { index: Number(match[1]), name: entry.name } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
}

async function readValues(projectDir) {
  const path = join(projectDir, 'values.json');
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('values.json must contain a JSON object.');
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function createMotionPlan(projectDir, maxClipDurationSeconds) {
  const beatPrompts = await readBeatPrompts(projectDir);
  const values = await readValues(projectDir);
  const overlays = Array.isArray(values.overlays) ? values.overlays : [];
  const beats = beatPrompts.map((prompt) => {
    const overlay = overlays[prompt.index - 1];
    return overlay?.motion === undefined ? {} : { motion: overlay.motion };
  });
  const plan = planMotionClips(beats, maxClipDurationSeconds);
  const outputPath = join(projectDir, 'prompts', 'motion-plan.json');
  await writeJsonAtomic(outputPath, plan);
  return plan;
}

function parseArguments(argv) {
  if (argv[0] !== 'create' || !argv[1] || argv[1].startsWith('--')) return null;
  try {
    const maxClipSeconds = Number(valueAfter(argv, '--max-clip-seconds'));
    if (argv.filter((argument) => argument === '--max-clip-seconds').length !== 1) {
      return null;
    }
    for (let index = 2; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '--max-clip-seconds') {
        index += 1;
        continue;
      }
      return null;
    }
    return { projectDir: argv[1], maxClipSeconds };
  } catch {
    return null;
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split(/\r?\n/, 1)[0];
}

export async function main(argv = process.argv.slice(2), io = console) {
  const options = parseArguments(argv);
  if (!options) {
    io.error(USAGE);
    return 1;
  }

  try {
    const plan = await createMotionPlan(options.projectDir, options.maxClipSeconds);
    io.log(JSON.stringify(plan, null, 2));
    return 0;
  } catch (error) {
    io.error('Motion plan failed: ' + firstLine(error));
    return 2;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
