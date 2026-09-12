import React, { useState } from 'react';
import { PeriodSummary } from '../../types/finance';
import { formatCurrency, halerToCzk } from '../../services/currencyService';
import { formatMonthsCount } from '../../services/periodService';

interface OverviewChartProps {
  periods: PeriodSummary[];
  minReserveInHaler: number;
  forecastMonths?: number;
}

export const OverviewChart: React.FC<OverviewChartProps> = ({
  periods,
  minReserveInHaler,
  forecastMonths,
}) => {
  const horizon = forecastMonths || periods?.length || 12;
  const [showUsable, setShowUsable] = useState(true);
  const [showNetWorth, setShowNetWorth] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!periods || periods.length === 0) return null;

  // Najít min a max pro škálování
  let minVal = 0;
  let maxVal = 1000000; // výchozí 10k Kč

  periods.forEach(p => {
    if (showUsable) {
      if (p.usableClosingInHaler < minVal) minVal = p.usableClosingInHaler;
      if (p.usableClosingInHaler > maxVal) maxVal = p.usableClosingInHaler;
    }
    if (showNetWorth) {
      if (p.netWorthClosingInHaler < minVal) minVal = p.netWorthClosingInHaler;
      if (p.netWorthClosingInHaler > maxVal) maxVal = p.netWorthClosingInHaler;
    }
  });

  if (minReserveInHaler > maxVal) maxVal = minReserveInHaler;

  // Přidáme 10% padding nahoru a dolů
  const padding = (maxVal - minVal) * 0.1 || 100000;
  const effectiveMax = maxVal + padding;
  const effectiveMin = Math.min(0, minVal - padding);
  const range = effectiveMax - effectiveMin || 1;

  // Rozměry SVG grafu
  const width = 800;
  const height = 240;
  const margin = { top: 20, right: 30, bottom: 35, left: 20 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const getX = (index: number) => {
    return margin.left + (index / (periods.length - 1)) * chartWidth;
  };

  const getY = (valHaler: number) => {
    const norm = (valHaler - effectiveMin) / range;
    return margin.top + chartHeight - norm * chartHeight;
  };

  // Generování SVG cest pro Usable
  const usablePoints = periods.map((p, i) => `${getX(i)},${getY(p.usableClosingInHaler)}`);
  const usableLinePath = `M ${usablePoints.join(' L ')}`;
  const usableAreaPath = `M ${getX(0)},${getY(0)} L ${usablePoints.join(' L ')} L ${getX(periods.length - 1)},${getY(0)} Z`;

  // Generování SVG cest pro Net Worth
  const nwPoints = periods.map((p, i) => `${getX(i)},${getY(p.netWorthClosingInHaler)}`);
  const nwLinePath = `M ${nwPoints.join(' L ')}`;
  const nwAreaPath = `M ${getX(0)},${getY(0)} L ${nwPoints.join(' L ')} L ${getX(periods.length - 1)},${getY(0)} Z`;

  const zeroY = getY(0);
  const reserveY = getY(minReserveInHaler);

  const hoveredPeriod = hoveredIdx !== null ? periods[hoveredIdx] : null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
      {/* Hlavička grafu s přepínači */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Výhled vývoje financí na {formatMonthsCount(horizon)}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Simulace zůstatků použitelných peněz a celkového majetku</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUsable(!showUsable)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
              showUsable 
                ? 'bg-sky-50 text-sky-700 border-sky-200 shadow-sm' 
                : 'bg-slate-50 text-slate-400 border-slate-200'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${showUsable ? 'bg-sky-600' : 'bg-slate-300'}`} />
            Použitelné peníze
          </button>

          <button
            type="button"
            onClick={() => setShowNetWorth(!showNetWorth)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
              showNetWorth 
                ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-sm' 
                : 'bg-slate-50 text-slate-400 border-slate-200'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${showNetWorth ? 'bg-purple-600' : 'bg-slate-300'}`} />
            Celkový majetek
          </button>
        </div>
      </div>

      {/* SVG Canvas grafu */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id="usableGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Mřížka a vodorovné linky */}
          <line
            x1={margin.left}
            y1={zeroY}
            x2={width - margin.right}
            y2={zeroY}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Linka minimální rezervy */}
          {reserveY >= margin.top && reserveY <= height - margin.bottom && (
            <g>
              <line
                x1={margin.left}
                y1={reserveY}
                x2={width - margin.right}
                y2={reserveY}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <text
                x={width - margin.right}
                y={reserveY - 4}
                textAnchor="end"
                className="text-[10px] font-medium fill-amber-600"
              >
                Rezerva ({formatCurrency(minReserveInHaler)})
              </text>
            </g>
          )}

          {/* Celkový majetek plocha a čára */}
          {showNetWorth && (
            <>
              <path d={nwAreaPath} fill="url(#nwGrad)" />
              <path d={nwLinePath} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Použitelné peníze plocha a čára */}
          {showUsable && (
            <>
              <path d={usableAreaPath} fill="url(#usableGrad)" />
              <path d={usableLinePath} fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Body a interaktivní zóny */}
          {periods.map((p, i) => {
            const x = getX(i);
            const isHovered = hoveredIdx === i;

            return (
              <g key={p.period.key}>
                {/* Osa X popisky */}
                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  className={`text-[10px] font-medium ${isHovered ? 'fill-slate-900 font-bold' : 'fill-slate-400'}`}
                >
                  {p.period.name.split(' ')[0].substring(0, 3)}
                </text>

                {/* Vertikální vodítko při hoveru */}
                {isHovered && (
                  <line
                    x1={x}
                    y1={margin.top}
                    x2={x}
                    y2={height - margin.bottom}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}

                {/* Bod pro Net Worth */}
                {showNetWorth && (
                  <circle
                    cx={x}
                    cy={getY(p.netWorthClosingInHaler)}
                    r={isHovered ? 5 : 3.5}
                    fill="#8b5cf6"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}

                {/* Bod pro Usable */}
                {showUsable && (
                  <circle
                    cx={x}
                    cy={getY(p.usableClosingInHaler)}
                    r={isHovered ? 5 : 3.5}
                    fill={p.usableClosingInHaler < 0 ? '#ef4444' : p.usableClosingInHaler < minReserveInHaler ? '#f59e0b' : '#0284c7'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}

                {/* Interaktivní hitbox */}
                <rect
                  x={x - chartWidth / (periods.length * 2)}
                  y={margin.top}
                  width={chartWidth / periods.length}
                  height={chartHeight}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                />
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip bublina */}
        {hoveredPeriod && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white backdrop-blur-sm text-xs rounded-xl px-3.5 py-2 shadow-xl border border-slate-700 pointer-events-none flex items-center gap-4 transition-all"
          >
            <div>
              <p className="text-slate-400 text-[10px]">{hoveredPeriod.period.name}</p>
              <p className="font-semibold">{hoveredPeriod.period.startDate} až {hoveredPeriod.period.endDate}</p>
            </div>
            {showUsable && (
              <div>
                <p className="text-sky-300 text-[10px]">Použitelné peníze</p>
                <p className={`font-bold ${hoveredPeriod.usableClosingInHaler < 0 ? 'text-red-400' : 'text-sky-200'}`}>
                  {formatCurrency(hoveredPeriod.usableClosingInHaler)}
                </p>
              </div>
            )}
            {showNetWorth && (
              <div>
                <p className="text-purple-300 text-[10px]">Celkový majetek</p>
                <p className="font-bold text-purple-200">
                  {formatCurrency(hoveredPeriod.netWorthClosingInHaler)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
