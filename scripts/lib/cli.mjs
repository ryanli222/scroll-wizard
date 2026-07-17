import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isDirect(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  const resolved = resolve(argv1);
  // import.meta.url reflects Node's canonicalized (realpath'd) main module
  // path, but argv1 keeps whatever link (symlink/junction) was invoked --
  // e.g. an npm .bin shim or a manually linked skill install. Realpath
  // argv1 before comparing so invocation through a link still matches.
  let target = resolved;
  try {
    target = realpathSync(resolved);
  } catch {
    // Missing/unreadable file: fall back to the unresolved path so behavior
    // degrades to the old comparison instead of throwing.
  }
  return pathToFileURL(target).href === importMetaUrl;
}

export function valueAfter(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
    throw new Error('Missing value for ' + flag);
  }
  return argv[index + 1];
}

export function hasFlag(argv, flag) {
  return argv.includes(flag);
}
