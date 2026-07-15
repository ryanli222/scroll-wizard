import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isDirect(importMetaUrl, argv1 = process.argv[1]) {
  return Boolean(argv1) && pathToFileURL(resolve(argv1)).href === importMetaUrl;
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
