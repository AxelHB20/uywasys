import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayHoursDto {
  @IsInt()
  @Min(1)
  @Max(7)
  day: number;

  @ValidateIf((d: DayHoursDto) => d.open !== null || d.close !== null)
  @Matches(TIME, { message: 'La hora de apertura debe ser HH:MM' })
  open: string | null;

  @ValidateIf((d: DayHoursDto) => d.open !== null || d.close !== null)
  @Matches(TIME, { message: 'La hora de cierre debe ser HH:MM' })
  close: string | null;
}

export class OpeningHoursDto {
  @IsArray()
  @ArrayMinSize(7, { message: 'Indica el horario de los 7 días' })
  @ArrayMaxSize(7, { message: 'Indica el horario de los 7 días' })
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days: DayHoursDto[];
}
