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
  'keyframes',
  'video',
  'extraction',
  'theme',
  'preview',
];

export function valuesProjection(values, gate) {
  if (gate === 'extraction') {
    return {
      holds: (values.overlays ?? [])
        .filter((overlay) => overlay.hold)
        .map((overlay) => ({ at: overlay.at })),
      posterIndex: values.posterIndex ?? 1,
    };
  }
  if (gate === 'theme') return values.theme ?? null;
  throw new Error('No values projection for gate: ' + gate);
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

const KEYFRAME_PROMPT = /^keyframe-(first|last|ref-[1-3])\.txt$/;
const KEYFRAME_ROLES = ['first', 'last', 'ref-1', 'ref-2', 'ref-3'];

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
      KEYFRAME_ROLES.indexOf(left.role) - KEYFRAME_ROLES.indexOf(right.role)
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

  if (gate === 'keyframes') {
    const plan = await activeKeyframePlan(projectDir, inspect);
    if (!plan.prompts.length || plan.incompleteRoles.length) return null;
    const selectedImages = plan.images.filter((image) => (
      plan.prompts.some((prompt) => prompt.role === image.role)
    ));
    return sortManifestEntries([
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
    ]);
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
  if (gate === 'extraction') {
    const projectFrames = await regularFilesRecursive(
      join(projectDir, 'frames'),
      inspect,
    );
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
  const manifestPairs = await Promise.all(GATES.map(async (gate) => {
    const entries = await buildGateManifest(projectDir, gate, inspect);
    return [gate, entries ? manifestHash(entries) : null];
  }));
  const approvalsPath = join(projectDir, 'approvals.json');
  const receipts = await readJsonObject(approvalsPath, 'approvals.json') ?? {};

  const paths = {
    video: join(projectDir, 'input', 'video.mp4'),
    projectFrames: join(projectDir, 'frames'),
    siteFrames: join(projectDir, 'site', 'frames'),
    brief: join(projectDir, 'brief.md'),
    values: join(projectDir, 'values.json'),
    config: join(projectDir, 'site', 'config.json'),
    keyframes: join(projectDir, 'input', 'keyframes'),
  };
  const siteRootAvailable = await regularDirectoryExists(
    join(projectDir, 'site'),
    inspect,
  );
  const mtimePairs = await Promise.all([
    ['video', newestMtime(paths.video, inspect)],
    ['projectFrames', newestMtime(paths.projectFrames, inspect)],
    [
      'siteFrames',
      siteRootAvailable ? newestMtime(paths.siteFrames, inspect) : null,
    ],
    ['brief', newestMtime(paths.brief, inspect)],
    ['values', newestMtime(paths.values, inspect)],
    ['config', siteRootAvailable ? newestMtime(paths.config, inspect) : null],
    ['keyframes', newestMtime(paths.keyframes, inspect)],
  ].map(async ([name, pendingMtime]) => [name, await pendingMtime]));
  const mtimes = Object.fromEntries(mtimePairs);
  const activeFramesMtime = mtimes.projectFrames ?? mtimes.siteFrames;
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
    && activeFramesMtime !== null
    && mtimes.video > activeFramesMtime
  ) {
    stale.push('extraction');
  }
  const projectFramesOutrunSite = mtimes.projectFrames !== null
    && (mtimes.siteFrames === null || mtimes.projectFrames > mtimes.siteFrames);
  const sourceOutrunsConfig = mtimes.config !== null
    && [mtimes.brief, mtimes.values].some((mtime) => (
      mtime !== null && mtime > mtimes.config
    ));
  if (projectFramesOutrunSite || sourceOutrunsConfig) stale.push('site');

  return {
    manifests: Object.fromEntries(manifestPairs),
    receipts,
    incomplete: keyframePlan.incompleteRoles.map((role) => 'keyframes:' + role),
    stale,
    keyframePromptCount: keyframePlan.prompts.length,
    videoPromptExists,
    mtimes,
  };
}

function stepFor(item) {
  if (item === 'brief') return 1;
  if (item.startsWith('keyframe')) return 2;
  if (item === 'video') return 3;
  if (item === 'extraction') return 4;
  if (item === 'site' || item === 'theme') return 5;
  if (item === 'preview') return 6;
  return 1;
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
    const skippedKeyframes = gate === 'keyframes'
      && inventory.keyframePromptCount === 0
      && inventory.videoPromptExists;
    if (skippedKeyframes) continue;

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
    actionableSteps.length ? Math.min(...actionableSteps) : 7,
    inventory,
    unapproved,
  );
}

function keyframesSkipped(inventory) {
  return inventory.keyframePromptCount === 0 && inventory.videoPromptExists;
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
    if (upstreamGate === 'keyframes' && keyframesSkipped(inventory)) continue;
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
  if (gate === 'keyframes' && keyframesSkipped(inventory)) return 'skipped';
  const step = GATES.indexOf(gate) + 1;
  const incomplete = inventory.incomplete.some((item) => stepFor(item) === step);
  if (incomplete || !inventory.manifests[gate]) return 'incomplete';
  if (report.unapproved.includes(gate)) {
    return inventory.receipts[gate] ? 'needs re-review' : 'ready-unapproved';
  }
  const stale = inventory.stale.some((item) => stepFor(item) === step);
  if (stale) return 'stale';
  return 'done';
}

function printHuman(inventory, report, io) {
  GATES.forEach((gate, index) => {
    io.log((index + 1) + '. ' + gate + ': ' + stateForGate(gate, inventory, report));
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
