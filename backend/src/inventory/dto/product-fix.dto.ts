import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import type { BaseUnit } from '../../generated/prisma/enums.js';
import { COUNTING_UNITS } from '../unit-names.js';

/** Un producto a corregir en "Corregir productos" */
export class ProductFixItemDto {
  @IsInt({ message: 'Elige el producto' })
  productId: number;

  /** Presentación a la que se le pone «Trae» = 1 */
  @IsOptional()
  @IsInt({ message: 'Elige la presentación' })
  presentationId?: number;

  /** Cómo se cuenta el stock (solo si el producto no tiene movimientos) */
  @IsOptional()
  @IsIn(COUNTING_UNITS, { message: 'Elige Unidad, Tableta, Caja o Frasco' })
  baseUnit?: BaseUnit;

  /** true = se vende al cliente (deja de ser insumo) */
  @IsOptional()
  @IsBoolean()
  sellable?: boolean;
}

export class ProductFixDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos un producto' })
  @ArrayMaxSize(300, { message: 'Hasta 300 productos por vez' })
  @ValidateNested({ each: true })
  @Type(() => ProductFixItemDto)
  items: ProductFixItemDto[];
}
