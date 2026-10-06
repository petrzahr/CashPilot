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
    title="Finanční přehled"
    emptyText="Žádná data pro zobrazení finančního přehledu."
    rowHeaderLabel="Ukazatel"
    segmentOrder="topDown"
    data={data}
  />
);
