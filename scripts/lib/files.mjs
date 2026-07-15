import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

export const sha256Text = (value) =>
  createHash('sha256').update(value).digest('hex');

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function directoryNonEmpty(path) {
  try {
    return (await readdir(path)).length > 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    if (error?.code === 'ENOTDIR') return true;
    throw error;
  }
}

export async function listFilesRecursive(root) {
  const files = [];

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = relativeDirectory
        ? join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        await walk(absolutePath, path);
      } else {
        files.push({ path, absolutePath });
      }
    }
  }

  await walk(root, '');
  return files.sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.tmp-' + randomUUID();
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function replaceDirectory(prepared, target, force) {
  const targetExists = await pathExists(target);
  if (targetExists && !force) {
    throw new Error(`Target already exists; use --force to replace it: ${target}`);
  }
  if (!targetExists) {
    await rename(prepared, target);
    return;
  }

  const backup = target + '.backup-' + randomUUID();
  await rename(target, backup);
  try {
    await rename(prepared, target);
  } catch (error) {
    try {
      await rm(target, { recursive: true, force: true });
      await rename(backup, target);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Failed to replace ${target} and restore its backup.`,
      );
    }
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}
