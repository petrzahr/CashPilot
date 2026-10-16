import React from 'react';
import { Modal, ModalFooter } from '../common/Modal';
import { FileText, Info } from 'lucide-react';
import type { AppData } from '../../services/storageService';

type RecordCollections = Pick<AppData,
  'transactions' | 'accounts' | 'categories' | 'recurringRules' |
  'recurringExceptions' | 'corrections' | 'marketValueSnapshots' | 'investmentFees'>;

const GROUPS: { key: keyof RecordCollections; label: string }[] = [
  { key: 'transactions', label: 'Položky' },
  { key: 'accounts', label: 'Účty' },
  { key: 'categories', label: 'Kategorie a podkategorie' },
  { key: 'recurringRules', label: 'Pravidelné položky' },
  { key: 'recurringExceptions', label: 'Upravené výskyty pravidelných položek' },
  { key: 'corrections', label: 'Korekce zůstatků' },
  { key: 'marketValueSnapshots', label: 'Tržní hodnoty' },
  { key: 'investmentFees', label: 'Poplatky investic' },
];

export interface RestorePreviewGroup {
  label: string;
  added: number;
  existing: number;
}

export interface RestorePreview {
  fileName: string;
  content: string;
  groups: RestorePreviewGroup[];
  totalAdded: number;
}

/**
 * Spočítá, co sloučení zálohy udělá. Odpovídá mergeBackupData: záznam ze zálohy přibude,
 * jen když jeho id v aktuálních datech není; existující záznamy se nikdy nepřepisují.
 */
export function buildRestorePreview(
  backup: RecordCollections,
  current: RecordCollections,
): Omit<RestorePreview, 'fileName' | 'content'> {
  const groups = GROUPS.map(({ key, label }) => {
    const currentIds = new Set((current[key] || []).map((r: { id: string }) => r.id));
    const incoming = (backup[key] || []) as { id: string }[];
    const added = incoming.filter(r => !currentIds.has(r.id)).length;
    return { label, added, existing: incoming.length - added };
  }).filter(g => g.added > 0 || g.existing > 0);
  return { groups, totalAdded: groups.reduce((sum, g) => sum + g.added, 0) };
}

interface RestoreConfirmationModalProps {
  preview: RestorePreview | null;
  onClose: () => void;
  onConfirm: (content: string) => void;
}

export const RestoreConfirmationModal: React.FC<RestoreConfirmationModalProps> = ({
  preview,
  onClose,
  onConfirm,
}) => {
  const nothingToAdd = !!preview && preview.totalAdded === 0;

  return (
    <Modal isOpen={!!preview} onClose={onClose} title="Obnovit data ze zálohy?" maxWidth="max-w-lg">
      {preview && (
        <div className="space-y-4 text-sm text-slate-500">
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <FileText className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-slate-900 truncate" title={preview.fileName}>{preview.fileName}</span>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-sky-50 text-sky-900">
            <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs">
              Záloha se sloučí s aktuálními daty. Přibudou jen záznamy, které v aplikaci ještě nejsou.
              Nic se nesmaže ani nepřepíše a nastavení zůstane beze změny.
            </p>
          </div>

          {preview.groups.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Co se stane</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th scope="col" className="text-left font-semibold py-2 pr-3">Záznamy</th>
                      <th scope="col" className="text-right font-semibold py-2 px-3">Přibude</th>
                      <th scope="col" className="text-right font-semibold py-2 pl-3">Už existuje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.groups.map(g => (
                      <tr key={g.label}>
                        <td className="py-2 pr-3 text-slate-900">{g.label}</td>
                        <td className={`py-2 px-3 text-right font-bold ${g.added > 0 ? 'text-slate-900' : 'text-slate-500'}`}>{g.added}</td>
                        <td className="py-2 pl-3 text-right text-slate-500">{g.existing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-xs">Soubor neobsahuje žádné záznamy.</p>
          )}

          {nothingToAdd && preview.groups.length > 0 && (
            <p className="text-xs">Všechny záznamy ze zálohy už v aplikaci jsou, obnovou se nic nezmění.</p>
          )}

          <ModalFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Zrušit
            </button>
            <button
              type="button"
              disabled={nothingToAdd || preview.groups.length === 0}
              onClick={() => {
                onConfirm(preview.content);
                onClose();
              }}
              className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm transition-colors disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed"
            >
              Obnovit data
            </button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
};
