import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../common/validators/peru.js';

/** Activos: se atienden hoy. Inactivos: fallecidos o retirados (la historia se conserva). */
export const PATIENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export const PATIENT_SPECIES = ['DOG', 'CAT', 'OTHER'] as const;
export const PATIENT_SORTS = ['RECENT', 'NAME', 'NUMBER'] as const;

/** Filtros de Historias clínicas */
export class ListPatientsQuery {
  /** Mascota, N° de historia (HC-00026 o 26), dueño, DNI o celular */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsIn(PATIENT_STATUSES)
  status?: PatientStatus;

  @IsOptional()
  @IsIn(PATIENT_SPECIES)
  species?: (typeof PATIENT_SPECIES)[number];

  @IsOptional()
  @IsIn(PATIENT_SORTS)
  sort?: (typeof PATIENT_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
