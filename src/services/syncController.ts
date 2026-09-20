import { createResetAppData } from '../constants/defaultData';
import { validateAndParseBackup, type AppData } from './storageService';
import { accountStorageKey, getDeviceId, mergePending, recordLocalChange, type SyncEnvelope } from './syncModel';
import { backupLegacyCloud, DriveConflictError, findAppDataFile, readDriveSnapshot, uploadToGoogleDrive } from './googleDriveService';

export type SyncStatus = 'disconnected' | 'idle' | 'loading' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
export const SYNC_LABELS: Record<SyncStatus, string> = {
  disconnected: 'Odpojeno', idle: 'Čeká na synchronizaci', loading: 'Načítám aktuální data z Google Disku…',
  syncing: 'Synchronizuji změny', synced: 'Synchronizováno', offline: 'Čeká na připojení',
  conflict: 'Konflikt synchronizace', error: 'Chyba synchronizace',
};
export const driveTransport = {
  find: findAppDataFile, read: readDriveSnapshot, upload: uploadToGoogleDrive, backup: backupLegacyCloud,
};
export class SyncController {
  private envelope: SyncEnvelope;
  private serialized: string | null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private key: string;
  private deviceId: string;
  constructor(identity: string, private token: () => string | null,
    private onChange: (data: AppData, status: SyncStatus, ready: boolean, error?: string) => void,
    private transport = driveTransport, private storage: Storage = localStorage) {
    this.key = accountStorageKey(identity);
    this.deviceId = getDeviceId();
    this.serialized = storage.getItem(this.key);
    this.envelope = this.serialized ? JSON.parse(this.serialized) : {
      data: createResetAppData(), pending: [], cloudRevision: 0, generation: 0,
    };
    this.envelope.data = validateAndParseBackup(JSON.stringify(this.envelope.data));
    if (!Array.isArray(this.envelope.pending) || this.envelope.pending.some(op =>
      !op || typeof op.operationId !== 'string' || typeof op.deviceId !== 'string' ||
      !Number.isSafeInteger(op.baseRevision) || !Number.isFinite(Date.parse(op.occurredAt)) ||
      !['create', 'update', 'delete'].includes(op.operation) || !op.payload
    )) throw new Error('Poškozená fronta lokálních operací.');
  }
  get isReady() { return this.ready; }
  get data() { return this.envelope.data; }
  get pendingCount() { return this.envelope.pending.length; }
  private emit(status: SyncStatus, error?: string) {
    if (!this.stopped) this.onChange(this.data, status, this.ready, error);
  }
  private persist(next: SyncEnvelope) {
    // Another tab must never silently overwrite this tab's durable journal.
    if (this.storage.getItem(this.key) !== this.serialized) throw new Error('Data změnila jiná karta. Obnovte stránku; změna nebyla uložena.');
    const serialized = JSON.stringify(next);
    this.storage.setItem(this.key, serialized); // Fail BEFORE publishing any in-memory change.
    this.serialized = serialized;
    this.envelope = next;
  }
  change(action: AppData | ((prev: AppData) => AppData), reset = false) {
    if (!this.ready || this.stopped) return;
    try {
      const requested = typeof action === 'function' ? action(this.data) : action;
      const next = recordLocalChange(this.envelope, requested, this.deviceId, new Date().toISOString(), reset);
      if (next === this.envelope) return;
      this.persist(next);
      this.emit(navigator.onLine === false ? 'offline' : 'syncing');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(); }, 1500);
    } catch (error) {
      this.emit('error', (error as Error).message);
      throw error;
    }
  }
  stop() {
    this.stopped = true;
    this.abort.abort();
    this.ready = false;
    clearTimeout(this.timer);
  }
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  private async run() {
    this.emit(this.ready ? 'syncing' : 'loading');
    try {
      let conflicts = 0;
      do {
        try {
          const token = this.token();
          if (!token) throw new Error('Platnost přihlášení vypršela. Přihlaste se znovu; čekající změny jsou zachovány.');
          if (navigator.onLine === false) { this.emit('offline'); return; }
          // Always resolve the canonical file under the CURRENT identity, never a global cached ID.
          const file = await this.transport.find(token, this.abort.signal);
          if (this.stopped) return;
          if (!file && this.envelope.fileId) throw new Error('Dříve synchronizovaný cloudový soubor nebyl nalezen. Lokální data zůstala zachována.');
          let cloud = createResetAppData(), etag: string | undefined;
          let legacy = false;
          if (file) {
            const snapshot = await this.transport.read(token, file.id, this.abort.signal);
            if (this.stopped) return;
            legacy = snapshot.data.version < 2 || !snapshot.data.sync;
            if (legacy) {
              this.storage.setItem(`${this.key}:cloud_backup:${file.id}`, JSON.stringify(snapshot.data));
              await this.transport.backup(token, file.id, snapshot.data, this.abort.signal);
              if (this.stopped) return;
            }
            cloud = validateAndParseBackup(JSON.stringify(snapshot.data));
            etag = snapshot.etag;
          }
          const captured = [...this.envelope.pending];
          const localRevision = this.data.sync.revision;
          let merged = mergePending(cloud, this.data, captured);
          const needsUpload = !file || legacy || captured.length > 0 || JSON.stringify(merged) !== JSON.stringify(cloud);
          // Preserve pending operations while exposing the reconciled state after a conflict.
          this.persist({ ...this.envelope, data: merged });
          if (this.ready) this.emit('syncing');
          let fileId = file?.id;
          if (needsUpload) {
            merged = { ...merged, sync: { revision: Math.max(cloud.sync.revision, localRevision, this.envelope.cloudRevision) + 1,
              updatedAt: new Date().toISOString(), updatedByDeviceId: this.deviceId } };
            const uploaded = await this.transport.upload(token, merged, fileId, etag, this.abort.signal);
            if (this.stopped) return;
            fileId = uploaded.id;
            // Recheck duplicates, including simultaneous first-file creation.
            const canonical = await this.transport.find(token, this.abort.signal);
            if (this.stopped) return;
            if (!canonical || canonical.id !== fileId) throw new DriveConflictError();
            const confirmed = await this.transport.read(token, fileId, this.abort.signal);
            if (this.stopped) return;
            if (JSON.stringify(confirmed.data) !== JSON.stringify(merged)) throw new DriveConflictError();
          }
          const acknowledged = new Set(captured.map(op => op.operationId));
          const remaining = this.envelope.pending.filter(op => !acknowledged.has(op.operationId));
          this.persist({ ...this.envelope, fileId, cloudRevision: merged.sync.revision,
            data: mergePending(merged, this.data, remaining), pending: remaining });
          this.ready = true;
          conflicts = 0;
          this.emit(remaining.length ? 'syncing' : 'synced');
        } catch (error) {
          if (error instanceof DriveConflictError && ++conflicts < 3 && !this.stopped) {
            // Give the other device a moment to finish writing before re-reading the cloud.
            await new Promise(resolve => setTimeout(resolve, 400 * conflicts + Math.random() * 300));
            continue;
          }
          throw error;
        }
      } while (!this.stopped && (this.envelope.pending.length > 0 || conflicts > 0));
    } catch (error) {
      const message = (error as Error).message;
      // Pending operations are preserved, so a persistent conflict is retried automatically instead of stalling.
      if (error instanceof DriveConflictError && !this.stopped) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.sync(); }, 5000);
      }
      this.emit(navigator.onLine === false ? 'offline' : error instanceof DriveConflictError || message.includes('Konflikt') ? 'conflict' : 'error', message);
    }
  }
}
