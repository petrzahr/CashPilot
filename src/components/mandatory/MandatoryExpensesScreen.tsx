import React, { useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { formatCurrency } from '../../services/currencyService';
import { formatCzechDate, getTodayInPrague } from '../../services/periodService';
import { calculateMandatoryOverview, MandatorySection } from '../../services/mandatoryExpensesService';

/** Všechny částky na této obrazovce se zobrazují zaokrouhlené na 100 Kč (součty se počítají z přesných hodnot). */
const formatRounded = (haler: number) => formatCurrency(Math.round(haler / 10000) * 10000);

const SECTION_TITLES: Record<MandatorySection['group'], string> = {
  income: 'Pravidelné příjmy',
  expense: 'Mandatorní výdaje',
  transfer: 'Pravidelné spoření & převody',
};

const SECTION_TOTAL_COLORS: Record<MandatorySection['group'], string> = {
  income: 'text-emerald-700',
  expense: 'text-red-700',
  transfer: 'text-sky-700',
};

const SectionTable: React.FC<{ section: MandatorySection }> = ({ section }) => {
  const title = SECTION_TITLES[section.group];
  const totalColor = SECTION_TOTAL_COLORS[section.group];
  const isTransfer = section.group === 'transfer';

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>

      {section.categories.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold text-xs">
                <th className="py-2.5 px-4">Položka</th>
                {!isTransfer && <th className="py-2.5 px-4">Kategorie</th>}
                <th className="py-2.5 px-4">Účet</th>
                <th className="py-2.5 px-4">Kdy se hradí</th>
                <th className="py-2.5 px-4">Nejbližší</th>
                <th className="py-2.5 px-4 text-right">Částka</th>
                <th className="py-2.5 px-4 text-right">Měsíčně</th>
                <th className="py-2.5 px-4 text-right">Ročně</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {section.categories.map((cat) => (
                <React.Fragment key={cat.key}>
                  {!isTransfer && (
                    <tr className="bg-slate-50/40">
                      <td colSpan={5} className="py-2 px-4 font-bold text-slate-900">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          {cat.label}
                        </span>
                      </td>
                      <td className="py-2 px-4" />
                      <td className="py-2 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatRounded(cat.monthlyInHaler)}
                      </td>
                      <td className="py-2 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatRounded(cat.yearlyInHaler)}
                      </td>
                    </tr>
                  )}
                  {cat.items.map((item) => (
                    <tr key={item.ruleId}>
                      <td className={`py-2 ${isTransfer ? 'px-4' : 'pl-8 pr-4'} font-medium text-slate-900`}>
                        {item.title}
                        {item.startsInFuture && (
                          <span className="ml-1.5 text-[10px] font-medium text-slate-500">(zatím nezačala)</span>
                        )}
                      </td>
                      {!isTransfer && (
                        <td className="py-2 px-4 text-slate-500 whitespace-nowrap">{item.categoryLabel}</td>
                      )}
                      <td className="py-2 px-4 text-slate-500 whitespace-nowrap">{item.accountLabel}</td>
                      <td className="py-2 px-4 text-slate-600 whitespace-nowrap">{item.scheduleLabel}</td>
                      <td className="py-2 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                        {item.nextDate ? formatCzechDate(item.nextDate) : '—'}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        {formatRounded(item.amountInHaler)}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatRounded(item.monthlyInHaler)}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        {formatRounded(item.yearlyInHaler)}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className="bg-slate-50/75 border-t border-slate-200">
                <td colSpan={isTransfer ? 5 : 6} className={`py-2.5 px-4 font-bold ${totalColor}`}>
                  Celkem
                </td>
                <td className={`py-2.5 px-4 text-right font-extrabold tabular-nums whitespace-nowrap ${totalColor}`}>
                  {formatRounded(section.monthlyInHaler)}
                </td>
                <td className={`py-2.5 px-4 text-right font-bold tabular-nums whitespace-nowrap ${totalColor}`}>
                  {formatRounded(section.yearlyInHaler)}
                </td>
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

export const MandatoryExpensesScreen: React.FC = () => {
  const { recurringRules, categories, accounts, settings } = useFinance();
  const todayStr = getTodayInPrague();
  const budgetStartDay = settings?.budgetStartDay || 15;

  const overview = useMemo(
    () => calculateMandatoryOverview(recurringRules, categories, accounts, todayStr, budgetStartDay),
    [recurringRules, categories, accounts, todayStr, budgetStartDay]
  );

  const cards = [
    { label: 'Příjmy / měsíc', value: overview.income.monthlyInHaler, className: 'text-emerald-600' },
    { label: 'Mandatorní výdaje / měsíc', value: overview.expense.monthlyInHaler, className: 'text-red-600' },
    {
      label: 'Skutečně uspořeno / měsíc',
      value: overview.actuallySavedMonthlyInHaler,
      className: overview.actuallySavedMonthlyInHaler < 0 ? 'text-red-600' : 'text-emerald-600',
      title: 'Příjmy − výdaje na běžných účtech a hotovosti, bez převodů',
    },
    { label: 'Spoření & převody / měsíc', value: overview.transfer.monthlyInHaler, className: 'text-sky-600' },
    {
      label: 'Zbývá / měsíc',
      value: overview.remainingMonthlyInHaler,
      className: overview.remainingMonthlyInHaler < 0 ? 'text-red-600' : 'text-slate-900',
      title: 'Příjmy − mandatorní výdaje − spoření & převody',
    },
  ];

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
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
          </div>
        ))}
      </div>

      <SectionTable section={overview.income} />
      <SectionTable section={overview.expense} />
      <SectionTable section={overview.transfer} />
    </div>
  );
};
