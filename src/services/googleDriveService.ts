/**
 * Google Drive Sync Service pro CashPilot
 * Využívá Google Identity Services (GIS) Token Client a Google Drive API v3 (appDataFolder).
 */

import type { AppData } from './storageService';

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
  permissionId?: string;
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
// drive.file: přístup jen k souborům, které appka sama vytvoří – použito pro viditelnou složku se zálohami.
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_DRIVE_SCOPES = `${GOOGLE_DRIVE_APP_DATA_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`;
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
let authEpoch = 0;
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
    scope: GOOGLE_DRIVE_SCOPES,
    callback: (response: GoogleTokenResponse) => {
      if (response.error) {
        console.error('Chyba při autorizaci Google účtu:', response.error, response.error_description);
        if (currentReject) {
          currentReject(new Error(response.error_description || response.error));
          currentReject = null;
          currentResolve = null;
        }
      } else if (response.access_token && currentResolve) {
        const expiresInSec = response.expires_in || 3600;
        const expiresAt = Date.now() + expiresInSec * 1000;
        saveStoredAuth({
          accessToken: response.access_token,
          expiresAt,
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
  const epoch = authEpoch;
  const tokenClient = await getOrCreateTokenClient();
  if (epoch !== authEpoch) throw new Error('Přihlášení bylo zrušeno.');
  if (currentResolve) throw new Error('Přihlášení již probíhá.');

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
  ++authEpoch;
  currentReject?.(new Error('Přihlášení bylo zrušeno.'));
  currentReject = null; currentResolve = null;
  const auth = getStoredAuth();
  clearStoredAuth();
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
        permissionId: data.user.permissionId,
      };
      // Aktualizovat uloženou autentizaci
      const current = getStoredAuth();
      if (current?.accessToken === token) {
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

const DUPLICATE_ARCHIVE_PREFIX = 'cashpilot_duplicate_';
const MAX_LIST_PAGES = 20;

const driveFileTime = (file: DriveFileInfo): number => {
  const parsed = Date.parse(file.modifiedTime || '');
  return Number.isFinite(parsed) ? parsed : 0;
};
const driveFileSize = (file: DriveFileInfo): number => {
  const parsed = Number(file.size);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Vypíše VŠECHNY soubory cashpilot_data.json v appDataFolder (včetně stránkování).
 * `complete` je false, pokud Google vrátil neúplný výsledek hledání.
 */
export async function listAppDataFiles(token: string, signal?: AbortSignal): Promise<{ files: DriveFileInfo[]; complete: boolean }> {
  const query = `name = '${CASH_PILOT_DATA_FILENAME}' and trashed = false`;
  const files: DriveFileInfo[] = [];
  let complete = true;
  let pageToken: string | undefined;
  let page = 0;

  do {
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&pageSize=1000&fields=nextPageToken,incompleteSearch,files(id,name,modifiedTime,size)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;

    const res = await fetch(url, {
      signal, cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      if (getStoredAuth()?.accessToken === token) clearStoredAuth();
      throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
    }

    if (res.status === 412) throw new DriveConflictError();
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Chyba při hledání souboru na Google Disku (HTTP ${res.status}): ${errorText}`);
    }

    const data = await res.json();
    if (data.incompleteSearch) complete = false;
    if (Array.isArray(data.files)) files.push(...(data.files as DriveFileInfo[]));
    pageToken = data.nextPageToken;
  } while (pageToken && ++page < MAX_LIST_PAGES);

  // Nedočerpané stránkování znamená stejnou nejistotu jako incompleteSearch.
  if (pageToken) complete = false;
  return { files, complete };
}

/** Nejnovější vyhrává; velikost a id rozhodují remízu, aby všechna zařízení zvolila stejný soubor. */
export function sortDriveFilesByPrecedence(files: DriveFileInfo[]): DriveFileInfo[] {
  return [...files].sort((a, b) =>
    driveFileTime(b) - driveFileTime(a) || driveFileSize(b) - driveFileSize(a) || b.id.localeCompare(a.id));
}

/**
 * Odloží duplicitní datový soubor přejmenováním. Nikdy nemaže – obsah zůstává v appDataFolder
 * dostupný, jen přestane odpovídat kanonickému názvu.
 */
export async function archiveDuplicateDataFile(token: string, file: DriveFileInfo, signal?: AbortSignal): Promise<string> {
  const name = `${DUPLICATE_ARCHIVE_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}_${file.id}.json`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?fields=id,name`, {
    signal, cache: 'no-store',
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  if (res.status === 401) {
    if (getStoredAuth()?.accessToken === token) clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Konflikt synchronizace: duplicitní datový soubor se nepodařilo odložit (HTTP ${res.status}): ${errorText}. Žádný soubor nebyl přepsán.`);
  }

  return name;
}

/**
 * Vyhledá kanonický soubor cashpilot_data.json v prostoru appDataFolder.
 * Duplicity (dvě zařízení mohla založit soubor současně) řeší deduplikací: ponechá nejnovější
 * podle modifiedTime a ostatní přejmenuje na zálohy, takže se sync sám uzdraví bez ztráty dat.
 */
export async function findAppDataFile(token: string, signal?: AbortSignal): Promise<DriveFileInfo | null> {
  const { files, complete } = await listAppDataFiles(token, signal);
  const [canonical, ...duplicates] = sortDriveFilesByPrecedence(files);

  if (!canonical) {
    // Prázdný a zároveň nejistý seznam je jediný neřešitelný případ: založením souboru bychom
    // mohli vytvořit další duplicitu k souboru, který jsme jen neviděli.
    if (!complete) {
      throw new Error('Konflikt synchronizace: Google Disk vrátil neúplný seznam souborů. Nic nebylo zapsáno, zkuste to prosím znovu.');
    }
    return null;
  }

  for (const duplicate of duplicates) {
    const archived = await archiveDuplicateDataFile(token, duplicate, signal);
    console.warn(`CashPilot: duplicitní datový soubor ${duplicate.id} byl odložen jako ${archived}.`);
  }

  if (duplicates.length) {
    console.warn(`CashPilot: na Google Disku bylo ${files.length} datových souborů. Ponechán nejnovější (${canonical.id}, ${canonical.modifiedTime ?? 'bez času'}).`);
  }

  return canonical;
}

/**
 * Stáhne a naparsuje data ze souboru na Google Disku
 */
export async function downloadFromGoogleDrive(token: string, fileId: string, signal?: AbortSignal): Promise<AppData> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

  const res = await fetch(url, {
    signal, cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    if (getStoredAuth()?.accessToken === token) clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (res.status === 412) throw new DriveConflictError();
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
 * Aktualizace používá podmíněné PUT v2 se stejným ETagem jako v2 metadata. Nový soubor používá POST v3.
 */
export async function uploadToGoogleDrive(
  token: string,
  appData: AppData,
  existingFileId?: string,
  etag?: string,
  signal?: AbortSignal
): Promise<DriveFileInfo> {
  if (existingFileId && !etag) throw new Error('Chybí ETag pro bezpečný upload.');
  const payloadJson = JSON.stringify(appData, null, 2);
  const boundary = `-------CashPilotBoundary${Date.now()}`;

  let url: string;
  let method: string;
  let metadata: Record<string, unknown>;

  if (existingFileId) {
    // Aktualizace stávajícího souboru
    url = `https://www.googleapis.com/upload/drive/v2/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,title,modifiedDate,fileSize`;
    method = 'PUT';
    metadata = {
      title: CASH_PILOT_DATA_FILENAME,
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
    signal, cache: 'no-store',
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      ...(etag ? { 'If-Match': etag } : {}),
    },
    body,
  });

  if (res.status === 401) {
    if (getStoredAuth()?.accessToken === token) clearStoredAuth();
    throw new Error('Platnost přihlášení k Google Disku vypršela. Přihlaste se prosím znovu.');
  }

  if (res.status === 412) throw new DriveConflictError();
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Nepodařilo se uložit data na Google Disk (HTTP ${res.status}): ${errorText}`);
  }

  const result = await res.json();
  return { ...result, name: result.name || result.title, modifiedTime: result.modifiedTime || result.modifiedDate, size: result.size || result.fileSize } as DriveFileInfo;
}

export class DriveConflictError extends Error {
  constructor() { super('Konflikt synchronizace: cloud se mezitím změnil.'); }
}

/** v2 exposes the file ETag in JSON, including when CORS hides the HTTP header. */
export async function readDriveSnapshot(token: string, id: string, signal?: AbortSignal): Promise<{ data: AppData; etag: string }> {
  const metadata = async () => {
    const response = await fetch(`https://www.googleapis.com/drive/v2/files/${encodeURIComponent(id)}?fields=id,etag,version`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal,
    });
    if (!response.ok) throw new Error(`Nelze ověřit cloudovou revizi (HTTP ${response.status}).`);
    const value = await response.json();
    if (!value.etag || value.etag.startsWith('W/')) throw new Error('Google Disk neposkytl silný ETag. Upload byl zastaven.');
    return value;
  };
  const before = await metadata();
  const data = await downloadFromGoogleDrive(token, id, signal);
  const after = await metadata();
  if (before.etag !== after.etag || before.version !== after.version) throw new DriveConflictError();
  return { data, etag: after.etag };
}

/** Retain an exact, separate JSON cloud backup before the first v2 write. */
export async function backupLegacyCloud(token: string, id: string, data: AppData, signal?: AbortSignal): Promise<void> {
  const boundary = `CashPilotBackup${crypto.randomUUID()}`;
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    signal, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: buildMultipartRequestBody({ name: `cashpilot_backup_before_sync_v2_${id}_${Date.now()}.json`, parents: ['appDataFolder'] }, JSON.stringify(data), boundary),
  });
  if (!response.ok) throw new Error('Nepodařilo se vytvořit úplnou cloudovou zálohu. Migrace byla zastavena.');
}
