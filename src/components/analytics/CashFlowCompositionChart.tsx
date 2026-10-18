import React from 'react';
import { CashFlowCompositionPoint } from '../../services/analyticsEngine';
import { StackedPercentChart } from './StackedPercentChart';

interface CashFlowCompositionChartProps {
  data: CashFlowCompositionPoint[];
  /** Název výchozího účtu, ze kterého se přehled počítá */
  defaultAccountName?: string;
}

export const CashFlowCompositionChart: React.FC<CashFlowCompositionChartProps> = ({
  data,
  defaultAccountName,
}) => (
  <StackedPercentChart
    title="Finanční přehled"
    subtitle={defaultAccountName ? `Výchozí účet: ${defaultAccountName}` : 'Chybí výchozí účet'}
    emptyText="Žádná data pro zobrazení finančního přehledu."
    rowHeaderLabel="Ukazatel"
    segmentOrder="topDown"
    data={data}
  />
);
