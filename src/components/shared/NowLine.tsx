import React from 'react';

/** Podřádek hodnoty v probíhajícím období: jen číslo, význam („teď“ / „provedeno“) v tooltipu. */
export const NowLine: React.FC<{ label: string; text: string }> = ({ label, text }) => (
  <span className="text-xs text-slate-500 font-medium block truncate tabular-nums" title={label}>{text}</span>
);
