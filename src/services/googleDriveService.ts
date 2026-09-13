/**
 * Google Drive Sync Service pro CashPilot
 * Využívá Google Identity Services (GIS) Token Client a Google Drive API v3 (appDataFolder).
 */

import { AppData, sanitizeCorrections } from './storageService';
import {
  Account,
  AppSettings,
  BalanceCorrection,
  Category,
  MarketValueSnapshot,
  RecurringException,
  RecurringRule,
  Transaction,
} from '../types/finance';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  isKnownDemoRecordId,
} from '../constants/defaultData';
import { sanitizeAndRepairSequences } from './sequenceService';


// Typy pro Google Identity Services (GIS)
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

export interface GoogleUser {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (err: unknown) => void;
            prompt?: string;
          }) => GoogleTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export const GOOGLE_DRIVE_APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const CASH_PILOT_DATA_FILENAME = 'cashpilot_data.json';
const AUTH_STORAGE_KEY = 'cashpilot_google_auth_v1';

export interface StoredAuthData {
  accessToken: string;
  expiresAt: number; // Unix timestamp v ms
  user?: GoogleUser;
}

/**
 * Načte Client ID z proměnné prostředí Vite
 */
export function getGoogleClientId(): string {
  const envId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return envId || '471929194107-leupf0slff3no70bl5u7104aaim5jcmf.apps.googleusercontent.com';
}

/**
 * Uloží autentizační token a volitelná uživatelská data do localStorage
 */
export function saveStoredAuth(auth: StoredAuthData): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch (err) {
    console.error('Chyba při ukládání Google autentizace:', err);
  }
}

/**
 * Načte uloženou Google autentizaci
 */
export function getStoredAuth(): StoredAuthData | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthData;
    if (!parsed.accessToken || typeof parsed.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Vymaže uloženou autentizaci
 */
export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (err) {
    console.error('Chyba při mazání Google autentizace:', err);
  }
}

/**
 * Zkontroluje, zda máme platný (neexpirovaný) access token
 */
export function isStoredTokenValid(): boolean {
  const auth = getStoredAuth();
  if (!auth) return false;
  // Nechat rezervu 60 sekund před skutečnou expirací
  return auth.expiresAt > Date.now() + 60000;
}

/**
 * Získá aktuální platný token z úložiště
 */
export function getValidAccessToken(): string | null {
  if (!isStoredTokenValid()) return null;
  return getStoredAuth()?.accessToken || null;
}

/**
 * Čeká na načtení Google Identity Services (GIS) skriptu
 */
export function waitForGoogleClient(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Knihovna Google Identity Services nebyla včas načtena. Zkontrolujte připojení k internetu.'));
      }
    }, 100);
  });
}

/**
 * Singleton pro Token Client
 */
let cachedTokenClient: GoogleTokenClient | null = null;
let currentResolve: ((response: GoogleTokenResponse) => void) | null = null;
let currentReject: ((err: Error) => void) | null = null;

/**
 * Inicializuje Google OAuth Token Client
 */
export async function getOrCreateTokenClient(): Promise<GoogleTokenClient> {
  if (cachedTokenClient) return cachedTokenClient;

  await waitForGoogleClient();

  if (!window.google?.accounts?.oauth2?.initTokenClient) {
    throw new Error('Google Identity Services oauth2 není k dispozici.');
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Není nastaven VITE_GOOGLE_CLIENT_ID.');
  }

  cachedTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_DRIVE_APP_DATA_SCOPE,
    callback: (response: GoogleTokenResponse) => {
      if (response.error) {
        console.error('Chyba při autorizaci Google účtu:', response.error, response.error_description);
        if (currentReject) {
          currentReject(new Error(response.error_description || response.error));
          currentReject = null;
          currentResolve = null;
        }
      } else if (response.access_token) {
        const expiresInSec = response.expires_in || 3600;
        const expiresAt = Date.now() + expiresInSec * 1000;
        const current = getStoredAuth();
        saveStoredAuth({
          accessToken: response.access_token,
          expiresAt,
          user: current?.user,
        });

        if (currentResolve) {
          currentResolve(response);
          currentResolve = null;
          currentReject = null;
        }
      }
    },
    error_callback: (err: unknown) => {
      console.error('Google OAuth error_callback:', err);
      if (currentReject) {
        currentReject(new Error(String(err)));
        currentReject = null;
        currentResolve = null;
      }
    },
  });

  return cachedTokenClient;
}

/**
 * Vyvolá přihlášení uživatele (otevře OAuth dialog)
 */
export async function loginToGoogle(prompt: string = 'select_account'): Promise<string> {
  const tokenClient = await getOrCreateTokenClient();

  return new Promise((resolve, reject) => {
    currentResolve = (response) => resolve(response.access_token);
    currentReject = (err) => reject(err);

    try {
      tokenClient.requestAccessToken({ prompt });
    } catch (err) {
      currentResolve = null;
      currentReject = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Odhlásí uživatele a revokuje token
 */
export async function logoutFromGoogle(): Promise<void> {
  const auth = getStoredAuth();
  if (auth?.accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      await new Promise<void>((resolve) => {
        window.google!.accounts!.oauth2!.revoke(auth.accessToken, () => resolve());
        // Fallback pokud callback nezavolá
        setTimeout(resolve, 1500);
      });
    } catch (e) {
      console.warn('Chyba při revokaci Google tokenu:', e);
    }
  }
  clearStoredAuth();
}

/**
 * Načte základní profil uživatele přes Drive API about.get
 */
export async function fetchGoogleUserProfile(token: string): Promise<GoogleUser | null> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (data.user) {
      const user: GoogleUser = {
        displayName: data.user.displayName,
        emailAddress: data.user.emailAddress,
        photoLink: data.user.photoLink,
      };
      // Aktualizovat uloženou autentizaci
      const current = getStoredAuth();
      if (current) {
        saveStoredAuth({ ...current, user });
      }
      return user;
    }
    return null;
  } catch (err) {
    console.warn('Nepodařilo se načíst profil uživatele z Google Drive API:', err);
    return null;
  }
}

/**
 * Vyhledá soubor cashpilot_data.json v prostoru appDataFolder
 */
export async function findAppDataFile(token: string): Promise<DriveFileInfo | null> {
  const query = `name = '${CASH_PILOT_DATA_FILENAME}' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,size)`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Chyba při hledání souboru na Google Disku (HTTP ${res.status}): ${errorText}`);
  }

  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0] as DriveFileInfo;
  }

  return null;
}

/**
 * Stáhne a naparsuje data ze souboru na Google Disku
 */
export async function downloadFromGoogleDrive(token: string, fileId: string): Promise<AppData> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Nepodařilo se stáhnout data z Google Disku (HTTP ${res.status}): ${errorText}`);
  }

  const content = await res.json();
  if (!content || typeof content !== 'object') {
    throw new Error('Data stažená z Google Disku nejsou ve validním JSON formátu.');
  }

  return content as AppData;
}

/**
 * Vytvoří tělo multipart/related požadavku pro nahrání souboru na Google Drive
 */
export function buildMultipartRequestBody(
  metadata: Record<string, unknown>,
  payloadJson: string,
  boundary: string
): string {
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;

  return [
    delimiter,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    delimiter,
    'Content-Type: application/json; charset=UTF-8',
    '',
    payloadJson,
    closeDelimiter,
  ].join('\r\n');
}

/**
 * Nahraje data aplikace na Google Disk do appDataFolder.
 * Pokud je zadán existingFileId, provede PATCH (aktualizaci), jinak provede POST (vytvoření nového souboru).
 */
export async function uploadToGoogleDrive(
  token: string,
  appData: AppData,
  existingFileId?: string
): Promise<DriveFileInfo> {
  const payloadJson = JSON.stringify(appData, null, 2);
  const boundary = `-------CashPilotBoundary${Date.now()}`;

  let url: string;
  let method: string;
  let metadata: Record<string, unknown>;

  if (existingFileId) {
    // Aktualizace stávajícího souboru
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,modifiedTime,size`;
    method = 'PATCH';
    metadata = {
      name: CASH_PILOT_DATA_FILENAME,
    };
  } else {
    // Vytvoření nového souboru v appDataFolder
    url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';
    method = 'POST';
    metadata = {
      name: CASH_PILOT_DATA_FILENAME,
      parents: ['appDataFolder'],
    };
  }

  const body = buildMultipartRequestBody(metadata, payloadJson, boundary);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (res.status === 401) {
    clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Nepodařilo se uložit data na Google Disk (HTTP ${res.status}): ${errorText}`);
  }

  const result = await res.json();
  return result as DriveFileInfo;
}

export interface MergeResult {
  mergedData: AppData;
  hasLocalAdditions: boolean;
}

/**
 * Sloučí data z Google Disku (autorita) a lokálního úložiště (cache).
 * - Google Disk je Single Source of Truth.
 * - Lokální nově vytvořené offline záznamy (nebo záznamy s novějším časovým razítkem úpravy) jsou začleněny.
 * - Ošetřuje se, aby se nesmazaly smazané položky znovu zavlečením z lokální demo databáze.
 */
export function mergeCloudAndLocalData(cloudData: AppData, localData: AppData): MergeResult {
  let hasLocalAdditions = false;

  // Pokud jsou data identická, není co slučovat
  if (JSON.stringify(cloudData) === JSON.stringify(localData)) {
    return { mergedData: cloudData, hasLocalAdditions: false };
  }

  const getTime = (dateStr?: string): number => {
    if (!dateStr) return 0;
    const t = new Date(dateStr).getTime();
    return isNaN(t) ? 0 : t;
  };

  // 1. Sloučení účtů (Accounts)
  const cloudAccounts = Array.isArray(cloudData.accounts) ? [...cloudData.accounts] : [];
  const localAccounts = Array.isArray(localData.accounts) ? localData.accounts : [];
  const accMap = new Map<string, Account>(cloudAccounts.map(a => [a.id, { ...a }]));

  for (const localAcc of localAccounts) {
    if (accMap.has(localAcc.id)) {
      const cloudAcc = accMap.get(localAcc.id)!;
      if (getTime(localAcc.updatedAt) > getTime(cloudAcc.updatedAt)) {
        accMap.set(localAcc.id, { ...localAcc });
        hasLocalAdditions = true;
      }
    } else {
      const isDemo = isKnownDemoRecordId(localAcc.id);
      if (!isDemo) {
        accMap.set(localAcc.id, { ...localAcc });
        hasLocalAdditions = true;
      }
    }
  }

  const mergedAccounts = Array.from(accMap.values());
  let defaultCount = 0;
  const sanitizedAccounts = mergedAccounts.map(a => {
    if (a.isDefault && a.status !== 'archived') {
      defaultCount++;
      if (defaultCount > 1) {
        return { ...a, isDefault: false };
      }
    }
    return a;
  });
  if (defaultCount === 0 && sanitizedAccounts.length > 0) {
    const firstActive = sanitizedAccounts.find(a => a.status !== 'archived');
    if (firstActive) firstActive.isDefault = true;
  }

  // 2. Sloučení kategorií (Categories)
  const cloudCategories = Array.isArray(cloudData.categories) ? [...cloudData.categories] : [];
  const localCategories = Array.isArray(localData.categories) ? localData.categories : [];
  const catMap = new Map<string, Category>(cloudCategories.map(c => [c.id, { ...c }]));

  for (const localCat of localCategories) {
    if (catMap.has(localCat.id)) {
      const cloudCat = catMap.get(localCat.id)!;
      if (getTime(localCat.updatedAt) > getTime(cloudCat.updatedAt)) {
        catMap.set(localCat.id, { ...localCat });
        hasLocalAdditions = true;
      }
    } else {
      const isDefault = DEFAULT_CATEGORIES.some(d => d.id === localCat.id);
      if (!isDefault) {
        catMap.set(localCat.id, { ...localCat });
        hasLocalAdditions = true;
      }
    }
  }
  const mergedCategories = Array.from(catMap.values());

  // 3. Sloučení pravidel opakovaných plateb (RecurringRules)
  const cloudRules = Array.isArray(cloudData.recurringRules) ? [...cloudData.recurringRules] : [];
  const localRules = Array.isArray(localData.recurringRules) ? localData.recurringRules : [];
  const ruleMap = new Map<string, RecurringRule>(cloudRules.map(r => [r.id, { ...r }]));

  for (const localRule of localRules) {
    if (ruleMap.has(localRule.id)) {
      const cloudRule = ruleMap.get(localRule.id)!;
      if (getTime(localRule.updatedAt) > getTime(cloudRule.updatedAt)) {
        ruleMap.set(localRule.id, { ...localRule });
        hasLocalAdditions = true;
      }
    } else {
      const isDemo = isKnownDemoRecordId(localRule.id);
      if (!isDemo) {
        ruleMap.set(localRule.id, { ...localRule });
        hasLocalAdditions = true;
      }
    }
  }
  const mergedRules = Array.from(ruleMap.values());

  // 4. Sloučení transakcí (Transactions)
  const cloudTxs = Array.isArray(cloudData.transactions) ? [...cloudData.transactions] : [];
  const localTxs = Array.isArray(localData.transactions) ? localData.transactions : [];
  const txMap = new Map<string, Transaction>(cloudTxs.map(t => [t.id, { ...t }]));

  for (const localTx of localTxs) {
    if (txMap.has(localTx.id)) {
      const cloudTx = txMap.get(localTx.id)!;
      const localUpdatedTime = getTime(localTx.updatedAt) || getTime(localTx.createdAt);
      const cloudUpdatedTime = getTime(cloudTx.updatedAt) || getTime(cloudTx.createdAt);
      if (localUpdatedTime > cloudUpdatedTime) {
        txMap.set(localTx.id, { ...localTx });
        hasLocalAdditions = true;
      }
    } else {
      const isDemo = isKnownDemoRecordId(localTx.id);
      if (!isDemo) {
        txMap.set(localTx.id, { ...localTx });
        hasLocalAdditions = true;
      }
    }
  }

  const rawMergedTxs = Array.from(txMap.values());
  const mergedTransactions = sanitizeAndRepairSequences(rawMergedTxs);

  // 5. Sloučení výjimek opakovaných plateb (RecurringExceptions)
  const cloudExceptions = Array.isArray(cloudData.recurringExceptions) ? [...cloudData.recurringExceptions] : [];
  const localExceptions = Array.isArray(localData.recurringExceptions) ? localData.recurringExceptions : [];
  const exMap = new Map<string, RecurringException>(cloudExceptions.map(e => [e.id, { ...e }]));

  for (const localEx of localExceptions) {
    if (!exMap.has(localEx.id)) {
      if (ruleMap.has(localEx.ruleId)) {
        exMap.set(localEx.id, { ...localEx });
        hasLocalAdditions = true;
      }
    }
  }
  const mergedExceptions = Array.from(exMap.values());

  // 6. Sloučení korekcí zůstatku (BalanceCorrections)
  const cloudCorrections = Array.isArray(cloudData.corrections) ? [...cloudData.corrections] : [];
  const localCorrections = Array.isArray(localData.corrections) ? localData.corrections : [];
  const corrMap = new Map<string, BalanceCorrection>(cloudCorrections.map(c => [c.id, { ...c }]));

  for (const localCorr of localCorrections) {
    if (corrMap.has(localCorr.id)) {
      const cloudCorr = corrMap.get(localCorr.id)!;
      if (getTime(localCorr.updatedAt) > getTime(cloudCorr.updatedAt)) {
        corrMap.set(localCorr.id, { ...localCorr });
        hasLocalAdditions = true;
      }
    } else {
      if (accMap.has(localCorr.accountId)) {
        corrMap.set(localCorr.id, { ...localCorr });
        hasLocalAdditions = true;
      }
    }
  }
  const { cleanedCorrections: mergedCorrections } = sanitizeCorrections(
    Array.from(corrMap.values()),
    mergedTransactions,
    mergedRules
  );

  // 7. Sloučení snímků tržní hodnoty (MarketValueSnapshots)
  const cloudSnapshots = Array.isArray(cloudData.marketValueSnapshots) ? [...cloudData.marketValueSnapshots] : [];
  const localSnapshots = Array.isArray(localData.marketValueSnapshots) ? localData.marketValueSnapshots : [];
  const snapMap = new Map<string, MarketValueSnapshot>(cloudSnapshots.map(s => [s.id, { ...s }]));

  for (const localSnap of localSnapshots) {
    if (!snapMap.has(localSnap.id) && accMap.has(localSnap.accountId)) {
      snapMap.set(localSnap.id, { ...localSnap });
      hasLocalAdditions = true;
    }
  }
  const mergedSnapshots = Array.from(snapMap.values()).filter(s => accMap.has(s.accountId));

  // 8. Nastavení (Settings) - cloud má přednost
  const cloudSettings = cloudData.settings || localData.settings || DEFAULT_SETTINGS;
  const overdraftLimit = typeof cloudSettings.overdraftLimitInHaler === 'number'
    ? cloudSettings.overdraftLimitInHaler
    : typeof cloudSettings.minReserveInHaler === 'number'
      ? cloudSettings.minReserveInHaler
      : DEFAULT_SETTINGS.overdraftLimitInHaler;

  const mergedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...cloudSettings,
    overdraftLimitInHaler: overdraftLimit,
    minReserveInHaler: overdraftLimit,
  };

  const mergedData: AppData = {
    version: cloudData.version || localData.version || 1,
    settings: mergedSettings,
    accounts: sanitizedAccounts,
    categories: mergedCategories,
    transactions: mergedTransactions,
    recurringRules: mergedRules,
    recurringExceptions: mergedExceptions,
    corrections: mergedCorrections,
    marketValueSnapshots: mergedSnapshots,
  };

  return { mergedData, hasLocalAdditions };
}

