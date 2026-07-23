#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasFlag, isDirect, valueAfter } from './lib/cli.mjs';
import { directoryNonEmpty, pathExists, writeJsonAtomic } from './lib/files.mjs';
import { validateConfig } from '../template/scrub-core.js';

const DEFAULT_TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

const DIRECTIONS = JSON.parse(
  await readFile(fileURLToPath(new URL('../references/directions.json', import.meta.url)), 'utf8'),
);

const FRAME_NAME = /^frame-(\d{4})\.(webp|jpg)$/;
const MEDIA_ARTIFACTS = ['video.mp4', 'poster.webp', 'media.json'];

export async function inspectFrameSet(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const frameLike = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('frame-'))
    .map((entry) => entry.name)
    .sort();
  if (!frameLike.length) {
    throw new Error('No frame files found in ' + directory + '.');
  }

  const extensions = new Set();
  const indices = [];
  for (const name of frameLike) {
    const match = FRAME_NAME.exec(name);
    if (!match) {
      throw new Error(
        'Unrecognized frame file (expected frame-<4 digits>.webp or .jpg): ' + name,
      );
    }
    indices.push(Number(match[1]));
    extensions.add(match[2]);
  }
  if (extensions.size > 1) {
    throw new Error(
      'Frame set must use a single format; found ' + [...extensions].sort().join(', ') + '.',
    );
  }

  const count = indices.length;
  // ponytail: the 4-digit filename pattern can never produce a contiguous
  // 1..N run above 9999, so this is unreachable defense, not a real path.
  if (count > 9999) {
    throw new Error('Frame count must not exceed 9999.');
  }
  const sorted = [...indices].sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error('Frame indices must not repeat (duplicate index detected).');
  }
  for (let index = 0; index < count; index += 1) {
    if (sorted[index] !== index + 1) {
      throw new Error('Frame indices must be contiguous starting at frame-0001 (gap found).');
    }
  }

  const [extension] = extensions;
  return {
    count,
    extension,
    pattern: 'frames/frame-{index:4}.' + extension,
  };
}

export function assembleConfig(defaults, values, frameSet, mediaSet = null) {
  const videoMode = values.scrub?.mode === 'video'
    || (values.scrub?.mode == null && mediaSet !== null);
  const posterIndex = values.posterIndex ?? 1;
  if (!videoMode && (!Number.isInteger(posterIndex)
      || posterIndex < 1 || posterIndex > frameSet.count)) {
    throw new Error('posterIndex must be within 1..' + frameSet.count);
  }
  const { posterIndex: _ignored, ...creative } = values;
  const brand = { ...defaults.brand, ...creative.brand };
  const selectedDirection = DIRECTIONS[creative.direction];
  // Clarification: poster alt falls back imageAlt -> tagline -> "<name> hero scene".
  brand.imageAlt = brand.imageAlt || brand.tagline || (brand.name + ' hero scene');
  const config = {
    ...defaults,
    ...creative,
    brand,
    theme: {
      ...defaults.theme,
      ...(selectedDirection?.theme ?? {}),
      ...creative.theme,
      fonts: {
        ...defaults.theme.fonts,
        ...selectedDirection?.theme?.fonts,
        ...creative.theme?.fonts,
      },
    },
    scrub: { ...defaults.scrub, ...creative.scrub },
  };
  if (selectedDirection) {
    config.directionPreset = {
      motion: { ...selectedDirection.motion },
      chromeStyle: selectedDirection.chromeStyle,
      scrimStrength: selectedDirection.scrimStrength,
    };
  } else {
    delete config.directionPreset;
  }
  if (videoMode) {
    if (!mediaSet) throw new Error('Video mode requires valid media.');
    delete config.frames;
    config.video = {
      src: 'media/video.mp4',
      poster: 'media/poster.webp',
      duration: mediaSet.duration,
    };
  } else {
    delete config.video;
    config.frames = {
      count: frameSet.count,
      pattern: frameSet.pattern,
      poster: 'frames/frame-' + String(posterIndex).padStart(4, '0')
        + '.' + frameSet.extension,
    };
  }
  const report = validateConfig(config);
  if (report.errors.length) {
    throw new Error(report.errors.map((item) => item.path + ': ' + item.message).join('\n'));
  }
  return { config, warnings: report.warnings };
}

async function readJsonFile(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Missing ' + label + ': ' + path);
    throw error;
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must contain a JSON object.');
  }
  return value;
}

async function inspectMediaSet(directory, strict = true) {
  try {
    for (const name of MEDIA_ARTIFACTS) {
      const item = await lstat(join(directory, name));
      if (item.isSymbolicLink() || !item.isFile() || item.size <= 0) {
        throw new Error(
          'media/' + name + ' must be a nonzero regular file and not a symlink.',
        );
      }
    }
    const mediaInfo = await readJsonFile(
      join(directory, 'media.json'), 'media/media.json',
    );
    if (!Number.isFinite(mediaInfo.duration) || mediaInfo.duration <= 0) {
      throw new Error('media/media.json must contain a positive duration.');
    }
    return mediaInfo;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

async function stageMediaSet(source, destination) {
  await mkdir(destination);
  for (const name of MEDIA_ARTIFACTS) {
    await cp(join(source, name), join(destination, name), {
      dereference: false,
      errorOnExist: true,
      force: false,
    });
  }
  return inspectMediaSet(destination);
}

async function removeConsumedMedia(directory) {
  for (const name of MEDIA_ARTIFACTS) {
    await rm(join(directory, name), { force: true });
  }
  try {
    await rmdir(directory);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
  }
}

function buildReadme(config, frameSet, framesSource, mediaSet) {
  const assetLines = mediaSet
    ? ['- Video: media/video.mp4 (' + framesSource + ')']
    : [
        '- Frames: ' + frameSet.count + ' ' + frameSet.extension + ' (' + framesSource + ')',
        '- Poster: ' + config.frames.poster,
      ];
  return [
    '# ' + config.brand.name,
    '',
    'Generated by scroll-wizard scaffold-site.',
    '',
    ...assetLines,
    '',
    '## Deploy',
    '',
    'Upload the contents of `site/` to any static host, e.g. `npx serve site`.',
    '',
  ].join('\n');
}

// At process start, deterministically recover from a run interrupted mid-transaction.
async function recoverInterruptedRun(projectDir, io) {
  const sitePath = join(projectDir, 'site');
  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const oldDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('site.old-'))
    .map((entry) => entry.name);
  const tmpDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('site.tmp-'))
    .map((entry) => entry.name);

  const siteExists = await pathExists(sitePath);
  if (!siteExists && oldDirs.length === 1) {
    await rename(join(projectDir, oldDirs[0]), sitePath);
    io.warn?.('Recovered interrupted scaffold: restored ' + oldDirs[0] + ' as site.');
  } else if (siteExists) {
    for (const name of [...oldDirs, ...tmpDirs]) {
      io.warn?.('Removing orphaned ' + name + ' left by an interrupted scaffold run.');
    }
    for (const name of oldDirs) {
      await rm(join(projectDir, name), { recursive: true, force: true });
    }
  }

  const recoveredAssets = new Set();
  for (const name of tmpDirs) {
    const tmpPath = join(projectDir, name);
    for (const asset of ['frames', 'media']) {
      const projectAssetPath = join(projectDir, asset);
      const tmpAssetPath = join(tmpPath, asset);
      const projectAssetExists = recoveredAssets.has(asset)
        || await pathExists(projectAssetPath);
      if (!projectAssetExists && await directoryNonEmpty(tmpAssetPath)) {
        await rename(tmpAssetPath, projectAssetPath);
        recoveredAssets.add(asset);
        io.warn?.(
          'Recovered fresh ' + asset + ' left by an interrupted scaffold run: ' + name,
        );
      }
    }
    await rm(tmpPath, { recursive: true, force: true });
  }
}

export async function scaffoldProject(options) {
  const {
    valuesPath,
    force = false,
    io = console,
    fileOperations = {},
  } = options;
  const projectDir = resolve(options.projectDir);
  const templateDir = resolve(options.templateDir ?? DEFAULT_TEMPLATE_DIR);
  const sitePath = join(projectDir, 'site');
  const projectFramesPath = join(projectDir, 'frames');
  const projectMediaPath = join(projectDir, 'media');

  await recoverInterruptedRun(projectDir, io);

  const siteExisted = await pathExists(sitePath);
  if (siteExisted && !force) {
    throw new Error('Site already exists; use --force to replace it: ' + sitePath);
  }

  const suffix = randomUUID();
  const siteTmpPath = join(projectDir, 'site.tmp-' + suffix);
  const siteOldPath = join(projectDir, 'site.old-' + suffix);
  const readmeTmpPath = join(projectDir, '.README.md.tmp-' + suffix);
  const readmePath = join(projectDir, 'README.md');
  const renameAsset = fileOperations.rename ?? rename;

  let freshFramesMoved = false;
  let freshMediaConsumed = false;
  let siteReplaced = false;
  try {
    const [values, defaults] = await Promise.all([
      readJsonFile(valuesPath, 'values.json'),
      readJsonFile(join(templateDir, 'config.json'), 'template/config.json'),
    ]);
    await cp(templateDir, siteTmpPath, { recursive: true });

    const liveMediaPath = join(sitePath, 'media');
    const explicitMode = values.scrub?.mode;
    let mediaSourcePath = null;
    if (explicitMode === 'video') {
      if (await pathExists(projectMediaPath)) {
        mediaSourcePath = projectMediaPath;
      } else if (await pathExists(liveMediaPath)) {
        mediaSourcePath = liveMediaPath;
      }
    } else if (explicitMode == null) {
      if (await pathExists(projectMediaPath)
          && await inspectMediaSet(projectMediaPath, false)) {
        mediaSourcePath = projectMediaPath;
      } else if (await pathExists(liveMediaPath)
          && await inspectMediaSet(liveMediaPath, false)) {
        mediaSourcePath = liveMediaPath;
      }
    }
    const videoMode = explicitMode === 'video'
      || (explicitMode == null && mediaSourcePath !== null);

    let framesSource;
    let frameSet = null;
    let mediaSet = null;
    if (videoMode) {
      if (!mediaSourcePath) {
        throw new Error(
          'No media available: run reencode-video into project/media, '
          + 'or scaffold over an existing site that already has media.',
        );
      }
      await inspectMediaSet(mediaSourcePath);
      mediaSet = await stageMediaSet(mediaSourcePath, join(siteTmpPath, 'media'));
      freshMediaConsumed = mediaSourcePath === projectMediaPath;
      framesSource = freshMediaConsumed ? 'fresh' : 'inherited';
    } else {
      if (await pathExists(projectFramesPath)) {
        await renameAsset(projectFramesPath, join(siteTmpPath, 'frames'));
        freshFramesMoved = true;
        framesSource = 'fresh';
      } else {
        const liveFramesPath = join(sitePath, 'frames');
        if (!await pathExists(liveFramesPath)) {
          throw new Error(
            'No frames available: run extraction into project/frames, '
            + 'or scaffold over an existing site that already has frames.',
          );
        }
        await cp(liveFramesPath, join(siteTmpPath, 'frames'), { recursive: true });
        framesSource = 'inherited';
      }
      frameSet = await inspectFrameSet(join(siteTmpPath, 'frames'));
    }

    const liveFontsPath = join(sitePath, 'fonts');
    if (await pathExists(liveFontsPath)) {
      await cp(liveFontsPath, join(siteTmpPath, 'fonts'), { recursive: true });
    }

    const { config, warnings } = assembleConfig(defaults, values, frameSet, mediaSet);
    await writeJsonAtomic(join(siteTmpPath, 'config.json'), config);

    const displayFile = config.theme.fonts?.displayFile;
    if (displayFile && !await pathExists(join(siteTmpPath, displayFile))) {
      warnings.push({
        code: 'font.missing',
        path: 'theme.fonts.displayFile',
        message: 'Display font is referenced but missing from the staged site: ' + displayFile,
      });
    }

    await writeFile(
      readmeTmpPath,
      buildReadme(config, frameSet, framesSource, mediaSet),
      'utf8',
    );

    if (siteExisted) await rename(sitePath, siteOldPath);
    try {
      await rename(siteTmpPath, sitePath);
    } catch (error) {
      if (siteExisted) await rename(siteOldPath, sitePath);
      throw error;
    }
    siteReplaced = true;

    try {
      await rename(readmeTmpPath, readmePath);
      if (siteExisted) await rm(siteOldPath, { recursive: true, force: true });
      if (freshMediaConsumed) await removeConsumedMedia(projectMediaPath);
    } catch (postCommitError) {
      // The site itself is already fully validated and swapped in; a failure
      // here only affects the README convenience file or old-site cleanup.
      warnings.push({
        code: 'post-commit',
        path: 'site.old',
        message: 'Site was replaced, but finishing touches failed: '
          + String(postCommitError?.message ?? postCommitError),
      });
    }

    return {
      sitePath, frameSet, mediaSet, framesSource, config, warnings, readmePath,
    };
  } catch (error) {
    let reportedError = error;
    let retainStaging = false;
    if (freshFramesMoved && !siteReplaced) {
      try {
        await renameAsset(join(siteTmpPath, 'frames'), projectFramesPath);
      } catch (rollbackError) {
        retainStaging = true;
        reportedError = new AggregateError(
          [error, rollbackError],
          'Scaffold failed and fresh frames could not be restored; '
            + 'staging was retained for interrupted-run recovery.',
        );
      }
    }
    if (!retainStaging) {
      await rm(siteTmpPath, { recursive: true, force: true }).catch(() => {});
    }
    await rm(readmeTmpPath, { recursive: true, force: true }).catch(() => {});
    throw reportedError;
  }
}

const USAGE = 'Usage: scaffold-site <projectDir> --config <values.json> [--force]';

function firstLine(error) {
  return String(error?.message ?? error).split(/\r?\n/, 1)[0];
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  templateDir = DEFAULT_TEMPLATE_DIR,
) {
  const projectDir = argv[0];
  if (!projectDir || projectDir.startsWith('--')) {
    io.error(USAGE);
    return 1;
  }
  let valuesPath;
  try {
    valuesPath = valueAfter(argv, '--config');
  } catch (error) {
    io.error(firstLine(error));
    io.error(USAGE);
    return 1;
  }
  if (!valuesPath) {
    io.error(USAGE);
    return 1;
  }

  try {
    const result = await scaffoldProject({
      projectDir,
      valuesPath: resolve(valuesPath),
      templateDir,
      force: hasFlag(argv, '--force'),
      io,
    });
    io.log('Site: ' + result.sitePath);
    if (result.mediaSet) {
      io.log('Video: media/video.mp4');
    } else {
      io.log(
        'Frames: ' + result.frameSet.count + ' ' + result.frameSet.extension
        + ' (' + result.framesSource + ')',
      );
      io.log('Poster: ' + result.config.frames.poster);
    }
    io.log('README: ' + result.readmePath);
    for (const warning of result.warnings) {
      io.warn('Warning: ' + warning.path + ': ' + warning.message);
    }
    return 0;
  } catch (error) {
    // Print every line: a validateConfig failure carries one "path: message"
    // entry per line, and the caller must see the full list, not just the first.
    io.error('Scaffold failed:');
    for (const line of String(error?.message ?? error).split(/\r?\n/)) {
      io.error('  ' + line);
    }
    return 1;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
