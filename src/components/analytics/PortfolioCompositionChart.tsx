import React, { useState } from 'react';
import { PortfolioCompositionPoint } from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';

interface PortfolioCompositionChartProps {
  data: PortfolioCompositionPoint[];
}

export const PortfolioCompositionChart: React.FC<PortfolioCompositionChartProps> = ({
  data,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm text-center text-slate-500 text-xs">
        Žádná data pro zobrazení rozložení celkového majetku.
      </div>
    );
  }

  // Řádky tabulky vycházejí z pořadí segmentů, které je konzistentní napříč obdobími;
  // v tabulce se zobrazují v obráceném pořadí (graf zůstává skládaný v pořadí účtů z Účty)
  const tableSegments = [...data[0].segments].reverse();

  // Segment je "záporný" jen pokud jeho zůstatek po zaokrouhlení na celé koruny skutečně
  // vychází záporně (stejné pravidlo jako formatCurrency). Bez toho by i haléřová
  // zaokrouhlovací nepřesnost (zobrazující se jako "0 Kč") vynucovala zbytečné záporné
  // pásmo na ose.
  const isEffectivelyNegative = (seg: { balanceInHaler: number; pct: number | null }) =>
    (seg.pct ?? 0) < 0 && Math.round(seg.balanceInHaler / 100) !== 0;

  // Dominantní strana (kladná nebo záporná, podle výpočtu v analyticsEngine) je vždy
  // přesně 100 %, resp. -100 % - to je definice % základny, takže osa nikdy nemusí
  // přesáhnout tuto hranici. Rozsah osy se ale přizpůsobuje SKUTEČNÝM hodnotám napříč
  // obdobími (zaokrouhleno nahoru/dolů na nejbližší násobek 20), aby se nezobrazoval
  // prázdný prostor až do -100 %/100 %, když to žádné období nepotřebuje.
  let maxPositive = 0;
  let minNegative = 0;

  for (const d of data) {
    let posSum = 0;
    let negSum = 0;
    for (const s of d.segments) {
      const pct = s.pct ?? 0;
      if (isEffectivelyNegative(s)) negSum += pct;
      else posSum += pct;
    }
    if (posSum > maxPositive) maxPositive = posSum;
    if (negSum < minNegative) minNegative = negSum;
  }

  const effectiveMax = Math.min(100, Math.max(20, Math.ceil(maxPositive / 20) * 20));
  const effectiveMin = minNegative < 0 ? Math.max(-100, Math.floor(minNegative / 20) * 20) : 0;
  const range = effectiveMax - effectiveMin || 1;

  const clampPct = (v: number) => Math.max(effectiveMin, Math.min(effectiveMax, v));

  const gridValues: number[] = [];
  for (let v = 0; v <= effectiveMax; v += 20) gridValues.push(v);
  for (let v = -20; v >= effectiveMin; v -= 20) gridValues.push(v);

  // Rozměry SVG
  const width = 800;
  const height = 300;
  const margin = { top: 25, right: 25, bottom: 40, left: 35 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const getY = (pct: number) => {
    const norm = (pct - effectiveMin) / range;
    return margin.top + chartHeight - norm * chartHeight;
  };

  const zeroY = getY(0);

  const count = data.length;
  const slotWidth = chartWidth / count;
  const barWidth = Math.min(slotWidth * 0.6, 60);

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="p-5 space-y-4">
      {/* Hlavička karty */}
      <div>
        <h3 className="text-sm font-bold text-slate-900">Rozložení celkového majetku</h3>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Vodorovné mřížkové linky (popisky % jsou vykreslené jako HTML overlay níže,
              aby jejich velikost písma odpovídala tabulce bez ohledu na škálování SVG) */}
          {gridValues.map((v) => (
            <line
              key={`grid-${v}`}
              x1={margin.left}
              y1={getY(v)}
              x2={width - margin.right}
              y2={getY(v)}
              stroke="#cbd5e1"
              strokeWidth={v === 0 ? '1.5' : '1'}
              strokeDasharray={v === 0 ? undefined : '4 4'}
              opacity={v === 0 ? 1 : 0.6}
            />
          ))}

          {/* Skládané sloupce */}
          {data.map((item, idx) => {
            const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
            const barX = slotCenterX - barWidth / 2;
            const isHovered = hoveredIdx === idx;

            let posCum = 0;
            let negCum = 0;

            return (
              <g
                key={item.periodKey}
                className="cursor-pointer"
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

                {item.segments.map((seg) => {
                  const pct = seg.pct ?? 0;
                  let y0: number;
                  let y1: number;

                  if (isEffectivelyNegative(seg)) {
                    y1 = negCum;
                    negCum += pct;
                    y0 = negCum;
                  } else {
                    y0 = posCum;
                    posCum += pct;
                    y1 = posCum;
                  }

                  const rectY = getY(clampPct(y1));
                  const rectHeight = Math.max(0, getY(clampPct(y0)) - getY(clampPct(y1)));

                  if (rectHeight <= 0) return null;

                  return (
                    <rect
                      key={seg.key}
                      x={barX}
                      y={rectY}
                      width={barWidth}
                      height={rectHeight}
                      fill={seg.color}
                      className="transition-all hover:opacity-90"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Popisky os vykreslené jako HTML overlay (ne uvnitř škálovaného SVG),
            aby velikost písma odpovídala tabulce bez ohledu na šířku karty */}
        <div className="absolute inset-0 pointer-events-none">
          {gridValues.map((v) => (
            <span
              key={`grid-label-${v}`}
              className="absolute text-[8px] font-medium text-slate-500 whitespace-nowrap"
              style={{
                left: `${((margin.left - 6) / width) * 100}%`,
                top: `${(getY(v) / height) * 100}%`,
                transform: 'translate(-100%, -50%)',
              }}
            >
              {v}%
            </span>
          ))}

          {data.map((item, idx) => {
            const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={`x-label-${item.periodKey}`}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${(slotCenterX / width) * 100}%`,
                  top: `${((height - margin.bottom + 10) / height) * 100}%`,
                  transform: 'translate(-50%, 0)',
                }}
              >
                <span
                  className={`text-[8px] font-medium whitespace-nowrap transition-colors ${
                    isHovered ? 'text-slate-900 font-bold' : 'text-slate-500'
                  }`}
                >
                  {item.periodShortLabel || item.periodLabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* Hover Tooltip */}
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
                <span>{hoveredItem.periodLabel}</span>
              </div>
            </div>

            <div className="space-y-1 pt-0.5 text-[11px] min-w-[220px]">
              {hoveredItem.segments.map((seg) => (
                <div
                  key={seg.key}
                  className="flex items-center justify-between gap-4 text-slate-300"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="truncate">{seg.label}:</span>
                  </span>
                  <span className="font-semibold tabular-nums text-white whitespace-nowrap">
                    {formatCurrency(seg.balanceInHaler)}
                    {seg.pct !== null && (
                      <span className="text-slate-400 font-normal">
                        {' '}
                        ({(isEffectivelyNegative(seg) ? seg.pct : Math.abs(seg.pct)).toFixed(1)} %)
                      </span>
                    )}
                  </span>
                </div>
              ))}

              <div className="border-t border-slate-700/80 pt-1.5 flex items-center justify-between gap-4 font-bold">
                <span className="text-slate-100">Celkový majetek:</span>
                <span className="text-sm font-extrabold text-white tabular-nums">
                  {formatCurrency(hoveredItem.totalNetWorthInHaler)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Tabulka s absolutními částkami po účtech a obdobích (slouží zároveň jako legenda barev) */}
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50/75 border-b border-slate-200/80 text-slate-500 font-semibold text-xs">
              <th className="py-2.5 px-4">Účet</th>
              {data.map((d) => (
                <th key={d.periodKey} className="py-2.5 px-4 text-right whitespace-nowrap">
                  {d.periodShortLabel || d.periodLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tableSegments.map((seg) => (
              <tr key={seg.key}>
                <td className="py-2 px-4 font-medium text-slate-700 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    {seg.label}
                  </span>
                </td>
                {data.map((d) => {
                  const match = d.segments.find((s) => s.key === seg.key);
                  return (
                    <td
                      key={d.periodKey}
                      className="py-2 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap"
                    >
                      {match ? formatCurrency(match.balanceInHaler) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="py-2.5 px-4 font-bold text-slate-900">Celkový majetek</td>
              {data.map((d) => (
                <td
                  key={d.periodKey}
                  className="py-2.5 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap"
                >
                  {formatCurrency(d.totalNetWorthInHaler)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
