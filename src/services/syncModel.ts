import type { AppData } from './storageService';

export const COLLECTIONS = {
  transaction: 'transactions', account: 'accounts', category: 'categories',
  recurringRule: 'recurringRules', recurringException: 'recurringExceptions',
  correction: 'corrections', marketValueSnapshot: 'marketValueSnapshots',
} as const;
export type EntityType = keyof typeof COLLECTIONS;
export interface DeletionRecord { entityType: EntityType; entityId: string; deletedAt: string; deviceId: string }
export interface ResetMarker { resetAt: string; deviceId: string; operationId: string }
export interface SyncMetadata { revision: number; updatedAt: string; updatedByDeviceId: string }
export interface PendingOperation {
  operationId: string; deviceId: string; entityType: EntityType | 'settings' | 'reset';
  entityId: string; operation: 'create' | 'update' | 'delete'; occurredAt: string;
  baseRevision: number; resetId?: string; payload?: any;
}
export interface SyncEnvelope {
  data: AppData; pending: PendingOperation[]; cloudRevision: number;
  generation: number; fileId?: string;
}
export const EMPTY_SYNC: SyncMetadata = { revision: 0, updatedAt: '', updatedByDeviceId: '' };
export function getDeviceId(): string {
  const key = 'cashpilot_device_id_v2';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
export function accountStorageKey(identity: string): string {
  if (!identity) throw new Error('Chybí ověřená identita Google účtu.');
  return `cashpilot_sync_v2:${encodeURIComponent(identity)}`;
}
const time = (s?: string) => s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : 0;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only adds synchronization metadata. Never repairs, seeds or removes financial records. */
export function migrateSyncData(input: AppData): AppData {
  return { ...input, version: 2, deletions: input.deletions || [], sync: input.sync || { ...EMPTY_SYNC } };
}
export function mergeDeletions(...groups: DeletionRecord[][]): DeletionRecord[] {
  const map = new Map<string, DeletionRecord>();
  for (const d of groups.flat()) {
    const key = `${d.entityType}:${d.entityId}`, old = map.get(key);
    if (!old || time(d.deletedAt) > time(old.deletedAt) ||
      (time(d.deletedAt) === time(old.deletedAt) && d.deviceId > old.deviceId)) map.set(key, d);
  }
  return [...map.values()].sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`));
}
export function applyDeletions(input: AppData): AppData {
  const result = migrateSyncData(input);
  for (const [type, collection] of Object.entries(COLLECTIONS)) {
    const tombstones = new Map(result.deletions.filter(d => d.entityType === type).map(d => [d.entityId, d]));
    (result as any)[collection] = (result as any)[collection].filter((e: any) => {
      const d = tombstones.get(e.id);
      return !d || time(e.updatedAt || e.createdAt) > time(d.deletedAt);
    });
  }
  return result;
}

/** Called synchronously for EVERY local mutation, including cascading/bulk deletions. */
export function recordLocalChange(envelope: SyncEnvelope, requested: AppData, deviceId: string,
  now = new Date().toISOString(), reset = false): SyncEnvelope {
  const before = envelope.data;
  const next = migrateSyncData({ ...requested, deletions: before.deletions, sync: before.sync, resetMarker: before.resetMarker });
  const operations: PendingOperation[] = [];
  const add = (entityType: PendingOperation['entityType'], entityId: string,
    operation: PendingOperation['operation'], payload?: any) => {
    const op: PendingOperation = { operationId: crypto.randomUUID(), deviceId, entityType, entityId,
      operation, occurredAt: now, baseRevision: envelope.cloudRevision, resetId: next.resetMarker?.operationId, payload };
    operations.push(op); return op;
  };
  if (reset) {
    const op = add('reset', 'all', 'delete');
    next.resetMarker = { resetAt: now, deviceId, operationId: op.operationId };
    op.payload = next.resetMarker;
  }
  for (const [type, collection] of Object.entries(COLLECTIONS) as [EntityType, typeof COLLECTIONS[EntityType]][]) {
    const old = new Map<string, any>((before[collection] as any[]).map(e => [e.id, e]));
    const current = new Map<string, any>((next[collection] as any[]).map(e => [e.id, e]));
    for (const [id] of old) if (!current.has(id)) {
      const deletion: DeletionRecord = { entityType: type, entityId: id, deletedAt: now, deviceId };
      next.deletions = mergeDeletions(next.deletions, [deletion]);
      add(type, id, 'delete', deletion);
    }
    (next as any)[collection] = [...current.values()].map(e => {
      if (equal(e, old.get(e.id))) return e;
      const updated = { ...e, updatedAt: now };
      add(type, e.id, old.has(e.id) ? 'update' : 'create', updated);
      return updated;
    });
  }
  if (reset || !equal(before.settings, next.settings)) add('settings', 'settings', 'update', next.settings);
  if (!operations.length) return envelope;
  next.sync = { revision: Math.max(before.sync.revision, envelope.cloudRevision) + 1, updatedAt: now, updatedByDeviceId: deviceId };
  return { ...envelope, generation: envelope.generation + 1, data: next, pending: [...envelope.pending, ...operations] };
}

/** A cache is not an operation log. Only explicitly recorded changes may enter the cloud. */
export function mergePending(cloud: AppData, local: AppData, pending: PendingOperation[]): AppData {
  let result = migrateSyncData(structuredClone(cloud));
  result.deletions = mergeDeletions(result.deletions, local.deletions || []);
  for (const op of pending) {
    if (op.entityType === 'reset') {
      const marker = op.payload as ResetMarker;
      if (!result.resetMarker || op.baseRevision >= cloud.sync.revision || time(marker.resetAt) > time(result.resetMarker.resetAt) ||
        (time(marker.resetAt) === time(result.resetMarker.resetAt) && marker.operationId > result.resetMarker.operationId)) {
        for (const collection of Object.values(COLLECTIONS)) (result as any)[collection] = [];
        result.resetMarker = marker;
      }
      continue;
    }
    // Epoch identity protects reset even when an old device's clock is ahead.
    if (result.resetMarker && op.resetId !== result.resetMarker.operationId) continue;
    if (op.entityType === 'settings') { result.settings = op.payload; continue; }
    if (op.operation === 'delete') {
      result.deletions = mergeDeletions(result.deletions, [op.payload]); continue;
    }
    const collection = COLLECTIONS[op.entityType];
    const list: any[] = (result as any)[collection];
    const old = list.find(e => e.id === op.entityId);
    if (!old || op.baseRevision >= cloud.sync.revision || time(op.payload.updatedAt) > time(old.updatedAt || old.createdAt) ||
      (time(op.payload.updatedAt) === time(old.updatedAt || old.createdAt) && JSON.stringify(op.payload) > JSON.stringify(old))) {
      (result as any)[collection] = [...list.filter(e => e.id !== op.entityId), op.payload];
    }
  }
  result = applyDeletions(result);
  return result;
}
