import { Species } from '../../core/services/clients.models';

/** Signo vital que se compara con el rango de la especie */
export type Vital = 'temperatureC' | 'heartRate' | 'respiratoryRate' | 'capillaryRefillS';

export interface VitalHint {
  level: 'warn' | 'danger';
  text: string;
}

interface Range {
  min: number;
  max: number;
  /** Cuánto fuera del rango ya es para alarmarse (rojo) */
  margin: number;
  unit: string;
}

/**
 * Rangos de referencia en reposo para adultos (Manual Merck de Veterinaria). Son una ayuda: el
 * veterinario decide. Aves y reptiles varían mucho por especie: no se avisa. Cachorros y gatitos
 * tienen otros valores.
 */
const RANGES: Partial<Record<Species, Record<Exclude<Vital, 'capillaryRefillS'>, Range>>> = {
  DOG: {
    temperatureC: { min: 37.5, max: 39.2, margin: 0.8, unit: '°C' },
    heartRate: { min: 60, max: 140, margin: 40, unit: 'lpm' },
    respiratoryRate: { min: 10, max: 30, margin: 15, unit: 'rpm' },
  },
  CAT: {
    temperatureC: { min: 37.8, max: 39.2, margin: 0.8, unit: '°C' },
    heartRate: { min: 140, max: 220, margin: 40, unit: 'lpm' },
    respiratoryRate: { min: 20, max: 30, margin: 15, unit: 'rpm' },
  },
  RABBIT: {
    temperatureC: { min: 38.5, max: 40, margin: 0.8, unit: '°C' },
    heartRate: { min: 130, max: 325, margin: 40, unit: 'lpm' },
    respiratoryRate: { min: 30, max: 60, margin: 15, unit: 'rpm' },
  },
  GUINEA_PIG: {
    temperatureC: { min: 37.2, max: 39.5, margin: 0.8, unit: '°C' },
    heartRate: { min: 230, max: 380, margin: 40, unit: 'lpm' },
    respiratoryRate: { min: 40, max: 100, margin: 20, unit: 'rpm' },
  },
};
const SPECIES_NAME: Partial<Record<Species, string>> = {
  DOG: 'un perro',
  CAT: 'un gato',
  RABBIT: 'un conejo',
  GUINEA_PIG: 'un cuy',
};

/** Aviso cuando un signo vital sale del rango normal de la especie; null si está bien o no aplica. */
export function vitalHint(
  species: Species,
  vital: Vital,
  value: number | null | undefined,
): VitalHint | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (vital === 'capillaryRefillS') {
    if (value <= 2) return null;
    return { level: value > 3 ? 'danger' : 'warn', text: 'Lento: lo normal es 2 s o menos' };
  }
  const range = RANGES[species]?.[vital];
  if (!range) return null;
  const { min, max, margin, unit } = range;
  if (value >= min && value <= max) return null;
  const low = value < min;
  const level = (low ? min - value : value - max) > margin ? 'danger' : 'warn';
  return {
    level,
    text: `${low ? 'Baja' : 'Alta'} para ${SPECIES_NAME[species]} (${min}–${max} ${unit})`,
  };
}

/** Rango normal [mín, máx] de un signo para la especie; null si no hay referencia (aves, reptiles…) */
export function vitalRange(
  species: Species,
  vital: Exclude<Vital, 'capillaryRefillS'>,
): [number, number] | null {
  const range = RANGES[species]?.[vital];
  return range ? [range.min, range.max] : null;
}
