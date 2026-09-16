import React, { useState, useEffect } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal } from '../common/Modal';
import { Category, CategoryType } from '../../types/finance';
import { sortCategoriesAlphabetically } from '../../services/categoryService';
import { COLOR_PALETTE } from '../../constants/colors';

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryToEdit?: Category | null;
  defaultType?: CategoryType;
  defaultParentId?: string | null;
  mode?: 'main' | 'sub' | 'edit';
}

export const CategoryModal: React.FC<CategoryModalProps> = ({
  isOpen,
  onClose,
  categoryToEdit,
  defaultType = 'expense',
  defaultParentId = null,
  mode,
}) => {
  const { categories, addCategory, addMainCategory, updateCategory, moveSubcategory } = useFinance();

  const currentMode = mode || (categoryToEdit ? 'edit' : (defaultParentId ? 'sub' : 'main'));
  const isMainCategoryMode = currentMode === 'main';
  const isSubcategoryMode = currentMode === 'sub';
  const isEditMode = currentMode === 'edit';

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>(defaultType);
  const [parentId, setParentId] = useState<string | null>(isMainCategoryMode ? null : defaultParentId);
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [updateHistorical, setUpdateHistorical] = useState(false);

  // Hlavní kategorie stejného typu pro výběr nadřazené kategorie (seřazeno A–Z)
  const mainCategories = sortCategoriesAlphabetically(
    categories.filter(c => !c.parentId && c.type === type && c.id !== categoryToEdit?.id)
  );

  useEffect(() => {
    if (categoryToEdit) {
      setName(categoryToEdit.name);
      setType(categoryToEdit.type);
      setParentId(categoryToEdit.parentId || null);
      setColor(categoryToEdit.color || COLOR_PALETTE[0]);
      setUpdateHistorical(false);
    } else {
      setName('');
      setType(defaultType);
      setParentId(isMainCategoryMode ? null : defaultParentId);
      setColor(COLOR_PALETTE[0]);
      setUpdateHistorical(false);
    }
  }, [categoryToEdit, isOpen, defaultType, defaultParentId, isMainCategoryMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Zadejte prosím název kategorie.');
      return;
    }

    if (isEditMode && categoryToEdit) {
      const isParentChanged = categoryToEdit.parentId !== parentId;

      if (isParentChanged && parentId) {
        // Přesun podkategorie s volbou historických položek
        moveSubcategory(categoryToEdit.id, parentId, updateHistorical);
      }

      updateCategory({
        ...categoryToEdit,
        name: name.trim(),
        type,
        parentId: categoryToEdit.parentId ? parentId : null,
        color,
      });
    } else if (isMainCategoryMode) {
      // Funkce Nová hlavní kategorie VŽDY nastavuje parentId na null (API pravidlo)
      addMainCategory({
        name: name.trim(),
        type,
        color,
        icon: type === 'income' ? 'TrendingUp' : 'Folder',
        sortOrder: categories.length + 1,
        status: 'active',
      });
    } else {
      // Vytvoření Nové podkategorie
      if (!parentId) {
        alert('Vyberte prosím nadřazenou hlavní kategorii.');
        return;
      }
      const parentCat = categories.find(c => c.id === parentId);
      const subType = parentCat ? parentCat.type : type;

      addCategory({
        name: name.trim(),
        type: subType,
        parentId,
        color,
        icon: 'Tag',
        sortOrder: categories.length + 1,
        status: 'active',
      });
    }

    onClose();
  };

  let modalTitle = 'Nová hlavní kategorie';
  let modalSubtitle: string | undefined = undefined;

  if (isEditMode) {
    modalTitle = categoryToEdit?.parentId ? 'Upravit podkategorii' : 'Upravit hlavní kategorii';
    modalSubtitle = undefined;
  } else if (isSubcategoryMode) {
    modalTitle = 'Nová podkategorie';
    modalSubtitle = undefined;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      subtitle={modalSubtitle}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Název kategorie *
          </label>
          <input
            type="text"
            required
            placeholder="např. Bydlení, Restaurace, Mzda"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {/* Typ kategorie (pouze pro hlavní kategorie) */}
        {(isMainCategoryMode || (isEditMode && !categoryToEdit?.parentId)) && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Typ kategorie
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setType('expense')}
                className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                  type === 'expense' ? 'bg-white text-red-600 shadow-sm font-semibold' : 'text-slate-600'
                }`}
              >
                Výdajová
              </button>
              <button
                type="button"
                onClick={() => setType('income')}
                className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                  type === 'income' ? 'bg-white text-emerald-600 shadow-sm font-semibold' : 'text-slate-600'
                }`}
              >
                Příjmová
              </button>
            </div>
          </div>
        )}

        {/* Výběr nadřazené kategorie - pouze pro vytváření podkategorie nebo editaci existující podkategorie */}
        {(isSubcategoryMode || (isEditMode && categoryToEdit?.parentId)) && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nadřazená hlavní kategorie *
            </label>
            <select
              required
              value={parentId || ''}
              onChange={(e) => {
                const newParentId = e.target.value || null;
                setParentId(newParentId);
                const parentCat = categories.find(c => c.id === newParentId);
                if (parentCat) {
                  setType(parentCat.type);
                }
              }}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {isSubcategoryMode && !parentId && (
                <option value="">-- Vyberte hlavní kategorii --</option>
              )}
              {mainCategories.map((mc) => (
                <option key={mc.id} value={mc.id}>
                  {mc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Volba při změně rodičovské kategorie v editaci */}
        {isEditMode && categoryToEdit && categoryToEdit.parentId !== parentId && parentId && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-900">
            <p className="font-semibold">Přesunujete tuto podkategorii do jiné hlavní kategorie:</p>
            <label className="flex items-start gap-2 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={updateHistorical}
                onChange={(e) => setUpdateHistorical(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
              />
              <span>Změnit také hlavní kategorii u všech historických položek (varování: ovlivní historické reporty)</span>
            </label>
          </div>
        )}

        {/* Barva */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Barva kategorie
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-transform ${
                  color === c ? 'scale-125 ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm shadow-sky-200"
          >
            {isEditMode ? 'Uložit' : 'Vytvořit'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
