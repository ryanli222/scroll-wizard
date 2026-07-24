import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  sha256File,
  sha256Text,
} from '../../scripts/lib/files.mjs';
import {
  GATES,
  approveGate,
  buildGateManifest,
  buildInventory,
  main,
  manifestHash,
  resolveResume,
  valuesProjection,
} from '../../scripts/status.mjs';

const hash = (letter) => letter.repeat(64);

async function temporaryProject(prefix = 'scroll-wizard-status-') {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function writeMotionPlan(projectDir, maxClipDurationSeconds = 6) {
  await writeJson(join(projectDir, 'prompts', 'motion-plan.json'), {
    maxClipDurationSeconds,
    totalDurationSeconds: 8,
    clips: [
      { index: 1, durationSeconds: 6, beatStart: 1, beatEnd: 2 },
      { index: 2, durationSeconds: 2, beatStart: 3, beatEnd: 3 },
    ],
    continuity: [{ fromClip: 1, toClip: 2, handoff: 'last-frame-to-first-frame' }],
  });
}

async function createCompleteProject({ keyframes = true } = {}) {
  const projectDir = await temporaryProject();
  await mkdir(join(projectDir, 'prompts'), { recursive: true });
  await mkdir(join(projectDir, 'input', 'keyframes'), { recursive: true });
  await mkdir(join(projectDir, 'site', 'frames'), { recursive: true });
  await mkdir(join(projectDir, 'site', 'assets'), { recursive: true });
  await writeFile(join(projectDir, 'brief.md'), '# Test brief\n');
  if (keyframes) {
    await writeFile(
      join(projectDir, 'prompts', 'keyframe-first.txt'),
      'First frame prompt\n',
    );
    await writeFile(join(projectDir, 'input', 'keyframes', 'first.png'), 'image');
  }
  await writeFile(join(projectDir, 'prompts', 'video.txt'), 'Video prompt\n');
  await writeMotionPlan(projectDir);
  await writeFile(join(projectDir, 'input', 'video.mp4'), 'video');
  await writeJson(join(projectDir, 'values.json'), {
    brand: { name: 'Aster' },
    overlays: [{ at: [0.2, 0.4], hold: true }],
    posterIndex: 1,
    theme: { bg: '#000000', text: '#ffffff' },
  });
  await writeFile(join(projectDir, 'site', 'frames', 'frame-0001.webp'), 'frame');
  await writeFile(join(projectDir, 'site', 'assets', 'runtime.js'), 'export {};\n');
  await writeFile(join(projectDir, 'site', 'style.css'), 'body {}\n');
  await writeJson(join(projectDir, 'site', 'config.json'), { frames: { count: 1 } });
  return projectDir;
}

function fakeIo() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function noFollowInspection(...blockedRoots) {
  const blocked = new Set(blockedRoots);
  return async (path) => {
    if (blocked.has(path)) {
      return {
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        mtimeMs: 0,
      };
    }
    return lstat(path);
  };
}

function completeInventory(overrides = {}) {
  const directed = overrides.directed ?? false;
  const manifests = Object.fromEntries(
    GATES.map((gate, index) => [gate, hash(String.fromCharCode(97 + index))]),
  );
  const chain = directed ? GATES : GATES.filter((gate) => gate !== 'inspiration');
  let basedOn = null;
  const receipts = {};
  for (const gate of chain) {
    receipts[gate] = { manifestHash: manifests[gate], basedOn };
    basedOn = manifests[gate];
  }
  return {
    manifests,
    receipts,
    incomplete: [],
    stale: [],
    keyframePromptCount: 1,
    beatPromptCount: 1,
    videoPromptExists: true,
    videoFileExists: true,
    videoEnabled: true,
    directed,
    ...overrides,
  };
}

describe('status inventory resolution', () => {
  it('inserts inspiration as the second gate', () => {
    expect(GATES).toEqual([
      'brief', 'inspiration', 'storyboard', 'motion-plan', 'stills-preview',
      'video', 'extraction', 'theme', 'preview',
    ]);
  });

  it('projects the inspiration decision and its approved references', () => {
    const values = {
      register: 'product', archetype: undefined, direction: 'minimal',
      inspiration: { bucket: 'product', approvedRefs: ['https://explanideo.com'] },
    };
    expect(valuesProjection(values, 'inspiration')).toEqual({
      register: 'product', archetype: null, direction: 'minimal',
      bucket: 'product', approvedRefs: ['https://explanideo.com'],
    });
    expect(valuesProjection({}, 'inspiration')).toEqual({
      register: null, archetype: null, direction: null, bucket: null, approvedRefs: [],
    });
  });

  it('keeps extraction approval stable when theme and unrelated copy are added', () => {
    const before = {
      posterIndex: 12,
      overlays: [
        { at: [0.2, 0.4], hold: true, title: 'Pause here' },
        { at: [0.6, 0.7], title: 'Keep moving' },
      ],
      brand: { name: 'Before' },
    };
    const after = {
      ...before,
      brand: { name: 'After' },
      theme: { bg: '#000000' },
    };

    expect(valuesProjection(before, 'extraction')).toEqual({
      holds: [{ at: [0.2, 0.4] }],
      posterIndex: 12,
    });
    expect(valuesProjection(before, 'extraction'))
      .toEqual(valuesProjection(after, 'extraction'));
    expect(valuesProjection(after, 'theme')).toEqual({ bg: '#000000' });
  });

  it('uses the default extraction poster and rejects unsupported projections', () => {
    expect(valuesProjection({}, 'extraction')).toEqual({
      holds: [],
      posterIndex: 1,
    });
    expect(() => valuesProjection({}, 'preview')).toThrow(
      'No values projection for gate: preview',
    );
  });

  it('canonicalizes manifest entry order and ignores non-manifest fields', () => {
    expect(manifestHash([
      { path: 'b', sha256: hash('b'), mtimeMs: 200 },
      { path: 'a', sha256: hash('a'), mtimeMs: 100 },
    ])).toBe(manifestHash([
      { path: 'a', sha256: hash('a') },
      { path: 'b', sha256: hash('b') },
    ]));
  });

  it('orders mixed-case and Unicode paths by code point', () => {
    const entries = [
      { path: '😀', sha256: hash('e') },
      { path: 'é', sha256: hash('d') },
      { path: 'a', sha256: hash('b') },
      { path: 'Z', sha256: hash('a') },
      { path: 'Å', sha256: hash('c') },
    ];
    const expected = [
      entries[3],
      entries[2],
      entries[4],
      entries[1],
      entries[0],
    ];

    expect(manifestHash(entries)).toBe(
      sha256Text(canonicalJson(expected)),
    );
  });

  it('reports a fully approved fresh chain as complete', () => {
    expect(resolveResume(completeInventory())).toEqual({
      resumeStep: 10,
      staleness: [],
      incomplete: [],
      unapproved: [],
    });
  });

  it('invalidates the entire descendant chain after brief changes', () => {
    const inventory = completeInventory();
    inventory.manifests.brief = hash('z');

    expect(resolveResume(inventory)).toEqual({
      resumeStep: 1,
      staleness: [],
      incomplete: [],
      unapproved: [
        'brief', 'storyboard', 'motion-plan', 'stills-preview', 'video',
        'extraction', 'theme', 'preview',
      ],
    });
  });

  it('marks a missing receipt and every chained descendant unapproved', () => {
    const inventory = completeInventory();
    delete inventory.receipts.extraction;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 7,
      unapproved: ['extraction', 'theme', 'preview'],
    });
  });

  it('keeps an earlier broken receipt ahead of a later missing artifact', () => {
    const inventory = completeInventory();
    inventory.manifests.brief = hash('z');
    inventory.manifests.preview = null;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 1,
      unapproved: [
        'brief', 'storyboard', 'motion-plan', 'stills-preview', 'video',
        'extraction', 'theme', 'preview',
      ],
    });
  });

  it('returns stale video before a missing preview receipt while reporting both', () => {
    const inventory = completeInventory({ stale: ['video'] });
    delete inventory.receipts.preview;

    expect(resolveResume(inventory)).toEqual({
      resumeStep: 6,
      staleness: ['video'],
      incomplete: [],
      unapproved: ['preview'],
    });
  });

  it('takes the earliest step across incomplete, stale, and unapproved signals', () => {
    const inventory = completeInventory({
      incomplete: ['storyboard'],
      stale: ['extraction'],
    });
    delete inventory.receipts.preview;

    expect(resolveResume(inventory)).toEqual({
      resumeStep: 3,
      staleness: ['extraction'],
      incomplete: ['storyboard'],
      unapproved: ['preview'],
    });
  });

  it('invalidates every descendant after a missing manifest without truncation', () => {
    const inventory = completeInventory();
    inventory.manifests.video = null;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 6,
      unapproved: ['video', 'extraction', 'theme', 'preview'],
    });
  });

  it('resumes at missing keyframes before a video prompt establishes the skip', () => {
    const inventory = completeInventory({
      keyframePromptCount: 0,
      beatPromptCount: 0,
      videoPromptExists: false,
      videoFileExists: false,
    });
    inventory.manifests.storyboard = null;
    delete inventory.receipts.storyboard;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 3,
      unapproved: [
        'storyboard', 'motion-plan', 'stills-preview', 'video',
        'extraction', 'theme', 'preview',
      ],
    });
  });

  it('requires motion-plan when storyboard is skipped in video mode', () => {
    const inventory = completeInventory({ keyframePromptCount: 0, beatPromptCount: 0 });
    inventory.manifests.storyboard = null;
    delete inventory.receipts.storyboard;
    inventory.manifests['motion-plan'] = null;
    delete inventory.receipts['motion-plan'];

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 4,
      unapproved: ['motion-plan', 'video', 'extraction', 'theme', 'preview'],
    });
  });

  it('links video through motion-plan when keyframes are skipped', () => {
    const inventory = completeInventory({ keyframePromptCount: 0, beatPromptCount: 0 });
    inventory.manifests.storyboard = null;
    delete inventory.receipts.storyboard;
    inventory.receipts['motion-plan'].basedOn = inventory.manifests.brief;
    inventory.receipts.video.basedOn = inventory.manifests['motion-plan'];

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 10,
      unapproved: [],
    });
  });

  it('returns incomplete and staleness details with their earliest resume step', () => {
    expect(resolveResume(completeInventory({
      incomplete: ['storyboard'],
    }))).toMatchObject({
      resumeStep: 3,
      incomplete: ['storyboard'],
    });

    expect(resolveResume(completeInventory({
      stale: ['video', 'extraction', 'site'],
    }))).toMatchObject({
      resumeStep: 6,
      staleness: ['video', 'extraction', 'site'],
    });
  });
});

describe('gate manifests', () => {
  it('normalizes extraction frames across scaffold movement and isolates its values', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'frames', 'nested'), { recursive: true });
    await writeFile(join(projectDir, 'frames', 'nested', 'frame-0001.webp'), 'frame');
    const valuesPath = join(projectDir, 'values.json');
    await writeJson(valuesPath, {
      brand: { name: 'Before' },
      overlays: [{ at: [0.25, 0.5], hold: true, title: 'Hold' }],
      posterIndex: 1,
      theme: { bg: '#000000' },
    });

    const before = await buildGateManifest(projectDir, 'extraction');
    expect(before.map(({ path }) => path)).toEqual([
      'frames/nested/frame-0001.webp',
      'values.json#extraction',
    ]);

    await mkdir(join(projectDir, 'site'), { recursive: true });
    await rename(join(projectDir, 'frames'), join(projectDir, 'site', 'frames'));
    expect(manifestHash(await buildGateManifest(projectDir, 'extraction')))
      .toBe(manifestHash(before));

    await writeJson(valuesPath, {
      brand: { name: 'After' },
      overlays: [{ at: [0.25, 0.5], hold: true, title: 'Different copy' }],
      posterIndex: 1,
      theme: { bg: '#ffffff' },
    });
    expect(manifestHash(await buildGateManifest(projectDir, 'extraction')))
      .toBe(manifestHash(before));

    await writeJson(valuesPath, {
      overlays: [{ at: [0.3, 0.5], hold: true }],
      posterIndex: 1,
      theme: { bg: '#ffffff' },
    });
    expect(manifestHash(await buildGateManifest(projectDir, 'extraction')))
      .not.toBe(manifestHash(before));
  });

  it('uses project frames exclusively when both frame roots are populated', async () => {
    const projectDir = await createCompleteProject({ keyframes: false });
    const projectFrames = join(projectDir, 'frames');
    const projectFrame = join(projectFrames, 'frame-0001.webp');
    const siteFrame = join(projectDir, 'site', 'frames', 'frame-0001.webp');
    await mkdir(projectFrames);
    await writeFile(projectFrame, 'project frame');

    const manifest = await buildGateManifest(projectDir, 'extraction');
    expect(manifest.map(({ path }) => path)).toEqual([
      'frames/frame-0001.webp',
      'values.json#extraction',
    ]);
    expect(manifest[0].sha256).toBe(await sha256File(projectFrame));
    expect(manifest[0].sha256).not.toBe(await sha256File(siteFrame));
  });

  it('hashes all regular preview files recursively under site', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'site', 'frames'), { recursive: true });
    await mkdir(join(projectDir, 'site', 'fonts'), { recursive: true });
    await writeFile(join(projectDir, 'site', 'index.html'), '<main></main>');
    await writeFile(join(projectDir, 'site', 'frames', 'frame.webp'), 'frame');
    await writeFile(join(projectDir, 'site', 'fonts', 'display.woff2'), 'font');

    expect((await buildGateManifest(projectDir, 'preview')).map(({ path }) => path))
      .toEqual([
        'site/fonts/display.woff2',
        'site/frames/frame.webp',
        'site/index.html',
      ]);
  });

  it('includes only active keyframe prompts and their matching canonical images', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'prompts', 'history'), { recursive: true });
    await mkdir(join(projectDir, 'input', 'keyframes'), { recursive: true });
    await writeFile(join(projectDir, 'prompts', 'keyframe-first.txt'), 'first');
    await writeFile(join(projectDir, 'prompts', 'keyframe-ref-1.txt'), 'reference');
    await writeFile(join(projectDir, 'prompts', 'keyframe-history.txt'), 'inactive');
    await writeFile(
      join(projectDir, 'prompts', 'history', 'keyframe-last.txt'),
      'old last',
    );
    await writeFile(join(projectDir, 'input', 'keyframes', 'first.png'), 'first image');
    await writeFile(join(projectDir, 'input', 'keyframes', 'ref-1.webp'), 'ref image');
    await writeFile(join(projectDir, 'input', 'keyframes', 'ref-2.png'), 'unplanned');
    await writeJson(join(projectDir, 'values.json'), {
      overlays: [{ title: 'Approved copy', at: [0.1, 0.2], position: 'left' }],
    });

    expect((await buildGateManifest(projectDir, 'storyboard')).map(({ path }) => path))
      .toEqual([
        'input/keyframes/first.png',
        'input/keyframes/ref-1.webp',
        'prompts/keyframe-first.txt',
        'prompts/keyframe-ref-1.txt',
        'values.json#storyboard',
      ]);
  });

  it('does not follow a site root into preview, extraction, or mtime inventory', async () => {
    const projectDir = await createCompleteProject();
    const siteRoot = join(projectDir, 'site');
    const inspect = noFollowInspection(siteRoot);

    await expect(buildGateManifest(projectDir, 'preview', inspect)).resolves.toBeNull();
    await expect(buildGateManifest(projectDir, 'extraction', inspect))
      .resolves.toBeNull();
    const inventory = await buildInventory(projectDir, inspect);
    expect(inventory.manifests.preview).toBeNull();
    expect(inventory.manifests.extraction).toBeNull();
    expect(inventory.mtimes.siteFrames).toBeNull();
    expect(inventory.mtimes.config).toBeNull();
  });

  it('does not follow either physical frame root and falls back only to a safe root', async () => {
    const projectDir = await createCompleteProject({ keyframes: false });
    const projectFrames = join(projectDir, 'frames');
    const siteFrames = join(projectDir, 'site', 'frames');
    await mkdir(projectFrames);
    await writeFile(join(projectFrames, 'frame-0001.webp'), 'project frame');

    const projectBlocked = noFollowInspection(projectFrames);
    const fromSite = await buildGateManifest(
      projectDir,
      'extraction',
      projectBlocked,
    );
    expect(fromSite[0].sha256).toBe(
      await sha256File(join(siteFrames, 'frame-0001.webp')),
    );
    expect((await buildInventory(projectDir, projectBlocked)).mtimes.projectFrames)
      .toBeNull();

    const siteOnlyProject = await createCompleteProject({ keyframes: false });
    const siteOnlyFrames = join(siteOnlyProject, 'site', 'frames');
    const siteBlocked = noFollowInspection(siteOnlyFrames);
    await expect(buildGateManifest(siteOnlyProject, 'extraction', siteBlocked))
      .resolves.toBeNull();
    expect((await buildInventory(siteOnlyProject, siteBlocked)).mtimes.siteFrames)
      .toBeNull();
    expect((await buildGateManifest(siteOnlyProject, 'preview', siteBlocked))
      .map(({ path }) => path))
      .not.toContain('site/frames/frame-0001.webp');
  });

  it('does not follow prompts or keyframe-image roots when inferring the plan', async () => {
    const projectDir = await createCompleteProject();
    const promptsRoot = join(projectDir, 'prompts');
    const keyframesRoot = join(projectDir, 'input', 'keyframes');

    const promptsBlocked = await buildInventory(
      projectDir,
      noFollowInspection(promptsRoot),
    );
    expect(promptsBlocked.keyframePromptCount).toBe(0);
    expect(promptsBlocked.videoPromptExists).toBe(false);
    expect(promptsBlocked.manifests.storyboard).toBeNull();

    const imagesBlocked = await buildInventory(
      projectDir,
      noFollowInspection(keyframesRoot),
    );
    expect(imagesBlocked.incomplete).toEqual(['storyboard:first']);
    expect(imagesBlocked.manifests.storyboard).toBeNull();
    expect(imagesBlocked.mtimes.keyframes).toBeNull();
  });
});

describe('filesystem inventory and approvals', () => {
  it('reports incomplete keyframe roles and rejects their manifest approval', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await mkdir(join(projectDir, 'input', 'keyframes'), { recursive: true });
    await writeFile(join(projectDir, 'brief.md'), 'brief');
    await writeFile(join(projectDir, 'prompts', 'keyframe-first.txt'), 'first');
    await writeFile(join(projectDir, 'prompts', 'keyframe-last.txt'), 'last');
    await writeFile(join(projectDir, 'input', 'keyframes', 'first.png'), 'image');
    await approveGate(projectDir, 'brief');

    const inventory = await buildInventory(projectDir);
    expect(inventory.incomplete).toEqual(['storyboard:last']);
    expect(inventory.manifests.storyboard).toBeNull();
    await expect(approveGate(projectDir, 'storyboard')).rejects.toThrow(/last.*incomplete/i);
  });

  it('marks motion-plan as needs re-review after its artifact changes', async () => {
    const projectDir = await createV2Project();
    await approveGate(projectDir, 'brief');
    await approveGate(projectDir, 'storyboard');
    await approveGate(projectDir, 'motion-plan');
    await writeMotionPlan(projectDir, 8);

    const io = fakeIo();
    expect(await main([projectDir], io)).toBe(0);
    const output = io.log.mock.calls.flat().join('\n');
    expect(output).toContain('4. motion-plan: needs re-review');
    expect(output).toContain('Resume at step 4.');
  });

  it('rejects video approval until motion-plan is currently approved', async () => {
    const projectDir = await createV2Project();
    await approveGate(projectDir, 'brief');
    await approveGate(projectDir, 'storyboard');

    await expect(approveGate(projectDir, 'video')).rejects.toThrow(/motion-plan/i);
  });

  it('resumes at keyframes until video.txt makes an empty plan explicitly skipped', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await writeFile(join(projectDir, 'brief.md'), 'brief');
    await approveGate(projectDir, 'brief');

    expect(resolveResume(await buildInventory(projectDir)).resumeStep).toBe(3);
    await writeFile(join(projectDir, 'prompts', 'video.txt'), 'text-only video prompt');
    expect(resolveResume(await buildInventory(projectDir)).resumeStep).toBe(4);
  });

  it('writes an atomic linked approval chain and preserves unrelated receipts', async () => {
    const projectDir = await createCompleteProject();
    await writeJson(join(projectDir, 'approvals.json'), {
      external: { keep: true },
    });

    const briefReceipt = await approveGate(projectDir, 'brief');
    expect(briefReceipt).toMatchObject({
      step: 1,
      basedOn: null,
      manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      timestamp: expect.any(String),
    });
    const storyboardReceipt = await approveGate(projectDir, 'storyboard');
    expect(storyboardReceipt.basedOn).toBe(briefReceipt.manifestHash);
    const motionPlanReceipt = await approveGate(projectDir, 'motion-plan');
    expect(motionPlanReceipt.basedOn).toBe(storyboardReceipt.manifestHash);
    const videoReceipt = await approveGate(projectDir, 'video');
    expect(videoReceipt.basedOn).toBe(motionPlanReceipt.manifestHash);
    await approveGate(projectDir, 'extraction');
    await approveGate(projectDir, 'theme');
    await approveGate(projectDir, 'preview');

    expect(resolveResume(await buildInventory(projectDir))).toMatchObject({
      resumeStep: 10,
      unapproved: [],
    });
    const approvals = JSON.parse(
      await readFile(join(projectDir, 'approvals.json'), 'utf8'),
    );
    expect(approvals.external).toEqual({ keep: true });
    expect(await readdir(projectDir)).not.toContain(
      expect.stringMatching(/^approvals\.json\.tmp-/),
    );

    await writeFile(join(projectDir, 'brief.md'), '# Edited brief\n');
    const changed = resolveResume(await buildInventory(projectDir));
    expect(changed.resumeStep).toBe(1);
    expect(changed.unapproved).toEqual([
      'brief', 'storyboard', 'motion-plan', 'video', 'extraction', 'theme', 'preview',
    ]);

    await approveGate(projectDir, 'brief');
    const preserved = JSON.parse(
      await readFile(join(projectDir, 'approvals.json'), 'utf8'),
    );
    expect(Object.keys(preserved).sort()).toEqual([
      'brief', 'external', 'extraction', 'motion-plan',
      'preview', 'storyboard', 'theme', 'video',
    ]);
    expect(resolveResume(await buildInventory(projectDir)).unapproved).toEqual([
      'storyboard', 'motion-plan', 'video', 'extraction', 'theme', 'preview',
    ]);
  });

  it('requires a current upstream chain and rejects unknown or incomplete gates', async () => {
    const projectDir = await createCompleteProject();
    await expect(approveGate(projectDir, 'video')).rejects.toThrow(/upstream.*brief/i);
    await expect(approveGate(projectDir, 'unknown')).rejects.toThrow(/unknown gate/i);

    const emptyProject = await temporaryProject();
    await expect(approveGate(emptyProject, 'brief')).rejects.toThrow(/incomplete/i);
    await expect(readFile(join(emptyProject, 'approvals.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps an extraction receipt valid when scaffold moves frames into site', async () => {
    const projectDir = await createCompleteProject({ keyframes: false });
    await rename(join(projectDir, 'site', 'frames'), join(projectDir, 'frames'));
    await approveGate(projectDir, 'brief');
    await approveGate(projectDir, 'motion-plan');
    await approveGate(projectDir, 'video');
    const extractionReceipt = await approveGate(projectDir, 'extraction');

    await rename(join(projectDir, 'frames'), join(projectDir, 'site', 'frames'));
    const inventory = await buildInventory(projectDir);
    expect(inventory.manifests.extraction).toBe(extractionReceipt.manifestHash);
    expect(resolveResume(inventory).unapproved).not.toContain('extraction');
  });

  it('derives video, extraction, and site staleness from newest recursive mtimes', async () => {
    const now = Date.now();

    const videoProject = await createCompleteProject();
    await utimes(
      join(videoProject, 'input', 'video.mp4'),
      new Date(now + 10_000),
      new Date(now + 10_000),
    );
    expect((await buildInventory(videoProject)).stale).toEqual(['extraction']);

    const framesProject = await createCompleteProject();
    await mkdir(join(framesProject, 'frames'));
    await writeFile(join(framesProject, 'frames', 'frame-0001.webp'), 'new frame');
    await utimes(
      join(framesProject, 'frames', 'frame-0001.webp'),
      new Date(now + 20_000),
      new Date(now + 20_000),
    );
    expect((await buildInventory(framesProject)).stale).toEqual(['site']);

    const configProject = await createCompleteProject();
    await utimes(
      join(configProject, 'values.json'),
      new Date(now + 30_000),
      new Date(now + 30_000),
    );
    expect((await buildInventory(configProject)).stale).toEqual(['site']);

    const keyframeProject = await createCompleteProject();
    await utimes(
      join(keyframeProject, 'input', 'keyframes', 'first.png'),
      new Date(now + 40_000),
      new Date(now + 40_000),
    );
    expect((await buildInventory(keyframeProject)).stale).toEqual(['video']);
  });
});

describe('status CLI', () => {
  it('prints stale before ready-unapproved when a receipt is missing', async () => {
    const projectDir = await createCompleteProject();
    const future = new Date(Date.now() + 10_000);
    await utimes(join(projectDir, 'input', 'video.mp4'), future, future);
    const io = fakeIo();

    expect(await main([projectDir], io)).toBe(0);
    const output = io.log.mock.calls.flat().join('\n');
    expect(output).toContain('7. extraction: stale');
    expect(output).not.toContain('7. extraction: ready-unapproved');
  });

  it('prints stale before needs re-review when the receipt chain is invalid', async () => {
    const projectDir = await createCompleteProject();
    for (const gate of GATES.filter((item) => !['inspiration', 'stills-preview'].includes(item))) {
      await approveGate(projectDir, gate);
    }
    await writeFile(join(projectDir, 'brief.md'), '# Changed brief\n');
    const future = new Date(Date.now() + 10_000);
    await utimes(join(projectDir, 'input', 'video.mp4'), future, future);
    const io = fakeIo();

    expect(await main([projectDir], io)).toBe(0);
    const output = io.log.mock.calls.flat().join('\n');
    expect(output).toContain('7. extraction: stale');
    expect(output).not.toContain('7. extraction: needs re-review');
  });

  it('prints missing artifacts as incomplete even when their chain is invalid', async () => {
    const projectDir = await temporaryProject();
    const io = fakeIo();

    expect(await main([projectDir], io)).toBe(0);
    expect(io.log.mock.calls.flat().join('\n')).toContain('1. brief: incomplete');
    expect(io.log.mock.calls.flat().join('\n')).not.toContain(
      '1. brief: ready-unapproved',
    );
  });

  it('prints JSON and human status states without approving anything', async () => {
    const projectDir = await createCompleteProject();
    const jsonIo = fakeIo();
    expect(await main([projectDir, '--json'], jsonIo)).toBe(0);
    expect(JSON.parse(jsonIo.log.mock.calls[0][0])).toMatchObject({
      resumeStep: 1,
      unapproved: GATES.filter((gate) => !['inspiration', 'stills-preview'].includes(gate)),
    });
    await expect(readFile(join(projectDir, 'approvals.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const humanIo = fakeIo();
    expect(await main([projectDir], humanIo)).toBe(0);
    expect(humanIo.log.mock.calls.flat().join('\n')).toContain(
      '1. brief: ready-unapproved',
    );
    expect(humanIo.log.mock.calls.flat().join('\n')).toContain('Resume at step 1.');
  });

  it('approves via CLI and uses distinct argument and operational exit codes', async () => {
    const projectDir = await createCompleteProject();
    const approvedIo = fakeIo();
    expect(await main([projectDir, '--approve', 'brief'], approvedIo)).toBe(0);
    expect(approvedIo.log.mock.calls[0][0]).toMatch(/^Approved brief: [a-f0-9]{64}$/);

    const usageIo = fakeIo();
    expect(await main([], usageIo)).toBe(1);
    expect(await main([projectDir, '--wat'], usageIo)).toBe(1);
    expect(usageIo.error.mock.calls.flat().join('\n')).toContain('Usage: status');

    const incompleteIo = fakeIo();
    expect(await main([await temporaryProject(), '--approve', 'brief'], incompleteIo))
      .toBe(2);
    expect(incompleteIo.error.mock.calls[0][0]).toMatch(/incomplete/i);
  });
});

async function createV2Project({ videoEnabled = true, media = false } = {}) {
  const projectDir = await temporaryProject('scroll-wizard-status-v2-');
  await mkdir(join(projectDir, 'prompts'), { recursive: true });
  await mkdir(join(projectDir, 'input', 'keyframes'), { recursive: true });
  await mkdir(join(projectDir, 'frames'), { recursive: true });
  await mkdir(join(projectDir, 'site', 'frames'), { recursive: true });
  await writeFile(join(projectDir, 'brief.md'), '# V2 brief\n');
  await writeFile(join(projectDir, 'prompts', 'keyframe-beat-1.txt'), 'Beat one\n');
  await writeFile(join(projectDir, 'input', 'keyframes', 'beat-1.png'), 'beat image');
  await writeFile(join(projectDir, 'prompts', 'video.txt'), 'Video prompt\n');
  if (videoEnabled) await writeMotionPlan(projectDir);
  if (videoEnabled) await writeFile(join(projectDir, 'input', 'video.mp4'), 'video');
  await writeFile(join(projectDir, 'frames', 'frame-0001.webp'), 'frame');
  await writeFile(join(projectDir, 'site', 'frames', 'frame-0001.webp'), 'frame');
  await writeFile(join(projectDir, 'site', 'index.html'), '<main></main>');
  await writeJson(join(projectDir, 'values.json'), {
    brand: { name: 'Aster' },
    generation: { video: videoEnabled },
    scrub: { mode: media ? 'video' : 'frames' },
    overlays: [{
      title: 'Beat one', body: 'Opening copy', position: 'left',
      at: [0.1, 0.3], hold: false,
    }],
    theme: { bg: '#000000', text: '#ffffff' },
  });
  if (media) {
    await mkdir(join(projectDir, 'media'));
    await writeFile(join(projectDir, 'media', 'video.mp4'), 'encoded video');
    await writeFile(join(projectDir, 'media', 'poster.webp'), 'poster');
    await writeJson(join(projectDir, 'media', 'media.json'), {
      duration: 7.8, width: 1600, height: 900,
    });
  }
  await writeJson(join(projectDir, 'site', 'config.json'), { frames: { count: 1 } });
  return projectDir;
}

async function createLegacyVideoProject() {
  const projectDir = await temporaryProject('scroll-wizard-status-legacy-');
  await mkdir(join(projectDir, 'prompts'), { recursive: true });
  await mkdir(join(projectDir, 'input'), { recursive: true });
  await writeFile(join(projectDir, 'brief.md'), '# Legacy brief\n');
  await writeFile(join(projectDir, 'prompts', 'video.txt'), 'Legacy video prompt\n');
  await writeMotionPlan(projectDir);
  await writeFile(join(projectDir, 'input', 'video.mp4'), 'video');
  await writeJson(join(projectDir, 'values.json'), {
    generation: { video: true },
    overlays: [],
    theme: { bg: '#000000', text: '#ffffff' },
  });
  return projectDir;
}

async function createDirectedProject({ approvedRefs = ['https://explanideo.com'] } = {}) {
  const projectDir = await createV2Project();
  const valuesPath = join(projectDir, 'values.json');
  const values = JSON.parse(await readFile(valuesPath, 'utf8'));
  values.register = 'product';
  values.direction = 'minimal';
  if (approvedRefs) values.inspiration = { bucket: 'product', approvedRefs };
  await writeJson(valuesPath, values);
  return projectDir;
}

describe('inspiration gate', () => {
  it('skips the gate for a legacy project and never fabricates its receipt', async () => {
    const projectDir = await createV2Project(); // no register/direction
    const inventory = await buildInventory(projectDir);
    expect(inventory.directed).toBe(false);
    const io = fakeIo();
    await main([projectDir], io);
    const output = io.log.mock.calls.flat().join('\n');
    expect(output).toContain('2. inspiration: skipped');
    // A skipped gate is never approvable and writes no receipt.
    await expect(approveGate(projectDir, 'inspiration')).rejects.toThrow(/incomplete/i);
  });

  it('requires a directed project to approve inspiration before storyboard', async () => {
    const projectDir = await createDirectedProject({ approvedRefs: null });
    await approveGate(projectDir, 'brief');
    const report = resolveResume(await buildInventory(projectDir));
    expect(report.resumeStep).toBe(2);
    expect(report.unapproved).toContain('inspiration');
    // Cannot skip ahead: storyboard approval is blocked until inspiration is approved.
    await expect(approveGate(projectDir, 'storyboard')).rejects.toThrow(/inspiration/i);
  });

  it('chains inspiration between brief and storyboard for a directed project', async () => {
    const projectDir = await createDirectedProject();
    const briefReceipt = await approveGate(projectDir, 'brief');
    const inspirationReceipt = await approveGate(projectDir, 'inspiration');
    expect(inspirationReceipt.step).toBe(2);
    expect(inspirationReceipt.basedOn).toBe(briefReceipt.manifestHash);
    const storyboardReceipt = await approveGate(projectDir, 'storyboard');
    expect(storyboardReceipt.basedOn).toBe(inspirationReceipt.manifestHash);
  });

  it('marks inspiration needs re-review after the direction changes', async () => {
    const projectDir = await createDirectedProject();
    await approveGate(projectDir, 'brief');
    await approveGate(projectDir, 'inspiration');
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    values.direction = 'cinematic';
    await writeJson(valuesPath, values);
    const io = fakeIo();
    await main([projectDir], io);
    expect(io.log.mock.calls.flat().join('\n')).toContain('2. inspiration: needs re-review');
  });
});

describe('v2 status gates', () => {
  it('maps a legacy keyframes receipt to storyboard and preserves downstream skip behavior', async () => {
    const projectDir = await createCompleteProject();
    const gateManifests = {};
    for (const gate of ['brief', 'storyboard', 'motion-plan', 'video', 'extraction', 'theme']) {
      const entries = await buildGateManifest(projectDir, gate);
      gateManifests[gate] = manifestHash(gate === 'storyboard'
        ? entries.filter((entry) => entry.path !== 'values.json#storyboard')
        : entries);
    }
    let basedOn = null;
    const receipts = {};
    for (const gate of ['brief', 'storyboard', 'motion-plan', 'video', 'extraction', 'theme']) {
      const key = gate === 'storyboard' ? 'keyframes' : gate;
      receipts[key] = { manifestHash: gateManifests[gate], basedOn };
      basedOn = gateManifests[gate];
    }
    await writeJson(join(projectDir, 'approvals.json'), receipts);

    const inventory = await buildInventory(projectDir);
    const report = resolveResume(inventory);
    expect(inventory.receipts.storyboard).toEqual(receipts.keyframes);
    expect(report.unapproved).not.toEqual(expect.arrayContaining([
      'brief', 'storyboard', 'motion-plan', 'stills-preview',
      'video', 'extraction', 'theme',
    ]));
    expect(report.unapproved).toEqual(['preview']);
    const io = fakeIo();
    await main([projectDir], io);
    expect(io.log.mock.calls.flat().join('\n')).toContain('5. stills-preview: skipped');
  });

  it('builds a motion-plan manifest from only motion-plan.json when storyboard is skipped', async () => {
    const projectDir = await createLegacyVideoProject();

    const manifest = await buildGateManifest(projectDir, 'motion-plan');
    expect(manifest.map((entry) => entry.path)).toEqual(['prompts/motion-plan.json']);
  });

  it('rejects legacy video approval without a current motion-plan receipt', async () => {
    const projectDir = await createLegacyVideoProject();
    await approveGate(projectDir, 'brief');

    await expect(approveGate(projectDir, 'video')).rejects.toThrow(/motion-plan/i);
  });

  it('builds video-mode extraction from project media and never skips extraction', async () => {
    const projectDir = await createV2Project({ media: true });
    const manifest = await buildGateManifest(projectDir, 'extraction');
    expect(manifest.map((entry) => entry.path)).toEqual([
      'media/media.json', 'media/poster.webp', 'media/video.mp4',
    ]);
    const inventory = await buildInventory(projectDir);
    expect(resolveResume(inventory).unapproved).toContain('extraction');
  });

  it('ignores unrelated project-media leftovers in favor of a valid site media set', async () => {
    const projectDir = await createV2Project();
    await writeFile(join(projectDir, 'media-note.txt'), 'outside media');
    await mkdir(join(projectDir, 'media'));
    await writeFile(join(projectDir, 'media', 'notes.txt'), 'preserved unrelated file');
    await mkdir(join(projectDir, 'site', 'media'));
    await writeFile(join(projectDir, 'site', 'media', 'video.mp4'), 'site video');
    await writeFile(join(projectDir, 'site', 'media', 'poster.webp'), 'site poster');
    await writeJson(join(projectDir, 'site', 'media', 'media.json'), {
      duration: 7.8, width: 1600, height: 900,
    });
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    delete values.scrub.mode;
    await writeJson(valuesPath, values);
    await writeJson(join(projectDir, 'site', 'config.json'), { frames: { count: 1 } });

    const manifest = await buildGateManifest(projectDir, 'extraction');
    expect(manifest.map((entry) => entry.path)).toEqual([
      'media/media.json', 'media/poster.webp', 'media/video.mp4',
    ]);
    const inventory = await buildInventory(projectDir);
    expect(inventory.scrubMode).toBe('video');
    expect(inventory.mtimes.projectMedia).toBeNull();
    expect(inventory.mtimes.siteMedia).not.toBeNull();
  });

  it('builds storyboard beats and reports a missing beat image as incomplete', async () => {
    const projectDir = await createV2Project();
    const complete = await buildGateManifest(projectDir, 'storyboard');
    expect(complete.map((entry) => entry.path)).toEqual([
      'input/keyframes/beat-1.png',
      'prompts/keyframe-beat-1.txt',
      'values.json#storyboard',
    ]);
    await writeFile(join(projectDir, 'prompts', 'keyframe-beat-2.txt'), 'Beat two\n');
    const inventory = await buildInventory(projectDir);
    expect(inventory.manifests.storyboard).toBeNull();
    expect(inventory.incomplete).toContain('storyboard:beat-2');
  });

  it('reports the fully approved v2 chain as complete (resume step 10)', async () => {
    const projectDir = await createV2Project();
    for (const gate of GATES.filter((gate) => gate !== 'inspiration')) {
      await approveGate(projectDir, gate);
    }
    expect(resolveResume(await buildInventory(projectDir))).toMatchObject({
      resumeStep: 10,
      unapproved: [],
    });
  });

  it('invalidates storyboard for overlay edits but not theme-only edits', async () => {
    const projectDir = await createV2Project();
    const before = manifestHash(await buildGateManifest(projectDir, 'storyboard'));
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    await writeJson(valuesPath, { ...values, theme: { bg: '#ffffff' } });
    expect(manifestHash(await buildGateManifest(projectDir, 'storyboard'))).toBe(before);
    await writeJson(valuesPath, {
      ...values,
      overlays: [{ ...values.overlays[0], body: 'Changed', position: 'right', at: [0.2, 0.4] }],
    });
    expect(manifestHash(await buildGateManifest(projectDir, 'storyboard'))).not.toBe(before);
  });

  it('keeps stills-preview stable across theme and mutable site rebuilds', async () => {
    const projectDir = await createV2Project();
    const before = manifestHash(await buildGateManifest(projectDir, 'stills-preview'));
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    await writeJson(valuesPath, { ...values, theme: { bg: '#ffffff' } });
    await writeFile(join(projectDir, 'site', 'index.html'), '<main>rebuilt</main>');
    await writeFile(join(projectDir, 'site', 'theme-only.css'), 'body {}');
    expect(manifestHash(await buildGateManifest(projectDir, 'stills-preview'))).toBe(before);
  });

  it('keeps stills-preview stable after scaffold moves fresh frames into site', async () => {
    const projectDir = await createV2Project();
    const before = manifestHash(await buildGateManifest(projectDir, 'stills-preview'));
    await rm(join(projectDir, 'site', 'frames'), { recursive: true });
    await rename(join(projectDir, 'frames'), join(projectDir, 'site', 'frames'));
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    await writeJson(valuesPath, { ...values, theme: { bg: '#ffffff' } });
    await writeFile(join(projectDir, 'site', 'index.html'), '<main>theme rebuild</main>');
    await writeFile(join(projectDir, 'site', 'theme.css'), 'body { color: white; }');

    const after = await buildGateManifest(projectDir, 'stills-preview');
    expect(after).not.toBeNull();
    expect(after.map((entry) => entry.path)).toEqual([
      'frames/frame-0001.webp', 'values.json#storyboard',
    ]);
    expect(manifestHash(after)).toBe(before);
  });

  it('uses only frames for explicit frames playback despite valid leftover media', async () => {
    const projectDir = await createV2Project({ media: true });
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    await writeJson(valuesPath, { ...values, scrub: { mode: 'frames' } });
    await writeJson(join(projectDir, 'site', 'config.json'), { frames: { count: 1 } });
    const now = Date.now();
    for (const name of ['video.mp4', 'poster.webp', 'media.json']) {
      await utimes(
        join(projectDir, 'media', name),
        new Date(now + 20_000),
        new Date(now + 20_000),
      );
    }

    const manifest = await buildGateManifest(projectDir, 'extraction');
    expect(manifest.map((entry) => entry.path)).toEqual([
      'frames/frame-0001.webp', 'values.json#extraction',
    ]);
    expect((await buildInventory(projectDir)).stale).not.toContain('site');

    await utimes(
      join(projectDir, 'frames', 'frame-0001.webp'),
      new Date(now + 30_000),
      new Date(now + 30_000),
    );
    expect((await buildInventory(projectDir)).stale).toContain('site');
  });

  it('uses only media for explicit video playback and ignores leftover frame edits', async () => {
    const projectDir = await createV2Project({ media: true });
    await mkdir(join(projectDir, 'site', 'media'));
    for (const name of ['video.mp4', 'poster.webp', 'media.json']) {
      const source = join(projectDir, 'media', name);
      await writeFile(join(projectDir, 'site', 'media', name), await readFile(source));
    }
    const now = Date.now();
    await utimes(
      join(projectDir, 'frames', 'frame-0001.webp'),
      new Date(now + 20_000),
      new Date(now + 20_000),
    );

    expect((await buildGateManifest(projectDir, 'extraction')).map((entry) => entry.path))
      .toEqual(['media/media.json', 'media/poster.webp', 'media/video.mp4']);
    expect((await buildInventory(projectDir)).stale).not.toContain('site');

    await utimes(
      join(projectDir, 'media', 'video.mp4'),
      new Date(now + 30_000),
      new Date(now + 30_000),
    );
    expect((await buildInventory(projectDir)).stale).toContain('site');
  });

  it('forces frames when video generation is disabled despite valid leftover media', async () => {
    const projectDir = await createV2Project({ videoEnabled: false, media: true });
    const now = Date.now();
    for (const name of ['video.mp4', 'poster.webp', 'media.json']) {
      await utimes(
        join(projectDir, 'media', name),
        new Date(now + 20_000),
        new Date(now + 20_000),
      );
    }

    const manifest = await buildGateManifest(projectDir, 'extraction');
    expect(manifest.map((entry) => entry.path)).toEqual([
      'frames/frame-0001.webp', 'values.json#extraction',
    ]);
    const valuesPath = join(projectDir, 'values.json');
    const values = JSON.parse(await readFile(valuesPath, 'utf8'));
    delete values.scrub.mode;
    await writeJson(valuesPath, values);
    await writeJson(join(projectDir, 'site', 'config.json'), { frames: { count: 1 } });
    expect((await buildGateManifest(projectDir, 'extraction')).map((entry) => entry.path))
      .toEqual(['frames/frame-0001.webp', 'values.json#extraction']);
    const inactiveMedia = await buildInventory(projectDir);
    expect(inactiveMedia.scrubMode).toBe('frames');
    expect(inactiveMedia.stale).not.toContain('site');

    await utimes(
      join(projectDir, 'frames', 'frame-0001.webp'),
      new Date(now + 30_000),
      new Date(now + 30_000),
    );
    expect((await buildInventory(projectDir)).stale).toContain('site');
  });

  it('skips disabled motion-plan and video but still requires frame extraction', async () => {
    const projectDir = await createV2Project({ videoEnabled: false });
    const inventory = await buildInventory(projectDir);
    expect(inventory.manifests.extraction).not.toBeNull();
    const io = fakeIo();
    await main([projectDir], io);
    expect(io.log.mock.calls.flat().join('\n')).toContain('4. motion-plan: skipped');
    expect(io.log.mock.calls.flat().join('\n')).toContain('6. video: skipped');
    for (const gate of GATES.filter((gate) => (
      !['inspiration', 'motion-plan', 'video'].includes(gate)
    ))) {
      await approveGate(projectDir, gate);
    }
    const report = resolveResume(await buildInventory(projectDir));
    expect(report.unapproved).toEqual([]);
    expect(report.resumeStep).toBe(10);
  });
});
