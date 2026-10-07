import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency, halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { sortAccountsByOrder } from '../../services/accountService';
import { sortCategoriesAlphabetically } from '../../services/categoryService';
import {
  calculateMandatoryOverview,
  EMPTY_SIMULATION,
  FREQUENCY_LABELS,
  getMonthlyFactor,
  isSimulationEmpty,
  MandatoryGroup,
  MandatoryItem,
  MandatorySection,
  MandatorySimulation,
  MandatoryUpcomingChange,
} from '../../services/mandatoryExpensesService';
import { Account, Category, RecurrenceFrequency } from '../../types/finance';

/** Všechny částky na této obrazovce se zobrazují zaokrouhlené na 100 Kč (součty se počítají z přesných hodnot). */
const formatRounded = (haler: number) => formatCurrency(Math.round(haler / 10000) * 10000);

const SIMULATION_STORAGE_KEY = 'cashpilot_mandatory_simulation_v1';

const loadSimulation = (): MandatorySimulation => {
  try {
    const raw = localStorage.getItem(SIMULATION_STORAGE_KEY);
    if (!raw) return EMPTY_SIMULATION;
    const parsed = JSON.parse(raw);
    return {
      edits: parsed?.edits && typeof parsed.edits === 'object' ? parsed.edits : {},
      deleted: Array.isArray(parsed?.deleted) ? parsed.deleted : [],
      added: Array.isArray(parsed?.added) ? parsed.added : [],
    };
  } catch {
    return EMPTY_SIMULATION;
  }
};

const saveSimulation = (simulation: MandatorySimulation) => {
  try {
    if (isSimulationEmpty(simulation)) localStorage.removeItem(SIMULATION_STORAGE_KEY);
    else localStorage.setItem(SIMULATION_STORAGE_KEY, JSON.stringify(simulation));
  } catch {
    // Simulace se pak jen neuloží mezi obnoveními stránky
  }
};

const SECTION_TITLES: Record<MandatoryGroup, string> = {
  income: 'Pravidelné příjmy',
  expense: 'Mandatorní výdaje',
  transfer: 'Pravidelné spoření & převody',
};

const SECTION_TOTAL_COLORS: Record<MandatoryGroup, string> = {
  income: 'text-emerald-700',
  expense: 'text-red-700',
  transfer: 'text-sky-700',
};

const STANDARD_FREQUENCIES: RecurrenceFrequency[] = ['monthly', 'bi_monthly', 'quarterly', 'semi_annually', 'annually'];

const inputClass =
  'w-full h-7 px-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500';

// Název platby a akce zůstávají viditelné i při vodorovném posunu široké tabulky
const STICKY_LEFT = 'sticky left-0 z-10';
const STICKY_RIGHT = 'sticky right-0 z-10';
// Neprůhledné ekvivalenty bg-slate-50/75 a bg-slate-50/40 na bílé - ukotvené buňky nesmí prosvítat
const HEADER_ROW_BG = 'bg-[#fafbfd]';
const CATEGORY_ROW_BG = 'bg-[#fcfdfe]';
// Lehce fialové podbarvení plateb, které se neopakují měsíčně (neprůhledné kvůli ukotveným buňkám)
const NON_MONTHLY_ROW_BG = 'bg-[#f8f6ff]';

const iconButtonClass =
  'p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent';

interface Draft {
  title: string;
  amount: string;
  frequency: RecurrenceFrequency;
  categoryId: string;
  sourceAccountId: string;
  targetAccountId: string;
}

interface SectionTableProps {
  section: MandatorySection;
  categoryOptions: Category[];
  accountOptions: Account[];
  onSaveEdit: (item: MandatoryItem, draft: Draft) => void;
  onAdd: (group: MandatoryGroup, draft: Draft) => void;
  onDelete: (item: MandatoryItem) => void;
  onRestore: (item: MandatoryItem) => void;
}

const FrequencySelect: React.FC<{ value: RecurrenceFrequency; onChange: (f: RecurrenceFrequency) => void }> = ({
  value,
  onChange,
}) => (
  <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as RecurrenceFrequency)}>
    {[...STANDARD_FREQUENCIES, ...(value === 'custom' ? (['custom'] as RecurrenceFrequency[]) : [])].map((f) => (
      <option key={f} value={f}>
        {FREQUENCY_LABELS[f]}
      </option>
    ))}
  </select>
);

const SectionTable: React.FC<SectionTableProps> = ({
  section,
  categoryOptions,
  accountOptions,
  onSaveEdit,
  onAdd,
  onDelete,
  onRestore,
}) => {
  const title = SECTION_TITLES[section.group];
  const totalColor = SECTION_TOTAL_COLORS[section.group];
  const isTransfer = section.group === 'transfer';
  const columnCount = isTransfer ? 8 : 9;

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const emptyDraft = (): Draft => ({
    title: '',
    amount: '',
    frequency: 'monthly',
    categoryId: categoryOptions[0]?.id ?? '',
    sourceAccountId: accountOptions[0]?.id ?? '',
    targetAccountId: accountOptions[1]?.id ?? accountOptions[0]?.id ?? '',
  });

  const isDraftValid = (d: Draft | null, requireAccounts: boolean) =>
    !!d &&
    d.title.trim() !== '' &&
    parseInputToHaler(d.amount) > 0 &&
    (!requireAccounts || (!!d.sourceAccountId && (!isTransfer || (!!d.targetAccountId && d.targetAccountId !== d.sourceAccountId))));

  const startEdit = (item: MandatoryItem) => {
    setAddDraft(null);
    setEditingKey(item.ruleId);
    setDraft({ ...emptyDraft(), title: item.title, amount: halerToInputValue(item.amountInHaler), frequency: item.frequency });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setDraft(null);
  };

  const previewMonthly = (d: Draft) => Math.round(parseInputToHaler(d.amount) * getMonthlyFactor({ frequency: d.frequency }));

  const renderAddRow = () => {
    if (!addDraft) return null;
    const set = (patch: Partial<Draft>) => setAddDraft({ ...addDraft, ...patch });
    const monthly = previewMonthly(addDraft);
    return (
      <tr className="bg-emerald-50">
        <td className={`py-2 px-4 ${STICKY_LEFT} bg-emerald-50`}>
          <input autoFocus className={inputClass} placeholder="Název" value={addDraft.title} onChange={(e) => set({ title: e.target.value })} />
        </td>
        {!isTransfer && (
          <td className="py-2 px-4">
            <select className={inputClass} value={addDraft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">Bez kategorie</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </td>
        )}
        <td className="py-2 px-4">
          <div className="flex items-center gap-1">
            <select className={inputClass} value={addDraft.sourceAccountId} onChange={(e) => set({ sourceAccountId: e.target.value })}>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {isTransfer && (
              <>
                <span className="text-slate-400">→</span>
                <select className={inputClass} value={addDraft.targetAccountId} onChange={(e) => set({ targetAccountId: e.target.value })}>
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </td>
        <td className="py-2 px-4">
          <FrequencySelect value={addDraft.frequency} onChange={(frequency) => set({ frequency })} />
        </td>
        <td className="py-2 px-4 text-slate-400">—</td>
        <td className="py-2 px-4">
          <input className={`${inputClass} text-right w-24`} inputMode="decimal" placeholder="Kč" value={addDraft.amount} onChange={(e) => set({ amount: e.target.value })} />
        </td>
        <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">{formatRounded(monthly)}</td>
        <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">{formatRounded(monthly * 12)}</td>
        <td className={`py-2 px-2 whitespace-nowrap text-right ${STICKY_RIGHT} bg-emerald-50`}>
          <button
            type="button"
            title="Přidat do simulace"
            className={iconButtonClass}
            disabled={!isDraftValid(addDraft, true)}
            onClick={() => {
              onAdd(section.group, addDraft);
              setAddDraft(null);
            }}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="Zrušit" className={iconButtonClass} onClick={() => setAddDraft(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    );
  };

  const renderItemRow = (item: MandatoryItem) => {
    const isEditing = editingKey === item.ruleId && draft;
    const isDeleted = item.simState === 'deleted';
    // Stav simulace má přednost před zvýrazněním nepravidelných (ne měsíčních) plateb
    const rowBg =
      item.simState === 'edited' ? 'bg-amber-50'
        : item.simState === 'added' ? 'bg-emerald-50'
        : !isDeleted && item.frequency !== 'monthly' ? NON_MONTHLY_ROW_BG
        : 'bg-white';
    const rowClass = `${rowBg} ${isDeleted ? 'text-slate-400' : ''}`;
    const strike = isDeleted ? 'line-through text-slate-400' : '';

    if (isEditing) {
      const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
      const monthly = previewMonthly(draft);
      return (
        <tr key={item.ruleId} className="bg-sky-50">
          <td className={`py-2 ${isTransfer ? 'px-4' : 'pl-8 pr-4'} ${STICKY_LEFT} bg-sky-50`}>
            <input autoFocus className={inputClass} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </td>
          {!isTransfer && <td className="py-2 px-4 text-slate-500 whitespace-nowrap">{item.categoryLabel}</td>}
          <td className="py-2 px-4 text-slate-500 whitespace-nowrap">{item.accountLabel}</td>
          <td className="py-2 px-4">
            <FrequencySelect value={draft.frequency} onChange={(frequency) => set({ frequency })} />
          </td>
          <td className="py-2 px-4 text-slate-400">—</td>
          <td className="py-2 px-4">
            <input className={`${inputClass} text-right w-24`} inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} />
          </td>
          <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">{formatRounded(monthly)}</td>
          <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">{formatRounded(monthly * 12)}</td>
          <td className={`py-2 px-2 whitespace-nowrap text-right ${STICKY_RIGHT} bg-sky-50`}>
            <button
              type="button"
              title="Uložit do simulace"
              className={iconButtonClass}
              disabled={!isDraftValid(draft, false)}
              onClick={() => {
                onSaveEdit(item, draft);
                cancelEdit();
              }}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" title="Zrušit" className={iconButtonClass} onClick={cancelEdit}>
              <X className="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>
      );
    }

    return (
      <tr key={item.ruleId} className={rowClass}>
        <td className={`py-2 ${isTransfer ? 'px-4' : 'pl-8 pr-4'} font-medium ${isDeleted ? strike : 'text-slate-900'} ${STICKY_LEFT} ${rowBg}`}>
          {item.title}
          {item.simState === 'added' && <span className="ml-1.5 text-[10px] font-semibold text-emerald-700">nová</span>}
        </td>
        {!isTransfer && <td className={`py-2 px-4 whitespace-nowrap ${strike || 'text-slate-500'}`}>{item.categoryLabel}</td>}
        <td className={`py-2 px-4 whitespace-nowrap ${strike || 'text-slate-500'}`}>{item.accountLabel}</td>
        <td className={`py-2 px-4 whitespace-nowrap ${strike || 'text-slate-600'}`}>{item.scheduleLabel}</td>
        <td className={`py-2 px-4 whitespace-nowrap tabular-nums ${strike || 'text-slate-500'}`}>
          {item.nextDate ? formatCzechDate(item.nextDate) : '—'}
        </td>
        <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${strike || 'text-slate-600'}`}>
          {formatRounded(item.amountInHaler)}
          {item.original && item.original.amountInHaler !== item.amountInHaler && (
            <span className="block text-[10px] text-slate-400 line-through">{formatRounded(item.original.amountInHaler)}</span>
          )}
        </td>
        <td className={`py-2 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${strike || 'text-slate-900'}`}>
          {formatRounded(item.monthlyInHaler)}
        </td>
        <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${strike || 'text-slate-600'}`}>
          {formatRounded(item.yearlyInHaler)}
        </td>
        <td className={`py-2 px-2 whitespace-nowrap text-right ${STICKY_RIGHT} ${rowBg}`}>
          {isDeleted ? (
            <button type="button" title="Vrátit zpět" className={iconButtonClass} onClick={() => onRestore(item)}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              {item.simState === 'edited' && (
                <button type="button" title="Vrátit původní hodnoty" className={iconButtonClass} onClick={() => onRestore(item)}>
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button type="button" title="Upravit v simulaci" className={iconButtonClass} onClick={() => startEdit(item)}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Smazat ze simulace" className={iconButtonClass} onClick={() => onDelete(item)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <button
          type="button"
          onClick={() => {
            cancelEdit();
            setAddDraft(emptyDraft());
          }}
          disabled={!!addDraft || accountOptions.length === 0}
          className="-my-1 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Přidat
        </button>
      </div>

      {section.categories.length > 0 || addDraft ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold text-xs">
                <th className={`py-2.5 px-4 ${STICKY_LEFT} ${HEADER_ROW_BG}`}>Položka</th>
                {!isTransfer && <th className="py-2.5 px-4">Kategorie</th>}
                <th className="py-2.5 px-4">Účet</th>
                <th className="py-2.5 px-4">Kdy se hradí</th>
                <th className="py-2.5 px-4">Nejbližší</th>
                <th className="py-2.5 px-4 text-right">Částka</th>
                <th className="py-2.5 px-4 text-right">Měsíčně</th>
                <th className="py-2.5 px-4 text-right">Ročně</th>
                <th className={`py-2.5 px-2 ${STICKY_RIGHT} ${HEADER_ROW_BG}`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {renderAddRow()}
              {section.categories.map((cat) => (
                <React.Fragment key={cat.key}>
                  {!isTransfer && (
                    <tr className={CATEGORY_ROW_BG}>
                      <td className={`py-2 px-4 font-bold text-slate-900 whitespace-nowrap ${STICKY_LEFT} ${CATEGORY_ROW_BG}`}>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          {cat.label}
                        </span>
                      </td>
                      <td colSpan={columnCount - 4} className="py-2 px-4" />
                      <td className="py-2 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatRounded(cat.monthlyInHaler)}
                      </td>
                      <td className="py-2 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatRounded(cat.yearlyInHaler)}
                      </td>
                      <td className={`py-2 px-2 ${STICKY_RIGHT} ${CATEGORY_ROW_BG}`} />
                    </tr>
                  )}
                  {cat.items.map(renderItemRow)}
                </React.Fragment>
              ))}
              <tr className={`${HEADER_ROW_BG} border-t border-slate-200`}>
                <td className={`py-2.5 px-4 font-bold ${totalColor} ${STICKY_LEFT} ${HEADER_ROW_BG}`}>
                  Celkem
                </td>
                <td colSpan={columnCount - 4} className="py-2.5 px-4" />
                <td className={`py-2.5 px-4 text-right font-extrabold tabular-nums whitespace-nowrap ${totalColor}`}>
                  {formatRounded(section.monthlyInHaler)}
                </td>
                <td className={`py-2.5 px-4 text-right font-bold tabular-nums whitespace-nowrap ${totalColor}`}>
                  {formatRounded(section.yearlyInHaler)}
                </td>
                <td className={`py-2.5 px-2 ${STICKY_RIGHT} ${HEADER_ROW_BG}`} />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-slate-500">
          Žádné aktivní opakované platby tohoto typu.
        </div>
      )}
    </div>
  );
};

const GROUP_LABELS: Record<MandatoryGroup, string> = {
  income: 'Příjem',
  expense: 'Výdaj',
  transfer: 'Převod',
};

const CHANGE_KIND_LABELS: Record<MandatoryUpcomingChange['kind'], string> = {
  start: 'Začíná',
  end: 'Končí',
  change: 'Mění se',
};

const CHANGE_KIND_COLORS: Record<MandatoryUpcomingChange['kind'], string> = {
  start: 'text-emerald-700',
  end: 'text-slate-500',
  change: 'text-amber-700',
};

/** Hodnota s původní hodnotou přeškrtnutou před ní (jen pokud se liší). */
const BeforeAfter: React.FC<{ before?: string; after: string }> = ({ before, after }) => (
  <>
    {before !== undefined && before !== after && (
      <span className="text-slate-400 font-normal line-through mr-1.5">{before}</span>
    )}
    {after}
  </>
);

const UpcomingChangesTable: React.FC<{ changes: MandatoryUpcomingChange[] }> = ({ changes }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
    <div className="p-4 sm:p-5 border-b border-slate-100">
      <h3 className="text-sm font-bold text-slate-900">Nadcházející změny</h3>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold text-xs">
            <th className="py-2.5 px-4">Změna</th>
            <th className={`py-2.5 px-4 ${STICKY_LEFT} ${HEADER_ROW_BG}`}>Položka</th>
            <th className="py-2.5 px-4">Typ</th>
            <th className="py-2.5 px-4">Kdy se hradí</th>
            <th className="py-2.5 px-4 text-right">Částka</th>
            <th className="py-2.5 px-4 text-right">Měsíčně</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {changes.map((change) => (
            <tr key={`${change.ruleId}-${change.kind}`}>
              <td className="py-2 px-4 whitespace-nowrap">
                <span className={`font-semibold ${CHANGE_KIND_COLORS[change.kind]}`}>
                  {CHANGE_KIND_LABELS[change.kind]}
                </span>
                <span className="text-slate-500">
                  {' '}
                  {change.kind === 'end' ? 'naposledy' : 'od'} {formatCzechDate(change.occurrenceDate)} (období {change.periodName})
                </span>
              </td>
              <td className="py-2 px-4 font-medium text-slate-900">
                {change.previous && change.previous.title !== change.title && (
                  <span className="text-slate-400 line-through mr-1.5">{change.previous.title}</span>
                )}
                {change.title}
              </td>
              <td className="py-2 px-4 text-slate-500">{GROUP_LABELS[change.group]}</td>
              <td className="py-2 px-4 text-slate-600 whitespace-nowrap">
                <BeforeAfter before={change.previous?.scheduleLabel} after={change.scheduleLabel} />
              </td>
              <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
                <BeforeAfter
                  before={change.previous && formatRounded(change.previous.amountInHaler)}
                  after={formatRounded(change.amountInHaler)}
                />
              </td>
              <td className="py-2 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                <BeforeAfter
                  before={change.previous && formatRounded(change.previous.monthlyInHaler)}
                  after={formatRounded(change.monthlyInHaler)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const MandatoryExpensesScreen: React.FC = () => {
  const { recurringRules, categories, accounts, settings, selectedPeriod } = useFinance();
  const todayStr = getTodayInPrague();
  const budgetStartDay = settings?.budgetStartDay || 15;

  const [simulation, setSimulation] = useState<MandatorySimulation>(loadSimulation);
  useEffect(() => saveSimulation(simulation), [simulation]);
  const isSimulating = !isSimulationEmpty(simulation);

  const overview = useMemo(
    () => calculateMandatoryOverview(recurringRules, categories, accounts, todayStr, budgetStartDay, simulation, selectedPeriod),
    [recurringRules, categories, accounts, todayStr, budgetStartDay, simulation, selectedPeriod]
  );
  // Výchozí stav (skutečné opakované platby) pro porovnání v kartách
  const baseline = useMemo(
    () => calculateMandatoryOverview(recurringRules, categories, accounts, todayStr, budgetStartDay, EMPTY_SIMULATION, selectedPeriod),
    [recurringRules, categories, accounts, todayStr, budgetStartDay, selectedPeriod]
  );

  const accountOptions = useMemo(() => sortAccountsByOrder(accounts).filter((a) => a.status === 'active'), [accounts]);
  const categoryOptions = (group: MandatoryGroup) =>
    sortCategoriesAlphabetically(
      categories.filter((c) => !c.parentId && c.status === 'active' && (group === 'income' ? c.type === 'income' : c.type !== 'income'))
    );

  const handleSaveEdit = (item: MandatoryItem, draft: Draft) => {
    const values = {
      title: draft.title.trim(),
      amountInHaler: parseInputToHaler(draft.amount),
      frequency: draft.frequency,
    };
    setSimulation((prev) =>
      item.simState === 'added'
        ? { ...prev, added: prev.added.map((p) => (p.id === item.ruleId ? { ...p, ...values } : p)) }
        : { ...prev, edits: { ...prev.edits, [item.ruleId]: values } }
    );
  };

  const handleAdd = (group: MandatoryGroup, draft: Draft) => {
    setSimulation((prev) => ({
      ...prev,
      added: [
        ...prev.added,
        {
          id: `sim_${Date.now()}`,
          title: draft.title.trim(),
          group,
          categoryId: group === 'transfer' ? null : draft.categoryId || null,
          sourceAccountId: draft.sourceAccountId,
          targetAccountId: group === 'transfer' ? draft.targetAccountId : undefined,
          amountInHaler: parseInputToHaler(draft.amount),
          frequency: draft.frequency,
        },
      ],
    }));
  };

  const handleDelete = (item: MandatoryItem) => {
    setSimulation((prev) =>
      item.simState === 'added'
        ? { ...prev, added: prev.added.filter((p) => p.id !== item.ruleId) }
        : { ...prev, deleted: [...prev.deleted, item.ruleId] }
    );
  };

  const handleRestore = (item: MandatoryItem) => {
    setSimulation((prev) => {
      if (item.simState === 'deleted') return { ...prev, deleted: prev.deleted.filter((id) => id !== item.ruleId) };
      const { [item.ruleId]: _removed, ...edits } = prev.edits;
      return { ...prev, edits };
    });
  };

  const cards = [
    { label: 'Příjmy / měsíc', value: overview.income.monthlyInHaler, base: baseline.income.monthlyInHaler, className: 'text-emerald-600' },
    { label: 'Mandatorní výdaje / měsíc', value: overview.expense.monthlyInHaler, base: baseline.expense.monthlyInHaler, className: 'text-red-600' },
    {
      label: 'Skutečně uspořeno / měsíc',
      value: overview.actuallySavedMonthlyInHaler,
      base: baseline.actuallySavedMonthlyInHaler,
      className: overview.actuallySavedMonthlyInHaler < 0 ? 'text-red-600' : 'text-emerald-600',
      title: 'Příjmy − výdaje na běžných účtech a hotovosti, bez převodů',
    },
    { label: 'Spoření & převody / měsíc', value: overview.transfer.monthlyInHaler, base: baseline.transfer.monthlyInHaler, className: 'text-sky-600' },
    {
      label: 'Zbývá / měsíc',
      value: overview.remainingMonthlyInHaler,
      base: baseline.remainingMonthlyInHaler,
      className: overview.remainingMonthlyInHaler < 0 ? 'text-red-600' : 'text-slate-900',
      title: 'Příjmy − mandatorní výdaje − spoření & převody',
    },
  ];

  const sectionProps = {
    accountOptions,
    onSaveEdit: handleSaveEdit,
    onAdd: handleAdd,
    onDelete: handleDelete,
    onRestore: handleRestore,
  };

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-xs ${
          isSimulating ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200/80'
        }`}
      >
        <p className="text-slate-500">
          {isSimulating ? (
            <>
              <strong className="text-amber-800">Simulace</strong> – hodnoty se liší od skutečných opakovaných plateb
              (ty zůstávají beze změny).
            </>
          ) : (
            <>
              Opakované platby platné v rozpočtovém období <strong className="text-slate-700">{overview.periodName}</strong>,
              nepravidelné platby rozpočítané do měsíců{' '}
              <span className={`inline-block px-1.5 rounded ${NON_MONTHLY_ROW_BG} text-violet-700`}>(podbarvené)</span>.
              Úpravy zde jsou jen simulace.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setSimulation(EMPTY_SIMULATION)}
          disabled={!isSimulating}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Obnovit výchozí stav
        </button>
      </div>

      {/* Souhrn měsíčních průměrů z opakovaných plateb */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm"
            title={card.title}
          >
            <span className="text-xs text-slate-500 block font-medium">{card.label}</span>
            <span className={`text-base font-bold block mt-0.5 truncate tabular-nums ${card.className}`}>
              {formatRounded(card.value)}
            </span>
            {isSimulating && card.value !== card.base && (
              <span className="text-[10px] text-slate-500 block mt-0.5 tabular-nums">
                výchozí {formatRounded(card.base)}
              </span>
            )}
          </div>
        ))}
      </div>

      {overview.upcomingChanges.length > 0 && <UpcomingChangesTable changes={overview.upcomingChanges} />}

      <SectionTable section={overview.income} categoryOptions={categoryOptions('income')} {...sectionProps} />
      <SectionTable section={overview.expense} categoryOptions={categoryOptions('expense')} {...sectionProps} />
      <SectionTable section={overview.transfer} categoryOptions={[]} {...sectionProps} />
    </div>
  );
};
