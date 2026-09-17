import React, { useState } from 'react';
import { MonthlyCashFlowPoint } from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';

interface CashFlowBarChartProps {
  data: MonthlyCashFlowPoint[];
  onSelectMonth?: (monthKey: string) => void;
}

export const CashFlowBarChart: React.FC<CashFlowBarChartProps> = ({
  data,
  onSelectMonth,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm text-center text-slate-500 text-xs">
        Žádná data pro zobrazení grafu cash flow.
      </div>
    );
  }

  // Najít maximální a minimální hodnotu pro měřítko
  let maxVal = 0;
  let minVal = 0;

  for (const d of data) {
    if (d.incomeInHaler > maxVal) maxVal = d.incomeInHaler;
    if (d.expenseInHaler > maxVal) maxVal = d.expenseInHaler;
    if (d.netChangeInHaler > maxVal) maxVal = d.netChangeInHaler;
    if (d.netChangeInHaler < minVal) minVal = d.netChangeInHaler;
  }

  if (maxVal === 0) maxVal = 1000000; // 10 000 Kč fallback

  const topPadding = (maxVal - minVal) * 0.15 || 100000;
  const effectiveMax = maxVal + topPadding;
  const effectiveMin = Math.min(0, minVal - topPadding);
  const range = effectiveMax - effectiveMin || 1;

  // Rozměry SVG plátna
  const width = 800;
  const height = 280;
  const margin = { top: 25, right: 25, bottom: 45, left: 30 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const getY = (valHaler: number) => {
    const norm = (valHaler - effectiveMin) / range;
    return margin.top + chartHeight - norm * chartHeight;
  };

  const zeroY = getY(0);

  const count = data.length;
  const slotWidth = chartWidth / count;
  const barGroupWidth = Math.min(slotWidth * 0.65, 48);
  const singleBarWidth = (barGroupWidth - 4) / 2;

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
      {/* Hlavička grafu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Příjmy, výdaje a čistá změna
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Měsíční porovnání uskutečněných příjmů a výdajů s čistou bilancí
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span>Příjmy</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="w-3 h-3 rounded-sm bg-red-500" />
            <span>Výdaje</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="w-3 h-0.5 bg-sky-500 rounded-full" />
            <span className="w-2 h-2 rounded-full bg-sky-500 -ml-1" />
            <span>Čistá změna</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Vodorovná nulová linka */}
          <line
            x1={margin.left}
            y1={zeroY}
            x2={width - margin.right}
            y2={zeroY}
            stroke="#cbd5e1"
            strokeWidth="1.5"
            strokeDasharray={minVal < 0 ? '4 4' : undefined}
          />

          {/* Sloupce a body */}
          {data.map((item, idx) => {
            const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
            const incomeBarX = slotCenterX - barGroupWidth / 2;
            const expenseBarX = incomeBarX + singleBarWidth + 4;

            // Výška sloupce příjmů (od zeroY nahoru)
            const incomeY = getY(item.incomeInHaler);
            const incomeH = Math.max(0, zeroY - incomeY);

            // Výška sloupce výdajů (od zeroY nahoru)
            const expenseY = getY(item.expenseInHaler);
            const expenseH = Math.max(0, zeroY - expenseY);

            // Pozice bodu čisté změny
            const netY = getY(item.netChangeInHaler);

            const isHovered = hoveredIdx === idx;

            return (
              <g
                key={item.monthKey}
                className="cursor-pointer transition-opacity"
                onClick={() => onSelectMonth && onSelectMonth(item.monthKey)}
                onMouseEnter={() => setHoveredIdx(idx)}
              >
                {/* Podbarvení aktivního slotu */}
                {isHovered && (
                  <rect
                    x={margin.left + idx * slotWidth}
                    y={margin.top}
                    width={slotWidth}
                    height={chartHeight}
                    fill="#f1f5f9"
                    opacity="0.7"
                    rx="8"
                  />
                )}

                {/* Sloupec příjmů */}
                <rect
                  x={incomeBarX}
                  y={incomeY}
                  width={singleBarWidth}
                  height={incomeH}
                  fill="#10b981"
                  rx="3"
                  className="transition-all hover:opacity-90"
                />

                {/* Sloupec výdajů */}
                <rect
                  x={expenseBarX}
                  y={expenseY}
                  width={singleBarWidth}
                  height={expenseH}
                  fill="#ef4444"
                  rx="3"
                  className="transition-all hover:opacity-90"
                />

                {/* Popisek měsíce dole na ose X */}
                <text
                  x={slotCenterX}
                  y={height - margin.bottom + 18}
                  textAnchor="middle"
                  className={`text-[11px] font-medium transition-colors ${
                    isHovered ? 'fill-sky-700 font-bold' : 'fill-slate-500'
                  }`}
                >
                  {item.shortLabel}
                </text>

              </g>
            );
          })}

          {/* Křivka čisté změny spojující body */}
          {data.length > 1 && (
            <path
              d={data
                .map((item, idx) => {
                  const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
                  const netY = getY(item.netChangeInHaler);
                  return `${idx === 0 ? 'M' : 'L'} ${slotCenterX},${netY}`;
                })
                .join(' ')}
              fill="none"
              stroke="#0284c7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Body čisté změny */}
          {data.map((item, idx) => {
            const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
            const netY = getY(item.netChangeInHaler);
            const isHovered = hoveredIdx === idx;

            return (
              <circle
                key={`dot-${item.monthKey}`}
                cx={slotCenterX}
                cy={netY}
                r={isHovered ? 6 : 4}
                fill={item.netChangeInHaler >= 0 ? '#0284c7' : '#dc2626'}
                stroke="#ffffff"
                strokeWidth="2"
                className="transition-all pointer-events-none"
              />
            );
          })}
        </svg>

        {/* Vznášející se tooltip */}
        {hoveredItem && hoveredIdx !== null && (
          <div
            className="absolute z-20 pointer-events-none bg-slate-900/95 backdrop-blur-sm text-white text-xs rounded-xl p-3 shadow-xl space-y-1.5 transition-all"
            style={{
              left: `${Math.min(
                Math.max(
                  10,
                  ((margin.left + hoveredIdx * slotWidth + slotWidth / 2) / width) * 100
                ),
                85
              )}%`,
              top: '10px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="font-bold text-slate-200 border-b border-slate-700/80 pb-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-4">
                <span>{hoveredItem.label}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-0.5">
              <span className="text-slate-400">Příjmy:</span>
              <span className="font-semibold text-emerald-400 text-right tabular-nums">
                {formatCurrency(hoveredItem.incomeInHaler)}
              </span>

              <span className="text-slate-400">Výdaje:</span>
              <span className="font-semibold text-red-400 text-right tabular-nums">
                {formatCurrency(hoveredItem.expenseInHaler)}
              </span>

              <span className="text-slate-400">Čistá změna:</span>
              <span
                className={`font-bold text-right tabular-nums ${
                  hoveredItem.netChangeInHaler < 0 ? 'text-red-400' : 'text-sky-400'
                }`}
              >
                {formatCurrency(hoveredItem.netChangeInHaler)}
              </span>

              <span className="text-slate-400">Míra úspor:</span>
              <span className="font-semibold text-right tabular-nums text-slate-200">
                {hoveredItem.savingsRate !== null
                  ? `${hoveredItem.savingsRate.toFixed(1)} %`
                  : '—'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
