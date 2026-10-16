import React from 'react';
import { AlertCircle, CheckCircle2, CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { SYNC_LABELS, type SyncStatus } from '../../services/syncController';

/**
 * Jediné zobrazení stavu synchronizace pro hlavičku, Nastavení i načítací obrazovku:
 * každý stav má vlastní ikonu (nejen barvu) a stejné barvy na všech místech.
 */
type SyncTone = 'busy' | 'problem' | 'pending' | 'ok';

export function getSyncTone(status: SyncStatus): SyncTone {
  if (status === 'syncing' || status === 'loading') return 'busy';
  if (status === 'error' || status === 'conflict') return 'problem';
  if (status === 'synced') return 'ok';
  return 'pending';
}

const ICON_COLOR: Record<SyncTone, string> = {
  busy: 'text-sky-600',
  problem: 'text-red-600',
  pending: 'text-amber-600',
  ok: 'text-emerald-600',
};

const TEXT_COLOR: Record<SyncTone, string> = {
  busy: 'text-sky-700',
  problem: 'text-red-700',
  pending: 'text-amber-700',
  ok: 'text-emerald-700',
};

export const SyncStatusIcon: React.FC<{ status: SyncStatus; className?: string }> = ({ status, className = 'w-3.5 h-3.5' }) => {
  const tone = getSyncTone(status);
  const cls = `${className} shrink-0 ${ICON_COLOR[tone]}`;
  if (tone === 'busy') return <RefreshCw className={`${cls} animate-spin motion-reduce:animate-none`} aria-hidden="true" />;
  if (tone === 'problem') return <AlertCircle className={cls} aria-hidden="true" />;
  if (tone === 'ok') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (status === 'offline' || status === 'disconnected') return <CloudOff className={cls} aria-hidden="true" />;
  return <CloudUpload className={cls} aria-hidden="true" />;
};

export const SyncStatusLabel: React.FC<{ status: SyncStatus; iconClassName?: string }> = ({ status, iconClassName }) => (
  <span className="inline-flex items-center gap-1.5 font-semibold">
    <SyncStatusIcon status={status} className={iconClassName} />
    <span className={TEXT_COLOR[getSyncTone(status)]}>{SYNC_LABELS[status]}</span>
  </span>
);

export function formatLastSync(time: Date | null | undefined): string {
  return time ? time.toLocaleString('cs-CZ') : 'zatím neproběhla';
}
