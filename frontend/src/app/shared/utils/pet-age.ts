/** Edad legible a partir de AAAA-MM-DD: "3 años", "1 año y 2 meses", "5 meses", "2 semanas". */
export function petAge(birthDate: string | null, today: Date = new Date()): string | null {
  if (!birthDate) return null;
  // Acepta AAAA-MM-DD o la fecha ISO completa (algunas respuestas traen la hora)
  const [y, m, d] = birthDate.slice(0, 10).split('-').map(Number);
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
  if (today.getDate() < d) months -= 1;
  if (months < 0) return null;
  if (months === 0) {
    const days = Math.floor((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
    const weeks = Math.max(0, Math.floor(days / 7));
    return weeks <= 1 ? 'Recién nacido' : `${weeks} semanas`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearText = years === 1 ? '1 año' : `${years} años`;
  const monthText = rest === 1 ? '1 mes' : `${rest} meses`;
  if (years === 0) return monthText;
  return rest && years < 3 ? `${yearText} y ${monthText}` : yearText;
}

/** Fecha de nacimiento estimada (AAAA-MM-DD) a partir de una edad en años y meses. */
export function birthDateFromAge(years: number, months: number, today: Date = new Date()): string {
  const date = new Date(today.getFullYear(), today.getMonth(), 1);
  date.setMonth(date.getMonth() - (years * 12 + months));
  // Se usa el día 1 del mes: es una estimación y así no cae en fechas futuras.
  return toIsoDate(date);
}

/** Años y meses cumplidos desde una fecha (para editar una edad aproximada). */
export function ageParts(
  birthDate: string,
  today: Date = new Date(),
): { years: number; months: number } {
  // Acepta AAAA-MM-DD o la fecha ISO completa (algunas respuestas traen la hora)
  const [y, m, d] = birthDate.slice(0, 10).split('-').map(Number);
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
  if (today.getDate() < d) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function toIsoDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
