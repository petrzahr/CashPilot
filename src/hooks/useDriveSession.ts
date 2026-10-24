import React, { useCallback, useEffect, useRef, useState } from 'react';
import { accountStorageKey } from '../services/syncModel';
import { SyncController, type SyncStatus } from '../services/syncController';
import { AppData, STORAGE_KEY_PRODUCTION, saveCorruptedRecoveryCopy, setActiveStorageKey } from '../services/storageService';
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
  /** Lokální obálku účtu nelze načíst; zůstala beze změny a její kopie je pod recoveryKey. */
  onLoadError: (details: { message: string; recoveryKey?: string; corruptedRaw?: string }) => void;
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

  /**
   * Zápis domény do relace. Vrací false, pokud relace ještě nemá načtená data (před první
   * synchronizací nebo po odpojení) - změna se pak neuloží a volající to musí oznámit.
   */
  const change = useCallback((action: React.SetStateAction<AppData>, reset?: boolean): boolean => {
    const controller = controllerRef.current;
    if (!controller || !controller.isReady) return false;
    controller.change(action, reset);
    return true;
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
      let controller: SyncController;
      try {
        controller = new SyncController(user.permissionId, () => getValidAccessToken() === token ? token : null, (next, status, ready, error) => {
          if (generation !== authGeneration.current) return;
          callbacks.current.onData(next);
          setDriveSyncStatus(status);
          setIsCloudReady(ready);
          setDriveError(error || null);
          if (status === 'synced') setLastDriveSyncTime(new Date());
        });
      } catch (error) {
        // Poškozená lokální obálka není chyba synchronizace: obálka zůstane beze změny a nabídne se obnova
        const corruptedRaw = localStorage.getItem(accountStorageKey(user.permissionId)) ?? undefined;
        const message = `Data uložená v tomto prohlížeči se nepodařilo bezpečně načíst (${(error as Error).message}). Původní data nebyla přepsána.`;
        setDriveSyncStatus('error');
        setDriveError(message);
        callbacks.current.onLoadError({
          message,
          recoveryKey: corruptedRaw === undefined ? undefined : saveCorruptedRecoveryCopy(corruptedRaw),
          corruptedRaw,
        });
        return;
      }
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

  /**
   * Zahodí poškozenou lokální obálku a načte data z Google Disku jako na novém zařízení.
   * Nová obálka nemá resetMarker, takže cloud zůstane netknutý. Obálka se smaže jen tehdy,
   * když je její přesná kopie bezpečně uložená pod recovery klíčem. Vrací 'ready', když je relace
   * po úvodní synchronizaci připravená na zápis, 'pending', když se úvodní synchronizace nedokončila,
   * a 'refused', když se obálka nesmazala (důvod už oznámil toast).
   */
  const discardCorruptedCache = useCallback(async (): Promise<'ready' | 'pending' | 'refused'> => {
    const { showToast } = callbacks.current;
    const token = getValidAccessToken();
    if (!token || !driveUser?.permissionId || controllerRef.current) {
      showToast('Data z Google Disku teď nelze načíst. Zkuste nejdřív „Načíst znovu“.', 'error');
      return 'refused';
    }
    const key = accountStorageKey(driveUser.permissionId);
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const recoveryKey = saveCorruptedRecoveryCopy(raw);
      if (!recoveryKey || localStorage.getItem(recoveryKey) !== raw) {
        showToast('Kopii poškozených dat se nepodařilo uložit, proto zůstala beze změny.', 'error');
        return 'refused';
      }
      localStorage.removeItem(key);
    }
    await startCloudSession(token, ++authGeneration.current);
    // startCloudSession controller nastavil; TS po await kontrolu výše nezneplatní
    const controller = controllerRef.current as SyncController | null;
    return controller?.isReady ? 'ready' : 'pending';
  }, [driveUser, startCloudSession]);

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
    discardCorruptedCache,
    setDriveBackupEnabled,
    runDriveBackupNow,
  };
}
