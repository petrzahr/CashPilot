import React, { useState, useEffect, useId } from 'react';
import { useFinance } from '../../context/FinanceContext';
import { Modal, ModalFooter } from '../common/Modal';
import { Category, CategoryType } from '../../types/finance';
import { sortCategoriesAlphabetically } from '../../services/categoryService';
import { COLOR_NAMES, COLOR_PALETTE } from '../../constants/colors';
import { FieldError, FieldErrors, fieldStateClass, fieldErrorProps, focusFirstInvalid } from '../common/FieldError';

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
  const fieldId = useId();
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
  const [errors, setErrors] = useState<FieldErrors<'name' | 'parent'>>({});

  // Hlavní kategorie stejného typu pro výběr nadřazené kategorie (seřazeno A–Z)
  const mainCategories = sortCategoriesAlphabetically(
    categories.filter(c => !c.parentId && c.type === type && c.id !== categoryToEdit?.id)
  );

  useEffect(() => {
    setErrors({});
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
    const nextErrors: FieldErrors<'name' | 'parent'> = {};
    if (!name.trim()) nextErrors.name = 'Zadejte prosím název kategorie.';
    if (!isEditMode && !isMainCategoryMode && !parentId) nextErrors.parent = 'Vyberte hlavní kategorii, pod kterou podkategorie patří.';
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.parent) {
      focusFirstInvalid(nextErrors, [['name', `${fieldId}-1`], ['parent', `${fieldId}-2`]]);
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
      // Vytvoření Nové podkategorie (nadřazená kategorie je ověřená výše)
      if (!parentId) return;
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
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor={`${fieldId}-1`} className="block text-xs font-semibold text-slate-500 mb-1">
            Název kategorie *
          </label>
          <input id={`${fieldId}-1`}
            type="text"
            required
            placeholder="např. Bydlení, Restaurace, Mzda"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: undefined })); }}
            {...fieldErrorProps(`${fieldId}-1`, errors.name)}
            className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.name, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
          />
          <FieldError inputId={`${fieldId}-1`} message={errors.name} />
        </div>

        {/* Typ kategorie (pouze pro hlavní kategorie) */}
        {(isMainCategoryMode || (isEditMode && !categoryToEdit?.parentId)) && (
          <div>
            <span id={`${fieldId}-type`} className="block text-xs font-semibold text-slate-500 mb-1">
              Typ kategorie
            </span>
            <div role="group" aria-labelledby={`${fieldId}-type`} className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                aria-pressed={type === 'expense'}
                onClick={() => setType('expense')}
                className={`max-md:min-h-11 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  type === 'expense' ? 'bg-white text-red-600 shadow-sm font-semibold' : 'text-slate-500'
                }`}
              >
                Výdajová
              </button>
              <button
                type="button"
                aria-pressed={type === 'income'}
                onClick={() => setType('income')}
                className={`max-md:min-h-11 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  type === 'income' ? 'bg-white text-emerald-600 shadow-sm font-semibold' : 'text-slate-500'
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
            <label htmlFor={`${fieldId}-2`} className="block text-xs font-semibold text-slate-500 mb-1">
              Patří pod hlavní kategorii *
            </label>
            <select id={`${fieldId}-2`}
              required
              value={parentId || ''}
              onChange={(e) => {
                const newParentId = e.target.value || null;
                setParentId(newParentId);
                setErrors(prev => ({ ...prev, parent: undefined }));
                const parentCat = categories.find(c => c.id === newParentId);
                if (parentCat) {
                  setType(parentCat.type);
                }
              }}
              {...fieldErrorProps(`${fieldId}-2`, errors.parent)}
              className={`w-full px-3.5 py-2 text-sm bg-white border rounded-xl focus:outline-none ${fieldStateClass(errors.parent, 'border-slate-200 focus:ring-2 focus:ring-sky-500')}`}
            >
              {isSubcategoryMode && !parentId && (
                <option value="">Vyberte hlavní kategorii</option>
              )}
              {mainCategories.map((mc) => (
                <option key={mc.id} value={mc.id}>
                  {mc.name}
                </option>
              ))}
            </select>
            <FieldError inputId={`${fieldId}-2`} message={errors.parent} />
          </div>
        )}

        {/* Volba při změně rodičovské kategorie v editaci */}
        {isEditMode && categoryToEdit && categoryToEdit.parentId !== parentId && parentId && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-900">
            <p className="font-semibold">Podkategorie se přesune do jiné hlavní kategorie.</p>
            <label className="flex items-start gap-2 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={updateHistorical}
                onChange={(e) => setUpdateHistorical(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500"
              />
              <span>
                Přesunout i dosavadní položky. Změní se tím i přehledy za minulá období.
                Bez zaškrtnutí zůstanou dosavadní položky v přehledech pod původní hlavní kategorií.
              </span>
            </label>
          </div>
        )}

        {/* Barva */}
        <div>
          <span id={`${fieldId}-color`} className="block text-xs font-semibold text-slate-500 mb-1.5">
            Barva kategorie
          </span>
          <div role="group" aria-labelledby={`${fieldId}-color`} className="flex items-center gap-2 flex-wrap">
            {COLOR_PALETTE.map((c, i) => (
              <button
                key={c}
                type="button"
                aria-label={COLOR_NAMES[i] ?? `Barva ${i + 1}`}
                title={COLOR_NAMES[i]}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 max-md:w-9 max-md:h-9 relative max-md:after:absolute max-md:after:-inset-1 max-md:after:content-[''] rounded-full transition-transform motion-reduce:transition-none ${
                  color === c ? 'scale-125 ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-sm"
          >
            {isEditMode ? 'Uložit změny' : isSubcategoryMode ? 'Vytvořit podkategorii' : 'Vytvořit kategorii'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
