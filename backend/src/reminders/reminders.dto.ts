import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class MarkReminderDto {
  @IsIn(['VACCINE', 'APPOINTMENT'])
  kind!: 'VACCINE' | 'APPOINTMENT';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId!: number;
}

class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(100)
  auth!: string;
}

/** Lo que entrega el navegador al aceptar los avisos (PushSubscription.toJSON()) */
export class PushSubscribeDto {
  @IsUrl({ protocols: ['https'], require_tld: false })
  @MaxLength(1000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class PushUnsubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}
