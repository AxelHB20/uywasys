/** Ids ya revisados (los que SÍ son psicotrópicos): el aviso de Inventario no vuelve a salir por ellos */
export const CONTROLLED_REVIEWED_KEY = 'uywa.controlled-reviewed.v1';

export function reviewedControlled(): number[] {
  try {
    return JSON.parse(localStorage.getItem(CONTROLLED_REVIEWED_KEY) ?? '[]') as number[];
  } catch {
    return [];
  }
}
