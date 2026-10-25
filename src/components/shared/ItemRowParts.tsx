import React from 'react';
import { AlertTriangle, Copy, Edit3, Eye, Repeat, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Transaction } from '../../types/finance';
import { ItemActions } from '../../hooks/useItemActions';
import { ItemAmountTone, ItemRow, ItemRowConflict, formatAccountPath, formatCategoryPath, formatItemAmount } from '../../services/itemRow';
import { StatusBadgeMenu } from './StatusBadgeMenu';

/** Barva částky podle tónu: příjem zeleně, výdaj červeně, převod inkoustem. */
export const amountToneClass = (tone: ItemAmountTone) =>
  tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-slate-900';

/** Štítek položky s datem před počátečním zůstatkem účtu; důvod v titulku. */
export const ConflictChip: React.FC<{ conflict: ItemRowConflict }> = ({ conflict }) => (
  <span
    className="chip bg-red-100 text-red-700 cursor-help shrink-0"
    title={conflict.reason}
  >
    <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
    Před aktivací
  </span>
);

/** Ikona pravidelné položky u názvu. */
export const RecurringIcon: React.FC = () => (
  <span title="Pravidelná položka" role="img" aria-label="Pravidelná položka" className="shrink-0 inline-flex">
    <Repeat className="w-3.5 h-3.5 text-slate-500" />
  </span>
);

export interface ItemRowPartsContext {
  actions: ItemActions;
  todayIso: string;
  openStatusUp: boolean;
  onEdit: (tx: Transaction) => void;
  onDuplicate: (tx: Transaction) => void;
}

/** Štítek stavu: korekce má vlastní štítek, ostatní stav lze změnit (StatusBadgeMenu). */
function renderItemStatus(tx: Transaction, row: ItemRow, ctx: Pick<ItemRowPartsContext, 'actions' | 'todayIso' | 'openStatusUp'>) {
  return row.isCorrection ? (
    <span className="chip bg-slate-100 text-slate-600">
      Korekce
    </span>
  ) : (
    <StatusBadgeMenu
      tx={tx}
      todayIso={ctx.todayIso}
      isUpdating={ctx.actions.updatingStatusTxId === tx.id}
      onChange={(status) => ctx.actions.handleStatusChange(tx.id, status)}
      openUp={ctx.openStatusUp}
    />
  );
}

/** Akce řádku: korekce detail a smazání, ostatní úprava, duplikace a smazání. */
function renderItemActions(tx: Transaction, row: ItemRow, ctx: Pick<ItemRowPartsContext, 'actions' | 'onEdit' | 'onDuplicate'>) {
  const { actions } = ctx;
  return row.isCorrection ? (
    <>
      <button
        type="button"
        onClick={() => actions.openCorrection(tx)}
        title="Detail a poznámka korekce"
        aria-label={`Detail a poznámka korekce: ${tx.title}`}
        className="btn-icon"
      >
        <Eye className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => void actions.deleteCorrection(tx.id)}
        title="Smazat korekci"
        aria-label={`Smazat korekci: ${tx.title}`}
        className="btn-icon btn-icon-danger"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </>
  ) : (
    <>
      {/* Stav se mění jen štítkem stavu, řádek nese úpravu, duplikaci a smazání */}
      <button
        onClick={() => ctx.onEdit(tx)}
        title="Upravit položku"
        aria-label={`Upravit položku: ${tx.title}`}
        className="btn-icon"
      >
        <Edit3 className="w-4 h-4" />
      </button>
      <button
        onClick={() => ctx.onDuplicate(tx)}
        title="Duplikovat položku"
        aria-label={`Duplikovat položku: ${tx.title}`}
        className="btn-icon"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        onClick={() => actions.requestDelete(tx)}
        disabled={actions.isDeletingTx}
        title="Smazat položku"
        aria-label={`Smazat položku: ${tx.title}`}
        className="btn-icon btn-icon-danger"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </>
  );
}

/**
 * Části řádku seznamu položek, které sdílí tabulka (od lg) i řádky-karty na mobilu
 * v Rozpočtu i Všech položkách, aby se jednotlivé podoby nerozešly.
 */
export function buildItemRowParts(tx: Transaction, row: ItemRow, ctx: ItemRowPartsContext) {
  const { isCancelled, isCorrection, conflict, category: cat } = row;

  const rowTone = isCancelled
    ? 'line-through decoration-slate-400 bg-slate-50 text-slate-500'
    : isCorrection ? 'bg-slate-50' : conflict ? 'bg-red-50/30' : '';

  const title = (
    <div className="flex items-center gap-1.5 flex-nowrap min-w-0">
      {isCorrection ? (
        <button
          type="button"
          onClick={() => ctx.actions.openCorrection(tx)}
          className="hover:text-sky-700 hover:underline text-left font-bold text-slate-900 flex items-center gap-1.5 min-w-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="truncate">{tx.title}</span>
        </button>
      ) : (
        // Název položky je vždy odkaz na její úpravu
        <button
          type="button"
          onClick={() => ctx.onEdit(tx)}
          className="hover:text-sky-700 hover:underline text-left truncate min-w-0"
        >
          {tx.title}
        </button>
      )}
      {row.isRecurring && <RecurringIcon />}
      {isCorrection && (
        <span className="chip bg-slate-100 text-slate-600 shrink-0">
          Korekce
        </span>
      )}
      {conflict && <ConflictChip conflict={conflict} />}
    </div>
  );

  const note = tx.note ? <span className="text-xs text-slate-500 block font-normal truncate">{tx.note}</span> : null;

  const category = cat.kind === 'correction' ? (
    <span className="chip bg-slate-100 text-slate-600">
      {cat.label}
    </span>
  ) : cat.kind === 'category' ? (
    <div className="min-w-0" title={formatCategoryPath(cat)}>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
        <span className="truncate">{cat.name}</span>
      </div>
      {cat.subName && <span className="block pl-3.5 text-slate-500 truncate">› {cat.subName}</span>}
    </div>
  ) : cat.kind === 'transfer' ? (
    <span className="text-slate-500 font-medium">{cat.label}</span>
  ) : (
    <span className="text-slate-500 italic text-xs">{cat.label}</span>
  );

  // Na mobilu stačí kategorie na jednom řádku; korekci už ohlašuje štítek u názvu
  const categoryInline = cat.kind === 'correction' ? null : cat.kind === 'category' ? (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
      <span className="truncate">{formatCategoryPath(cat)}</span>
    </span>
  ) : cat.kind === 'transfer' ? (
    <span className="font-medium">{cat.label}</span>
  ) : (
    <span className="italic">{cat.label}</span>
  );

  const accountInline = formatAccountPath(row);

  const account = row.sourceAccountName ? (
    <span className="block min-w-0" title={accountInline ?? undefined}>
      <span className="block truncate">{row.sourceAccountName}</span>
      {row.targetAccountName && <span className="block text-slate-500 truncate">→ {row.targetAccountName}</span>}
    </span>
  ) : '—';

  return {
    rowTone,
    title,
    note,
    category,
    categoryInline,
    account,
    accountInline,
    status: renderItemStatus(tx, row, ctx),
    amountClass: amountToneClass(row.amount.tone),
    amount: formatItemAmount(row.amount),
    actions: renderItemActions(tx, row, ctx),
  };
}
