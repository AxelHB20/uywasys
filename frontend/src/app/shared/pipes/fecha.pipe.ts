import { Pipe, PipeTransform } from '@angular/core';
import { DateStyle, formatDate } from '../utils/dates';

/** `{{ v.openedAt | fecha: 'datetime' }}` → 28/10/2026 · 13:39 (hora de Lima) */
@Pipe({ name: 'fecha' })
export class FechaPipe implements PipeTransform {
  transform(value: string | Date | null | undefined, style: DateStyle = 'date'): string {
    return formatDate(value, style);
  }
}
