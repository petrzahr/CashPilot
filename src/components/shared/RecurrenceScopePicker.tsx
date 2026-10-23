import React from 'react';
import { Repeat } from 'lucide-react';

export type RecurrenceScope = 'occurrence' | 'future' | 'series';

const SCOPE_ORDER: RecurrenceScope[] = ['occurrence', 'future', 'series'];

const SCOPE_TITLES: Record<RecurrenceScope, string> = {
  occurrence: 'Jen tento výskyt',
  future: 'Tento a všechny budoucí výskyty',
  series: 'Celá série',
};

interface RecurrenceScopePickerProps {
  /** Nadpis skupiny, např. „Pravidelná položka – co chcete smazat?“ */
  legend: string;
  name: string;
  value: RecurrenceScope;
  onChange: (scope: RecurrenceScope) => void;
  /** Vysvětlení důsledku každé volby v kontextu daného dialogu */
  descriptions: Record<RecurrenceScope, string>;
  disabled?: boolean;
  /** Volba, která je nevratná (např. smazání celé série), se zvýrazní červeně */
  destructiveScope?: RecurrenceScope;
}

/** Jednotná volba rozsahu změny pravidelné položky pro úpravu, mazání i změnu pořadí. */
export const RecurrenceScopePicker: React.FC<RecurrenceScopePickerProps> = ({
  legend,
  name,
  value,
  onChange,
  descriptions,
  disabled = false,
  destructiveScope,
}) => (
  <fieldset className="space-y-2" disabled={disabled}>
    <legend className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-2">
      <Repeat className="w-4 h-4 text-slate-500" aria-hidden="true" />
      <span>{legend}</span>
    </legend>
    {SCOPE_ORDER.map(scope => {
      const checked = value === scope;
      const destructive = scope === destructiveScope;
      return (
        <label
          key={scope}
          className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
            checked
              ? destructive
                ? 'border-red-500 bg-red-50/50 shadow-xs'
                : 'border-sky-500 bg-sky-50/60 shadow-xs'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={scope}
            checked={checked}
            onChange={() => onChange(scope)}
            className={`mt-0.5 ${destructive ? 'text-red-600 focus:ring-red-500' : 'text-sky-600 focus:ring-sky-500'}`}
          />
          <span className="text-xs">
            <span className="block font-semibold text-slate-900">{SCOPE_TITLES[scope]}</span>
            <span className="block text-slate-500 mt-0.5">{descriptions[scope]}</span>
          </span>
        </label>
      );
    })}
  </fieldset>
);
