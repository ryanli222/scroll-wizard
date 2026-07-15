import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';

import { hasFlag, isDirect, valueAfter } from './lib/cli.mjs';
import {
  canonicalJson,
  listFilesRecursive,
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

export function manifestHash(entries) {
  const normalized = [...entries]
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
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
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function regularFilesRecursive(root) {
  if (!await pathExists(root)) return [];
  const candidates = await listFilesRecursive(root);
  const inspected = await Promise.all(candidates.map(async (file) => ({
    ...file,
    regular: (await lstat(file.absolutePath)).isFile(),
  })));
  return inspected
    .filter(({ regular }) => regular)
    .map(({ regular: _regular, ...file }) => file);
}

async function manifestFile(path, logical) {
  if (!await pathExists(path)) return null;
  if (!(await lstat(path)).isFile()) return null;
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

async function activeKeyframePlan(projectDir) {
  const promptsDir = join(projectDir, 'prompts');
  const imagesDir = join(projectDir, 'input', 'keyframes');
  const promptEntries = await pathExists(promptsDir)
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

  const imageEntries = await pathExists(imagesDir)
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

  return { prompts, images, incompleteRoles };
}

export async function buildGateManifest(projectDir, gate) {
  if (!GATES.includes(gate)) throw new Error('Unknown gate: ' + gate);

  if (gate === 'brief') {
    const entry = await manifestFile(join(projectDir, 'brief.md'), 'brief.md');
    return entry ? [entry] : null;
  }

  if (gate === 'keyframes') {
    const plan = await activeKeyframePlan(projectDir);
    if (!plan.prompts.length || plan.incompleteRoles.length) return null;
    const selectedImages = plan.images.filter((image) => (
      plan.prompts.some((prompt) => prompt.role === image.role)
    ));
    return sortManifestEntries([
      ...await Promise.all(plan.prompts.map((prompt) => manifestFile(
        prompt.absolutePath,
        logicalPath('prompts', prompt.name),
      ))),
      ...await Promise.all(selectedImages.map((image) => manifestFile(
        image.absolutePath,
        logicalPath('input/keyframes', image.name),
      ))),
    ]);
  }

  if (gate === 'video') {
    const entry = await manifestFile(
      join(projectDir, 'input', 'video.mp4'),
      'input/video.mp4',
    );
    return entry ? [entry] : null;
  }

  const valuesPath = join(projectDir, 'values.json');
  if (gate === 'extraction') {
    const projectFrames = await regularFilesRecursive(join(projectDir, 'frames'));
    const siteFrames = await regularFilesRecursive(join(projectDir, 'site', 'frames'));
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

  const siteFiles = await regularFilesRecursive(join(projectDir, 'site'));
  if (!siteFiles.length) return null;
  return sortManifestEntries(await hashFiles(siteFiles, 'site'));
}

async function regularFileExists(path) {
  return await pathExists(path) && (await lstat(path)).isFile();
}

async function newestMtime(path) {
  if (!await pathExists(path)) return null;
  const metadata = await lstat(path);
  if (metadata.isFile()) return metadata.mtimeMs;
  if (!metadata.isDirectory()) return null;
  const files = await regularFilesRecursive(path);
  if (!files.length) return null;
  return Math.max(...await Promise.all(files.map(async (file) => (
    (await lstat(file.absolutePath)).mtimeMs
  ))));
}

export async function buildInventory(projectDir) {
  const keyframePlan = await activeKeyframePlan(projectDir);
  const videoPromptExists = await regularFileExists(
    join(projectDir, 'prompts', 'video.txt'),
  );
  const manifestPairs = await Promise.all(GATES.map(async (gate) => {
    const entries = await buildGateManifest(projectDir, gate);
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
  const mtimePairs = await Promise.all(Object.entries(paths).map(async ([name, path]) => (
    [name, await newestMtime(path)]
  )));
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
  let upstreamValidHash = null;
  let chainBroken = false;

  for (const gate of GATES) {
    const skippedKeyframes = gate === 'keyframes'
      && inventory.keyframePromptCount === 0
      && inventory.videoPromptExists;
    if (skippedKeyframes) continue;

    const currentHash = inventory.manifests[gate];
    if (!currentHash) {
      if (unapproved.length) {
        return finish(GATES.indexOf(unapproved[0]) + 1, inventory, unapproved);
      }
      if (gate === 'keyframes' && inventory.keyframePromptCount === 0) {
        return finish(2, inventory, unapproved);
      }
      return finish(GATES.indexOf(gate) + 1, inventory, unapproved);
    }

    const receipt = inventory.receipts[gate];
    const valid = !chainBroken
      && receipt?.manifestHash === currentHash
      && receipt?.basedOn === upstreamValidHash;
    if (!valid) {
      chainBroken = true;
      unapproved.push(gate);
    } else {
      upstreamValidHash = currentHash;
    }
  }

  if (unapproved.length) {
    return finish(GATES.indexOf(unapproved[0]) + 1, inventory, unapproved);
  }
  if (inventory.incomplete.length) {
    return finish(stepFor(inventory.incomplete[0]), inventory, unapproved);
  }
  if (inventory.stale.length) {
    return finish(stepFor(inventory.stale[0]), inventory, unapproved);
  }
  return finish(7, inventory, unapproved);
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
  if (report.unapproved.includes(gate)) {
    return inventory.receipts[gate] ? 'needs re-review' : 'ready-unapproved';
  }
  const step = GATES.indexOf(gate) + 1;
  const incomplete = inventory.incomplete.some((item) => stepFor(item) === step);
  if (incomplete || !inventory.manifests[gate]) return 'incomplete';
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
