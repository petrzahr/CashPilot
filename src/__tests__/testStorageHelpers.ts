import { getActiveStorageKey, loadStoredDataResult, type AppData } from '../services/storageService';

/**
 * Testovací pomocníci nad localStorage. `loadStoredData`/`saveStoredData` byly dříve
 * exportovány přímo z storageService, ale v produkci se nepoužívají (data zapisuje
 * SyncController přímo do Storage) — zůstávají zde jen pro pohodlí ~50 testů.
 */
export function saveStoredData(data: AppData, targetKey?: string): void {
  const key = targetKey || getActiveStorageKey();
  localStorage.setItem(key, JSON.stringify(data));
}

export function loadStoredData(targetKey?: string): AppData {
  return loadStoredDataResult(targetKey).data;
}
