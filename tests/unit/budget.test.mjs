import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  budgetTotals,
  createBudget,
  main,
  markTransactionUnknown,
  raiseBudgetCap,
  reserveTransaction,
  settleTransaction,
} from '../../scripts/budget.mjs';

const temporaryRoots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'scroll-wizard-budget-'));
  temporaryRoots.push(root);
  return root;
}

function fakeIo() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  };
}

function initArgs(root, capMicros = '1000000') {
  return [
    root,
    'init',
    '--preset', 'balanced',
    '--cap-micros', capMicros,
  ];
}

function reserveArgs(root, id = 'video-1', quotedMicros = '800000') {
  return [
    root,
    'reserve',
    '--id', id,
    '--kind', 'video',
    '--provider', 'verified',
    '--model', 'model-v1',
    '--quoted-micros', quotedMicros,
    '--prompt-path', 'prompts/video.txt',
    '--improvement', 'motion continuity',
  ];
}

async function storedBudget(root) {
  return JSON.parse(await readFile(join(root, 'budget.json'), 'utf8'));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('budget ledger', () => {
  it('reserves quoted cost and blocks calls over the hard cap', () => {
    const ledger = createBudget({
      capMicros: 1_000_000,
      currency: 'USD',
      preset: 'balanced',
    });
    const reserved = reserveTransaction(ledger, {
      id: 'video-1',
      kind: 'video',
      model: 'm',
      promptPath: 'prompts/video.txt',
      provider: 'verified',
      quotedMicros: 800_000,
    }, '2026-07-18T00:00:00.000Z');

    expect(budgetTotals(reserved).remainingMicros).toBe(200_000);
    expect(() => reserveTransaction(reserved, {
      id: 'reroll-1',
      improvement: 'motion continuity',
      kind: 'reroll',
      model: 'm',
      provider: 'verified',
      quotedMicros: 300_000,
    })).toThrow(
      'Reservation exceeds hard cap by exactly 100000 micros. '
      + 'An additional 100000 micros would fund this reroll and is likely to improve '
      + 'motion continuity, but improvement is not guaranteed. The cap was not raised.',
    );
    expect(budgetTotals(reserved).remainingMicros).toBe(200_000);
  });

  it('settles actual cost, releases quote headroom, and reconciles unknown holds', () => {
    const ledger = reserveTransaction(createBudget({
      capMicros: 1_000_000,
      currency: 'USD',
      preset: 'cheapest',
    }), {
      id: 'still-1',
      kind: 'still',
      model: 'm',
      provider: 'p',
      quotedMicros: 200_000,
    });

    const settled = settleTransaction(ledger, 'still-1', 150_000);
    expect(budgetTotals(settled)).toMatchObject({
      remainingMicros: 850_000,
      reservedMicros: 0,
      spentMicros: 150_000,
    });
    const unknown = markTransactionUnknown(ledger, 'still-1');
    expect(budgetTotals(unknown).reservedMicros).toBe(200_000);
    expect(budgetTotals(settleTransaction(unknown, 'still-1', 175_000)))
      .toMatchObject({ reservedMicros: 0, spentMicros: 175_000 });
  });

  it('requires an explicit strictly higher cap', () => {
    const ledger = createBudget({
      capMicros: 0,
      currency: 'USD',
      preset: 'free',
    });

    expect(raiseBudgetCap(ledger, 500_000, 'cheapest')).toMatchObject({
      capMicros: 500_000,
      preset: 'cheapest',
    });
    expect(() => raiseBudgetCap(ledger, 0)).toThrow(/higher/);
  });

  it('rejects floating, unsafe, and invalid allocation amounts', () => {
    expect(() => createBudget({ capMicros: 0.1, preset: 'balanced' }))
      .toThrow(/capMicros/);
    expect(() => createBudget({
      allocations: { videoMicros: 1 },
      capMicros: 0,
      preset: 'free',
    })).toThrow(/Free.*allocation/);
    expect(() => createBudget({
      capMicros: Number.MAX_SAFE_INTEGER + 1,
      preset: 'balanced',
    })).toThrow(/safe integer/);
  });
});

describe('budget main', () => {
  it('rejects a positive paid allocation when initializing Free', async () => {
    const root = await temporaryRoot();
    const io = fakeIo();

    expect(await main([
      root,
      'init',
      '--preset', 'free',
      '--cap-micros', '0',
      '--video-micros', '1',
    ], io)).toBe(1);

    expect(io.error.mock.calls.flat().join('\n')).toMatch(/Free.*allocation/);
    await expect(readFile(join(root, 'budget.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reserves atomically with integer totals and no leftover files', async () => {
    const root = await temporaryRoot();
    expect(await main(initArgs(root), fakeIo())).toBe(0);
    const io = fakeIo();

    expect(await main(reserveArgs(root), io)).toBe(0);

    const persisted = await storedBudget(root);
    expect(persisted.transactions).toHaveLength(1);
    expect(persisted.transactions[0]).toMatchObject({
      id: 'video-1',
      quotedMicros: 800000,
      status: 'reserved',
    });
    expect(persisted.totals).toEqual({
      quotedMicros: 800000,
      remainingMicros: 200000,
      reservedMicros: 800000,
      spentMicros: 0,
    });
    expect(await readdir(root)).toEqual(['budget.json']);
    expect(JSON.parse(io.log.mock.calls[0][0]).remainingMicros).toBe(200000);
  });

  it('rejects duplicate IDs and requires unknown calls to reconcile before reuse', async () => {
    const root = await temporaryRoot();
    expect(await main(initArgs(root), fakeIo())).toBe(0);
    expect(await main(reserveArgs(root), fakeIo())).toBe(0);
    expect(await main([root, 'unknown', '--id', 'video-1'], fakeIo())).toBe(0);
    const duplicateIo = fakeIo();

    expect(await main(reserveArgs(root), duplicateIo)).toBe(1);
    expect(duplicateIo.error.mock.calls.flat().join('\n')).toMatch(/Duplicate/);
    expect(await main([
      root,
      'settle',
      '--id', 'video-1',
      '--actual-micros', '700000',
    ], fakeIo())).toBe(0);
    expect((await storedBudget(root)).totals).toMatchObject({
      reservedMicros: 0,
      spentMicros: 700000,
    });
  });

  it('leaves the previous ledger valid when an atomic write fails', async () => {
    const root = await temporaryRoot();
    expect(await main(initArgs(root), fakeIo())).toBe(0);
    const before = await readFile(join(root, 'budget.json'), 'utf8');
    const io = fakeIo();
    const writeError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });

    expect(await main(reserveArgs(root), io, {
      writeJsonAtomic: vi.fn().mockRejectedValue(writeError),
    })).toBe(2);

    await expect(readFile(join(root, 'budget.json'), 'utf8')).resolves.toBe(before);
    expect(io.error.mock.calls.flat().join('\n')).toMatch(/Budget write failed.*disk full/);
    expect(await readdir(root)).toEqual(['budget.json']);
  });

  it('prevents concurrent reservations from losing updates or exceeding the cap', async () => {
    const root = await temporaryRoot();
    expect(await main(initArgs(root, '500000'), fakeIo())).toBe(0);
    const firstIo = fakeIo();
    const secondIo = fakeIo();

    const results = await Promise.all([
      main(reserveArgs(root, 'video-1', '400000'), firstIo),
      main(reserveArgs(root, 'video-2', '400000'), secondIo),
    ]);

    expect(results.sort()).toEqual([0, 2]);
    const persisted = await storedBudget(root);
    expect(persisted.transactions).toHaveLength(1);
    expect(persisted.totals.remainingMicros).toBe(100000);
    expect(await readdir(root)).toEqual(['budget.json']);
    expect([...firstIo.error.mock.calls, ...secondIo.error.mock.calls].flat().join('\n'))
      .toMatch(/locked/i);
  });

  it('uses exit 1 for usage and validation, and exit 2 for runtime reads', async () => {
    const usageIo = fakeIo();
    expect(await main([], usageIo)).toBe(1);
    expect(usageIo.error.mock.calls[0][0]).toMatch(/^Usage:/);

    const root = await temporaryRoot();
    const validationIo = fakeIo();
    expect(await main([
      root,
      'init',
      '--preset', 'balanced',
      '--cap-micros', '0.5',
    ], validationIo)).toBe(1);
    expect(validationIo.error.mock.calls.flat().join('\n')).toMatch(/integer/);

    const ioIo = fakeIo();
    expect(await main([root, 'status'], ioIo)).toBe(2);
    expect(ioIo.error.mock.calls.flat().join('\n')).toMatch(/ENOENT|no such file/i);
  });
});
