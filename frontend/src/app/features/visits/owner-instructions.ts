import { VisitDetail } from '../../core/services/visits.models';
import { formatDate } from '../../shared/utils/dates';

/**
 * Borrador de las indicaciones para el dueño: diagnóstico, plan, medicamentos y vacunas de hoy.
 * El veterinario lo revisa y corrige antes de enviarlo (el plan puede tener notas internas).
 */
export function ownerInstructions(v: VisitDetail): string {
  const blocks: string[] = [];
  if (v.diagnosis) blocks.push(`Diagnóstico: ${v.diagnosis.trim()}`);
  if (v.notes?.trim()) blocks.push(`Tratamiento e indicaciones:\n${v.notes.trim()}`);

  const meds = v.prescriptions
    .filter((p) => !p.voidedAt)
    .flatMap((p) => p.items)
    .map((i) => {
      const how = [
        i.dose,
        i.route?.toLowerCase(),
        lower(i.frequency),
        i.duration && `por ${i.duration}`,
      ]
        .filter(Boolean)
        .join(', ');
      return `• ${i.drug}: ${how}.${i.instructions ? ` ${i.instructions.trim()}` : ''}`;
    });
  if (meds.length) blocks.push(`Medicamentos:\n${meds.join('\n')}`);

  const doses = v.immunizations
    .filter((i) => !i.voidedAt)
    .map(
      (i) =>
        `• ${i.name}${i.nextDueAt ? ` (próxima dosis: ${formatDate(i.nextDueAt, 'calendar')})` : ''}`,
    );
  if (doses.length) blocks.push(`Vacunas y desparasitaciones de hoy:\n${doses.join('\n')}`);

  return blocks.join('\n\n');
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Saludo y despedida para WhatsApp alrededor de las indicaciones */
export function ownerMessage(v: VisitDetail, clinic: string, body: string): string {
  const first = v.client.name.split(' ')[0];
  const day = formatDate(v.openedAt, 'date');
  return [
    `Hola ${first}, estas son las indicaciones para ${v.pet.name} de su atención del ${day} en ${clinic}:`,
    body.trim(),
    'Cualquier duda, escríbenos por aquí.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
