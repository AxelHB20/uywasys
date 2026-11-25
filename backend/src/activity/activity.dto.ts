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
    'queue',
  ],
  billing: ['billing'],
  hospitalization: ['hospitalization'],
  lab: ['lab'],
  clients: ['client', 'pet', 'portal'],
  inventory: ['product', 'stock', 'purchase', 'supplier'],
  settings: ['clinic', 'user', 'service'],
} as const;

export type ActivityArea = keyof typeof ACTIVITY_AREAS;
const AREA_KEYS = Object.keys(ACTIVITY_AREAS);

/**
 * Grupos de "Para revisar": lo que el dueño debería mirar. Cada uno filtra la lista (?kind=).
 * Lo que hace la cuenta de soporte no entra aquí: se ve en el área Soporte, sin marca.
 */
export const REVIEW_KINDS = {
  closings: ['cash.close_difference'],
  voids: [
    'cash.receipt_void',
    'cash.expense_void',
    'charge.void',
    'sale.cancel',
    'visit.cancel',
    'grooming.cancel',
    'immunization.void',
    'prescription.void',
    'consent.void',
    'attachment.void',
    'purchase.void',
    'lab.cancel',
  ],
  prices: [
    'product.price_change',
    'service.price_change',
    'charge.transport_price',
  ],
  stock: ['stock.count_adjust', 'stock.waste'],
  access: ['auth.login_failed', 'auth.locked'],
  billing: [
    'billing.settings_update',
    'billing.token_update',
    'billing.reissue',
    'billing.to_factura',
  ],
  people: [
    'user.deactivate',
    'user.reset_password',
    'supplier.merge',
    'client.anonymize',
  ],
} as const;
export type ReviewKind = keyof typeof REVIEW_KINDS;

export class ActivityQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsIn(AREA_KEYS, { message: 'El área no es válida' })
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

  /** Un grupo de "Para revisar" (cierres con diferencia, anulaciones, precios…) */
  @IsOptional()
  @IsIn(Object.keys(REVIEW_KINDS), { message: 'El grupo no es válido' })
  kind?: ReviewKind;
}

/** Rango de "Para revisar": por defecto, los últimos 7 días */
export class ActivityReviewQuery {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha no es válida' })
  to?: string;
}
