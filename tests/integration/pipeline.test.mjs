import { spawn, spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const repo = (relativePath) => join(repoRoot, relativePath);

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

async function pathMissing(path) {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe.skipIf(!hasFfmpeg)('ffmpeg pipeline', () => {
  it('runs the complete generated-video pipeline end to end', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scroll-wizard-pipeline-'));
    temporaryRoots.push(projectDir);

    // Step 1 (plan): initialize the project and persist the brief and the
    // chosen visual reference. A generated-video project has no keyframes,
    // so the video itself is the visual reference; a video prompt makes the
    // keyframes gate self-skip.
    await mkdir(join(projectDir, 'input'), { recursive: true });
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await writeFile(join(projectDir, 'brief.md'), '# Aster\n');
    await writeFile(join(projectDir, 'prompts', 'video.txt'), 'One continuous shot.');

    const fixture = join(projectDir, 'input', 'video.mp4');
    const generated = await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=2:size=320x240:rate=15',
      '-c:v', 'mpeg4',
      fixture,
    ], projectDir);
    expect(generated.code).toBe(0);

    // Step 2 (plan): obtain explicit approval for the brief and the
    // selected video before touching extraction.
    for (const gate of ['brief', 'video']) {
      const approved = await run(process.execPath, [
        repo('scripts/status.mjs'), projectDir, '--approve', gate,
      ], projectDir);
      expect(approved.code).toBe(0);
    }

    // Step 3 (plan): validate the video, calculate the frame plan, and
    // extract into project/frames/.
    const valid = await run(process.execPath, [
      repo('scripts/validate-media.mjs'), fixture, '--json',
    ], projectDir);
    expect(valid.code).toBe(0);
    expect(JSON.parse(valid.stdout).warnings.map((item) => item.code))
      .toContain('video.height');

    await writeFile(join(projectDir, 'fake.mp4'), '<html>not video</html>');
    const invalid = await run(process.execPath, [
      repo('scripts/validate-media.mjs'), join(projectDir, 'fake.mp4'),
    ], projectDir);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toMatch(/Not decodable/);

    const extracted = await run(process.execPath, [
      repo('scripts/extract-frames.mjs'),
      fixture,
      join(projectDir, 'frames'),
      '--count', '24',
      '--width', '320',
      '--format', 'webp',
    ], projectDir);
    expect(extracted.code).toBe(0);
    expect(await readdir(join(projectDir, 'frames'))).toHaveLength(24);

    // Step 4 (plan): persist holds and posterIndex (alongside the rest of
    // the creative values), then approve extraction.
    await writeFile(join(projectDir, 'values.json'), JSON.stringify({
      brand: {
        name: 'Aster',
        tagline: 'Light in motion',
        imageAlt: 'Aster test pattern in motion',
      },
      theme: {
        bg: '#000000',
        text: '#ffffff',
        accent: '#dfff57',
        surface: 'rgba(0,0,0,0.8)',
        radius: 8,
        fonts: { display: 'serif', body: 'sans-serif' },
      },
      scrub: { heightVh: 300, smoothing: 0.12 },
      overlays: [{ at: [0.2, 0.4], title: 'Test', hold: true }],
      outro: { headline: 'Done', body: 'Complete' },
      posterIndex: 12,
    }, null, 2));

    expect((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--approve', 'extraction',
    ], projectDir)).code).toBe(0);

    // Step 5 (plan): derive/persist theme tokens (already captured above in
    // values.json) and approve them. Brief, video, extraction, and theme
    // must all be approved before the first scaffold.
    expect((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--approve', 'theme',
    ], projectDir)).code).toBe(0);

    // Step 6 (plan): transactionally scaffold, moving project/frames into
    // site/frames while preserving the extraction hash.
    const scaffolded = await run(process.execPath, [
      repo('scripts/scaffold-site.mjs'),
      projectDir,
      '--config', join(projectDir, 'values.json'),
    ], projectDir);
    expect(scaffolded.code).toBe(0);
    expect(await pathMissing(join(projectDir, 'frames'))).toBe(true);
    expect(await readdir(join(projectDir, 'site', 'frames'))).toHaveLength(24);
    const builtConfig = JSON.parse(
      await readFile(join(projectDir, 'site', 'config.json'), 'utf8'),
    );
    expect(builtConfig.frames).toMatchObject({
      count: 24,
      pattern: 'frames/frame-{index:4}.webp',
      poster: 'frames/frame-0012.webp',
    });

    // Verify approvals survive the physical frame move: entries normalize
    // to frames/<name> whether files live at project/frames or site/frames,
    // so extraction stays approved after scaffold relocates them.
    const afterMove = JSON.parse((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--json',
    ], projectDir)).stdout);
    expect(afterMove.unapproved).not.toContain('extraction');

    // Step 7 (plan): browser smoke checks over the complete site inventory
    // live in the separate Playwright suite (tests/browser, run via
    // `npm run test:browser`); here, close the pipeline with preview
    // approval, which itself covers the full site inventory.
    expect((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--approve', 'preview',
    ], projectDir)).code).toBe(0);
    const done = JSON.parse((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--json',
    ], projectDir)).stdout);
    expect(done).toMatchObject({ resumeStep: 9, unapproved: [] });

    // Staleness and wholesale format replacement: touching the source video
    // must flag extraction as stale, and re-extracting/re-scaffolding with
    // a different format and count must fully replace the frame set.
    const future = new Date(Date.now() + 5_000);
    await utimes(fixture, future, future);
    const stale = JSON.parse((await run(process.execPath, [
      repo('scripts/status.mjs'), projectDir, '--json',
    ], projectDir)).stdout);
    expect(stale.staleness).toContain('extraction');

    expect((await run(process.execPath, [
      repo('scripts/extract-frames.mjs'),
      fixture,
      join(projectDir, 'frames'),
      '--count', '12',
      '--width', '320',
      '--format', 'jpg',
    ], projectDir)).code).toBe(0);
    expect((await run(process.execPath, [
      repo('scripts/scaffold-site.mjs'),
      projectDir,
      '--config', join(projectDir, 'values.json'),
      '--force',
    ], projectDir)).code).toBe(0);

    const finalNames = await readdir(join(projectDir, 'site', 'frames'));
    expect(finalNames).toHaveLength(12);
    expect(finalNames.every((name) => name.endsWith('.jpg'))).toBe(true);
  });
});
