import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResetAppData } from '../constants/defaultData';
import { validateAndParseBackup, type AppData } from '../services/storageService';
import { COLLECTIONS, accountStorageKey, applyDeletions, mergePending, recordLocalChange, type SyncEnvelope } from '../services/syncModel';
import { SyncController, type SyncStatus } from '../services/syncController';
import { calculateQuickFinancialOverview, type QuickFinancialOverview } from '../services/financialEngine';
import type { Account, Transaction } from '../types/finance';
import { DriveConflictError, findAppDataFile, pickCanonicalDriveFile, readDriveSnapshot, uploadToGoogleDrive } from '../services/googleDriveService';

export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); },
    removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: n => [...values.keys()][n] ?? null,
    get length() { return values.size; } };
}
const stamp = '2026-09-14T12:00:00.000Z';
const tx = (id = 'tx', updatedAt = stamp): any => ({ id, updatedAt, createdAt: updatedAt,
  title: id, type: 'expense', amountInHaler: 100, date: '2026-09-14', sequence: 1, status: 'planned' });
const envelope = (data = createResetAppData()): SyncEnvelope => ({ data, pending: [], generation: 0, cloudRevision: data.sync.revision });
const change = (base: AppData, next: AppData, now = stamp, reset = false) => recordLocalChange(envelope(base), next, 'device', now, reset);
function fakeDrive(initial = createResetAppData()) {
  let cloud = structuredClone(initial), revision = 0;
  const transport = {
    find: vi.fn(async () => ({ id: 'file', name: 'cashpilot_data.json' })),
    read: vi.fn(async () => ({ data: structuredClone(cloud), etag: `"${revision}"` })),
    backup: vi.fn(async () => {}),
    upload: vi.fn(async (_token: string, data: AppData, _id?: string, etag?: string) => {
      if (etag !== `"${revision}"`) throw new DriveConflictError();
      cloud = structuredClone(data); revision++;
      return { id: 'file', name: 'cashpilot_data.json' };
    }),
  };
  return { transport, get cloud() { return cloud; } };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('publishes current sidebar groups after load, local CRUD, and remote restoration', async () => {
  const initial = createResetAppData();
  initial.accounts = (['checking', 'savings', 'investment', 'pension'] as const).map((type): Account => ({
    id: type, name: type, type, currency: 'CZK', initialBalanceInHaler: 1000,
    initialBalanceDate: '2026-01-01', isUsableCash: type === 'checking', isNetWorth: false,
    status: 'active', color: '#000000', sortOrder: 0, createdAt: stamp, updatedAt: stamp,
  }));
  const drive = fakeDrive(initial);
  let overview: QuickFinancialOverview | undefined;
  const controller = new SyncController('sidebar', () => 'token', (data) => {
    overview = calculateQuickFinancialOverview(data.accounts, data.transactions, data.corrections,
      data.marketValueSnapshots, '2026-09-14');
  }, drive.transport);
  const expected = {
    checkingAndCashInHaler: 1000, savingsInHaler: 1000, investmentsInHaler: 1000,
    pensionInHaler: 1000, totalNetWorthInHaler: 0,
  };
  try {
    await controller.sync();
    expect(overview).toEqual(expected);
    const expense: Transaction = { id: 'sidebar-expense', title: 'Expense', type: 'expense',
      sourceAccountId: 'checking', amountInHaler: 100, status: 'executed', date: '2026-09-14',
      sequence: 1, createdAt: stamp, updatedAt: stamp };
    controller.change(data => ({ ...data, transactions: [expense] }));
    expect(overview).toEqual({ ...expected, checkingAndCashInHaler: 900 });
    controller.change(data => ({ ...data, transactions: [{ ...expense, actualAmountInHaler: 250 }] }));
    expect(overview).toEqual({ ...expected, checkingAndCashInHaler: 750 });
    controller.change(data => ({ ...data, transactions: [] }));
    expect(overview).toEqual(expected);
    controller.change(data => ({ ...data, accounts: data.accounts.map(a => ({ ...a, initialBalanceInHaler: 2000 })) }));
    expect(overview).toEqual({ ...expected, checkingAndCashInHaler: 2000, savingsInHaler: 2000,
      investmentsInHaler: 2000, pensionInHaler: 2000 });
    await controller.sync();
    drive.cloud.accounts = drive.cloud.accounts.map(a => ({ ...a, initialBalanceInHaler: 3000, isNetWorth: true }));
    drive.cloud.sync.revision++;
    await controller.sync();
    expect(overview).toEqual({ checkingAndCashInHaler: 3000, savingsInHaler: 3000,
      investmentsInHaler: 3000, pensionInHaler: 3000, totalNetWorthInHaler: 12000 });
    controller.change(data => ({ ...data, accounts: data.accounts.filter(a => a.id !== 'savings') }));
    expect(overview?.savingsInHaler).toBe(0);
    expect(overview?.totalNetWorthInHaler).toBe(9000);
  } finally {
    controller.stop();
  }
});

describe('durable deletion and operation model', () => {
  it('does not resurrect Vercel deletions from an unjournaled localhost cache, even without historical tombstones', () => {
    const cloud = createResetAppData(), cache = { ...cloud, transactions: [tx()] };
    expect(mergePending(cloud, cache, []).transactions).toEqual([]);
  });
  it('uploads a real offline create but not an unrelated old cached entity', () => {
    const base = { ...createResetAppData(), transactions: [tx('old-cache')] };
    const local = change(base, { ...base, transactions: [...base.transactions, tx('offline')] });
    expect(mergePending(createResetAppData(), local.data, local.pending).transactions.map(e => e.id)).toEqual(['offline']);
  });
  it.each(Object.entries(COLLECTIONS))('persists %s tombstones for all physically removed records', (type, collection) => {
    const base = { ...createResetAppData(), [collection]: [tx('removed')] };
    const local = change(base, { ...base, [collection]: [] });
    expect(local.data.deletions[0]).toMatchObject({ entityType: type, entityId: 'removed', deletedAt: stamp });
    expect((mergePending(base, local.data, local.pending) as any)[collection]).toEqual([]);
    expect((mergePending(local.data, base, []) as any)[collection]).toEqual([]);
  });
  it.each([
    ['2026-09-14T11:00:00Z', 0], ['2026-09-14T12:00:00Z', 0], ['2026-09-14T13:00:00Z', 1],
  ])('compares update %s against deletion, with delete winning ties', (updated, count) => {
    const base = { ...createResetAppData(), transactions: [tx('tx', updated)] };
    const d = { entityType: 'transaction' as const, entityId: 'tx', deletedAt: stamp, deviceId: 'other' };
    expect(applyDeletions({ ...base, deletions: [d] }).transactions).toHaveLength(count);
    expect(mergePending(base, { ...base, deletions: [d] }, []).transactions).toHaveLength(count);
  });
  it('retains the newest deletion and never prunes tombstones', () => {
    const base = { ...createResetAppData(), transactions: [tx()], deletions: [{ entityType: 'transaction' as const, entityId: 'tx', deletedAt: '2030-01-01T00:00:00Z', deviceId: 'fast' }] };
    expect(change(base, { ...base, transactions: [] }).data.deletions[0].deletedAt).toBe('2030-01-01T00:00:00Z');
  });
  it('records account cascades, series, corrections, exceptions, and snapshots in one change', () => {
    const base = createResetAppData();
    for (const collection of Object.values(COLLECTIONS)) (base as any)[collection] = [tx(collection)];
    const local = change(base, createResetAppData());
    expect(local.pending).toHaveLength(7);
    expect(local.data.deletions).toHaveLength(7);
    for (const collection of Object.values(COLLECTIONS)) expect(mergePending(base, local.data, local.pending)[collection]).toEqual([]);
  });
  it('reset rejects old device operations even if that device clock is years ahead', () => {
    const base = { ...createResetAppData(), transactions: [tx('old')] };
    const reset = change(base, createResetAppData(), stamp, true);
    const cloud = mergePending(base, reset.data, reset.pending);
    const stale = change(base, { ...base, transactions: [tx('old'), tx('offline')] }, '2030-01-01T00:00:00Z');
    expect(mergePending(cloud, stale.data, stale.pending).transactions).toEqual([]);
    const fresh = change(cloud, { ...cloud, transactions: [tx('after-reset')] }, '2026-09-14T13:00:00Z');
    expect(mergePending(cloud, fresh.data, fresh.pending).transactions[0].id).toBe('after-reset');
  });
  it('migrates without editing IDs, financial fields, corrections or snapshots', () => {
    const old: any = { ...createResetAppData(), version: 1, transactions: [tx()], corrections: [tx('orphan')], marketValueSnapshots: [tx('snapshot')] };
    delete old.deletions; delete old.sync;
    const migrated = validateAndParseBackup(JSON.stringify(old));
    for (const collection of Object.values(COLLECTIONS)) expect(migrated[collection]).toEqual(old[collection]);
    expect(migrated.deletions).toEqual([]); expect(migrated.version).toBe(2);
  });
  it('uses the observed revision for a causally newer edit when the device clock is slow', () => {
    const base = { ...createResetAppData(), transactions: [tx('tx', '2030-01-01T00:00:00Z')] };
    base.sync.revision = 10;
    const local = change(base, { ...base, transactions: [{ ...base.transactions[0], title: 'Edited after reading revision 10' }] });
    expect(mergePending(base, local.data, local.pending).transactions[0].title).toBe('Edited after reading revision 10');
  });
  it('rejects corrupt deletion metadata instead of interpreting it as a deletion', () => {
    const data = { ...createResetAppData(), deletions: [{ entityType: 'transaction', entityId: 'x', deletedAt: 'invalid', deviceId: 'x' }] };
    expect(() => validateAndParseBackup(JSON.stringify(data))).toThrow('evidence smazání');
  });
});

describe('serialized cloud synchronization', () => {
  it('blocks edits and uploads while initial cloud read is pending', async () => {
    const drive = fakeDrive();
    let release!: () => void;
    drive.transport.read.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r; }); return { data: drive.cloud, etag: '"0"' }; });
    const states: SyncStatus[] = [];
    const session = new SyncController('user', () => 'token', (_d, s) => states.push(s), drive.transport);
    const running = session.sync();
    await Promise.resolve();
    session.change({ ...session.data, transactions: [tx()] });
    expect(session.pendingCount).toBe(0); expect(session.isReady).toBe(false);
    expect(drive.transport.upload).not.toHaveBeenCalled();
    expect(session.sync()).toBe(running);
    release(); await running;
    expect(session.isReady).toBe(true); expect(states[0]).toBe('loading');
    session.stop();
  });
  it('persists before debounce, survives closing, and acknowledges only after verified upload', async () => {
    const drive = fakeDrive();
    const first = new SyncController('user', () => 'token', () => {}, drive.transport);
    await first.sync();
    first.change({ ...first.data, transactions: [tx('offline')] });
    expect(first.pendingCount).toBe(1);
    first.stop();
    const states: SyncStatus[] = [];
    const next = new SyncController('user', () => 'token', (_d, s) => states.push(s), drive.transport);
    expect(next.pendingCount).toBe(1);
    await next.sync();
    expect(drive.cloud.transactions[0].id).toBe('offline');
    expect(next.pendingCount).toBe(0); expect(states[states.length - 1]).toBe('synced'); next.stop();
  });
  it('two independent origins preserve both concurrent changes through ETag retry', async () => {
    const drive = fakeDrive();
    const a = new SyncController('user', () => 'token', () => {}, drive.transport, memoryStorage());
    const b = new SyncController('user', () => 'token', () => {}, drive.transport, memoryStorage());
    await Promise.all([a.sync(), b.sync()]);
    a.change({ ...a.data, transactions: [tx('a')] });
    b.change({ ...b.data, transactions: [tx('b')] });
    await Promise.all([a.sync(), b.sync()]);
    await Promise.all([a.sync(), b.sync()]);
    expect(drive.cloud.transactions.map(e => e.id).sort()).toEqual(['a', 'b']);
    expect(a.data.transactions).toEqual(b.data.transactions);
    expect(a.pendingCount + b.pendingCount).toBe(0); a.stop(); b.stop();
  });
  it('queues changes made during upload without acknowledging them prematurely', async () => {
    const drive = fakeDrive();
    const session = new SyncController('user', () => 'token', () => {}, drive.transport);
    await session.sync();
    const upload = drive.transport.upload.getMockImplementation()!;
    drive.transport.upload.mockImplementationOnce(async (...args) => {
      session.change({ ...session.data, transactions: [...session.data.transactions, tx('during')] });
      return upload(...args);
    });
    session.change({ ...session.data, transactions: [tx('before')] });
    await session.sync();
    expect(drive.cloud.transactions.map(e => e.id).sort()).toEqual(['before', 'during']);
    expect(drive.transport.upload).toHaveBeenCalledTimes(2); expect(session.pendingCount).toBe(0); session.stop();
  });
  it('retries three conflicts and retains durable operations with conflict status', async () => {
    const drive = fakeDrive(); const states: SyncStatus[] = [];
    const session = new SyncController('user', () => 'token', (_d, s) => states.push(s), drive.transport);
    await session.sync();
    session.change({ ...session.data, transactions: [tx()] });
    drive.transport.upload.mockRejectedValue(new DriveConflictError());
    await session.sync();
    expect(drive.transport.upload).toHaveBeenCalledTimes(3); expect(session.pendingCount).toBe(1);
    expect(states[states.length - 1]).toBe('conflict'); session.stop();
  });
  it('isolates caches, file IDs and pending operations by account', async () => {
    const driveA = fakeDrive(), driveB = fakeDrive();
    const a = new SyncController('A', () => 'token-A', () => {}, driveA.transport);
    await a.sync(); a.change({ ...a.data, transactions: [tx('private-A')] }); a.stop();
    const b = new SyncController('B', () => 'token-B', () => {}, driveB.transport);
    await b.sync(); expect(b.data.transactions).toEqual([]); expect(b.pendingCount).toBe(0);
    expect(JSON.parse(localStorage.getItem(accountStorageKey('A'))!).pending).toHaveLength(1); b.stop();
  });
  it('stops callbacks and acknowledgements when logging out during an upload', async () => {
    const drive = fakeDrive(); const callback = vi.fn();
    const a = new SyncController('A', () => 'token', callback, drive.transport);
    await a.sync(); a.change({ ...a.data, transactions: [tx()] });
    drive.transport.upload.mockImplementationOnce(async () => { a.stop(); callback.mockClear(); return { id: 'file', name: '' }; });
    await a.sync(); expect(callback).not.toHaveBeenCalled(); expect(a.pendingCount).toBe(1);
  });
  it('backs up legacy cloud before a migration upload, preserving current records', async () => {
    const old = { ...createResetAppData(), version: 1, transactions: [tx('already-resurrected')] };
    const drive = fakeDrive(old);
    const a = new SyncController('A', () => 'token', () => {}, drive.transport);
    await a.sync();
    expect(drive.transport.backup).toHaveBeenCalledWith('token', 'file', old, expect.any(AbortSignal));
    expect(drive.transport.backup.mock.invocationCallOrder[0]).toBeLessThan(drive.transport.upload.mock.invocationCallOrder[0]);
    expect(drive.cloud.transactions).toEqual(old.transactions); a.stop();
  });
  it('storage failure does not publish or upload an unpersisted change', async () => {
    const drive = fakeDrive(), storage = memoryStorage();
    const a = new SyncController('A', () => 'token', () => {}, drive.transport, storage);
    await a.sync(); storage.setItem = () => { throw new Error('quota'); };
    expect(() => a.change({ ...a.data, transactions: [tx()] })).toThrow('quota');
    expect(a.data.transactions).toEqual([]); expect(drive.transport.upload).not.toHaveBeenCalled(); a.stop();
  });
  it('a failed migration backup leaves cloud and operations intact', async () => {
    const drive = fakeDrive({ ...createResetAppData(), version: 1, transactions: [tx()] });
    drive.transport.backup.mockRejectedValue(new Error('Backup failed'));
    const states: SyncStatus[] = [];
    const session = new SyncController('A', () => 'token', (_d, s) => states.push(s), drive.transport);
    await session.sync();
    expect(session.isReady).toBe(false); expect(states[states.length - 1]).toBe('error');
    expect(drive.transport.upload).not.toHaveBeenCalled(); expect(drive.cloud.transactions).toHaveLength(1); session.stop();
  });
  it('preserves pending operations while offline and syncs after reconnect', async () => {
    const drive = fakeDrive(); const states: SyncStatus[] = [];
    const session = new SyncController('A', () => 'token', (_d, s) => states.push(s), drive.transport);
    await session.sync();
    vi.stubGlobal('navigator', { onLine: false });
    session.change({ ...session.data, transactions: [tx()] }); await session.sync();
    expect(session.pendingCount).toBe(1); expect(states[states.length - 1]).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true }); await session.sync();
    expect(session.pendingCount).toBe(0); expect(drive.cloud.transactions).toHaveLength(1); session.stop();
  });
  it('does not overwrite a newer journal from another tab', async () => {
    const drive = fakeDrive();
    const a = new SyncController('A', () => 'token', () => {}, drive.transport);
    await a.sync();
    const b = new SyncController('A', () => 'token', () => {}, drive.transport);
    await b.sync(); b.change({ ...b.data, transactions: [tx('other-tab')] });
    expect(() => a.change({ ...a.data, transactions: [tx('this-tab')] })).toThrow('jiná karta');
    const stored = JSON.parse(localStorage.getItem(accountStorageKey('A'))!);
    expect(stored.pending[0].payload.id).toBe('other-tab'); a.stop(); b.stop();
  });
});

describe('Drive concurrency protocol', () => {
  it('keeps the newest duplicate and renames the others instead of failing', async () => {
    const files = [
      { id: 'old', name: 'cashpilot_data.json', modifiedTime: '2026-09-14T10:00:00Z' },
      { id: 'new', name: 'cashpilot_data.json', modifiedTime: '2026-09-14T12:00:00Z' },
    ];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'PATCH' ? { id: 'old' } : { files })));
    vi.stubGlobal('fetch', fetch);
    expect(await findAppDataFile('token')).toMatchObject({ id: 'new' });
    const patch = (fetch.mock.calls as any[]).find(([, init]) => init?.method === 'PATCH');
    expect(patch[0]).toContain('/files/old');
    expect(JSON.parse(patch[1].body).name).toMatch(/^cashpilot_duplicate_.*_old\.json$/);
  });
  it('resolves duplicates deterministically when timestamps tie', () => {
    const at = (id: string, size?: string) => ({ id, name: 'cashpilot_data.json', modifiedTime: '2026-09-14T12:00:00Z', size });
    expect(pickCanonicalDriveFile([at('a', '10'), at('b', '20')])?.id).toBe('b');
    expect(pickCanonicalDriveFile([at('a'), at('b')])?.id).toBe('b');
    expect(pickCanonicalDriveFile([])).toBeNull();
  });
  it('refuses to create a second file from an incomplete empty listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [], incompleteSearch: true }))));
    await expect(findAppDataFile('token')).rejects.toThrow('Konflikt');
  });
  it('follows pagination instead of treating extra pages as a conflict', async () => {
    const pages = [
      { files: [{ id: 'a', modifiedTime: '2026-09-14T10:00:00Z' }], nextPageToken: 'p2' },
      { files: [{ id: 'b', modifiedTime: '2026-09-14T09:00:00Z' }] },
      { id: 'b' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(pages.shift()))));
    expect(await findAppDataFile('token')).toMatchObject({ id: 'a' });
  });
  it('never sends an unchecked overwrite', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(uploadToGoogleDrive('token', createResetAppData(), 'file')).rejects.toThrow('ETag');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends If-Match and surfaces 412 for retry', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 412 })); vi.stubGlobal('fetch', fetch);
    await expect(uploadToGoogleDrive('token', createResetAppData(), 'file', '"etag"')).rejects.toBeInstanceOf(DriveConflictError);
    expect((fetch.mock.calls as any)[0][1].headers['If-Match']).toBe('"etag"');
  });
  it('rejects a cloud file changing between metadata and content reads', async () => {
    const responses = [{ etag: '"1"', version: '1' }, createResetAppData(), { etag: '"2"', version: '2' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responses.shift()))));
    await expect(readDriveSnapshot('token', 'file')).rejects.toBeInstanceOf(DriveConflictError);
  });
});
