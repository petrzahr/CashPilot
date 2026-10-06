import React from 'react';
import { CashFlowCompositionPoint } from '../../services/analyticsEngine';
import { StackedPercentChart } from './StackedPercentChart';

interface CashFlowCompositionChartProps {
  data: CashFlowCompositionPoint[];
}

export const CashFlowCompositionChart: React.FC<CashFlowCompositionChartProps> = ({
  data,
}) => (
  <StackedPercentChart
    title="Příjmy, výdaje a skutečně uspořeno"
    emptyText="Žádná data pro zobrazení příjmů, výdajů a skutečně uspořeného."
    rowHeaderLabel="Ukazatel"
    data={data}
  />
);
