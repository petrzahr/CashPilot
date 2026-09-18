import { buildMultipartRequestBody, clearStoredAuth, getStoredAuth } from './googleDriveService';
import type { AppData } from './storageService';

/**
 * Periodické JSON zálohy do viditelné složky na Google Disku (mimo appDataFolder).
 * Nezávislé na SyncControlleru: běží jako "fire and forget" při startu relace a nikdy
 * nesmí selháním přerušit synchronizaci ani načtení dat.
 */

const BACKUP_FOLDER_NAME = 'CashPilot zalohy';
const BACKUP_FILENAME_PREFIX = 'cashpilot_zaloha_';
export const DRIVE_BACKUP_MAX_COUNT = 30;
export const DRIVE_BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hodin

const BACKUP_ENABLED_KEY = 'cashpilot_drive_backup_enabled_v1';
const BACKUP_LAST_RUN_PREFIX = 'cashpilot_drive_backup_last_run_v1:';

export function isDriveBackupEnabled(): boolean {
  try {
    const raw = localStorage.getItem(BACKUP_ENABLED_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setDriveBackupEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BACKUP_ENABLED_KEY, enabled ? '1' : '0');
  } catch (err) {
    console.error('Chyba při ukládání nastavení automatických záloh:', err);
  }
}

function lastBackupKey(accountId: string): string {
  return `${BACKUP_LAST_RUN_PREFIX}${accountId}`;
}

export function getLastDriveBackupAt(accountId: string): Date | null {
  try {
    const raw = localStorage.getItem(lastBackupKey(accountId));
    if (!raw) return null;
    const time = Number(raw);
    return Number.isFinite(time) ? new Date(time) : null;
  } catch {
    return null;
  }
}

function setLastDriveBackupAt(accountId: string, at: number): void {
  try {
    localStorage.setItem(lastBackupKey(accountId), String(at));
  } catch (err) {
    console.error('Chyba při ukládání času poslední zálohy:', err);
  }
}

interface DriveEntry {
  id: string;
  name: string;
}

async function driveFetch(token: string, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, {
    ...init, signal, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (res.status === 401) {
    if (getStoredAuth()?.accessToken === token) clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }
  return res;
}

async function findBackupFolderId(token: string, signal?: AbortSignal): Promise<string | null> {
  const query = `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10`;
  const res = await driveFetch(token, url, {}, signal);
  if (!res.ok) throw new Error(`Nepodařilo se najít složku záloh na Google Disku (HTTP ${res.status}).`);
  const data = await res.json();
  const files: DriveEntry[] = Array.isArray(data.files) ? data.files : [];
  return files[0]?.id ?? null;
}

async function createBackupFolder(token: string, signal?: AbortSignal): Promise<string> {
  const res = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  }, signal);
  if (!res.ok) throw new Error(`Nepodařilo se vytvořit složku záloh na Google Disku (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data.id) throw new Error('Google Disk nevrátil ID nově vytvořené složky záloh.');
  return data.id;
}

async function findOrCreateBackupFolderId(token: string, signal?: AbortSignal): Promise<string> {
  const existing = await findBackupFolderId(token, signal);
  return existing ?? createBackupFolder(token, signal);
}

async function listBackupFiles(token: string, folderId: string, signal?: AbortSignal): Promise<DriveEntry[]> {
  const query = `'${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name desc&pageSize=1000`;
  const res = await driveFetch(token, url, {}, signal);
  if (!res.ok) throw new Error(`Nepodařilo se vypsat zálohy na Google Disku (HTTP ${res.status}).`);
  const data = await res.json();
  return Array.isArray(data.files) ? data.files : [];
}

async function uploadBackupFile(token: string, folderId: string, appData: AppData, name: string, signal?: AbortSignal): Promise<void> {
  const boundary = `CashPilotBackup${Date.now()}`;
  const body = buildMultipartRequestBody({ name, parents: [folderId] }, JSON.stringify(appData, null, 2), boundary);
  const res = await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  }, signal);
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Nepodařilo se nahrát zálohu na Google Disk (HTTP ${res.status}): ${errorText}`);
  }
}

async function deleteBackupFile(token: string, fileId: string, signal?: AbortSignal): Promise<void> {
  const res = await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, signal);
  if (!res.ok && res.status !== 404) throw new Error(`Nepodařilo se smazat starou zálohu na Google Disku (HTTP ${res.status}).`);
}

export interface DriveBackupResult {
  ran: boolean;
  reason?: string;
}

/** Nahraje nový timestampovaný snapshot a odstraní zálohy nad DRIVE_BACKUP_MAX_COUNT. Řídí se přepínačem a intervalem, pokud není force. */
export async function runDriveBackupIfDue(
  token: string,
  accountId: string,
  appData: AppData,
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<DriveBackupResult> {
  if (!options.force && !isDriveBackupEnabled()) return { ran: false, reason: 'disabled' };
  const last = getLastDriveBackupAt(accountId);
  if (!options.force && last && Date.now() - last.getTime() < DRIVE_BACKUP_MIN_INTERVAL_MS) {
    return { ran: false, reason: 'throttled' };
  }

  const folderId = await findOrCreateBackupFolderId(token, options.signal);
  const name = `${BACKUP_FILENAME_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await uploadBackupFile(token, folderId, appData, name, options.signal);
  setLastDriveBackupAt(accountId, Date.now());

  try {
    const files = await listBackupFiles(token, folderId, options.signal);
    const stale = files.slice(DRIVE_BACKUP_MAX_COUNT);
    for (const file of stale) await deleteBackupFile(token, file.id, options.signal);
  } catch (err) {
    console.warn('CashPilot: úklid starých záloh na Google Disku selhal, nově nahraná záloha tím není ohrožena.', err);
  }

  return { ran: true };
}

/** Best-effort varianta pro volání na pozadí (např. při startu relace) – nikdy nevyhodí výjimku. */
export async function tryRunDriveBackup(
  token: string,
  accountId: string,
  appData: AppData,
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<DriveBackupResult> {
  try {
    return await runDriveBackupIfDue(token, accountId, appData, options);
  } catch (err) {
    console.warn('CashPilot: automatická záloha na Google Disk selhala.', err);
    return { ran: false, reason: (err as Error).message };
  }
}
