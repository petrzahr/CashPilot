export type MoveDirection = 'up' | 'down';

/**
 * Přesune `sourceId` na pozici `targetId` (stejně jako drop při drag & drop):
 * při posunu dolů skončí za cílem, při posunu nahoru před ním.
 * Vrací nové pořadí, nebo null, pokud se nic nemění.
 */
export function moveIdToTarget(orderedIds: string[], sourceId: string, targetId: string): string[] | null {
  if (sourceId === targetId) return null;
  const fromIndex = orderedIds.indexOf(sourceId);
  const toIndex = orderedIds.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return null;

  const next = [...orderedIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Soused položky v zobrazeném seznamu ve zvoleném směru, nebo null na okraji. */
export function getNeighborId(visibleIds: string[], id: string, direction: MoveDirection): string | null {
  const index = visibleIds.indexOf(id);
  if (index === -1) return null;
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  return visibleIds[neighborIndex] ?? null;
}

/**
 * Posune položku o jedno místo mezi zobrazenými položkami. Pořadí se počítá
 * nad úplným seznamem `orderedIds`, takže skryté položky (např. archivované
 * účty) zůstanou na své relativní pozici.
 */
export function moveIdByStep(
  orderedIds: string[],
  visibleIds: string[],
  id: string,
  direction: MoveDirection
): string[] | null {
  const neighborId = getNeighborId(visibleIds, id, direction);
  return neighborId ? moveIdToTarget(orderedIds, id, neighborId) : null;
}
