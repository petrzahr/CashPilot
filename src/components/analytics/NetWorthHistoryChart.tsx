import React, { useState } from 'react';
import { NetWorthHistoryPoint } from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';

interface NetWorthHistoryChartProps {
  data: NetWorthHistoryPoint[];
  accountFilterName?: string | null;
}

export const NetWorthHistoryChart: React.FC<NetWorthHistoryChartProps> = ({
  data,
  accountFilterName,
}) => {
  const [showChecking, setShowChecking] = useState(true);
  const [showSavings, setShowSavings] = useState(true);
  const [showInvestments, setShowInvestments] = useState(true);
  const [showPension, setShowPension] = useState(true);
  const [showTotal, setShowTotal] = useState(true);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm text-center text-slate-500 text-xs">
        Žádná data pro zobrazení vývoje celkového jmění.
      </div>
    );
  }

  // Výpočet min a max pro škálování
  let minVal = 0;
  let maxVal = 0;

  for (const d of data) {
    const valuesToCheck: number[] = [];
    if (showTotal) valuesToCheck.push(d.totalNetWorthInHaler);
    if (!accountFilterName) {
      if (showChecking) valuesToCheck.push(d.checkingAndCashInHaler);
      if (showSavings) valuesToCheck.push(d.savingsInHaler);
      if (showInvestments) valuesToCheck.push(d.investmentsInHaler);
      if (showPension) valuesToCheck.push(d.pensionInHaler);
    } else {
      valuesToCheck.push(d.totalNetWorthInHaler);
    }

    for (const val of valuesToCheck) {
      if (val > maxVal) maxVal = val;
      if (val < minVal) minVal = val;
    }
  }

  if (maxVal === 0 && minVal === 0) maxVal = 1000000;

  const padding = (maxVal - minVal) * 0.15 || 100000;
  const effectiveMax = maxVal + padding;
  const effectiveMin = Math.min(0, minVal - padding);
  const range = effectiveMax - effectiveMin || 1;

  // Rozměry SVG
  const width = 800;
  const height = 260;
  const margin = { top: 25, right: 25, bottom: 40, left: 30 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const getX = (idx: number) => {
    if (data.length === 1) return margin.left + chartWidth / 2;
    return margin.left + (idx / (data.length - 1)) * chartWidth;
  };

  const getY = (valHaler: number) => {
    const norm = (valHaler - effectiveMin) / range;
    return margin.top + chartHeight - norm * chartHeight;
  };

  const zeroY = getY(0);

  // Helper pro generování čáry
  const buildLinePath = (getter: (d: NetWorthHistoryPoint) => number) => {
    if (data.length === 0) return '';
    if (data.length === 1) return '';
    return data
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)},${getY(getter(d))}`)
      .join(' ');
  };

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
      {/* Hlavička s přepínači */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {accountFilterName
              ? `Historický vývoj: ${accountFilterName}`
              : 'Vývoj celkového jmění a skupin účtů'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Historický stav ke konci každého rozpočtového období (k dnešku pro probíhající období)
          </p>
        </div>

        {/* Přepínače řad */}
        {!accountFilterName && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setShowChecking(!showChecking)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                showChecking
                  ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${showChecking ? 'bg-sky-500' : 'bg-slate-300'}`} />
              Běžné + hotovost
            </button>

            <button
              type="button"
              onClick={() => setShowSavings(!showSavings)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                showSavings
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${showSavings ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              Spořicí
            </button>

            <button
              type="button"
              onClick={() => setShowInvestments(!showInvestments)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                showInvestments
                  ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${showInvestments ? 'bg-purple-500' : 'bg-slate-300'}`} />
              Investice
            </button>

            <button
              type="button"
              onClick={() => setShowPension(!showPension)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                showPension
                  ? 'bg-pink-50 text-pink-700 border-pink-200 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${showPension ? 'bg-pink-500' : 'bg-slate-300'}`} />
              Penzijní
            </button>

            <button
              type="button"
              onClick={() => setShowTotal(!showTotal)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                showTotal
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${showTotal ? 'bg-white' : 'bg-slate-300'}`} />
              Celkové jmění
            </button>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Nulová linka */}
          <line
            x1={margin.left}
            y1={zeroY}
            x2={width - margin.right}
            y2={zeroY}
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Křivky jednotlivých skupin */}
          {!accountFilterName && showChecking && data.length > 1 && (
            <path
              d={buildLinePath((d) => d.checkingAndCashInHaler)}
              fill="none"
              stroke="#0284c7"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {!accountFilterName && showSavings && data.length > 1 && (
            <path
              d={buildLinePath((d) => d.savingsInHaler)}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {!accountFilterName && showInvestments && data.length > 1 && (
            <path
              d={buildLinePath((d) => d.investmentsInHaler)}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {!accountFilterName && showPension && data.length > 1 && (
            <path
              d={buildLinePath((d) => d.pensionInHaler)}
              fill="none"
              stroke="#ec4899"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {/* Výrazná křivka celkového jmění */}
          {showTotal && data.length > 1 && (
            <path
              d={buildLinePath((d) => d.totalNetWorthInHaler)}
              fill="none"
              stroke="#0f172a"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          )}

          {/* Interaktivní sloty a body */}
          {data.map((item, idx) => {
            const cx = getX(idx);
            const cy = getY(item.totalNetWorthInHaler);
            const isHovered = hoveredIdx === idx;

            return (
              <g
                key={item.monthKey}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
              >
                {/* Vertikální vodící linka na hover */}
                {isHovered && (
                  <line
                    x1={cx}
                    y1={margin.top}
                    x2={cx}
                    y2={height - margin.bottom}
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Bod celkového jmění */}
                {showTotal && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 6 : 4}
                    fill="#0f172a"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}

                {/* Popisek na ose X */}
                <text
                  x={cx}
                  y={height - margin.bottom + 18}
                  textAnchor="middle"
                  className={`text-[11px] font-medium transition-colors ${
                    isHovered ? 'fill-slate-900 font-bold' : 'fill-slate-500'
                  }`}
                >
                  {item.shortLabel || item.label}
                </text>

                {item.isCurrentMonth && (
                  <g>
                    <rect
                      x={cx - 29}
                      y={height - margin.bottom + 20}
                      width={58}
                      height={13}
                      rx={4}
                      className="fill-sky-100"
                    />
                    <text
                      x={cx}
                      y={height - margin.bottom + 29}
                      textAnchor="middle"
                      className="text-[9px] fill-sky-700 font-bold"
                    >
                      Aktuální
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoveredItem && hoveredIdx !== null && (
          <div
            className="absolute z-20 pointer-events-none bg-slate-900/95 backdrop-blur-sm text-white text-xs rounded-xl p-3 shadow-xl space-y-2 transition-all"
            style={{
              left: `${Math.min(
                Math.max(12, (getX(hoveredIdx) / width) * 100),
                82
              )}%`,
              top: '10px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="font-bold text-slate-200 border-b border-slate-700/80 pb-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-4">
                <span>{hoveredItem.label}</span>
                {hoveredItem.isCurrentMonth && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-sky-500/20 text-sky-300 rounded-md">
                    Aktuální
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1 pt-0.5 text-[11px]">
              {!accountFilterName && (
                <>
                  <div className="flex items-center justify-between gap-4 text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-500" />
                      Běžné + hotovost:
                    </span>
                    <span className="font-semibold tabular-nums text-white">
                      {formatCurrency(hoveredItem.checkingAndCashInHaler)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Spořicí účty:
                    </span>
                    <span className="font-semibold tabular-nums text-white">
                      {formatCurrency(hoveredItem.savingsInHaler)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      Investice:
                    </span>
                    <span className="font-semibold tabular-nums text-white">
                      {formatCurrency(hoveredItem.investmentsInHaler)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-pink-500" />
                      Penzijní účty:
                    </span>
                    <span className="font-semibold tabular-nums text-white">
                      {formatCurrency(hoveredItem.pensionInHaler)}
                    </span>
                  </div>
                </>
              )}

              <div className="border-t border-slate-700/80 pt-1.5 flex items-center justify-between gap-4 font-bold">
                <span className="text-slate-100">
                  {accountFilterName ? 'Zůstatek účtu:' : 'Celkové jmění:'}
                </span>
                <span className="text-sm font-extrabold text-white tabular-nums">
                  {formatCurrency(hoveredItem.totalNetWorthInHaler)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
