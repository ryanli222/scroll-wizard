#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isDirect, valueAfter } from './lib/cli.mjs';
import {
  archetypeGuidance,
  filterProviderRoutes,
  rankProviderRoutes,
  recommendBeatCount,
} from './lib/generation.mjs';

const USAGE = [
  'Usage:',
  '  plan-generation beats --claims N --sections N [--process] [--catalog N]',
  '  plan-generation guidance --register full3d|product [--archetype ARCH]',
  '  plan-generation routes <routes.json> --budget-micros N '
    + '--preset free|cheapest|balanced|quality-first --duration N '
    + '--resolution VALUE [--first-last] [--references N]',
].join('\n');

const PRESETS = new Set(['free', 'cheapest', 'balanced', 'quality-first']);

function validateOptions(argv, start, valueFlags, booleanFlags) {
  const seen = new Set();
  for (let index = start; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!valueFlags.has(argument) && !booleanFlags.has(argument)) {
      throw new Error('Unknown option: ' + argument);
    }
    if (seen.has(argument)) throw new Error('Duplicate option: ' + argument);
    seen.add(argument);
    if (valueFlags.has(argument)) index += 1;
  }
}

function integerFlag(argv, flag) {
  const value = valueAfter(argv, flag);
  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(parsed)) {
    throw new Error(flag.slice(2) + ' must be a non-negative integer.');
  }
  return parsed;
}

function optionalIntegerFlag(argv, flag, fallback) {
  if (!argv.includes(flag)) return fallback;
  return integerFlag(argv, flag);
}

function numericFlag(argv, flag) {
  const value = valueAfter(argv, flag);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || String(value).trim() === '') {
    throw new Error(flag.slice(2) + ' must be a non-negative number.');
  }
  return parsed;
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  runner = readFile,
) {
  const command = argv[0];
  try {
    if (command === 'beats') {
      validateOptions(
        argv,
        1,
        new Set(['--claims', '--sections', '--catalog']),
        new Set(['--process']),
      );
      const beatCount = recommendBeatCount({
        catalogItems: optionalIntegerFlag(argv, '--catalog', 0),
        claimCount: integerFlag(argv, '--claims'),
        hasProcess: argv.includes('--process'),
        sectionCount: integerFlag(argv, '--sections'),
      });
      io.log(JSON.stringify({ beatCount }, null, 2));
      return 0;
    }

    if (command === 'guidance') {
      validateOptions(
        argv,
        1,
        new Set(['--register', '--archetype']),
        new Set(),
      );
      const guidance = archetypeGuidance({
        register: valueAfter(argv, '--register'),
        archetype: argv.includes('--archetype') ? valueAfter(argv, '--archetype') : undefined,
      });
      io.log(JSON.stringify(guidance, null, 2));
      return 0;
    }

    if (command !== 'routes' || !argv[1] || argv[1].startsWith('--')) {
      io.error(USAGE);
      return 1;
    }
    validateOptions(
      argv,
      2,
      new Set([
        '--budget-micros',
        '--preset',
        '--duration',
        '--resolution',
        '--references',
      ]),
      new Set(['--first-last']),
    );

    const preset = valueAfter(argv, '--preset');
    if (!PRESETS.has(preset)) {
      throw new Error(
        'preset must be free, cheapest, balanced, or quality-first.',
      );
    }
    const requestedBudgetMicros = integerFlag(argv, '--budget-micros');
    const requirements = {
      budgetMicros: preset === 'free' ? 0 : requestedBudgetMicros,
      duration: numericFlag(argv, '--duration'),
      firstLast: argv.includes('--first-last'),
      preset,
      referenceCount: optionalIntegerFlag(argv, '--references', 0),
      resolution: valueAfter(argv, '--resolution'),
    };

    let routes;
    try {
      routes = JSON.parse(await runner(resolve(argv[1]), 'utf8'));
    } catch (error) {
      io.error('Could not read routes: ' + String(error?.message ?? error));
      return 2;
    }
    if (!Array.isArray(routes)) throw new Error('Routes file must contain an array.');
    const { eligible, excluded } = filterProviderRoutes(routes, requirements);
    const ranked = rankProviderRoutes(eligible, preset);
    io.log(JSON.stringify({
      eligible: ranked,
      excluded,
      recommended: ranked[0] ?? null,
    }, null, 2));
    return 0;
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 1;
  }
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
