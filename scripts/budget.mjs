#!/usr/bin/env node

import {
  mkdir,
  open,
  readFile,
  rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { isDirect, valueAfter } from './lib/cli.mjs';
import { writeJsonAtomic } from './lib/files.mjs';

const PRESETS = new Set(['free', 'cheapest', 'balanced', 'quality-first']);
const USAGE = 'Usage: budget <project> init|status|reserve|settle|unknown|raise-cap [options]';

function money(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(name + ' must be a non-negative safe integer.');
  }
  return value;
}

function addMoney(left, right, name) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(name + ' exceeds the safe integer range.');
  }
  return result;
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(name + ' must be a non-empty string.');
  }
  return value;
}

export function budgetTotals(ledger) {
  if (!ledger || !Array.isArray(ledger.transactions)) {
    throw new Error('Ledger transactions must be an array.');
  }
  let quotedMicros = 0;
  let reservedMicros = 0;
  let spentMicros = 0;
  for (const transaction of ledger.transactions) {
    const quoted = money(transaction.quotedMicros, 'quotedMicros');
    quotedMicros = addMoney(quotedMicros, quoted, 'quotedMicros total');
    if (['reserved', 'unknown'].includes(transaction.status)) {
      reservedMicros = addMoney(reservedMicros, quoted, 'reservedMicros total');
    }
    if (transaction.status === 'settled') {
      spentMicros = addMoney(
        spentMicros,
        money(transaction.actualMicros, 'actualMicros'),
        'spentMicros total',
      );
    }
  }
  const capMicros = money(ledger.capMicros, 'capMicros');
  const committed = addMoney(spentMicros, reservedMicros, 'committed total');
  return {
    quotedMicros,
    remainingMicros: capMicros - committed,
    reservedMicros,
    spentMicros,
  };
}

export function createBudget({
  allocations = {},
  capMicros,
  currency = 'USD',
  preset,
}) {
  if (!PRESETS.has(preset)) throw new Error('Invalid preset.');
  money(capMicros, 'capMicros');
  nonEmpty(currency, 'currency');
  if (!allocations || Array.isArray(allocations) || typeof allocations !== 'object') {
    throw new Error('allocations must be an object.');
  }
  let allocatedMicros = 0;
  for (const [name, value] of Object.entries(allocations)) {
    allocatedMicros = addMoney(
      allocatedMicros,
      money(value, 'allocations.' + name),
      'allocation total',
    );
  }
  if (preset === 'free' && (capMicros !== 0 || allocatedMicros !== 0)) {
    throw new Error('Free preset cap and paid allocations must be zero.');
  }
  if (allocatedMicros > capMicros) {
    throw new Error('Paid allocations exceed the hard cap.');
  }
  return {
    allocations,
    capMicros,
    currency,
    preset,
    transactions: [],
    version: 1,
  };
}

export function reserveTransaction(
  ledger,
  transaction,
  timestamp = new Date().toISOString(),
) {
  nonEmpty(transaction?.id, 'transaction id');
  nonEmpty(transaction?.kind, 'transaction kind');
  nonEmpty(transaction?.provider, 'transaction provider');
  nonEmpty(transaction?.model, 'transaction model');
  if (ledger.transactions.some((item) => item.id === transaction.id)) {
    throw new Error('Duplicate transaction id. Unknown calls must be reconciled before retrying.');
  }
  money(transaction.quotedMicros, 'quotedMicros');
  const remainingMicros = budgetTotals(ledger).remainingMicros;
  if (transaction.quotedMicros > remainingMicros) {
    const extraMicros = transaction.quotedMicros - remainingMicros;
    const improvement = transaction.improvement
      ? String(transaction.improvement)
      : 'the targeted ' + transaction.kind + ' result';
    throw new Error(
      'Reservation exceeds hard cap by exactly ' + extraMicros + ' micros. '
      + 'An additional ' + extraMicros + ' micros would fund this '
      + transaction.kind + ' and is likely to improve ' + improvement
      + ', but improvement is not guaranteed. The cap was not raised.',
    );
  }
  return {
    ...ledger,
    transactions: [...ledger.transactions, {
      ...transaction,
      status: 'reserved',
      timestamp,
    }],
  };
}

export function settleTransaction(
  ledger,
  id,
  actualMicros,
  timestamp = new Date().toISOString(),
) {
  money(actualMicros, 'actualMicros');
  const target = ledger.transactions.find((item) => item.id === id);
  if (!target || !['reserved', 'unknown'].includes(target.status)) {
    throw new Error('Transaction is not reservable.');
  }
  if (actualMicros > target.quotedMicros) {
    throw new Error('Actual cost exceeds approved quote; reconcile manually.');
  }
  return {
    ...ledger,
    transactions: ledger.transactions.map((item) => item.id === id
      ? { ...item, actualMicros, settledAt: timestamp, status: 'settled' }
      : item),
  };
}

export function markTransactionUnknown(ledger, id) {
  const target = ledger.transactions.find((item) => item.id === id);
  if (!target) throw new Error('Unknown transaction id.');
  if (!['reserved', 'unknown'].includes(target.status)) {
    throw new Error('Only an unsettled transaction can be marked unknown.');
  }
  return {
    ...ledger,
    transactions: ledger.transactions.map((item) => item.id === id
      ? { ...item, status: 'unknown' }
      : item),
  };
}

export function raiseBudgetCap(ledger, capMicros, preset = ledger.preset) {
  money(capMicros, 'capMicros');
  if (capMicros <= ledger.capMicros) {
    throw new Error('New cap must be a higher integer amount.');
  }
  if (!PRESETS.has(preset)) throw new Error('Invalid preset.');
  if (preset === 'free') {
    throw new Error('Raising a Free budget requires a paid preset.');
  }
  return { ...ledger, capMicros, preset };
}

const required = (argv, flag) => valueAfter(argv, flag);

const integer = (argv, flag) => {
  const raw = required(argv, flag);
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed)) {
    throw new Error(flag + ' must be a non-negative safe integer.');
  }
  return parsed;
};

const optional = (argv, flag, fallback = null) => (
  argv.includes(flag) ? required(argv, flag) : fallback
);

function validateOptions(argv, flags) {
  const seen = new Set();
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!flags.has(argument)) throw new Error('Unknown option: ' + argument);
    if (seen.has(argument)) throw new Error('Duplicate option: ' + argument);
    seen.add(argument);
    index += 1;
  }
}

function invalidLedger(message) {
  return Object.assign(
    new Error('budget.json has an invalid or unsupported shape: ' + message),
    { code: 'EBUDGET' },
  );
}

function validatePersistedLedger(ledger) {
  try {
    if (
      ledger?.version !== 1
      || !Array.isArray(ledger.transactions)
      || !PRESETS.has(ledger.preset)
      || !ledger.allocations
      || Array.isArray(ledger.allocations)
      || typeof ledger.allocations !== 'object'
    ) {
      throw new Error('unsupported top-level fields');
    }
    money(ledger.capMicros, 'capMicros');
    nonEmpty(ledger.currency, 'currency');
    let allocationTotal = 0;
    for (const [name, value] of Object.entries(ledger.allocations)) {
      allocationTotal = addMoney(
        allocationTotal,
        money(value, 'allocations.' + name),
        'allocation total',
      );
    }
    if (allocationTotal > ledger.capMicros) {
      throw new Error('allocations exceed the hard cap');
    }
    if (ledger.preset === 'free' && (ledger.capMicros !== 0 || allocationTotal !== 0)) {
      throw new Error('Free cap and allocations must be zero');
    }

    const ids = new Set();
    for (const transaction of ledger.transactions) {
      nonEmpty(transaction?.id, 'transaction id');
      nonEmpty(transaction?.kind, 'transaction kind');
      nonEmpty(transaction?.provider, 'transaction provider');
      nonEmpty(transaction?.model, 'transaction model');
      money(transaction?.quotedMicros, 'quotedMicros');
      if (ids.has(transaction.id)) throw new Error('duplicate transaction id');
      ids.add(transaction.id);
      if (!['reserved', 'unknown', 'settled'].includes(transaction.status)) {
        throw new Error('unsupported transaction status');
      }
      if (transaction.status === 'settled') {
        money(transaction.actualMicros, 'actualMicros');
        if (transaction.actualMicros > transaction.quotedMicros) {
          throw new Error('settled actualMicros exceeds quotedMicros');
        }
      }
    }
    if (budgetTotals(ledger).remainingMicros < 0) {
      throw new Error('committed total exceeds the hard cap');
    }
  } catch (error) {
    if (error?.code === 'EBUDGET') throw error;
    throw invalidLedger(String(error?.message ?? error));
  }
  return ledger;
}

async function readLedger(path, reader) {
  const ledger = JSON.parse(await reader(path, 'utf8'));
  return validatePersistedLedger(ledger);
}

async function acquireLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw Object.assign(
        new Error('Budget ledger is locked by another writer.'),
        { code: 'ELOCKED' },
      );
    }
    throw error;
  }
  await handle.writeFile(String(process.pid) + '\n', 'utf8');
  await handle.sync();
  return handle;
}

async function releaseLock(lockPath, handle) {
  await handle?.close();
  await rm(lockPath, { force: true });
}

function runtime(runner = {}) {
  return {
    acquireLock: runner.acquireLock ?? acquireLock,
    readFile: runner.readFile ?? readFile,
    releaseLock: runner.releaseLock ?? releaseLock,
    writeJsonAtomic: runner.writeJsonAtomic ?? writeJsonAtomic,
  };
}

function optionsFor(command) {
  if (command === 'init') {
    return new Set([
      '--currency', '--preset', '--cap-micros',
      '--still-micros', '--video-micros', '--reroll-micros',
    ]);
  }
  if (command === 'reserve') {
    return new Set([
      '--id', '--kind', '--provider', '--model', '--quoted-micros',
      '--prompt-path', '--duration', '--resolution', '--improvement',
    ]);
  }
  if (command === 'settle') return new Set(['--id', '--actual-micros']);
  if (command === 'unknown') return new Set(['--id']);
  if (command === 'raise-cap') return new Set(['--cap-micros', '--preset']);
  if (command === 'status') return new Set();
  return null;
}

function transitionFor(command, argv) {
  if (command === 'reserve') {
    return (ledger) => reserveTransaction(ledger, {
      duration: optional(argv, '--duration'),
      id: required(argv, '--id'),
      improvement: optional(argv, '--improvement'),
      kind: required(argv, '--kind'),
      model: required(argv, '--model'),
      promptPath: optional(argv, '--prompt-path'),
      provider: required(argv, '--provider'),
      quotedMicros: integer(argv, '--quoted-micros'),
      resolution: optional(argv, '--resolution'),
    });
  }
  if (command === 'settle') {
    const id = required(argv, '--id');
    const actualMicros = integer(argv, '--actual-micros');
    return (ledger) => settleTransaction(ledger, id, actualMicros);
  }
  if (command === 'unknown') {
    const id = required(argv, '--id');
    return (ledger) => markTransactionUnknown(ledger, id);
  }
  const capMicros = integer(argv, '--cap-micros');
  const preset = optional(argv, '--preset');
  return (ledger) => raiseBudgetCap(ledger, capMicros, preset ?? ledger.preset);
}

function output(ledger) {
  return { ...budgetTotals(ledger), ledger };
}

export async function main(
  argv = process.argv.slice(2),
  io = console,
  runner = {},
) {
  const projectDir = argv[0];
  const command = argv[1];
  const allowed = optionsFor(command);
  if (!projectDir || projectDir.startsWith('--') || !command || !allowed) {
    io.error(USAGE);
    return 1;
  }

  let initLedger;
  let transition;
  try {
    validateOptions(argv, allowed);
    if (command === 'init') {
      initLedger = createBudget({
        allocations: {
          rerollMicros: optional(argv, '--reroll-micros') === null
            ? 0 : integer(argv, '--reroll-micros'),
          stillMicros: optional(argv, '--still-micros') === null
            ? 0 : integer(argv, '--still-micros'),
          videoMicros: optional(argv, '--video-micros') === null
            ? 0 : integer(argv, '--video-micros'),
        },
        capMicros: integer(argv, '--cap-micros'),
        currency: optional(argv, '--currency', 'USD'),
        preset: required(argv, '--preset'),
      });
    } else if (command !== 'status') {
      transition = transitionFor(command, argv);
    }
  } catch (error) {
    io.error(String(error?.message ?? error));
    return 1;
  }

  const path = join(resolve(projectDir), 'budget.json');
  const lockPath = path + '.lock';
  const operations = runtime(runner);
  if (command === 'status') {
    try {
      const ledger = await readLedger(path, operations.readFile);
      io.log(JSON.stringify(output(ledger), null, 2));
      return 0;
    } catch (error) {
      io.error(String(error?.message ?? error));
      return error instanceof SyntaxError || error?.code ? 2 : 1;
    }
  }

  let lock;
  let result = 0;
  try {
    lock = await operations.acquireLock(lockPath);
    let next;
    if (command === 'init') {
      next = initLedger;
    } else {
      const ledger = await readLedger(path, operations.readFile);
      next = transition(ledger);
    }
    try {
      await operations.writeJsonAtomic(path, {
        ...next,
        totals: budgetTotals(next),
      });
    } catch (error) {
      io.error('Budget write failed: ' + String(error?.message ?? error));
      result = 2;
      return result;
    }
    io.log(JSON.stringify(output(next), null, 2));
  } catch (error) {
    io.error(String(error?.message ?? error));
    result = error instanceof SyntaxError || error?.code ? 2 : 1;
  } finally {
    if (lock) {
      try {
        await operations.releaseLock(lockPath, lock);
      } catch (error) {
        io.error('Budget lock cleanup failed: ' + String(error?.message ?? error));
        result = 2;
      }
    }
  }
  return result;
}

if (isDirect(import.meta.url)) {
  process.exitCode = await main();
}
