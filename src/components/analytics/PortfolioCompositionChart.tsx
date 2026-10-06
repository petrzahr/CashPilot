import React, { useMemo } from 'react';
import { PortfolioCompositionPoint } from '../../services/analyticsEngine';
import { StackedPercentChart, StackedPercentPoint } from './StackedPercentChart';

interface PortfolioCompositionChartProps {
  data: PortfolioCompositionPoint[];
}

export const PortfolioCompositionChart: React.FC<PortfolioCompositionChartProps> = ({
  data,
}) => {
  const points = useMemo<StackedPercentPoint[]>(
    () =>
      (data || []).map((d) => ({
        periodKey: d.periodKey,
        periodLabel: d.periodLabel,
        periodShortLabel: d.periodShortLabel,
        totalInHaler: d.totalNetWorthInHaler,
        segments: d.segments.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          amountInHaler: s.balanceInHaler,
          pct: s.pct,
        })),
      })),
    [data]
  );

  return (
    <StackedPercentChart
      title="Rozložení celkového majetku"
      emptyText="Žádná data pro zobrazení rozložení celkového majetku."
      rowHeaderLabel="Účet"
      totalLabel="Celkový majetek"
      data={points}
    />
  );
};
