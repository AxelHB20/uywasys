export interface MarkPart {
  text: string;
  hit: boolean;
}

/** Sin tildes ni mayúsculas, y sin espacios ni guiones (para que "77" encuentre "987 677 123") */
const fold = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ignorable = (c: string) => /[\s\-.]/.test(c);

/**
 * Parte un texto en trozos marcando dónde coincide lo buscado (la primera vez), para resaltarlo
 * en la lista sin usar innerHTML. Ignora tildes, mayúsculas, espacios, guiones y puntos.
 */
export function markMatch(text: string, query: string): MarkPart[] {
  const q = [...query]
    .filter((c) => !ignorable(c))
    .map(fold)
    .join('');
  if (!text || q.length < 2) return [{ text, hit: false }];
  // Texto "limpio" y, para cada letra limpia, su posición en el original
  const map: number[] = [];
  let clean = '';
  [...text].forEach((c, i) => {
    if (ignorable(c)) return;
    clean += fold(c);
    map.push(i);
  });
  const at = clean.indexOf(q);
  if (at < 0) return [{ text, hit: false }];
  const chars = [...text];
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return [
    { text: chars.slice(0, start).join(''), hit: false },
    { text: chars.slice(start, end).join(''), hit: true },
    { text: chars.slice(end).join(''), hit: false },
  ].filter((p) => p.text);
}
