import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

function completeInventory(overrides = {}) {
  const manifests = Object.fromEntries(
    GATES.map((gate, index) => [gate, hash(String.fromCharCode(97 + index))]),
  );
  let basedOn = null;
  const receipts = Object.fromEntries(GATES.map((gate, index) => {
    const receipt = {
      manifestHash: manifests[gate],
      basedOn,
    };
    basedOn = manifests[gate];
    return [gate, receipt];
  }));
  return {
    manifests,
    receipts,
    incomplete: [],
    stale: [],
    keyframePromptCount: 1,
    videoPromptExists: true,
    ...overrides,
  };
}

describe('status inventory resolution', () => {
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

  it('reports a fully approved fresh chain as complete', () => {
    expect(resolveResume(completeInventory())).toEqual({
      resumeStep: 7,
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
        'brief', 'keyframes', 'video', 'extraction', 'theme', 'preview',
      ],
    });
  });

  it('marks a missing receipt and every chained descendant unapproved', () => {
    const inventory = completeInventory();
    delete inventory.receipts.extraction;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 4,
      unapproved: ['extraction', 'theme', 'preview'],
    });
  });

  it('keeps an earlier broken receipt ahead of a later missing artifact', () => {
    const inventory = completeInventory();
    inventory.manifests.brief = hash('z');
    inventory.manifests.preview = null;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 1,
      unapproved: ['brief', 'keyframes', 'video', 'extraction', 'theme'],
    });
  });

  it('resumes at missing keyframes before a video prompt establishes the skip', () => {
    const inventory = completeInventory({
      keyframePromptCount: 0,
      videoPromptExists: false,
    });
    inventory.manifests.keyframes = null;
    delete inventory.receipts.keyframes;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 2,
      unapproved: [],
    });
  });

  it('links video directly to brief when keyframes are skipped', () => {
    const inventory = completeInventory({ keyframePromptCount: 0 });
    inventory.manifests.keyframes = null;
    delete inventory.receipts.keyframes;
    inventory.receipts.video.basedOn = inventory.manifests.brief;

    expect(resolveResume(inventory)).toMatchObject({
      resumeStep: 7,
      unapproved: [],
    });
  });

  it('returns incomplete and staleness details with their earliest resume step', () => {
    expect(resolveResume(completeInventory({
      incomplete: ['keyframes'],
    }))).toMatchObject({
      resumeStep: 2,
      incomplete: ['keyframes'],
    });

    expect(resolveResume(completeInventory({
      stale: ['video', 'extraction', 'site'],
    }))).toMatchObject({
      resumeStep: 3,
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

    expect((await buildGateManifest(projectDir, 'keyframes')).map(({ path }) => path))
      .toEqual([
        'input/keyframes/first.png',
        'input/keyframes/ref-1.webp',
        'prompts/keyframe-first.txt',
        'prompts/keyframe-ref-1.txt',
      ]);
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
    expect(inventory.incomplete).toEqual(['keyframes:last']);
    expect(inventory.manifests.keyframes).toBeNull();
    await expect(approveGate(projectDir, 'keyframes')).rejects.toThrow(/last.*incomplete/i);
  });

  it('resumes at keyframes until video.txt makes an empty plan explicitly skipped', async () => {
    const projectDir = await temporaryProject();
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await writeFile(join(projectDir, 'brief.md'), 'brief');
    await approveGate(projectDir, 'brief');

    expect(resolveResume(await buildInventory(projectDir)).resumeStep).toBe(2);
    await writeFile(join(projectDir, 'prompts', 'video.txt'), 'text-only video prompt');
    expect(resolveResume(await buildInventory(projectDir)).resumeStep).toBe(3);
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
    const keyframeReceipt = await approveGate(projectDir, 'keyframes');
    expect(keyframeReceipt.basedOn).toBe(briefReceipt.manifestHash);
    const videoReceipt = await approveGate(projectDir, 'video');
    expect(videoReceipt.basedOn).toBe(keyframeReceipt.manifestHash);
    await approveGate(projectDir, 'extraction');
    await approveGate(projectDir, 'theme');
    await approveGate(projectDir, 'preview');

    expect(resolveResume(await buildInventory(projectDir))).toMatchObject({
      resumeStep: 7,
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
      'brief', 'keyframes', 'video', 'extraction', 'theme', 'preview',
    ]);

    await approveGate(projectDir, 'brief');
    const preserved = JSON.parse(
      await readFile(join(projectDir, 'approvals.json'), 'utf8'),
    );
    expect(Object.keys(preserved).sort()).toEqual([
      'brief', 'external', 'extraction', 'keyframes', 'preview', 'theme', 'video',
    ]);
    expect(resolveResume(await buildInventory(projectDir)).unapproved).toEqual([
      'keyframes', 'video', 'extraction', 'theme', 'preview',
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
  it('prints JSON and human status states without approving anything', async () => {
    const projectDir = await createCompleteProject();
    const jsonIo = fakeIo();
    expect(await main([projectDir, '--json'], jsonIo)).toBe(0);
    expect(JSON.parse(jsonIo.log.mock.calls[0][0])).toMatchObject({
      resumeStep: 1,
      unapproved: GATES,
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
