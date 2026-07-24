import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { stitchVideo } from '../../scripts/stitch-video.mjs';

async function temporaryProject() {
  return mkdtemp(join(tmpdir(), 'scroll-wizard-stitch-'));
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function createProjectWithPlan() {
  const projectDir = await temporaryProject();
  await mkdir(join(projectDir, 'prompts'), { recursive: true });
  await mkdir(join(projectDir, 'input', 'clips'), { recursive: true });
  await writeJson(join(projectDir, 'prompts', 'motion-plan.json'), {
    maxClipDurationSeconds: 6,
    totalDurationSeconds: 8,
    clips: [
      { index: 1, durationSeconds: 6, beatStart: 1, beatEnd: 2 },
      { index: 2, durationSeconds: 2, beatStart: 3, beatEnd: 3 },
    ],
    continuity: [{ fromClip: 1, toClip: 2, handoff: 'last-frame-to-first-frame' }],
  });
  return projectDir;
}

function validProbe(duration = 8) {
  return {
    streams: [{
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '24/1',
      nb_frames: '192',
    }],
    format: {
      duration: String(duration),
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    },
  };
}

describe('stitchVideo', () => {
  it('fails before ffmpeg when a required numbered clip is missing', async () => {
    const projectDir = await createProjectWithPlan();
    await writeFile(join(projectDir, 'input', 'clips', 'clip-01.mp4'), 'clip 1');
    const runner = vi.fn();

    await expect(stitchVideo(projectDir, runner)).rejects.toThrow(/clip-02\.mp4/i);
    expect(runner).not.toHaveBeenCalled();
  });

  it('fails before ffmpeg when an extra numbered clip is present', async () => {
    const projectDir = await createProjectWithPlan();
    await writeFile(join(projectDir, 'input', 'clips', 'clip-01.mp4'), 'clip 1');
    await writeFile(join(projectDir, 'input', 'clips', 'clip-02.mp4'), 'clip 2');
    await writeFile(join(projectDir, 'input', 'clips', 'clip-03.mp4'), 'clip 3');
    const runner = vi.fn();

    await expect(stitchVideo(projectDir, runner)).rejects.toThrow(/clip-03\.mp4/i);
    expect(runner).not.toHaveBeenCalled();
  });

  it('uses ffmpeg concat copy, validates output, and replaces input/video.mp4', async () => {
    const projectDir = await createProjectWithPlan();
    const clipsDir = join(projectDir, 'input', 'clips');
    const finalVideoPath = join(projectDir, 'input', 'video.mp4');
    await writeFile(join(clipsDir, 'clip-01.mp4'), 'clip 1');
    await writeFile(join(clipsDir, 'clip-02.mp4'), 'clip 2');
    await writeFile(finalVideoPath, 'old video');

    const calls = [];
    let manifestBody = '';
    const runner = vi.fn(async (command, args) => {
      calls.push({ command, args });
      if (command === 'ffmpeg') {
        manifestBody = await readFile(args[args.indexOf('-i') + 1], 'utf8');
        await writeFile(args.at(-1), 'stitched video');
        return { stdout: '', stderr: '' };
      }
      if (command === 'ffprobe') {
        return { stdout: JSON.stringify(validProbe()), stderr: '' };
      }
      throw new Error('Unexpected command: ' + command);
    });

    const result = await stitchVideo(projectDir, runner);

    expect(result).toEqual({ outputPath: finalVideoPath });
    expect(await readFile(finalVideoPath, 'utf8')).toBe('stitched video');
    expect(await readFile(join(clipsDir, 'clip-01.mp4'), 'utf8')).toBe('clip 1');
    expect(await readFile(join(clipsDir, 'clip-02.mp4'), 'utf8')).toBe('clip 2');

    const ffmpegCall = calls.find(({ command }) => command === 'ffmpeg');
    expect(ffmpegCall.args).toEqual(expect.arrayContaining([
      '-f', 'concat',
      '-safe', '0',
      '-c', 'copy',
    ]));
    const manifestPath = ffmpegCall.args[ffmpegCall.args.indexOf('-i') + 1];
    expect(manifestPath.startsWith(projectDir)).toBe(true);
    expect(manifestBody).toContain("file '");
    expect(manifestBody).toContain('clip-01.mp4');
    expect(manifestBody).toContain('clip-02.mp4');
    expect(ffmpegCall.args.at(-1)).not.toBe(finalVideoPath);
    expect(calls.map(({ command }) => command)).toEqual(['ffmpeg', 'ffprobe']);
  });
});
