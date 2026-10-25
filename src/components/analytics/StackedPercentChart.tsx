import React, { useEffect, useId, useRef, useState } from 'react';
import { formatCurrency, formatPercent } from '../../services/currencyService';

export interface StackedPercentSegment {
  key: string;
  label: string;
  color: string;
  amountInHaler: number;
  pct: number | null;     // podíl na součtu absolutních hodnot segmentů daného období
  /** Plánovaná část pct (stejné znaménko), kreslí se šrafovaně na vnější straně segmentu */
  plannedPct?: number;
  /** Rozpad částky v tooltipu: „{executedLabel} X · plánováno Y“ a „vč. korekcí Z“ */
  split?: { executedLabel: string; executedInHaler: number; plannedInHaler: number; correctionsInHaler: number };
}

export interface StackedPercentPoint {
  periodKey: string;
  periodLabel: string;
  periodShortLabel: string;
  segments: StackedPercentSegment[];
  totalInHaler?: number;
  /** Období obsahuje plánované položky (jantarové záhlaví v tabulce) */
  hasPlanned?: boolean;
}

/** Částka, která se po zaokrouhlení na celé koruny zobrazí jako nenulová (stejně jako formatCurrency). */
const isVisibleAmount = (amountInHaler: number) => Math.round(amountInHaler / 100) !== 0;

interface StackedPercentChartProps {
  title: string;
  /** Doplňující popisek vedle nadpisu (např. z jakého účtu se počítá) */
  subtitle?: string;
  emptyText: string;
  rowHeaderLabel: string;
  data: StackedPercentPoint[];
  /** Popisek souhrnného řádku (tabulka i tooltip); bez něj se souhrn nezobrazuje. */
  totalLabel?: string;
  /**
   * 'bottomUp' (výchozí): první segment je ve sloupci dole, tabulka je v obráceném pořadí.
   * 'topDown': první segment je ve sloupci nahoře, tabulka i tooltip jsou v pořadí dat.
   */
  segmentOrder?: 'bottomUp' | 'topDown';
}

/**
 * Skládaný sloupcový graf v %, kde kladné i záporné segmenty dohromady dávají 100 %
 * (kladné se skládají nad nulu, záporné pod ni). Pod grafem je tabulka s absolutními
 * částkami, která slouží zároveň jako legenda barev.
 */
export const StackedPercentChart: React.FC<StackedPercentChartProps> = ({
  title,
  subtitle,
  emptyText,
  rowHeaderLabel,
  data,
  totalLabel,
  segmentOrder = 'bottomUp',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Sloupce jdou otevřít i klepnutím a klávesnicí (Tab, ←/→, Esc), nejen myší
  const barRefs = useRef<(SVGGElement | null)[]>([]);
  // Graf je jedna zastávka Tabu (naposledy aktivní sloupec), mezi sloupci se chodí šipkami
  const [rovingIdx, setRovingIdx] = useState(0);
  const openedByFocusRef = useRef(false);
  // Skutečná šířka plochy grafu v px - podle ní se na úzkých displejích ředí popisky osy X
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  // Id vzorů šrafování musí být v dokumentu jedinečné (stránka může mít víc grafů)
  const hatchIdPrefix = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hasData = !!data && data.length > 0;

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setPlotWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasData]);

  if (!hasData) {
    return (
      <div className="card empty-state">
        {emptyText}
      </div>
    );
  }

  // Řádky tabulky vycházejí z pořadí segmentů, které je konzistentní napříč obdobími;
  // v tabulce se zobrazují shora dolů ve stejném pořadí jako ve sloupci
  const isTopDown = segmentOrder === 'topDown';
  const tableSegments = isTopDown ? data[0].segments : [...data[0].segments].reverse();
  const stackSegments = (segments: StackedPercentSegment[]) =>
    isTopDown ? [...segments].reverse() : segments;

  // Segment je "záporný" jen pokud jeho částka po zaokrouhlení na celé koruny skutečně
  // vychází záporně (stejné pravidlo jako formatCurrency). Bez toho by i haléřová
  // zaokrouhlovací nepřesnost (zobrazující se jako "0 Kč") vynucovala zbytečné záporné
  // pásmo na ose.
  const isEffectivelyNegative = (seg: StackedPercentSegment) =>
    (seg.pct ?? 0) < 0 && isVisibleAmount(seg.amountInHaler);

  // Barvy sérií, které mají v některém období plánovanou část (každá potřebuje svůj vzor šrafování)
  const hatchColors = [...new Set(data.flatMap((d) => d.segments.filter((s) => s.plannedPct).map((s) => s.color)))];
  const hatchId = (color: string) => `${hatchIdPrefix}-${hatchColors.indexOf(color)}`;
  const hasAnyPlanned = hatchColors.length > 0;

  // Kladná a záporná strana dávají dohromady 100 %, osa se proto přizpůsobuje SKUTEČNÝM
  // hodnotám napříč obdobími (zaokrouhleno nahoru/dolů na nejbližší násobek 20).
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
  // Popisky osy Y leží v pevném HTML okraji vlevo od SVG, proto je levý okraj SVG minimální
  const margin = { top: 25, right: 25, bottom: 40, left: 6 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const getY = (pct: number) => {
    const norm = (pct - effectiveMin) / range;
    return margin.top + chartHeight - norm * chartHeight;
  };

  const count = data.length;
  const slotWidth = chartWidth / count;
  const barWidth = Math.min(slotWidth * 0.6, 60);

  // Popisek období ("Lis 2025") potřebuje zhruba 56 px; když se sloty zúží, zobrazí se jen každý n-tý
  const slotPx = plotWidth > 0 ? (plotWidth * slotWidth) / width : Infinity;
  const xLabelStep = Math.max(1, Math.ceil(56 / slotPx));

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="card overflow-hidden">
      <div className="p-5 space-y-4">
      {/* Hlavička karty */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        {/* Legenda plnění jen tehdy, když některé období obsahuje plán */}
        {hasAnyPlanned && (
          <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" aria-hidden="true">
                <rect width="12" height="12" rx="2" className="fill-slate-500" />
              </svg>
              Uskutečněno
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" aria-hidden="true">
                <rect width="12" height="12" rx="2" className="fill-slate-500" opacity="0.25" />
                <path d="M-3 9 L3 -3 M1 13 L9 -3 M5 17 L15 -3" className="stroke-slate-500" strokeWidth="2.5" />
              </svg>
              Plánováno
            </span>
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="w-full overflow-hidden pl-11">
      <div ref={plotRef} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHoveredIdx(null); }}
        >
          {/* Šrafování plánované části: šikmé pruhy v barvě série přes její světlý nádech */}
          {hasAnyPlanned && (
            <defs>
              {hatchColors.map((color) => (
                <pattern key={color} id={hatchId(color)} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill={color} opacity="0.25" />
                  <rect width="3.5" height="8" fill={color} />
                </pattern>
              ))}
            </defs>
          )}
          {/* Vodorovné mřížkové linky (popisky % jsou vykreslené jako HTML overlay níže,
              aby jejich velikost písma odpovídala tabulce bez ohledu na škálování SVG) */}
          {gridValues.map((v) => (
            <line
              key={`grid-${v}`}
              x1={margin.left}
              y1={getY(v)}
              x2={width - margin.right}
              y2={getY(v)}
              className="stroke-slate-300"
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
                ref={(el) => { barRefs.current[idx] = el; }}
                tabIndex={idx === Math.min(rovingIdx, data.length - 1) ? 0 : -1}
                role="button"
                aria-label={`${item.periodLabel}: zobrazit podrobnosti`}
                aria-expanded={isHovered}
                className="cursor-pointer focus:outline-hidden group/bar"
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHoveredIdx(idx); }}
                onFocus={() => { openedByFocusRef.current = true; setHoveredIdx(idx); setRovingIdx(idx); }}
                onBlur={(e) => {
                  if (!barRefs.current.includes(e.relatedTarget as SVGGElement)) setHoveredIdx(null);
                }}
                onClick={() => {
                  // Klepnutí, které sloupec teprve zaměřilo, bublinu nechá otevřenou; další ji zavře
                  if (openedByFocusRef.current) openedByFocusRef.current = false;
                  else setHoveredIdx(prev => (prev === idx ? null : idx));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    const next = idx + (e.key === 'ArrowRight' ? 1 : -1);
                    barRefs.current[next]?.focus();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setHoveredIdx(null);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openedByFocusRef.current = false;
                    setHoveredIdx(prev => (prev === idx ? null : idx));
                  }
                }}
              >
                {/* Podbarvení aktivního slotu; při fokusu klávesnicí s modrým okrajem */}
                {isHovered && (
                  <rect
                    x={margin.left + idx * slotWidth}
                    y={margin.top}
                    width={slotWidth}
                    height={chartHeight}
                    className="fill-slate-100 group-focus-visible/bar:stroke-sky-500"
                    strokeWidth="2"
                    opacity="0.7"
                    rx="8"
                  />
                )}

                {stackSegments(item.segments).map((seg) => {
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

                  // Plánovaná část leží na vnější straně segmentu (dál od nuly), uskutečněná u nuly
                  const negative = isEffectivelyNegative(seg);
                  const outer = negative ? y0 : y1;
                  const split = outer - (seg.plannedPct ?? 0);
                  const parts = [
                    { key: 'executed', from: negative ? split : y0, to: negative ? y1 : split, fill: seg.color },
                    { key: 'planned', from: negative ? y0 : split, to: negative ? split : y1, fill: `url(#${hatchId(seg.color)})` },
                  ];

                  return parts.map((part) => {
                    const rectY = getY(clampPct(part.to));
                    const rectHeight = Math.max(0, getY(clampPct(part.from)) - getY(clampPct(part.to)));
                    if (rectHeight <= 0) return null;
                    return (
                      <rect
                        key={`${seg.key}-${part.key}`}
                        x={barX}
                        y={rectY}
                        width={barWidth}
                        height={rectHeight}
                        fill={part.fill}
                        className="transition-all hover:opacity-90"
                      />
                    );
                  });
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
              className="absolute text-xs font-medium text-slate-500 whitespace-nowrap tabular-nums"
              style={{
                right: '100%',
                top: `${(getY(v) / height) * 100}%`,
                transform: 'translate(-6px, -50%)',
              }}
            >
              {v}%
            </span>
          ))}

          {data.map((item, idx) => {
            const slotCenterX = margin.left + idx * slotWidth + slotWidth / 2;
            const isHovered = hoveredIdx === idx;
            if (idx % xLabelStep !== 0) return null;

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
                  className={`text-xs font-medium whitespace-nowrap transition-colors ${
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
            className="absolute z-20 pointer-events-none bg-white border border-slate-200 text-slate-900 text-xs rounded-xl p-3 shadow-lg space-y-1.5 transition-all motion-reduce:transition-none"
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
            <div className="font-bold text-slate-900 border-b border-slate-200 pb-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-4">
                <span>{hoveredItem.periodLabel}</span>
              </div>
            </div>

            <div className="space-y-1 pt-0.5 text-xs min-w-[220px]">
              {hoveredItem.segments.map((seg) => (
                <div key={seg.key}>
                <div
                  className="flex items-center justify-between gap-4 text-slate-600"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="truncate">{seg.label}:</span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                    {formatCurrency(seg.amountInHaler)}
                    {seg.pct !== null && (
                      <span className="text-slate-500 font-normal">
                        {' '}
                        ({formatPercent(isEffectivelyNegative(seg) ? seg.pct : Math.abs(seg.pct))})
                      </span>
                    )}
                  </span>
                </div>
                {seg.split && isVisibleAmount(seg.split.plannedInHaler) && (
                  <div className="pl-3.5 text-slate-500 tabular-nums whitespace-nowrap">
                    {seg.split.executedLabel} {formatCurrency(seg.split.executedInHaler)} · plánováno {formatCurrency(seg.split.plannedInHaler)}
                  </div>
                )}
                {seg.split && isVisibleAmount(seg.split.correctionsInHaler) && (
                  <div className="pl-3.5 text-slate-500 tabular-nums whitespace-nowrap">
                    vč. korekcí {formatCurrency(seg.split.correctionsInHaler)}
                  </div>
                )}
                </div>
              ))}

              {totalLabel && hoveredItem.totalInHaler !== undefined && (
                <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between gap-4 font-bold">
                  <span className="text-slate-900">{totalLabel}:</span>
                  <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {formatCurrency(hoveredItem.totalInHaler)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      </div>

      {/* Tabulka s absolutními částkami po řádcích a obdobích (slouží zároveň jako legenda barev) */}
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs">
              <th className="py-2.5 px-4">{rowHeaderLabel}</th>
              {data.map((d) => (
                <th
                  key={d.periodKey}
                  className={`py-2.5 px-4 text-right whitespace-nowrap ${d.hasPlanned ? 'text-amber-700' : ''}`}
                  title={d.hasPlanned ? 'Obsahuje plánované položky' : undefined}
                >
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
                      {match ? formatCurrency(match.amountInHaler) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            {totalLabel && (
              <tr>
                <td className="py-2.5 px-4 font-bold text-slate-900">{totalLabel}</td>
                {data.map((d) => (
                  <td
                    key={d.periodKey}
                    className="py-2.5 px-4 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap"
                  >
                    {d.totalInHaler !== undefined ? formatCurrency(d.totalInHaler) : '—'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
