import type { ConsentType } from '../generated/prisma/enums.js';

export interface ConsentContext {
  clinic: string;
  pet: string;
  species: string;
  breed: string | null;
  owner: string;
  procedure: string;
  /** dd/mm/aaaa */
  date: string;
}

export const CONSENT_TITLES: Record<ConsentType, string> = {
  SURGERY: 'Consentimiento informado para cirugía',
  ANESTHESIA: 'Consentimiento informado para anestesia o sedación',
  EUTHANASIA: 'Consentimiento informado para eutanasia',
  HOSPITALIZATION: 'Consentimiento informado para hospitalización',
  OTHER: 'Consentimiento informado',
};

/**
 * Textos base de los consentimientos. El veterinario puede ajustarlos antes de la firma; lo
 * que se firma queda guardado tal cual. Son modelos generales: cada clínica debería revisarlos
 * con su asesor legal (ver docs/legal).
 */
export function consentTemplate(type: ConsentType, c: ConsentContext): string {
  const patient = `${c.pet} (${c.species}${c.breed ? `, ${c.breed}` : ''})`;
  const intro =
    `Yo, ${c.owner}, en mi calidad de propietario(a) o responsable de ${patient}, ` +
    `declaro haber sido informado(a) de forma clara y comprensible por el médico veterinario ` +
    `de ${c.clinic} sobre lo siguiente:`;
  const closing =
    `He podido hacer las preguntas que consideré necesarias y han sido respondidas. ` +
    `Entiendo que puedo retirar esta autorización antes de que se inicie el procedimiento. ` +
    `Me comprometo a cubrir los costos informados y los que se generen por las atenciones adicionales necesarias.\n\n` +
    `Lugar y fecha: ${c.date}.`;

  switch (type) {
    case 'SURGERY':
      return [
        intro,
        `1. Procedimiento: ${c.procedure}.`,
        `2. Que todo procedimiento quirúrgico requiere anestesia y conlleva riesgos, entre ellos reacciones a los fármacos, ` +
          `hemorragias, infecciones, dehiscencia de la herida y, en casos excepcionales, la muerte del paciente, ` +
          `aun cuando se apliquen los cuidados y protocolos adecuados.`,
        `3. Que durante la cirugía pueden presentarse hallazgos que obliguen a ampliar o modificar el procedimiento. ` +
          `Autorizo al médico veterinario a realizar lo necesario para preservar la vida y la salud de mi mascota, ` +
          `informándome en cuanto sea posible.`,
        `4. Los cuidados posoperatorios, controles y medicación indicados, cuyo cumplimiento es mi responsabilidad.`,
        `Por lo expuesto, AUTORIZO la realización del procedimiento descrito.`,
        closing,
      ].join('\n\n');
    case 'ANESTHESIA':
      return [
        intro,
        `1. Procedimiento que requiere anestesia o sedación: ${c.procedure}.`,
        `2. Que la anestesia y la sedación conllevan riesgos, como reacciones adversas a los fármacos, alteraciones ` +
          `cardiorrespiratorias y, en casos excepcionales, la muerte del paciente, incluso en animales sanos.`,
        `3. Que se me ha recomendado realizar exámenes previos para reducir estos riesgos y que, si decido no realizarlos, ` +
          `asumo el mayor riesgo que ello implica.`,
        `4. Que he informado sobre enfermedades previas, alergias y medicamentos que recibe mi mascota, y el tiempo de ayuno.`,
        `Por lo expuesto, AUTORIZO la anestesia o sedación de mi mascota.`,
        closing,
      ].join('\n\n');
    case 'EUTHANASIA':
      return [
        `Yo, ${c.owner}, declaro ser el (la) propietario(a) o responsable legal de ${patient} y que no existe ` +
          `impedimento legal para disponer sobre su vida.`,
        `He sido informado(a) por el médico veterinario de ${c.clinic} sobre el estado de salud de mi mascota y sobre ` +
          `las alternativas disponibles. Motivo: ${c.procedure}.`,
        `Entiendo que la eutanasia es un procedimiento irreversible que se realiza con fármacos y técnicas que evitan ` +
          `el dolor y el sufrimiento del animal.`,
        `De manera libre y voluntaria, SOLICITO Y AUTORIZO la eutanasia de mi mascota, y libero de responsabilidad a ` +
          `la clínica y al médico veterinario por la realización de este procedimiento.`,
        `Sobre el destino de los restos: ______________________________.`,
        `Lugar y fecha: ${c.date}.`,
      ].join('\n\n');
    case 'HOSPITALIZATION':
      return [
        intro,
        `1. Motivo de la hospitalización: ${c.procedure}.`,
        `2. Que mi mascota permanecerá en la clínica bajo observación y tratamiento, y que su evolución puede ` +
          `cambiar, incluso empeorar, pese a los cuidados brindados.`,
        `3. Que el médico veterinario podrá realizar los tratamientos, exámenes y procedimientos necesarios para ` +
          `estabilizarla, informándome de los cambios relevantes y de los costos.`,
        `4. Los horarios de visita e información, y que debo mantener un teléfono de contacto disponible.`,
        `Por lo expuesto, AUTORIZO la hospitalización de mi mascota.`,
        closing,
      ].join('\n\n');
    default:
      return [
        intro,
        `1. Procedimiento o tratamiento: ${c.procedure}.`,
        `2. Sus beneficios, riesgos y alternativas, y los cuidados posteriores que debo cumplir.`,
        `Por lo expuesto, AUTORIZO la realización del procedimiento descrito.`,
        closing,
      ].join('\n\n');
  }
}
