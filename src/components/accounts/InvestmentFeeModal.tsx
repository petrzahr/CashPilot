import React, { useState, useEffect, useMemo, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Account } from '../../types/finance';
import { getAccountFees } from '../../services/investmentPerformanceService';
import { halerToInputValue, parseInputToHaler } from '../../services/currencyService';
import { generatePeriodsBetween, getPeriodForDate } from '../../services/periodService';
import { Info } from 'lucide-react';
import { FieldError, fieldStateClass, fieldErrorProps } from '../common/FieldError';

interface InvestmentFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  /** Období, které se má otevřít (např. úprava z historie); jinak aktuální období. */
  periodKey?: string | null;
}

export const InvestmentFeeModal: React.FC<InvestmentFeeModalProps> = ({ isOpen, onClose, account, periodKey }) => {
  const fieldId = useId();
  const { investmentFees = [], currentPeriod, settings, saveInvestmentFee } = useFinance();
  const [selectedKey, setSelectedKey] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  const accountFees = useMemo(() => account ? getAccountFees(investmentFees, account.id) : [], [account, investmentFees]);

  const periods = useMemo(() => {
    if (!account) return [];
    const first = getPeriodForDate(account.initialBalanceDate, settings.budgetStartDay);
    const last = first.key > currentPeriod.key ? first : currentPeriod;
    return generatePeriodsBetween(first, last, settings.budgetStartDay).reverse();
  }, [account, currentPeriod, settings.budgetStartDay]);

  // Existující poplatek období se upravuje; jinak se předvyplní poslední předchozí poplatek.
  const fillForPeriod = (key: string) => {
    setSelectedKey(key);
    const existing = accountFees.find(f => f.periodKey === key);
    const previous = [...accountFees].reverse().find(f => f.periodKey < key) ?? accountFees[accountFees.length - 1];
    const source = existing ?? previous;
    setAmountStr(source ? halerToInputValue(source.amountInHaler) : '');
    setNote(existing?.note ?? '');
    setAmountError(null);
  };

  useEffect(() => {
    if (isOpen && account) fillForPeriod(periodKey ?? (periods.some(p => p.key === currentPeriod.key) ? currentPeriod.key : periods[0]?.key ?? currentPeriod.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, account?.id, periodKey]);

  if (!account) return null;

  const existing = accountFees.find(f => f.periodKey === selectedKey);
  const amountInHaler = parseInputToHaler(amountStr);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountStr.trim() || !Number.isSafeInteger(amountInHaler) || amountInHaler < 0) {
      setAmountError('Zadejte částku poplatku (0 nebo více).');
      document.getElementById(`${fieldId}-2`)?.focus();
      return;
    }
    saveInvestmentFee(account.id, selectedKey, amountInHaler, note);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${existing ? 'Upravit poplatek' : 'Zadat poplatek'}: ${account.name}`}
      subtitle="Měsíční poplatek obchodníka"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">Období *</label>
            <select id={`${fieldId}-1`}
              value={selectedKey}
              onChange={(e) => fillForPeriod(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {periods.map(p => (
                <option key={p.key} value={p.key}>
                  {p.name}{accountFees.some(f => f.periodKey === p.key) ? ' (zadáno)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">Částka poplatku ({account.currency === 'CZK' ? 'Kč' : account.currency}) *</label>
            <input id={`${fieldId}-2`}
              type="number"
              step="0.01"
              min="0"
              required
              value={amountStr}
              onChange={(e) => { setAmountStr(e.target.value); setAmountError(null); }}
              {...fieldErrorProps(`${fieldId}-2`, amountError)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(amountError, 'border-slate-200 focus:ring-2 focus:ring-purple-500')} font-semibold`}
            />
            <FieldError inputId={`${fieldId}-2`} message={amountError} />
          </div>
        </div>

        <div>
          <label htmlFor={`${fieldId}-3`} className="block text-xs font-semibold text-slate-500 mb-1">Poznámka (nepovinné)</label>
          <input id={`${fieldId}-3`}
            type="text"
            placeholder="např. Výpis obchodníka za září"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex items-start gap-2 p-4 bg-purple-50/70 border border-purple-100 rounded-xl text-xs text-purple-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {existing
              ? 'Pro toto období už je poplatek zadaný – uložením ho přepíšete. '
              : 'Za každé období jde zadat jen jeden poplatek. '}
            Při výpočtu výnosu se poplatek odečte od vkladů. Není to výdaj, rozpočet nemění.
          </span>
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm shadow-purple-200"
          >
            Uložit poplatek
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
