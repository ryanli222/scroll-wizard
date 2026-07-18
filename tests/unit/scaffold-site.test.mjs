import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as renamePath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assembleConfig,
  inspectFrameSet,
  main,
  scaffoldProject,
} from '../../scripts/scaffold-site.mjs';

const temporaryRoots = [];

async function temporaryRoot(prefix = 'scroll-wizard-scaffold-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function fakeIo() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function makeFrameDir(names) {
  const root = await temporaryRoot('scroll-wizard-frames-');
  await Promise.all(names.map((name) => writeFile(join(root, name), 'frame')));
  return root;
}

const defaultConfig = {
  brand: { name: 'Template Brand', tagline: 'A default tagline' },
  theme: {
    bg: '#000000',
    text: '#ffffff',
    accent: '#dfff57',
    surface: 'rgba(0, 0, 0, 0.75)',
    radius: 10,
    fonts: { display: 'serif', body: 'sans-serif' },
  },
  scrub: { heightVh: 400, smoothing: 0.12 },
};

const creativeValues = {
  brand: { name: 'Aster', tagline: 'Light, held in motion' },
  posterIndex: 1,
};

async function makeTemplateDir(configOverrides = {}) {
  const root = await temporaryRoot('scroll-wizard-template-');
  await writeFile(join(root, 'index.html'), '<html></html>', 'utf8');
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({ ...defaultConfig, ...configOverrides }, null, 2),
    'utf8',
  );
  return root;
}

async function makeProjectDir() {
  return temporaryRoot('scroll-wizard-project-');
}

async function seedFreshFrames(projectDir, names) {
  const framesDir = join(projectDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  await Promise.all(names.map((name) => writeFile(join(framesDir, name), 'frame')));
}

async function seedMedia(directory, media = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'video.mp4'), media.video ?? 'video');
  await writeFile(join(directory, 'poster.webp'), media.poster ?? 'poster');
  await writeFile(join(directory, 'media.json'), JSON.stringify({
    duration: 7.8,
    width: 1600,
    height: 900,
    ...media.metadata,
  }), 'utf8');
}

async function seedFreshMedia(projectDir, media) {
  await seedMedia(join(projectDir, 'media'), media);
}

async function seedLiveSite(projectDir, { marker, frames, media } = {}) {
  const sitePath = join(projectDir, 'site');
  await mkdir(sitePath, { recursive: true });
  if (marker !== undefined) {
    await writeFile(join(sitePath, 'marker.txt'), marker, 'utf8');
  }
  if (frames) {
    const framesDir = join(sitePath, 'frames');
    await mkdir(framesDir, { recursive: true });
    await Promise.all(frames.map((name) => writeFile(join(framesDir, name), 'frame')));
  }
  if (media) {
    await seedMedia(join(sitePath, 'media'), media);
  }
}

async function writeValues(projectDir, values) {
  await writeFile(join(projectDir, 'values.json'), JSON.stringify(values), 'utf8');
}

async function writeValidValues(projectDir) {
  await writeValues(projectDir, creativeValues);
}

async function writeInvalidValues(projectDir) {
  // Surface alpha below the 0.45 floor -> validateConfig rejects it.
  await writeValues(projectDir, {
    ...creativeValues,
    theme: { surface: 'rgba(0, 0, 0, 0.1)' },
  });
}

describe('inspectFrameSet', () => {
  it('derives a contiguous single-format frame block', async () => {
    const frames = await makeFrameDir(['frame-0001.webp', 'frame-0002.webp']);
    expect(await inspectFrameSet(frames)).toEqual({
      count: 2,
      extension: 'webp',
      pattern: 'frames/frame-{index:4}.webp',
    });
  });

  it('rejects gaps and mixed formats', async () => {
    await expect(inspectFrameSet(
      await makeFrameDir(['frame-0001.webp', 'frame-0003.webp']),
    )).rejects.toThrow(/contiguous/);
    await expect(inspectFrameSet(
      await makeFrameDir(['frame-0001.webp', 'frame-0002.jpg']),
    )).rejects.toThrow(/single format/);
  });

  it('rejects duplicate indices, zero files, and unrecognized frame media', async () => {
    await expect(inspectFrameSet(
      await makeFrameDir(['frame-0001.webp', 'frame-0001.webp.bak']),
    )).rejects.toThrow(/Unrecognized/);
    await expect(inspectFrameSet(await temporaryRoot('scroll-wizard-empty-')))
      .rejects.toThrow(/No frame files/);
  });
});

describe('assembleConfig', () => {
  const frameSet = { count: 2, extension: 'webp', pattern: 'frames/frame-{index:4}.webp' };

  it('derives poster from one-based posterIndex', () => {
    const result = assembleConfig(defaultConfig, {
      ...creativeValues,
      posterIndex: 2,
    }, frameSet);
    expect(result.config.frames.poster).toBe('frames/frame-0002.webp');
  });

  it('rejects a posterIndex outside 1..count', () => {
    expect(() => assembleConfig(defaultConfig, { ...creativeValues, posterIndex: 0 }, frameSet))
      .toThrow(/posterIndex/);
    expect(() => assembleConfig(defaultConfig, { ...creativeValues, posterIndex: 3 }, frameSet))
      .toThrow(/posterIndex/);
  });

  it('falls back brand.imageAlt to tagline, then to a generated hero-scene label', () => {
    const withTagline = assembleConfig(defaultConfig, creativeValues, frameSet);
    expect(withTagline.config.brand.imageAlt).toBe('Light, held in motion');

    const defaultsWithoutTagline = { ...defaultConfig, brand: { name: 'Template Brand' } };
    const withoutTagline = assembleConfig(defaultsWithoutTagline, {
      brand: { name: 'Aster' },
      posterIndex: 1,
    }, frameSet);
    expect(withoutTagline.config.brand.imageAlt).toBe('Aster hero scene');

    const withImageAlt = assembleConfig(defaultConfig, {
      ...creativeValues,
      brand: { ...creativeValues.brand, imageAlt: 'Explicit alt text' },
    }, frameSet);
    expect(withImageAlt.config.brand.imageAlt).toBe('Explicit alt text');
  });

  it('surfaces validateConfig errors instead of assembling an invalid config', () => {
    expect(() => assembleConfig(defaultConfig, {
      ...creativeValues,
      theme: { surface: 'rgba(0, 0, 0, 0.1)' },
    }, frameSet)).toThrow(/surface/);
  });
});

describe('assembleConfig video mode', () => {
  const defaults = () => JSON.parse(JSON.stringify({
    brand: { name: 'Aster', tagline: 'T', imageAlt: 'A' },
    theme: {
      bg: '#050607', text: '#f7f8f2', accent: '#dfff57',
      surface: 'rgba(5,6,7,0.78)', radius: 12,
      fonts: { display: 'Georgia, serif', body: 'Inter, sans-serif' },
    },
    frames: {
      count: 24,
      pattern: 'frames/frame-{index:4}.webp',
      poster: 'frames/frame-0001.webp',
    },
    scrub: { heightVh: 400, smoothing: 0.12 },
  }));

  it('emits a video block and drops frames', () => {
    const { config } = assembleConfig(
      defaults(),
      { scrub: { mode: 'video' } },
      null,
      { duration: 7.8 },
    );
    expect(config.video).toEqual({
      src: 'media/video.mp4', poster: 'media/poster.webp', duration: 7.8,
    });
    expect(config.frames).toBeUndefined();
    expect(config.scrub.mode).toBe('video');
  });

  it('still builds frames config when mediaSet is absent', () => {
    const { config } = assembleConfig(
      defaults(),
      {},
      { count: 24, extension: 'webp', pattern: 'frames/frame-{index:4}.webp' },
      null,
    );
    expect(config.frames.count).toBe(24);
    expect(config.video).toBeUndefined();
  });

  it('lets explicit frames mode win even when a media set is supplied', () => {
    const { config } = assembleConfig(
      defaults(),
      { scrub: { mode: 'frames' } },
      { count: 24, extension: 'webp', pattern: 'frames/frame-{index:4}.webp' },
      { duration: 7.8 },
    );
    expect(config.scrub.mode).toBe('frames');
    expect(config.frames.count).toBe(24);
    expect(config.video).toBeUndefined();
  });

  it('implicitly builds video config from a supplied valid media set', () => {
    const { config } = assembleConfig(defaults(), {}, null, { duration: 7.8 });
    expect(config.video.duration).toBe(7.8);
    expect(config.frames).toBeUndefined();
  });
});

describe('scaffoldProject', () => {
  it('assembles a video-mode site from fresh project media', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshMedia(projectDir);
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.framesSource).toBe('fresh');
    await expect(readFile(join(projectDir, 'site', 'media', 'video.mp4'), 'utf8'))
      .resolves.toBe('video');
    const config = JSON.parse(await readFile(join(projectDir, 'site', 'config.json'), 'utf8'));
    expect(config.scrub.mode).toBe('video');
    expect(config.frames).toBeUndefined();
    expect(config.video).toEqual({
      src: 'media/video.mp4', poster: 'media/poster.webp', duration: 7.8,
    });
    expect(await readdir(projectDir)).not.toContain('media');
  });

  it('publishes only the three validated media artifacts and preserves unrelated files', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshMedia(projectDir);
    await writeFile(join(projectDir, 'media', 'notes.txt'), 'do not publish', 'utf8');
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });

    await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(await readdir(join(projectDir, 'site', 'media')))
      .toEqual(['media.json', 'poster.webp', 'video.mp4']);
    expect(await readdir(join(projectDir, 'media'))).toEqual(['notes.txt']);
    await expect(readFile(join(projectDir, 'media', 'notes.txt'), 'utf8'))
      .resolves.toBe('do not publish');
  });

  it('rejects symlinked media artifacts without consuming fresh originals', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshMedia(projectDir);
    const externalVideo = join(projectDir, 'external-video');
    await mkdir(externalVideo);
    await writeFile(join(externalVideo, 'marker.txt'), 'external video');
    await rm(join(projectDir, 'media', 'video.mp4'));
    await symlink(externalVideo, join(projectDir, 'media', 'video.mp4'), 'junction');
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    })).rejects.toThrow(/regular.*not.*symlink/i);

    expect(await readdir(join(projectDir, 'media')))
      .toEqual(['media.json', 'poster.webp', 'video.mp4']);
    await expect(readFile(join(externalVideo, 'marker.txt'), 'utf8'))
      .resolves.toBe('external video');
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });

  it('implicitly selects video only when the available media set is valid', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await seedFreshMedia(projectDir);
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.config.scrub.mode).toBeUndefined();
    expect(result.config.video.duration).toBe(7.8);
    expect(result.config.frames).toBeUndefined();
    expect(await readdir(projectDir)).toContain('frames');
  });

  it('keeps frames mode when implicit project media metadata is invalid', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await seedFreshMedia(projectDir, { metadata: { duration: 0 } });
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.config.video).toBeUndefined();
    expect(result.config.frames.count).toBe(1);
    expect(await readdir(projectDir)).toContain('media');
  });

  it('restores fresh media when staged media validation fails', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshMedia(projectDir, { metadata: { duration: 0 } });
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    })).rejects.toThrow(/positive duration/);

    expect(await readdir(join(projectDir, 'media')))
      .toEqual(['media.json', 'poster.webp', 'video.mp4']);
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });

  it('copies inherited media for a video-mode rebuild', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { media: {} });
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
    });

    expect(result.framesSource).toBe('inherited');
    expect(await readdir(join(projectDir, 'site', 'media')))
      .toEqual(['media.json', 'poster.webp', 'video.mp4']);
  });

  it('rescues fresh media orphaned in a stale site.tmp before deleting it', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedMedia(join(projectDir, 'site.tmp-orphan', 'media'));
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });
    const io = fakeIo();

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      io,
    });

    expect(result.framesSource).toBe('fresh');
    expect(result.config.video.duration).toBe(7.8);
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('fresh media'));
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });

  it('assembles a fresh site from fresh frames', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp', 'frame-0002.webp']);
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.framesSource).toBe('fresh');
    expect(result.frameSet).toEqual({
      count: 2, extension: 'webp', pattern: 'frames/frame-{index:4}.webp',
    });
    expect(result.config.frames.poster).toBe('frames/frame-0001.webp');
    // 2 frames trips validateConfig's "recommended 24-400" budget warning; that's
    // expected here since the fixture uses a tiny frame set for test speed.
    expect(result.warnings).toEqual([{
      code: 'frames.budget', path: 'frames.count', message: 'Recommended frame count is 24 to 400.',
    }]);
    expect(await readdir(join(projectDir, 'site', 'frames')))
      .toEqual(['frame-0001.webp', 'frame-0002.webp']);
    expect(await readdir(projectDir)).not.toContain('frames');
    await expect(readFile(join(projectDir, 'README.md'), 'utf8'))
      .resolves.toContain('Aster');
    expect(await readdir(projectDir)).toEqual(
      expect.arrayContaining(['README.md', 'site', 'values.json']),
    );
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.old-'))).toBe(false);
  });

  it('fails before moving or copying anything when site exists without --force', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { marker: 'old-site' });
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValidValues(projectDir);

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    })).rejects.toThrow(/--force/);

    expect(await readdir(join(projectDir, 'frames'))).toEqual(['frame-0001.webp']);
    expect(await readFile(join(projectDir, 'site', 'marker.txt'), 'utf8')).toBe('old-site');
  });

  it('restores live site and fresh frames after validation failure', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { marker: 'old-site' });
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeInvalidValues(projectDir);

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
    })).rejects.toThrow(/contrast|surface/);

    expect(await readFile(join(projectDir, 'site', 'marker.txt'), 'utf8'))
      .toBe('old-site');
    expect(await readdir(join(projectDir, 'frames'))).toEqual(['frame-0001.webp']);
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });

  it('surfaces rollback failure and retains staged frames for startup recovery', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeInvalidValues(projectDir);
    const rollbackError = new Error('restore denied');
    const injectedRename = async (source, target) => {
      if (source.includes('site.tmp-') && target === join(projectDir, 'frames')) {
        throw rollbackError;
      }
      return renamePath(source, target);
    };

    let failure;
    try {
      await scaffoldProject({
        projectDir,
        valuesPath: join(projectDir, 'values.json'),
        templateDir,
        fileOperations: { rename: injectedRename },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual(expect.arrayContaining([rollbackError]));
    expect(String(failure.errors[0]?.message)).toMatch(/surface|contrast/);
    const retainedTmp = (await readdir(projectDir))
      .find((name) => name.startsWith('site.tmp-'));
    expect(retainedTmp).toBeDefined();
    expect(await readdir(join(projectDir, retainedTmp, 'frames')))
      .toEqual(['frame-0001.webp']);
    expect(await readdir(projectDir)).not.toContain('frames');

    await writeValidValues(projectDir);
    const recovered = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });
    expect(recovered.framesSource).toBe('fresh');
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });

  it('copies live frames for a theme-only rebuild', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { frames: ['frame-0001.webp'] });
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
    });

    expect(result.framesSource).toBe('inherited');
    expect(await readdir(join(projectDir, 'site', 'frames')))
      .toEqual(['frame-0001.webp']);
  });

  it('preserves the local display font across a theme-only rebuild', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir({
      theme: { ...defaultConfig.theme, fonts: { ...defaultConfig.theme.fonts, displayFile: 'fonts/Aster.woff2' } },
    });
    await seedLiveSite(projectDir, { frames: ['frame-0001.webp'] });
    await mkdir(join(projectDir, 'site', 'fonts'), { recursive: true });
    await writeFile(join(projectDir, 'site', 'fonts', 'Aster.woff2'), 'font');
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
    });

    expect(result.warnings.some((warning) => warning.code === 'font.missing')).toBe(false);
    await expect(readFile(join(projectDir, 'site', 'fonts', 'Aster.woff2'), 'utf8'))
      .resolves.toBe('font');
  });

  it('warns instead of failing when the configured display font is missing', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir({
      theme: { ...defaultConfig.theme, fonts: { ...defaultConfig.theme.fonts, displayFile: 'fonts/Missing.woff2' } },
    });
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValidValues(projectDir);

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'theme.fonts.displayFile',
    })]));
  });

  it('rejects a fresh install with no available frame source', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await writeValidValues(projectDir);

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
    })).rejects.toThrow(/frame/i);
  });

  it('recovers a run interrupted right after committing the new site', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedLiveSite(projectDir, { marker: 'stale-backup' });
    await mkdir(join(projectDir, 'site.old-deadbeef'));
    await writeFile(join(projectDir, 'site.old-deadbeef', 'marker.txt'), 'stale-backup');
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValidValues(projectDir);
    const io = fakeIo();

    await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      force: true,
      io,
    });

    expect(await readdir(projectDir)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^site\.old-/)]),
    );
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('orphaned'));
  });

  it('recovers a run interrupted before the swap by restoring the sole site.old', async () => {
    // scaffoldProject recovers at process start, before any other step, so a
    // rejection for an unrelated reason (site now exists, no --force) still
    // proves the restore already ran.
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await mkdir(join(projectDir, 'site.old-abc123'));
    await writeFile(join(projectDir, 'site.old-abc123', 'marker.txt'), 'recovered');
    const io = fakeIo();

    await expect(scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      io,
    })).rejects.toThrow(/--force/);

    expect(await readFile(join(projectDir, 'site', 'marker.txt'), 'utf8'))
      .toBe('recovered');
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('Recovered'));
  });

  it('rescues fresh frames orphaned in a stale site.tmp before deleting it', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    const orphanTmp = join(projectDir, 'site.tmp-orphan');
    await mkdir(join(orphanTmp, 'frames'), { recursive: true });
    await writeFile(join(orphanTmp, 'frames', 'frame-0001.webp'), 'frame');
    await writeValidValues(projectDir);
    const io = fakeIo();

    const result = await scaffoldProject({
      projectDir,
      valuesPath: join(projectDir, 'values.json'),
      templateDir,
      io,
    });

    expect(result.framesSource).toBe('fresh');
    expect((await readdir(projectDir)).some((name) => name.startsWith('site.tmp-'))).toBe(false);
  });
});

describe('scaffold-site CLI', () => {
  it('prints video and omits frame-only output for video mode', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshMedia(projectDir);
    await writeValues(projectDir, { ...creativeValues, scrub: { mode: 'video' } });
    const io = fakeIo();

    expect(await main([
      projectDir, '--config', join(projectDir, 'values.json'),
    ], io, templateDir)).toBe(0);

    const lines = io.log.mock.calls.map((call) => call[0]);
    expect(lines).toContain('Video: media/video.mp4');
    expect(lines.some((line) => line.startsWith('Frames:'))).toBe(false);
    expect(lines.some((line) => line.startsWith('Poster:'))).toBe(false);
  });

  it('prints site, frames, poster, README, and warnings on success', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir({
      theme: { ...defaultConfig.theme, fonts: { ...defaultConfig.theme.fonts, displayFile: 'fonts/Missing.woff2' } },
    });
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    await writeValidValues(projectDir);
    const io = fakeIo();

    expect(await main([
      projectDir, '--config', join(projectDir, 'values.json'),
    ], io, templateDir)).toBe(0);

    expect(io.log).toHaveBeenCalledWith(expect.stringContaining('Site: '));
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining('Frames: 1 webp (fresh)'));
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining('Poster: frames/frame-0001.webp'));
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining('README: '));
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('theme.fonts.displayFile'));
  });

  it('lists every validateConfig error, not just the first, then rolls back', async () => {
    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    // Two independent failures at once: bad surface alpha and a bad CTA href.
    await writeValues(projectDir, {
      ...creativeValues,
      theme: { surface: 'rgba(0, 0, 0, 0.1)' },
      outro: { cta: { label: 'Buy', href: 'javascript:alert(1)' } },
    });
    const io = fakeIo();

    expect(await main([
      projectDir, '--config', join(projectDir, 'values.json'),
    ], io, templateDir)).toBe(1);

    const errorLines = io.error.mock.calls.map((call) => call[0]);
    expect(errorLines.some((line) => line.includes('surface'))).toBe(true);
    expect(errorLines.some((line) => line.includes('cta.href'))).toBe(true);
    expect(await readdir(projectDir)).toEqual(['frames', 'values.json']);
  });

  it('returns 1 and reports usage or failure without throwing', async () => {
    const io = fakeIo();
    expect(await main([], io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('Usage'));

    const projectDir = await makeProjectDir();
    const templateDir = await makeTemplateDir();
    await seedFreshFrames(projectDir, ['frame-0001.webp']);
    const io2 = fakeIo();
    expect(await main(
      [projectDir, '--config', join(projectDir, 'missing.json')], io2, templateDir,
    )).toBe(1);
    expect(io2.error).toHaveBeenCalledWith(expect.stringContaining('Scaffold failed'));
    expect(io2.error).toHaveBeenCalledWith(expect.stringContaining('missing.json'));
  });
});
