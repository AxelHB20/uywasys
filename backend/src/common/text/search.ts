/** Texto para buscar: minúsculas, sin tildes (Peña → pena) y solo letras, números y espacios. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lo que se guarda en clients.search_text: nombre, documento y celular. */
export function clientSearchText(
  name: string,
  docNumber: string | null | undefined,
  phone: string,
): string {
  return normalizeSearch(
    [name, docNumber, phone].filter(Boolean).join(' '),
  ).slice(0, 200);
}
