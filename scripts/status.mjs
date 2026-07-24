#!/usr/bin/env node

import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';

import { hasFlag, isDirect, valueAfter } from './lib/cli.mjs';
import {
  canonicalJson,
  pathExists,
  sha256File,
  sha256Text,
  writeJsonAtomic,
} from './lib/files.mjs';

export const GATES = [
  'brief',
  'inspiration',
  'storyboard',
  'motion-plan',
  'stills-preview',
  'video',
  'extraction',
  'theme',
  'preview',
];

export function valuesProjection(values, gate) {
  if (gate === 'storyboard') {
    return (values.overlays ?? []).map((overlay) => ({
      title: overlay.title ?? null,
      body: overlay.body ?? null,
      stats: overlay.stats ?? [],
      cta: overlay.cta ?? null,
      position: overlay.position ?? null,
      at: overlay.at ?? null,
      hold: Boolean(overlay.hold),
    }));
  }
  if (gate === 'extraction') {
    return {
      holds: (values.overlays ?? [])
        .filter((overlay) => overlay.hold)
        .map((overlay) => ({ at: overlay.at })),
      posterIndex: values.posterIndex ?? 1,
    };
  }
  if (gate === 'theme') return values.theme ?? null;
  if (gate === 'inspiration') {
    return {
      register: values.register ?? null,
      archetype: values.archetype ?? null,
      direction: values.direction ?? null,
      bucket: values.inspiration?.bucket ?? null,
      approvedRefs: [...(values.inspiration?.approvedRefs ?? [])],
    };
  }
  throw new Error('No values projection for gate: ' + gate);
}

function effectiveScrubMode(values, mediaAvailable) {
  if (values?.generation?.video === false) return 'frames';
  return values?.scrub?.mode ?? (mediaAvailable ? 'video' : 'frames');
}

function compareCodePoints(left, right) {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftPoint = leftPoints.next();
    const rightPoint = rightPoints.next();
    if (leftPoint.done || rightPoint.done) {
      if (leftPoint.done && rightPoint.done) return 0;
      return leftPoint.done ? -1 : 1;
    }
    const leftValue = leftPoint.value.codePointAt(0);
    const rightValue = rightPoint.value.codePointAt(0);
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
}

function compareManifestPaths(left, right) {
  return compareCodePoints(left.path, right.path);
}

export function manifestHash(entries) {
  const normalized = [...entries]
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort(compareManifestPaths);
  return sha256Text(canonicalJson(normalized));
}

const KEYFRAME_PROMPT = /^keyframe-(first|last|ref-[1-3]|beat-\d{1,2})\.txt$/;
const KEYFRAME_ROLES = ['first', 'last', 'ref-1', 'ref-2', 'ref-3'];

function roleRank(role) {
  const fixed = KEYFRAME_ROLES.indexOf(role);
  if (fixed !== -1) return fixed;
  return 100 + Number(role.slice('beat-'.length));
}

function logicalPath(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => part.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function sortManifestEntries(entries) {
  return entries.sort(compareManifestPaths);
}

async function regularDirectoryExists(path, inspect = lstat) {
  if (!await pathExists(path, inspect)) return false;
  return (await inspect(path)).isDirectory();
}

async function regularFilesRecursive(root, inspect = lstat) {
  if (!await regularDirectoryExists(root, inspect)) return [];
  const files = [];

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = relativeDirectory
        ? join(relativeDirectory, entry.name)
        : entry.name;
      const metadata = await inspect(absolutePath);
      if (metadata.isDirectory()) {
        await walk(absolutePath, path);
      } else if (metadata.isFile()) {
        files.push({ path, absolutePath });
      }
    }
  }

  await walk(root, '');
  return files.sort((left, right) => (
    compareCodePoints(logicalPath(left.path), logicalPath(right.path))
  ));
}

async function regularMediaFiles(root, inspect = lstat) {
  const files = await regularFilesRecursive(root, inspect);
  const paths = new Set(files.map((file) => logicalPath(file.path)));
  return ['video.mp4', 'poster.webp', 'media.json'].every((name) => paths.has(name))
    ? files
    : [];
}

async function manifestFile(path, logical, inspect = lstat) {
  if (!await pathExists(path, inspect)) return null;
  if (!(await inspect(path)).isFile()) return null;
  return { path: logical, sha256: await sha256File(path) };
}

async function hashFiles(files, prefix) {
  return Promise.all(files.map(async (file) => ({
    path: logicalPath(prefix, file.path),
    sha256: await sha256File(file.absolutePath),
  })));
}

async function readJsonObject(path, label) {
  if (!await pathExists(path)) return null;
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must contain a JSON object.');
  }
  return value;
}

async function activeKeyframePlan(projectDir, inspect = lstat) {
  const promptsDir = join(projectDir, 'prompts');
  const imagesDir = join(projectDir, 'input', 'keyframes');
  const promptsRootAvailable = await regularDirectoryExists(promptsDir, inspect);
  const imagesRootAvailable = await regularDirectoryExists(imagesDir, inspect);
  const promptEntries = promptsRootAvailable
    ? await readdir(promptsDir, { withFileTypes: true })
    : [];
  const prompts = promptEntries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, match: KEYFRAME_PROMPT.exec(entry.name) }))
    .filter(({ match }) => match)
    .map(({ entry, match }) => ({
      role: match[1],
      name: entry.name,
      absolutePath: join(promptsDir, entry.name),
    }))
    .sort((left, right) => (
      roleRank(left.role) - roleRank(right.role)
    ));

  const imageEntries = imagesRootAvailable
    ? await readdir(imagesDir, { withFileTypes: true })
    : [];
  const images = imageEntries
    .filter((entry) => entry.isFile() && extname(entry.name))
    .map((entry) => ({
      role: parse(entry.name).name,
      name: entry.name,
      absolutePath: join(imagesDir, entry.name),
    }));
  const incompleteRoles = prompts
    .filter((prompt) => !images.some((image) => image.role === prompt.role))
    .map(({ role }) => role);

  return {
    prompts,
    images,
    incompleteRoles,
    promptsRootAvailable,
    imagesRootAvailable,
  };
}

export async function buildGateManifest(projectDir, gate, inspect = lstat) {
  if (!GATES.includes(gate)) throw new Error('Unknown gate: ' + gate);

  if (gate === 'brief') {
    const entry = await manifestFile(
      join(projectDir, 'brief.md'),
      'brief.md',
      inspect,
    );
    return entry ? [entry] : null;
  }

  if (gate === 'inspiration') {
    const values = await readJsonObject(join(projectDir, 'values.json'), 'values.json');
    if (!values) return null;
    const refs = values.inspiration?.approvedRefs;
    if (!Array.isArray(refs) || refs.length === 0) return null;
    return [{
      path: 'values.json#inspiration',
      sha256: sha256Text(canonicalJson(valuesProjection(values, 'inspiration'))),
    }];
  }

  if (gate === 'storyboard') {
    const plan = await activeKeyframePlan(projectDir, inspect);
    if (!plan.prompts.length || plan.incompleteRoles.length) return null;
    const selectedImages = plan.images.filter((image) => (
      plan.prompts.some((prompt) => prompt.role === image.role)
    ));
    const entries = [
      ...await Promise.all(plan.prompts.map((prompt) => manifestFile(
        prompt.absolutePath,
        logicalPath('prompts', prompt.name),
        inspect,
      ))),
      ...await Promise.all(selectedImages.map((image) => manifestFile(
        image.absolutePath,
        logicalPath('input/keyframes', image.name),
        inspect,
      ))),
    ];
    const values = await readJsonObject(join(projectDir, 'values.json'), 'values.json');
    if (!values) return null;
    entries.push({
      path: 'values.json#storyboard',
      sha256: sha256Text(canonicalJson(valuesProjection(values, 'storyboard'))),
    });
    return sortManifestEntries(entries);
  }

  if (gate === 'motion-plan') {
    const entry = await manifestFile(
      join(projectDir, 'prompts', 'motion-plan.json'),
      'prompts/motion-plan.json',
      inspect,
    );
    if (!entry) return null;
    const storyboardEntries = await buildGateManifest(projectDir, 'storyboard', inspect);
    return sortManifestEntries(storyboardEntries ? [...storyboardEntries, entry] : [entry]);
  }

  if (gate === 'video') {
    const entry = await manifestFile(
      join(projectDir, 'input', 'video.mp4'),
      'input/video.mp4',
      inspect,
    );
    return entry ? [entry] : null;
  }

  const valuesPath = join(projectDir, 'values.json');
  if (gate === 'stills-preview') {
    const projectFrames = await regularFilesRecursive(join(projectDir, 'frames'), inspect);
    const siteRoot = join(projectDir, 'site');
    const siteFrames = await regularDirectoryExists(siteRoot, inspect)
      ? await regularFilesRecursive(join(siteRoot, 'frames'), inspect)
      : [];
    const frames = projectFrames.length ? projectFrames : siteFrames;
    const values = await readJsonObject(valuesPath, 'values.json');
    if (!frames.length || !values) return null;
    return sortManifestEntries([
      ...await hashFiles(frames, 'frames'),
      {
        path: 'values.json#storyboard',
        sha256: sha256Text(canonicalJson(valuesProjection(values, 'storyboard'))),
      },
    ]);
  }

  if (gate === 'extraction') {
    const values = await readJsonObject(valuesPath, 'values.json');
    if (!values) return null;
    const projectMedia = await regularMediaFiles(join(projectDir, 'media'), inspect);
    const siteRoot = join(projectDir, 'site');
    const siteRootAvailable = await regularDirectoryExists(siteRoot, inspect);
    const siteMedia = siteRootAvailable
      ? await regularMediaFiles(join(siteRoot, 'media'), inspect)
      : [];
    const media = projectMedia.length ? projectMedia : siteMedia;
    const scrubMode = effectiveScrubMode(values, media.length > 0);
    if (scrubMode === 'video') {
      return media.length ? sortManifestEntries(await hashFiles(media, 'media')) : null;
    }

    const projectFrames = await regularFilesRecursive(
      join(projectDir, 'frames'),
      inspect,
    );
    const siteFrames = siteRootAvailable
      ? await regularFilesRecursive(join(siteRoot, 'frames'), inspect)
      : [];
    const frames = projectFrames.length ? projectFrames : siteFrames;
    if (!frames.length || !values) return null;
    return sortManifestEntries([
      ...await hashFiles(frames, 'frames'),
      {
        path: 'values.json#extraction',
        sha256: sha256Text(canonicalJson(valuesProjection(values, 'extraction'))),
      },
    ]);
  }

  if (gate === 'theme') {
    const values = await readJsonObject(valuesPath, 'values.json');
    const projection = values && valuesProjection(values, 'theme');
    if (projection === null) return null;
    return [{
      path: 'values.json#theme',
      sha256: sha256Text(canonicalJson(projection)),
    }];
  }

  const siteFiles = await regularFilesRecursive(join(projectDir, 'site'), inspect);
  if (!siteFiles.length) return null;
  return sortManifestEntries(await hashFiles(siteFiles, 'site'));
}

async function regularFileExists(path, inspect = lstat) {
  return await pathExists(path, inspect) && (await inspect(path)).isFile();
}

async function newestMtime(path, inspect = lstat) {
  if (!await pathExists(path, inspect)) return null;
  const metadata = await inspect(path);
  if (metadata.isFile()) return metadata.mtimeMs;
  if (!metadata.isDirectory()) return null;
  const files = await regularFilesRecursive(path, inspect);
  if (!files.length) return null;
  return Math.max(...await Promise.all(files.map(async (file) => (
    (await inspect(file.absolutePath)).mtimeMs
  ))));
}

export async function buildInventory(projectDir, inspect = lstat) {
  const keyframePlan = await activeKeyframePlan(projectDir, inspect);
  const videoPromptExists = keyframePlan.promptsRootAvailable
    && await regularFileExists(
      join(projectDir, 'prompts', 'video.txt'),
      inspect,
    );
  const videoFileExists = await regularFileExists(
    join(projectDir, 'input', 'video.mp4'),
    inspect,
  );
  const values = await readJsonObject(join(projectDir, 'values.json'), 'values.json');
  const projectMediaAvailable = (
    await regularMediaFiles(join(projectDir, 'media'), inspect)
  ).length > 0;
  const siteRootAvailable = await regularDirectoryExists(
    join(projectDir, 'site'), inspect,
  );
  const siteMediaAvailable = siteRootAvailable && (
    await regularMediaFiles(join(projectDir, 'site', 'media'), inspect)
  ).length > 0;
  const scrubMode = effectiveScrubMode(
    values,
    projectMediaAvailable || siteMediaAvailable,
  );
  let manifestPairs = await Promise.all(GATES.map(async (gate) => {
    const entries = await buildGateManifest(projectDir, gate, inspect);
    return [gate, entries ? manifestHash(entries) : null];
  }));
  const approvalsPath = join(projectDir, 'approvals.json');
  let receipts = await readJsonObject(approvalsPath, 'approvals.json') ?? {};
  if (receipts.keyframes && !receipts.storyboard) {
    const storyboardEntries = await buildGateManifest(projectDir, 'storyboard', inspect);
    const legacyEntries = storyboardEntries?.filter(
      (entry) => entry.path !== 'values.json#storyboard',
    );
    const legacyHash = legacyEntries?.length ? manifestHash(legacyEntries) : null;
    if (legacyHash === receipts.keyframes.manifestHash) {
      manifestPairs = manifestPairs.map(([gate, hash]) => (
        gate === 'storyboard' ? [gate, legacyHash] : [gate, hash]
      ));
    }
    receipts = { ...receipts, storyboard: receipts.keyframes };
  }

  const paths = {
    video: join(projectDir, 'input', 'video.mp4'),
    projectFrames: join(projectDir, 'frames'),
    siteFrames: join(projectDir, 'site', 'frames'),
    projectMedia: join(projectDir, 'media'),
    siteMedia: join(projectDir, 'site', 'media'),
    brief: join(projectDir, 'brief.md'),
    values: join(projectDir, 'values.json'),
    config: join(projectDir, 'site', 'config.json'),
    keyframes: join(projectDir, 'input', 'keyframes'),
  };
  const mtimePairs = await Promise.all([
    ['video', newestMtime(paths.video, inspect)],
    ['projectFrames', newestMtime(paths.projectFrames, inspect)],
    [
      'siteFrames',
      siteRootAvailable ? newestMtime(paths.siteFrames, inspect) : null,
    ],
    [
      'projectMedia',
      projectMediaAvailable ? newestMtime(paths.projectMedia, inspect) : null,
    ],
    [
      'siteMedia',
      siteMediaAvailable ? newestMtime(paths.siteMedia, inspect) : null,
    ],
    ['brief', newestMtime(paths.brief, inspect)],
    ['values', newestMtime(paths.values, inspect)],
    ['config', siteRootAvailable ? newestMtime(paths.config, inspect) : null],
    ['keyframes', newestMtime(paths.keyframes, inspect)],
  ].map(async ([name, pendingMtime]) => [name, await pendingMtime]));
  const mtimes = Object.fromEntries(mtimePairs);
  const activeFramesMtime = mtimes.projectFrames ?? mtimes.siteFrames;
  const activeMediaMtime = mtimes.projectMedia ?? mtimes.siteMedia;
  const activePlaybackMtime = scrubMode === 'video'
    ? activeMediaMtime
    : activeFramesMtime;
  const stale = [];
  if (
    mtimes.keyframes !== null
    && mtimes.video !== null
    && mtimes.keyframes > mtimes.video
  ) {
    stale.push('video');
  }
  if (
    mtimes.video !== null
    && activePlaybackMtime !== null
    && mtimes.video > activePlaybackMtime
  ) {
    stale.push('extraction');
  }
  const projectFramesOutrunSite = mtimes.projectFrames !== null
    && (mtimes.siteFrames === null || mtimes.projectFrames > mtimes.siteFrames);
  const projectMediaOutrunSite = mtimes.projectMedia !== null
    && (mtimes.siteMedia === null || mtimes.projectMedia > mtimes.siteMedia);
  const sourceOutrunsConfig = mtimes.config !== null
    && [mtimes.brief, mtimes.values].some((mtime) => (
      mtime !== null && mtime > mtimes.config
    ));
  if (
    (scrubMode === 'frames' && projectFramesOutrunSite)
    || (scrubMode === 'video' && projectMediaOutrunSite)
    || sourceOutrunsConfig
  ) {
    stale.push('site');
  }

  return {
    manifests: Object.fromEntries(manifestPairs),
    receipts,
    incomplete: keyframePlan.incompleteRoles.map((role) => 'storyboard:' + role),
    stale,
    keyframePromptCount: keyframePlan.prompts.length,
    beatPromptCount: keyframePlan.prompts
      .filter((prompt) => prompt.role.startsWith('beat-')).length,
    videoPromptExists,
    videoFileExists,
    videoEnabled: values?.generation?.video !== false,
    directed: Boolean(values?.register || values?.direction),
    scrubMode,
    mtimes,
  };
}

function stepFor(item) {
  if (item.startsWith('keyframe') || item.startsWith('storyboard')) {
    return GATES.indexOf('storyboard') + 1;
  }
  if (item === 'site') return GATES.indexOf('theme') + 1;
  const index = GATES.indexOf(item);
  return index === -1 ? 1 : index + 1;
}

function finish(resumeStep, inventory, unapproved) {
  return {
    resumeStep,
    staleness: [...(inventory.stale ?? [])],
    incomplete: [...(inventory.incomplete ?? [])],
    unapproved,
  };
}

export function resolveResume(inventory) {
  const unapproved = [];
  const missingSteps = [];
  let upstreamValidHash = null;
  let chainBroken = false;

  for (const gate of GATES) {
    if (gateSkipped(gate, inventory)) continue;

    const currentHash = inventory.manifests[gate];
    const step = GATES.indexOf(gate) + 1;
    if (!currentHash) missingSteps.push(step);
    const receipt = inventory.receipts[gate];
    const valid = Boolean(currentHash)
      && !chainBroken
      && receipt?.manifestHash === currentHash
      && receipt?.basedOn === upstreamValidHash;
    if (!valid) {
      chainBroken = true;
      unapproved.push(gate);
    } else {
      upstreamValidHash = currentHash;
    }
  }

  const actionableSteps = [
    ...missingSteps,
    ...unapproved.map((gate) => GATES.indexOf(gate) + 1),
    ...inventory.incomplete.map(stepFor),
    ...inventory.stale.map(stepFor),
  ];
  return finish(
    actionableSteps.length ? Math.min(...actionableSteps) : GATES.length + 1,
    inventory,
    unapproved,
  );
}

function gateSkipped(gate, inventory) {
  if (gate === 'inspiration') return !inventory.directed;
  if (gate === 'storyboard') {
    return inventory.keyframePromptCount === 0 && inventory.videoPromptExists;
  }
  if (gate === 'motion-plan') {
    return !inventory.videoEnabled;
  }
  if (gate === 'stills-preview') {
    return inventory.beatPromptCount === 0 && inventory.videoFileExists;
  }
  if (gate === 'video') return !inventory.videoEnabled;
  return false;
}

export async function approveGate(projectDir, gate) {
  if (!GATES.includes(gate)) throw new Error('Unknown gate: ' + gate);
  const inventory = await buildInventory(projectDir);
  const currentHash = inventory.manifests[gate];
  if (!currentHash) {
    const missingRoles = inventory.incomplete
      .filter((item) => item.startsWith(gate + ':'))
      .map((item) => item.slice(gate.length + 1));
    const detail = missingRoles.length
      ? ': ' + missingRoles.join(', ') + ' incomplete'
      : '';
    throw new Error('Cannot approve ' + gate + ': manifest is incomplete' + detail + '.');
  }

  let upstreamHash = null;
  for (const upstreamGate of GATES.slice(0, GATES.indexOf(gate))) {
    if (gateSkipped(upstreamGate, inventory)) continue;
    const manifest = inventory.manifests[upstreamGate];
    const receipt = inventory.receipts[upstreamGate];
    const valid = manifest
      && receipt?.manifestHash === manifest
      && receipt?.basedOn === upstreamHash;
    if (!valid) {
      throw new Error(
        'Cannot approve ' + gate + ': upstream gate '
        + upstreamGate + ' is not currently approved.',
      );
    }
    upstreamHash = manifest;
  }

  const receipt = {
    step: GATES.indexOf(gate) + 1,
    manifestHash: currentHash,
    basedOn: upstreamHash,
    timestamp: new Date().toISOString(),
  };
  await writeJsonAtomic(join(projectDir, 'approvals.json'), {
    ...inventory.receipts,
    [gate]: receipt,
  });
  return receipt;
}

const USAGE = 'Usage: status <projectDir> [--json] [--approve <gate>]';

function parseArguments(argv) {
  const projectDir = argv[0];
  if (!projectDir || projectDir.startsWith('--')) return null;
  let approve = null;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') continue;
    if (argument === '--approve' && approve === null) {
      try {
        approve = valueAfter(argv, '--approve');
      } catch {
        return null;
      }
      index += 1;
      continue;
    }
    return null;
  }
  if (approve !== null && !GATES.includes(approve)) return null;
  return { projectDir, json: hasFlag(argv, '--json'), approve };
}

function stateForGate(gate, inventory, report) {
  if (gateSkipped(gate, inventory)) return 'skipped';
  const step = GATES.indexOf(gate) + 1;
  const incomplete = inventory.incomplete.some((item) => stepFor(item) === step);
  if (incomplete || !inventory.manifests[gate]) return 'incomplete';
  const stale = inventory.stale.some((item) => stepFor(item) === step);
  if (stale) return 'stale';
  if (report.unapproved.includes(gate)) {
    return inventory.receipts[gate] ? 'needs re-review' : 'ready-unapproved';
  }
  return 'done';
}

function printHuman(inventory, report, io) {
  GATES.forEach((gate, index) => {
    const state = stateForGate(gate, inventory, report);
    // inventory.stale never contains the literal 'theme' gate name -- a
    // 'stale' state on the theme line is always driven by 'site' staleness
    // (frames/config outrunning the scaffolded site). Label it as such so
    // it doesn't read as the theme config itself being stale.
    const label = gate === 'theme' && state === 'stale' ? 'theme (site build)' : gate;
    io.log((index + 1) + '. ' + label + ': ' + state);
  });
  io.log('Resume at step ' + report.resumeStep + '.');
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
    if (options.approve) {
      const receipt = await approveGate(options.projectDir, options.approve);
      try {
        io.log(options.json
          ? JSON.stringify(receipt, null, 2)
          : 'Approved ' + options.approve + ': ' + receipt.manifestHash);
      } catch {
        // Reporting cannot undo a receipt that was already committed atomically.
      }
      return 0;
    }

    const inventory = await buildInventory(options.projectDir);
    const report = resolveResume(inventory);
    if (options.json) io.log(JSON.stringify(report, null, 2));
    else printHuman(inventory, report, io);
    return 0;
  } catch (error) {
    io.error('Status failed: ' + firstLine(error));
    return 2;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
