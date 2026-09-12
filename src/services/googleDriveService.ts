/**
 * Google Drive Sync Service pro CashPilot
 * Využívá Google Identity Services (GIS) Token Client a Google Drive API v3 (appDataFolder).
 */

import { AppData } from './storageService';

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
