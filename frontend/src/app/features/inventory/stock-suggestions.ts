import { StockSuggestion } from '../../core/services/inventory.models';

/** Cantidades que pasan de "Corregir productos" a "Cargar stock" (lo que estaba en «Trae») */
const KEY = 'uywa.stock-suggestions.v1';

export function readSuggestions(): StockSuggestion[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as StockSuggestion[]) : [];
  } catch {
    return [];
  }
}

export function addSuggestions(list: StockSuggestion[]): void {
  if (!list.length) return;
  const ids = new Set(list.map((s) => s.productId));
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([...readSuggestions().filter((s) => !ids.has(s.productId)), ...list]),
    );
  } catch {
    /* sin almacenamiento: solo no se sugiere */
  }
}

export function dropSuggestions(productIds: number[]): void {
  const ids = new Set(productIds);
  try {
    const rest = readSuggestions().filter((s) => !ids.has(s.productId));
    if (rest.length) localStorage.setItem(KEY, JSON.stringify(rest));
    else localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}
