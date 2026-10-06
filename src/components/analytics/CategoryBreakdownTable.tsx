import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { BudgetPeriodInfo } from '../../services/analyticsEngine';
import { CategoryBreakdownResult, CategoryBreakdownRow } from '../../services/categoryBreakdownService';
import { formatCurrency } from '../../services/currencyService';

interface CategoryBreakdownTableProps {
  periods: BudgetPeriodInfo[];
  data: CategoryBreakdownResult;
}

const formatShare = (part: number, whole: number) =>
  whole > 0
    ? `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format((part / whole) * 100)} %`
    : '—';

/** Podbarvení buňky podle výše částky vůči maximu řádku (zvýrazní výkyvy mezi obdobími). */
const heatStyle = (amount: number, rowMax: number): React.CSSProperties | undefined =>
  rowMax > 0 && amount > 0
    ? { backgroundColor: `rgba(14, 165, 233, ${(0.03 + 0.17 * (amount / rowMax)).toFixed(3)})` }
    : undefined;

export const CategoryBreakdownTable: React.FC<CategoryBreakdownTableProps> = ({ periods, data }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const expandableKeys = data.rows.filter((r) => r.children.length > 0).map((r) => r.key);
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k));

  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(expandableKeys));

  const periodCount = periods.length || 1;

  const shareBase = (row: CategoryBreakdownRow) =>
    row.group === 'income' ? data.incomeTotalInHaler : row.group === 'expense' ? data.expenseTotalInHaler : 0;

  const stickyCell = 'sticky left-0 z-10';

  const renderRow = (row: CategoryBreakdownRow) => {
    const isExpanded = expanded.has(row.key);
    const canExpand = row.children.length > 0;
    const rowMax = Math.max(0, ...row.amountsInHaler);
    const base = shareBase(row);

    return (
      <React.Fragment key={row.key}>
        <tr
          className={`group ${canExpand ? 'cursor-pointer hover:bg-slate-50' : ''}`}
          onClick={canExpand ? () => toggleRow(row.key) : undefined}
        >
          <td className={`${stickyCell} bg-white group-hover:bg-slate-50 py-2 px-4 font-semibold text-slate-900 whitespace-nowrap`}>
            <span className="flex items-center gap-1.5">
              <ChevronRight
                className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${
                  canExpand ? '' : 'invisible'
                } ${isExpanded ? 'rotate-90' : ''}`}
              />
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
              {row.label}
            </span>
          </td>
          {row.amountsInHaler.map((amount, i) => (
            <td
              key={periods[i].key}
              className="py-2 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap"
              style={heatStyle(amount, rowMax)}
            >
              {amount !== 0 ? formatCurrency(amount) : '—'}
            </td>
          ))}
          <td className="py-2 px-4 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
            {formatCurrency(row.totalInHaler)}
          </td>
          <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
            {formatCurrency(Math.round(row.totalInHaler / periodCount))}
          </td>
          <td className="py-2 px-4 text-right tabular-nums text-slate-500 whitespace-nowrap">
            {row.group === 'transfer' ? '—' : formatShare(row.totalInHaler, base)}
          </td>
        </tr>

        {isExpanded &&
          row.children.map((child) => (
            <tr key={child.key} className="bg-slate-50/50">
              <td className={`${stickyCell} bg-slate-50 py-1.5 pl-12 pr-4 text-slate-600 whitespace-nowrap`}>
                {child.label}
              </td>
              {child.amountsInHaler.map((amount, i) => (
                <td key={periods[i].key} className="py-1.5 px-4 text-right tabular-nums text-slate-500 whitespace-nowrap">
                  {amount !== 0 ? formatCurrency(amount) : '—'}
                </td>
              ))}
              <td className="py-1.5 px-4 text-right tabular-nums font-semibold text-slate-700 whitespace-nowrap">
                {formatCurrency(child.totalInHaler)}
              </td>
              <td className="py-1.5 px-4 text-right tabular-nums text-slate-500 whitespace-nowrap">
                {formatCurrency(Math.round(child.totalInHaler / periodCount))}
              </td>
              <td className="py-1.5 px-4 text-right tabular-nums text-slate-400 whitespace-nowrap">
                {row.group === 'transfer' ? '—' : formatShare(child.totalInHaler, base)}
              </td>
            </tr>
          ))}
      </React.Fragment>
    );
  };

  const renderTotalRow = (label: string, amounts: number[], total: number, colorClass: string) => (
    <tr className="bg-slate-50/75 border-t border-slate-200">
      <td className={`${stickyCell} bg-slate-50 py-2.5 px-4 font-bold whitespace-nowrap ${colorClass}`}>{label}</td>
      {amounts.map((amount, i) => (
        <td key={periods[i].key} className={`py-2.5 px-4 text-right tabular-nums font-bold whitespace-nowrap ${colorClass}`}>
          {formatCurrency(amount)}
        </td>
      ))}
      <td className={`py-2.5 px-4 text-right tabular-nums font-extrabold whitespace-nowrap ${colorClass}`}>
        {formatCurrency(total)}
      </td>
      <td className={`py-2.5 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${colorClass}`}>
        {formatCurrency(Math.round(total / periodCount))}
      </td>
      <td className="py-2.5 px-4" />
    </tr>
  );

  const incomeRows = data.rows.filter((r) => r.group === 'income');
  const expenseRows = data.rows.filter((r) => r.group === 'expense');
  const transferRows = data.rows.filter((r) => r.group === 'transfer');

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">Přehled podle kategorií</h3>
        <button
          type="button"
          onClick={toggleAll}
          disabled={expandableKeys.length === 0}
          className="-my-1 px-3 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          {allExpanded ? 'Sbalit vše' : 'Rozbalit vše'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold text-xs">
              <th className={`${stickyCell} bg-slate-50 py-2.5 px-4`}>Kategorie</th>
              {periods.map((p) => (
                <th key={p.key} className="py-2.5 px-4 text-right whitespace-nowrap">
                  {p.shortLabel || p.label}
                </th>
              ))}
              <th className="py-2.5 px-4 text-right whitespace-nowrap">Celkem</th>
              <th className="py-2.5 px-4 text-right whitespace-nowrap">Ø / období</th>
              <th className="py-2.5 px-4 text-right whitespace-nowrap">Podíl</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {incomeRows.map(renderRow)}
            {renderTotalRow('Příjmy celkem', data.incomeTotalsInHaler, data.incomeTotalInHaler, 'text-emerald-700')}
            {expenseRows.map(renderRow)}
            {renderTotalRow('Výdaje celkem', data.expenseTotalsInHaler, data.expenseTotalInHaler, 'text-red-700')}
            {transferRows.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
};
