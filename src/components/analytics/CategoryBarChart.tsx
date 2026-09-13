import React, { useState } from 'react';
import { CategoryBreakdownItem } from '../../services/analyticsEngine';
import { formatCurrency } from '../../services/currencyService';
import { ChevronDown, ChevronRight, Tag } from 'lucide-react';

interface CategoryBarChartProps {
  title: string;
  subtitle: string;
  items: CategoryBreakdownItem[];
  emptyMessage?: string;
}

export const CategoryBarChart: React.FC<CategoryBarChartProps> = ({
  title,
  subtitle,
  items,
  emptyMessage = 'Žádné záznamy v tomto období.',
}) => {
  const [expandedCatIds, setExpandedCatIds] = useState<Set<string>>(new Set());

  const toggleExpand = (catId: string) => {
    setExpandedCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  if (!items || items.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
        <div className="py-8 text-center text-xs text-slate-400">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      {/* Hlavička */}
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>

      {/* Seznam kategorií */}
      <div className="space-y-3">
        {items.map((cat) => {
          const isExpanded = expandedCatIds.has(cat.categoryId);
          const hasSubcategories = cat.subcategories && cat.subcategories.length > 0;

          return (
            <div key={cat.categoryId} className="space-y-2">
              {/* Hlavní kategorie */}
              <div
                onClick={() => hasSubcategories && toggleExpand(cat.categoryId)}
                className={`group p-2.5 rounded-xl transition-all border ${
                  isExpanded
                    ? 'bg-slate-50/90 border-slate-200'
                    : 'bg-white hover:bg-slate-50/60 border-slate-100'
                } ${hasSubcategories ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-md shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="font-bold text-slate-800 truncate" title={cat.name}>
                      {cat.name}
                    </span>
                    {hasSubcategories && (
                      <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(cat.totalInHaler)}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums min-w-[45px] text-right">
                      {cat.percentage.toFixed(1)} %
                    </span>
                  </div>
                </div>

                {/* Horizontální progress bar */}
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(2, Math.min(100, cat.percentage))}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
              </div>

              {/* Rozpad na podkategorie */}
              {isExpanded && hasSubcategories && (
                <div className="ml-5 pl-3 border-l-2 border-slate-200 space-y-1.5 py-1 animate-fadeIn">
                  {cat.subcategories.map((sub) => (
                    <div
                      key={sub.subcategoryId}
                      className="p-1.5 rounded-lg bg-slate-50/50 hover:bg-slate-100/60 transition-colors text-[11px] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="text-slate-700 font-medium truncate" title={sub.name}>
                          {sub.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-slate-800 tabular-nums">
                          {formatCurrency(sub.totalInHaler)}
                        </span>
                        <span className="text-[10px] text-slate-400 tabular-nums min-w-[38px] text-right">
                          {sub.percentage.toFixed(1)} %
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
