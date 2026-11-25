import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { PaymentMethod } from '../../generated/prisma/enums.js';
import { emptyToNull, trim } from '../../common/validators/peru.js';
import { BuyerDto } from '../../billing/billing.dto.js';
import {
  ChargeItemDto,
  MAX_CHARGE_ITEMS,
} from '../../visits/dto/charge.dto.js';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'CASH',
  'YAPE',
  'PLIN',
  'CARD',
  'TRANSFER',
];

const money = (field: string) =>
  IsNumber(
    { maxDecimalPlaces: 2 },
    { message: `${field} admite hasta 2 decimales` },
  );

export class PaymentDto {
  @IsIn(PAYMENT_METHODS, { message: 'Medio de pago no válido' })
  method: PaymentMethod;

  /** Lo que se aplica a la deuda con este medio */
  @money('El monto')
  @Min(0.01, { message: 'Cada pago debe ser mayor a 0' })
  @Max(999_999)
  amount: number;

  /** Solo efectivo: lo que entregó el cliente (para el vuelto) */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @money('El efectivo recibido')
  @Min(0)
  @Max(999_999)
  tendered?: number | null;

  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(40)
  operationCode?: string | null;
}

/** Clave que genera la pantalla para cada cobro: un reintento devuelve el mismo cobro. */
const RequestKey = () =>
  Matches(/^[A-Za-z0-9-]{8,64}$/, {
    message: 'Falta la clave del cobro (requestKey)',
  });

export class CollectDto {
  @RequestKey()
  requestKey: string;

  /** Comprobante: nota de venta interna (por defecto), boleta o factura electrónica */
  @IsOptional()
  @IsIn(['NOTE', 'BOLETA', 'FACTURA'], { message: 'Elige el comprobante' })
  document?: 'NOTE' | 'BOLETA' | 'FACTURA';

  /** Datos del comprador escritos en el cobro (factura sin RUC guardado, boleta de más de S/ 700) */
  @IsOptional()
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer?: BuyerDto;

  @IsInt({ message: 'Elige el cliente' })
  @Min(1)
  clientId: number;

  /** Cargos que se pagan; si no se indican, todos los pendientes del más antiguo al más nuevo */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  chargeIds?: number[];

  /** Productos o servicios agregados en caja: entran en el mismo comprobante y se pagan primero */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHARGE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ChargeItemDto)
  items?: ChargeItemDto[];

  /** Cuánto paga ahora; si no se indica, todo lo seleccionado. Menos = pago parcial */
  @IsOptional()
  @money('El monto')
  @Min(0.01)
  amount?: number;

  /** Caja; si la clínica tiene una sola abierta, se usa esa */
  @IsOptional()
  @IsInt()
  @Min(1)
  registerId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Indica cómo paga el cliente' })
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments: PaymentDto[];
}

/** Venta de mostrador: cargos y cobro completo en una sola operación. */
export class CounterSaleDto {
  @RequestKey()
  requestKey: string;

  /** Comprobante: nota de venta interna (por defecto), boleta o factura electrónica */
  @IsOptional()
  @IsIn(['NOTE', 'BOLETA', 'FACTURA'], { message: 'Elige el comprobante' })
  document?: 'NOTE' | 'BOLETA' | 'FACTURA';

  /** Datos del comprador escritos en el cobro (factura sin RUC guardado, boleta de más de S/ 700) */
  @IsOptional()
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer?: BuyerDto;

  /** Sin cliente = "Cliente varios" */
  @IsOptional()
  @IsInt()
  @Min(1)
  clientId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  petId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Agrega al menos un producto o servicio' })
  @ArrayMaxSize(MAX_CHARGE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ChargeItemDto)
  items: ChargeItemDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  registerId?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Indica cómo paga el cliente' })
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments: PaymentDto[];
}

export class OpenSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  registerId?: number;

  /** Sencillo con el que empieza la caja */
  @money('El monto inicial')
  @Min(0, { message: 'El monto inicial no puede ser negativo' })
  @Max(100_000)
  openingAmount: number;
}

export class CloseSessionDto {
  /** Efectivo contado en el cajón */
  @money('Lo contado')
  @Min(0, { message: 'Lo contado no puede ser negativo' })
  @Max(1_000_000)
  countedCash: number;

  /** Obligatorio si lo contado no coincide con lo esperado */
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class ExpenseDto {
  @money('El monto')
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  @Max(100_000)
  amount: number;

  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  registerId?: number;
}

export class CashVoidDto {
  @Transform(trim)
  @IsString({ message: 'Indica el motivo' })
  @Length(3, 200, { message: 'El motivo debe tener entre 3 y 200 caracteres' })
  reason: string;

  /** El cliente devolvió los productos vendidos en caja: se quitan de su cuenta y vuelven al stock */
  @IsOptional()
  @IsBoolean()
  returnProducts?: boolean;

  /** Caja de donde sale la devolución; si hay una sola abierta, esa */
  @IsOptional()
  @IsInt()
  @Min(1)
  registerId?: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class SalesReportQuery {
  @Matches(DAY, { message: 'Fecha inicial en formato AAAA-MM-DD' })
  from: string;

  @Matches(DAY, { message: 'Fecha final en formato AAAA-MM-DD' })
  to: string;
}

export class SessionsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
