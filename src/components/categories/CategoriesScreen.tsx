import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Category, CategoryType } from '../../types/finance';
import { CategoryModal } from './CategoryModal';
import { sortCategoriesAlphabetically } from '../../services/categoryService';
import { 
  Plus, 
  Tag, 
  Folder, 
  Edit3, 
  Archive, 
  RotateCcw, 
  Trash2, 
  ChevronRight, 
  Layers, 
  TrendingUp, 
  TrendingDown 
} from 'lucide-react';

export const CategoriesScreen: React.FC = () => {
  const { categories, archiveCategory, restoreCategory, deleteCategory } = useFinance();

  const [activeTab, setActiveTab] = useState<CategoryType>('income');
  const [showArchived, setShowArchived] = useState(false);

  // Modální dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'main' | 'sub' | 'edit'>('main');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);

  const displayedCategories = useMemo(() => {
    return categories.filter(c => {
      if (c.type !== activeTab) return false;
      if (!showArchived && c.status === 'archived') return false;
      return true;
    });
  }, [categories, activeTab, showArchived]);

  // Všechny hlavní kategorie seřazené abecedně vzestupně A–Z podle českých pravidel
  const mainCategories = useMemo(() => {
    return sortCategoriesAlphabetically(displayedCategories.filter(c => !c.parentId));
  }, [displayedCategories]);

  const handleOpenAddMain = () => {
    setEditingCategory(null);
    setDefaultParentId(null);
    setModalMode('main');
    setIsModalOpen(true);
  };

  const handleOpenAddSub = (parentId: string) => {
    setEditingCategory(null);
    setDefaultParentId(parentId);
    setModalMode('sub');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (cat: Category) => {
    setEditingCategory(cat);
    setDefaultParentId(cat.parentId || null);
    setModalMode('edit');
    setIsModalOpen(true);
  };

  const handleDelete = (cat: Category) => {
    if (confirm(`Opravdu chcete smazat kategorii „${cat.name}“?`)) {
      const res = deleteCategory(cat.id);
      if (!res.success && res.message) {
        alert(res.message);
      }
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Hlavička správy kategorií */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Přepínač záložek: Příjmy vs Výdaje */}
        <div className="flex gap-2 p-1 bg-slate-200/60 rounded-xl max-w-xs w-full shrink-0">
          <button
            onClick={() => setActiveTab('income')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'income'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Příjmy</span>
          </button>
          <button
            onClick={() => setActiveTab('expense')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'expense'
                ? 'bg-white text-red-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            <span>Výdaje</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500"
            />
            <span>Zobrazit archivované</span>
          </label>

          <button
            onClick={handleOpenAddMain}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Nová hlavní kategorie</span>
          </button>
        </div>
      </div>

      {/* Strom kategorií */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mainCategories.map((mainCat) => {
          const subcategories = sortCategoriesAlphabetically(
            displayedCategories.filter(c => c.parentId === mainCat.id)
          );

          return (
            <div
              key={mainCat.id}
              className={`bg-white rounded-2xl border p-5 shadow-sm space-y-3 transition-all ${
                mainCat.status === 'archived'
                  ? 'border-slate-200/50 bg-slate-50/50 opacity-75'
                  : 'border-slate-200/80 hover:border-slate-300'
              }`}
            >
              {/* Hlavní kategorie hlavička */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-3.5 h-3.5 rounded-md shrink-0 shadow-sm"
                    style={{ backgroundColor: mainCat.color }}
                  />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>{mainCat.name}</span>
                      {mainCat.status === 'archived' && (
                        <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                          Archivovaná
                        </span>
                      )}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenAddSub(mainCat.id)}
                    title="Přidat podkategorii"
                    className="p-1 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenEdit(mainCat)}
                    title="Upravit kategorii"
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {mainCat.status === 'active' ? (
                    <button
                      onClick={() => archiveCategory(mainCat.id)}
                      title="Archivovat"
                      className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => restoreCategory(mainCat.id)}
                      title="Obnovit"
                      className="p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(mainCat)}
                    title="Smazat"
                    className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Seznam podkategorií */}
              <div className="space-y-1.5 pl-2">
                {subcategories.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-1">Žádné podkategorie</p>
                ) : (
                  subcategories.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-xs text-slate-700"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: sub.color || mainCat.color }} />
                        <span className="font-medium">{sub.name}</span>
                        {sub.status === 'archived' && (
                          <span className="text-[10px] text-slate-400">(archiv)</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                        <button
                          onClick={() => handleOpenEdit(sub)}
                          title="Upravit nebo přesunout"
                          className="p-1 rounded text-slate-400 hover:text-slate-600"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {sub.status === 'active' ? (
                          <button
                            onClick={() => archiveCategory(sub.id)}
                            title="Archivovat"
                            className="p-1 rounded text-slate-400 hover:text-amber-600"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => restoreCategory(sub.id)}
                            title="Obnovit"
                            className="p-1 rounded text-slate-400 hover:text-sky-600"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(sub)}
                          title="Smazat"
                          className="p-1 rounded text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CategoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        categoryToEdit={editingCategory}
        defaultType={activeTab}
        defaultParentId={defaultParentId}
        mode={modalMode}
      />
    </div>
  );
};
