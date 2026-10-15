import React, { useState, useMemo } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Category, CategoryType } from '../../types/finance';
import { CategoryModal } from './CategoryModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { describeUsage, getCategoryUsage, isInUse } from '../../services/usageService';
import { sortCategoriesAlphabetically } from '../../services/categoryService';
import { 
  Plus, 
  Edit3, 
  Archive, 
  RotateCcw, 
  Trash2, 
  TrendingUp, 
  TrendingDown 
} from 'lucide-react';

export const CategoriesScreen: React.FC = () => {
  const { categories, transactions, recurringRules, archiveCategory, restoreCategory, deleteCategory, showToast } = useFinance();
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const [activeTab, setActiveTab] = useState<CategoryType>('expense');
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
    setDeletingCategory(cat);
  };

  // Použitou kategorii (i přes podkategorie) smazat nejde – dialog rovnou nabídne archivaci
  const deletingUsage = deletingCategory
    ? getCategoryUsage(deletingCategory.id, categories, transactions, recurringRules)
    : null;
  const isDeletingBlocked = !!deletingUsage && isInUse(deletingUsage);
  const isDeletingArchived = deletingCategory?.status === 'archived';

  const confirmDelete = () => {
    if (!deletingCategory) return;
    if (isDeletingBlocked) {
      if (!isDeletingArchived) archiveCategory(deletingCategory.id);
      return;
    }
    const res = deleteCategory(deletingCategory.id);
    if (!res.success && res.message) {
      showToast(res.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Hlavička správy kategorií */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Přepínač záložek: Příjmy vs Výdaje */}
        <div role="group" aria-label="Typ kategorií" className="h-8 max-md:h-[52px] w-full sm:w-56 flex gap-2 p-1 bg-slate-100 rounded-xl shrink-0">
          <button
            onClick={() => setActiveTab('expense')}
            aria-pressed={activeTab === 'expense'}
            className={`flex-1 flex items-center justify-center gap-2 h-full text-xs font-bold rounded-lg transition-all ${
              activeTab === 'expense'
                ? 'bg-white text-red-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            <span>Výdaje</span>
          </button>
          <button
            onClick={() => setActiveTab('income')}
            aria-pressed={activeTab === 'income'}
            className={`flex-1 flex items-center justify-center gap-2 h-full text-xs font-bold rounded-lg transition-all ${
              activeTab === 'income'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Příjmy</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer select-none">
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
            className="h-8 max-md:h-11 flex items-center gap-1.5 px-4 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Nová hlavní kategorie</span>
          </button>
        </div>
      </div>

      {mainCategories.length === 0 && (
        <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm text-center space-y-1">
          <p className="text-sm font-semibold text-slate-900">
            {activeTab === 'expense' ? 'Zatím žádné výdajové kategorie' : 'Zatím žádné příjmové kategorie'}
          </p>
          <p className="text-xs text-slate-500">
            Přidejte je tlačítkem Nová hlavní kategorie. Položky jdou zapisovat i bez kategorie.
          </p>
        </div>
      )}

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
                        <span className="px-1.5 py-0.5 text-xs font-semibold bg-slate-200 text-slate-500 rounded">
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
                    aria-label={`Přidat podkategorii: ${mainCat.name}`}
                    className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenEdit(mainCat)}
                    title="Upravit kategorii"
                    aria-label={`Upravit kategorii: ${mainCat.name}`}
                    className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {mainCat.status === 'active' ? (
                    <button
                      onClick={() => archiveCategory(mainCat.id)}
                      title="Archivovat"
                      aria-label={`Archivovat kategorii: ${mainCat.name}`}
                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => restoreCategory(mainCat.id)}
                      title="Obnovit"
                      aria-label={`Obnovit kategorii: ${mainCat.name}`}
                      className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(mainCat)}
                    title="Smazat"
                    aria-label={`Smazat kategorii: ${mainCat.name}`}
                    className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Seznam podkategorií */}
              <div className="space-y-1.5 pl-2">
                {subcategories.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-1">Žádné podkategorie</p>
                ) : (
                  subcategories.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-xs text-slate-500"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: sub.color || mainCat.color }} />
                        <span className="font-medium">{sub.name}</span>
                        {sub.status === 'archived' && (
                          <span className="text-xs text-slate-500">(archivovaná)</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                        <button
                          onClick={() => handleOpenEdit(sub)}
                          title="Upravit nebo přesunout"
                          aria-label={`Upravit nebo přesunout: ${sub.name}`}
                          className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {sub.status === 'active' ? (
                          <button
                            onClick={() => archiveCategory(sub.id)}
                            title="Archivovat"
                            aria-label={`Archivovat kategorii: ${sub.name}`}
                            className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => restoreCategory(sub.id)}
                            title="Obnovit"
                            aria-label={`Obnovit kategorii: ${sub.name}`}
                            className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(sub)}
                          title="Smazat"
                          aria-label={`Smazat kategorii: ${sub.name}`}
                          className="max-md:inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-1 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
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

      <ConfirmationModal
        isOpen={!!deletingCategory}
        onClose={() => setDeletingCategory(null)}
        onConfirm={confirmDelete}
        title={isDeletingBlocked ? 'Kategorii nejde smazat' : 'Smazat kategorii?'}
        message={
          isDeletingBlocked && deletingUsage
            ? `Kategorii „${deletingCategory?.name ?? ''}“ (včetně podkategorií) používá ${describeUsage(deletingUsage)}, proto ji nejde smazat. ${
                isDeletingArchived
                  ? 'Kategorie už je archivovaná, v nabídkách se nezobrazuje.'
                  : 'Můžete ji archivovat: zmizí z nabídek, ale historie zůstane.'
              }`
            : `Kategorie „${deletingCategory?.name ?? ''}“ se smaže. Smazání nelze vrátit. Pokud ji chcete jen skrýt z nabídek, zvolte raději archivaci.`
        }
        confirmText={isDeletingBlocked ? (isDeletingArchived ? 'Rozumím' : 'Archivovat kategorii') : 'Smazat kategorii'}
        showCancel={!(isDeletingBlocked && isDeletingArchived)}
        isDestructive={!isDeletingBlocked}
      />
    </div>
  );
};
