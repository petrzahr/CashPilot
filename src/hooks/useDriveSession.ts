import React, { useCallback, useEffect, useRef, useState } from 'react';
import { accountStorageKey } from '../services/syncModel';
import { SyncController, type SyncStatus } from '../services/syncController';
import { AppData, STORAGE_KEY_PRODUCTION, setActiveStorageKey } from '../services/storageService';
import {
  GoogleUser,
  fetchGoogleUserProfile,
  getValidAccessToken,
  isStoredTokenValid,
  loginToGoogle,
  logoutFromGoogle,
} from '../services/googleDriveService';
import {
  getLastDriveBackupAt,
  isDriveBackupEnabled,
  setDriveBackupEnabled as persistDriveBackupEnabled,
  tryRunDriveBackup,
} from '../services/driveBackupService';
import { describeSyncError } from '../services/syncErrorText';

type ToastFn = (
  text: string,
  type?: 'success' | 'info' | 'warning' | 'error',
  action?: { label: string; onClick: () => void }
) => void;

export interface DriveSessionOptions {
  /** Hotový controller (testy); jinak se session založí podle uloženého Google tokenu. */
  initialSession?: SyncController;
  /** Controller zveřejnil data (po načtení, synchronizaci nebo lokální změně). */
  onData: (data: AppData) => void;
  /** Bez uloženého tokenu se session nespouští; aplikace pokračuje s lokálními daty. */
  onNoSession: () => void;
  /** Po odpojení Google Disku se zobrazí prázdná lokální data. */
  onDisconnected: () => void;
  /** Aktuální data pro ruční zálohu. */
  getData: () => AppData;
  showToast: ToastFn;
}

/**
 * Relace s Google Diskem: ověření účtu, SyncController (durable journal + synchronizace),
 * obnovení při návratu do aplikace, zálohy do viditelné složky a oznámení o chybě synchronizace.
 * Doména do relace zapisuje jen přes change(); relace jí vrací data přes onData.
 */
export function useDriveSession(options: DriveSessionOptions) {
  // Callbacky se čtou přes ref: relace se nesmí restartovat jen kvůli nové identitě funkce
  const callbacks = useRef(options);
  callbacks.current = options;

  const controllerRef = useRef<SyncController | null>(options.initialSession || null);
  const authGeneration = useRef(0);

  const [driveSyncStatus, setDriveSyncStatus] = useState<SyncStatus>(() => isStoredTokenValid() ? 'loading' : 'disconnected');
  const [isDriveConnected, setIsDriveConnected] = useState(() => isStoredTokenValid());
  const [isCloudReady, setIsCloudReady] = useState(options.initialSession?.isReady || false);
  const [driveUser, setDriveUser] = useState<GoogleUser | null>(null);
  const [lastDriveSyncTime, setLastDriveSyncTime] = useState<Date | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveBackupEnabled, setDriveBackupEnabledState] = useState(() => isDriveBackupEnabled());
  const [lastDriveBackupTime, setLastDriveBackupTime] = useState<Date | null>(null);

  /** Zápis domény do relace; bez připraveného controlleru se nic neuloží. */
  const change = useCallback((action: React.SetStateAction<AppData>, reset?: boolean) => {
    controllerRef.current?.change(action, reset);
  }, []);

  const startCloudSession = useCallback(async (token: string, generation: number) => {
    setDriveSyncStatus('loading');
    setIsCloudReady(false);
    setDriveError(null);
    try {
      const user = await fetchGoogleUserProfile(token);
      if (generation !== authGeneration.current) return;
      if (!user?.permissionId) throw new Error('Nelze ověřit identitu Google účtu. Data nebyla sloučena.');
      // Keep the unscoped legacy cache verbatim for explicit recovery; ownership is unknown.
      const legacy = localStorage.getItem(STORAGE_KEY_PRODUCTION);
      if (legacy && !localStorage.getItem('cashpilot_legacy_cache_before_sync_v2')) {
        localStorage.setItem('cashpilot_legacy_cache_before_sync_v2', legacy);
      }
      setActiveStorageKey(accountStorageKey(user.permissionId));
      setDriveUser(user);
      setIsDriveConnected(true);
      setLastDriveBackupTime(getLastDriveBackupAt(user.permissionId));
      const controller = new SyncController(user.permissionId, () => getValidAccessToken() === token ? token : null, (next, status, ready, error) => {
        if (generation !== authGeneration.current) return;
        callbacks.current.onData(next);
        setDriveSyncStatus(status);
        setIsCloudReady(ready);
        setDriveError(error || null);
        if (status === 'synced') setLastDriveSyncTime(new Date());
      });
      controllerRef.current = controller;
      await controller.sync();
      if (generation !== authGeneration.current) return;
      // Zálohy jsou nezávislé na sync frontě a nesmí ji svým selháním ovlivnit; spouští se jednou za relaci (start appky).
      void tryRunDriveBackup(token, user.permissionId, controller.data).then((result) => {
        if (generation === authGeneration.current && result.ran) setLastDriveBackupTime(new Date());
      });
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setDriveSyncStatus('error');
      setDriveError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    const generation = ++authGeneration.current;
    const token = getValidAccessToken();
    if (token) void startCloudSession(token, generation);
    else callbacks.current.onNoSession();
    const resume = () => { void controllerRef.current?.sync(); };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++authGeneration.current;
      controllerRef.current?.stop();
      controllerRef.current = null;
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [startCloudSession]);

  const connectGoogleDrive = useCallback(async () => {
    const generation = ++authGeneration.current;
    controllerRef.current?.stop();
    controllerRef.current = null;
    setIsCloudReady(false);
    setDriveSyncStatus('loading');
    try {
      const token = await loginToGoogle();
      if (generation === authGeneration.current) await startCloudSession(token, generation);
    } catch (error) {
      if (generation !== authGeneration.current) return;
      setDriveSyncStatus('error');
      setDriveError((error as Error).message);
    }
  }, [startCloudSession]);

  const disconnectGoogleDrive = useCallback(async () => {
    ++authGeneration.current;
    controllerRef.current?.stop();
    controllerRef.current = null;
    setIsCloudReady(false);
    setIsDriveConnected(false);
    setDriveSyncStatus('disconnected');
    setActiveStorageKey(null);
    setDriveUser(null);
    setLastDriveSyncTime(null);
    setDriveError(null);
    callbacks.current.onDisconnected();
    await logoutFromGoogle();
  }, []);

  const syncWithGoogleDrive = useCallback(async (_forceDirection?: 'upload' | 'download') => {
    // All entry points reconcile the durable journal; manual directions cannot discard it.
    if (controllerRef.current) await controllerRef.current.sync();
    else {
      const token = getValidAccessToken();
      if (token) await startCloudSession(token, ++authGeneration.current);
      else await connectGoogleDrive();
    }
  }, [startCloudSession, connectGoogleDrive]);

  // Selhání synchronizace se nesmí ztratit v barevné tečce: při přechodu do chyby nebo konfliktu
  // zůstane oznámení s možností zkusit to znovu, po obnovení přijde krátké potvrzení.
  const lastSyncProblemRef = useRef(false);
  useEffect(() => {
    const isProblem = driveSyncStatus === 'error' || driveSyncStatus === 'conflict';
    if (!isCloudReady) return;
    const { showToast } = callbacks.current;
    if (isProblem && !lastSyncProblemRef.current) {
      lastSyncProblemRef.current = true;
      const text = driveSyncStatus === 'conflict'
        ? 'Změny z jiného zařízení se nepodařilo sloučit. Zkuste synchronizaci znovu, vaše data zůstávají v tomto zařízení.'
        : describeSyncError(driveError);
      showToast(text, 'error', { label: 'Zkusit znovu', onClick: () => { void syncWithGoogleDrive(); } });
    } else if (driveSyncStatus === 'synced' && lastSyncProblemRef.current) {
      lastSyncProblemRef.current = false;
      showToast('Změny jsou znovu uložené na Google Disku.');
    }
  }, [driveSyncStatus, driveError, isCloudReady, syncWithGoogleDrive]);

  const setDriveBackupEnabled = useCallback((enabled: boolean) => {
    persistDriveBackupEnabled(enabled);
    setDriveBackupEnabledState(enabled);
  }, []);

  const runDriveBackupNow = useCallback(async () => {
    const { showToast, getData } = callbacks.current;
    const token = getValidAccessToken();
    if (!token || !driveUser?.permissionId) {
      showToast('Nejdřív připojte Google Disk.', 'error');
      return;
    }
    const result = await tryRunDriveBackup(token, driveUser.permissionId, getData(), { force: true });
    if (result.ran) {
      setLastDriveBackupTime(new Date());
      showToast('Záloha byla uložena na Google Disk.');
    } else {
      showToast(`Zálohu se nepodařilo vytvořit: ${result.reason || 'neznámá chyba'}`, 'error');
    }
  }, [driveUser]);

  return {
    change,
    driveSyncStatus,
    isCloudReady,
    isDriveConnected,
    driveUser,
    lastDriveSyncTime,
    driveError,
    driveBackupEnabled,
    lastDriveBackupTime,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncWithGoogleDrive,
    setDriveBackupEnabled,
    runDriveBackupNow,
  };
}
