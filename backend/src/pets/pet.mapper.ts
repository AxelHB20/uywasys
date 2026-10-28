import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { PetSex, Species } from '../generated/prisma/enums.js';
import { normalizeSearch } from '../common/text/search.js';
import { fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import type { CreatePetDto, UpdatePetDto } from './dto/pet.dto.js';

/** Las mascotas viven hasta unos 40 años (loros, tortugas); más que eso es un error de tipeo. */
const MAX_AGE_YEARS = 40;

export const PET_SELECT = {
  id: true,
  clientId: true,
  name: true,
  species: true,
  breed: true,
  sex: true,
  neutered: true,
  birthDate: true,
  birthDateEstimated: true,
  weightKg: true,
  color: true,
  microchip: true,
  allergies: true,
  aggressive: true,
  aggressiveNote: true,
  notes: true,
  deceasedAt: true,
  active: true,
} as const;

type PetRow = Prisma.PetGetPayload<{ select: typeof PET_SELECT }>;

export interface PetView {
  id: number;
  clientId: number;
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  neutered: boolean;
  birthDate: string | null;
  birthDateEstimated: boolean;
  weightKg: number | null;
  color: string | null;
  microchip: string | null;
  allergies: string | null;
  aggressive: boolean;
  aggressiveNote: string | null;
  notes: string | null;
  deceasedAt: string | null;
  active: boolean;
}

export function toPetView(row: PetRow): PetView {
  return {
    ...row,
    birthDate: fromDbDate(row.birthDate),
    deceasedAt: fromDbDate(row.deceasedAt),
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
  };
}

/** Fecha válida, no futura y no más antigua que MAX_AGE_YEARS. */
export function checkPastDate(
  day: string | null | undefined,
  label: string,
  today: string,
): void {
  if (!day) return;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || fromDbDate(date) !== day)
    throw new BadRequestException(`La ${label} no es válida`);
  if (day > today)
    throw new BadRequestException(`La ${label} no puede ser futura`);
  const minYear = Number(today.slice(0, 4)) - MAX_AGE_YEARS;
  if (Number(day.slice(0, 4)) < minYear)
    throw new BadRequestException(
      `Revisa la ${label}: es de hace más de ${MAX_AGE_YEARS} años`,
    );
}

/** Datos para crear una mascota (sin clinicId ni clientId). */
export function petCreateData(dto: CreatePetDto, today: string) {
  checkPastDate(dto.birthDate, 'fecha de nacimiento', today);
  return {
    name: dto.name,
    nameSearch: normalizeSearch(dto.name).slice(0, 60),
    species: dto.species,
    breed: dto.breed ?? null,
    sex: dto.sex ?? null,
    neutered: dto.neutered ?? false,
    birthDate: dto.birthDate ? toDbDate(dto.birthDate) : null,
    birthDateEstimated: dto.birthDate
      ? (dto.birthDateEstimated ?? false)
      : false,
    weightKg: dto.weightKg ?? null,
    color: dto.color ?? null,
    microchip: dto.microchip ?? null,
    allergies: dto.allergies ?? null,
    aggressive: dto.aggressive ?? false,
    aggressiveNote: dto.aggressive ? (dto.aggressiveNote ?? null) : null,
    notes: dto.notes ?? null,
  };
}

/** Solo los campos enviados; undefined = no tocar, null = borrar. */
export function petUpdateData(
  dto: UpdatePetDto,
  current: PetRow,
  today: string,
): Prisma.PetUpdateInput {
  checkPastDate(dto.birthDate, 'fecha de nacimiento', today);
  checkPastDate(dto.deceasedAt, 'fecha de fallecimiento', today);
  const data: Prisma.PetUpdateInput = {};
  if (dto.name !== undefined) {
    data.name = dto.name;
    data.nameSearch = normalizeSearch(dto.name).slice(0, 60);
  }
  if (dto.species !== undefined) data.species = dto.species;
  if (dto.breed !== undefined) data.breed = dto.breed;
  if (dto.sex !== undefined) data.sex = dto.sex;
  if (dto.neutered !== undefined) data.neutered = dto.neutered;
  if (dto.birthDate !== undefined) {
    data.birthDate = dto.birthDate ? toDbDate(dto.birthDate) : null;
    data.birthDateEstimated = dto.birthDate
      ? (dto.birthDateEstimated ?? false)
      : false;
  } else if (dto.birthDateEstimated !== undefined && current.birthDate) {
    data.birthDateEstimated = dto.birthDateEstimated;
  }
  if (dto.weightKg !== undefined) data.weightKg = dto.weightKg;
  if (dto.color !== undefined) data.color = dto.color;
  if (dto.microchip !== undefined) data.microchip = dto.microchip;
  if (dto.allergies !== undefined) data.allergies = dto.allergies;
  if (dto.aggressive !== undefined) {
    data.aggressive = dto.aggressive;
    if (!dto.aggressive) data.aggressiveNote = null;
  }
  if (
    dto.aggressiveNote !== undefined &&
    (dto.aggressive ?? current.aggressive)
  )
    data.aggressiveNote = dto.aggressiveNote;
  if (dto.notes !== undefined) data.notes = dto.notes;
  if (dto.deceasedAt !== undefined) {
    data.deceasedAt = dto.deceasedAt ? toDbDate(dto.deceasedAt) : null;
    if (dto.deceasedAt) data.active = false;
  }
  if (dto.active !== undefined && !dto.deceasedAt) data.active = dto.active;
  return data;
}
