import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getGoogleClientId,
  saveStoredAuth,
  getStoredAuth,
  clearStoredAuth,
  isStoredTokenValid,
  getValidAccessToken,
  buildMultipartRequestBody,
  findAppDataFile,
  downloadFromGoogleDrive,
  uploadToGoogleDrive,
  fetchGoogleUserProfile,
  loginToGoogle,
  logoutFromGoogle,
  CASH_PILOT_DATA_FILENAME,
  GOOGLE_DRIVE_APP_DATA_SCOPE,
} from '../services/googleDriveService';
import { getInitialData } from '../services/storageService';

const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

describe('googleDriveService', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('1. Konfigurace a Client ID', () => {
    it('poskytuje platné Google Client ID', () => {
      const clientId = getGoogleClientId();
      expect(clientId).toContain('471929194107-leupf0slff3no70bl5u7104aaim5jcmf');
    });

    it('definuje správný rozsah oprávnění pro appDataFolder', () => {
      expect(GOOGLE_DRIVE_APP_DATA_SCOPE).toBe('https://www.googleapis.com/auth/drive.appdata');
      expect(CASH_PILOT_DATA_FILENAME).toBe('cashpilot_data.json');
    });
  });

  describe('2. Ukládání a expirace tokenu v lokálním úložišti', () => {
    it('správně uloží a načte platný autentizační token', () => {
      const futureExpiry = Date.now() + 3600 * 1000;
      saveStoredAuth({
        accessToken: 'test_token_123',
        expiresAt: futureExpiry,
        user: { displayName: 'Petr Zahrádka', emailAddress: 'pzahr@seznam.cz' },
      });

      const loaded = getStoredAuth();
      expect(loaded).not.toBeNull();
      expect(loaded?.accessToken).toBe('test_token_123');
      expect(loaded?.user?.displayName).toBe('Petr Zahrádka');
      expect(isStoredTokenValid()).toBe(true);
      expect(getValidAccessToken()).toBe('test_token_123');
    });

    it('vyhodnotí expirovaný token jako neplatný', () => {
      const pastExpiry = Date.now() - 5000;
      saveStoredAuth({
        accessToken: 'expired_token',
        expiresAt: pastExpiry,
      });

      expect(isStoredTokenValid()).toBe(false);
      expect(getValidAccessToken()).toBeNull();
    });

    it('vymaže uloženou autentizaci', () => {
      saveStoredAuth({
        accessToken: 'temp_token',
        expiresAt: Date.now() + 100000,
      });
      clearStoredAuth();
      expect(getStoredAuth()).toBeNull();
      expect(isStoredTokenValid()).toBe(false);
    });
  });

  describe('3. Sestavení multipart požadavku (buildMultipartRequestBody)', () => {
    it('vytvoří korektní multipart/related tělo s metadaty a JSON obsahem', () => {
      const metadata = { name: 'cashpilot_data.json', parents: ['appDataFolder'] };
      const payload = JSON.stringify({ version: 1, test: true });
      const boundary = 'TestBoundary123';

      const body = buildMultipartRequestBody(metadata, payload, boundary);

      expect(body).toContain('--TestBoundary123\r\n');
      expect(body).toContain('Content-Type: application/json; charset=UTF-8\r\n');
      expect(body).toContain(JSON.stringify(metadata));
      expect(body).toContain(payload);
      expect(body).toContain('--TestBoundary123--');
    });
  });

  describe('4. Vyhledání souboru v appDataFolder (findAppDataFile)', () => {
    it('najde existující soubor cashpilot_data.json a vrátí jeho metadata', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'drive_file_abc123', name: 'cashpilot_data.json', modifiedTime: '2026-09-12T20:00:00Z', size: '1024' },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const file = await findAppDataFile('mock_access_token');
      expect(file).not.toBeNull();
      expect(file?.id).toBe('drive_file_abc123');
      expect(file?.name).toBe('cashpilot_data.json');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('spaces=appDataFolder'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock_access_token' },
        })
      );
    });

    it('vrátí null, pokud soubor na Disku dosud neexistuje', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const file = await findAppDataFile('mock_access_token');
      expect(file).toBeNull();
    });

    it('vymaže lokální autentizaci a vyhodí chybu při 401 Unauthorized', async () => {
      saveStoredAuth({ accessToken: 'invalid_token', expiresAt: Date.now() + 100000 });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(findAppDataFile('invalid_token')).rejects.toThrow(/vypršela/);
      expect(getStoredAuth()).toBeNull();
    });
  });

  describe('5. Stažení dat z Google Disku (downloadFromGoogleDrive)', () => {
    it('stáhne data z endpointu alt=media a vrátí naparsovaný AppData objekt', async () => {
      const fakeData = getInitialData();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => fakeData,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await downloadFromGoogleDrive('token_123', 'file_xyz');
      expect(result).toEqual(fakeData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/drive/v3/files/file_xyz?alt=media',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token_123' },
        })
      );
    });
  });

  describe('6. Ukládání na Google Disk (uploadToGoogleDrive)', () => {
    it('vytvoří nový soubor přes POST při absenci existingFileId', async () => {
      const fakeData = getInitialData();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'new_created_file_id', name: 'cashpilot_data.json' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await uploadToGoogleDrive('token_123', fakeData);
      expect(result.id).toBe('new_created_file_id');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('uploadType=multipart'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token_123',
            'Content-Type': expect.stringContaining('multipart/related'),
          }),
        })
      );
    });

    it('aktualizuje existující soubor přes PATCH, pokud je zadán existingFileId', async () => {
      const fakeData = getInitialData();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'existing_file_999', name: 'cashpilot_data.json' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await uploadToGoogleDrive('token_123', fakeData, 'existing_file_999');
      expect(result.id).toBe('existing_file_999');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('files/existing_file_999?uploadType=multipart'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer token_123',
            'Content-Type': expect.stringContaining('multipart/related'),
          }),
        })
      );
    });
  });

  describe('7. Načtení profilu uživatele (fetchGoogleUserProfile)', () => {
    it('načte informace o uživateli z about.get a aktualizuje uloženou relaci', async () => {
      saveStoredAuth({ accessToken: 'tok', expiresAt: Date.now() + 100000 });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            displayName: 'Jan Novák',
            emailAddress: 'jan.novak@gmail.com',
            photoLink: 'https://photo.url',
          },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const user = await fetchGoogleUserProfile('tok');
      expect(user?.displayName).toBe('Jan Novák');
      expect(user?.emailAddress).toBe('jan.novak@gmail.com');
      expect(getStoredAuth()?.user?.displayName).toBe('Jan Novák');
    });
  });

  describe('8. Přihlášení a odhlášení (loginToGoogle, logoutFromGoogle)', () => {
    it('úspěšně získá token při zavolání callbacku Token Clienta', async () => {
      let registeredCallback: any = null;

      const mockInitTokenClient = vi.fn().mockImplementation((config: any) => {
        registeredCallback = config.callback;
        return {
          requestAccessToken: vi.fn().mockImplementation(() => {
            if (registeredCallback) {
              registeredCallback({
                access_token: 'newly_issued_token',
                expires_in: 3600,
                scope: GOOGLE_DRIVE_APP_DATA_SCOPE,
                token_type: 'Bearer',
              });
            }
          }),
        };
      });

      vi.stubGlobal('window', {
        google: {
          accounts: {
            oauth2: {
              initTokenClient: mockInitTokenClient,
            },
          },
        },
      });

      const token = await loginToGoogle();
      expect(token).toBe('newly_issued_token');
      expect(getValidAccessToken()).toBe('newly_issued_token');
    });

    it('zavolá revoke a vymaže autentizační data při odhlášení', async () => {
      saveStoredAuth({ accessToken: 'to_be_revoked', expiresAt: Date.now() + 100000 });
      const mockRevoke = vi.fn().mockImplementation((token: string, cb?: () => void) => {
        if (cb) cb();
      });

      vi.stubGlobal('window', {
        google: {
          accounts: {
            oauth2: {
              revoke: mockRevoke,
            },
          },
        },
      });

      await logoutFromGoogle();
      expect(mockRevoke).toHaveBeenCalledWith('to_be_revoked', expect.any(Function));
      expect(getStoredAuth()).toBeNull();
    });
  });
});
