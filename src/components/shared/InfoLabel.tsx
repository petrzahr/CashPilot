import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoLabelProps {
  label: React.ReactNode;
  /** Vysvětlení, jak se hodnota počítá */
  info: string;
  /** Název pro čtečky, když `label` není prostý text */
  name?: string;
  labelClassName?: string;
}

/**
 * Popisek KPI dlaždice s ikonou „i“. Vysvětlení se po klepnutí rozbalí přímo v dlaždici
 * (pod hodnotou díky `order-last`), takže funguje i na dotyku, kde `title` nikdy nevidíte.
 * Rodičovská dlaždice musí být `flex flex-col`.
 */
export const InfoLabel: React.FC<InfoLabelProps> = ({ label, info, name, labelClassName = 'text-xs text-slate-500 font-medium' }) => {
  const [open, setOpen] = useState(false);
  const infoId = useId();

  return (
    <>
      <div className="flex items-start justify-between gap-1">
        <span className={`block min-w-0 ${labelClassName}`}>{label}</span>
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          aria-expanded={open}
          aria-controls={open ? infoId : undefined}
          aria-label={`Jak se počítá: ${name ?? (typeof label === 'string' ? label : '')}`.trim()}
          title={info}
          className={`relative shrink-0 -m-0.5 p-0.5 rounded-md transition-colors max-md:after:absolute max-md:after:-inset-3 max-md:after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
            open ? 'text-sky-700 bg-sky-50' : 'text-slate-500 hover:text-sky-700 hover:bg-slate-100'
          }`}
        >
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <p id={infoId} className="order-last mt-1.5 pt-1.5 border-t border-slate-100 text-xs text-slate-500">
          {info}
        </p>
      )}
    </>
  );
};
