import { Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Período de un reporte, en días de la clínica (AAAA-MM-DD), ambos incluidos. */
export class ReportQuery {
  @Matches(DAY, { message: 'Indica desde qué fecha' })
  from: string;

  @Matches(DAY, { message: 'Indica hasta qué fecha' })
  to: string;
}
