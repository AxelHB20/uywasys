import { IconName } from '../ui/icon/icons';
import { Species } from '../../core/services/clients.models';

/** Código de cliente para el expediente: C-00012 */
export function clientCode(id: number): string {
  return `C-${String(id).padStart(5, '0')}`;
}

/** N.º de historia clínica de la mascota: HC-00045 */
export function petCode(id: number): string {
  return `HC-${String(id).padStart(5, '0')}`;
}

export const SPECIES_ICONS: Record<Species, IconName> = {
  DOG: 'dog',
  CAT: 'cat',
  RABBIT: 'rabbit',
  GUINEA_PIG: 'paw',
  BIRD: 'bird',
  REPTILE: 'turtle',
  OTHER: 'paw',
};

/** Iniciales para el avatar: "Rosa Peña Quispe" → "RP" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Fecha corta y relativa: "Hoy", "Ayer", "12 oct." o "12 oct. 2025". */
export function relativeDay(day: string | null, today: Date = new Date()): string {
  if (!day) return '—';
  // Un instante (2026-10-27T23:00:00Z) se lleva primero al día de Lima
  const local = day.length > 10 ? limaDate(new Date(day)) : day;
  const [y, m, d] = local.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((base.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    ...(y !== today.getFullYear() ? { year: 'numeric' } : {}),
  }).format(date);
}

/** AAAA-MM-DD de un instante, en hora de Lima. */
export function limaDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
