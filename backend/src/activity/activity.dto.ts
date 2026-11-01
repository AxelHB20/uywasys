import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Áreas de la bitácora: cada una agrupa los prefijos de acción que le corresponden. */
export const ACTIVITY_AREAS = {
  access: ['auth'],
  cash: ['cash', 'sale'],
  care: [
    'visit',
    'charge',
    'immunization',
    'prescription',
    'appointment',
    'estimate',
    'attachment',
    'consent',
    'grooming',
  ],
  clients: ['client', 'pet'],
  inventory: ['product', 'stock'],
  settings: ['clinic', 'user', 'service'],
} as const;

export type ActivityArea = keyof typeof ACTIVITY_AREAS;

export class ActivityQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsIn(Object.keys(ACTIVITY_AREAS), { message: 'El área no es válida' })
  area?: ActivityArea;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  to?: string;

  /** Solo lo que el dueño debería revisar: anulaciones, ajustes, cambios de precio… */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  important?: boolean;
}
