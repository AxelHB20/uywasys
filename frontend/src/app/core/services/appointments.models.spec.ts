import {
  Appointment,
  confirmationLink,
  layoutLanes,
  limaClock,
  limaIso,
  nextSlot,
  timeRange,
} from './appointments.models';

const at = (id: number, time: string, durationMin: number) => ({
  id,
  startsAt: limaIso('2026-10-29', time),
  durationMin,
});

describe('appointments.models', () => {
  it('convierte entre la hora de Lima y UTC', () => {
    expect(limaIso('2026-10-29', '10:30')).toBe('2026-10-29T15:30:00.000Z');
    expect(limaClock('2026-10-30T02:15:00.000Z')).toEqual({
      day: '2026-10-29',
      time: '21:15',
      minutes: 21 * 60 + 15,
    });
    expect(timeRange(at(1, '09:45', 30))).toBe('09:45 – 10:15');
  });

  it('propone el próximo horario que todavía no pasó', () => {
    expect(nextSlot(new Date('2026-10-29T15:31:00.000Z'))).toBe('10:45');
    expect(nextSlot(new Date('2026-10-29T15:45:00.000Z'))).toBe('10:45');
    expect(nextSlot(new Date('2026-10-30T03:00:00.000Z'))).toBeNull();
  });

  it('pone lado a lado solo las citas que se cruzan', () => {
    const lanes = layoutLanes([
      at(1, '09:00', 30),
      at(2, '09:15', 30),
      at(3, '09:30', 30),
      at(4, '11:00', 30),
    ]);
    expect(lanes.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(2)).toEqual({ lane: 1, lanes: 2 });
    // La de 09:30 empieza cuando termina la de 09:00: reutiliza su carril
    expect(lanes.get(3)).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(4)).toEqual({ lane: 0, lanes: 1 });
  });

  it('arma el recordatorio de WhatsApp', () => {
    const a = {
      ...at(1, '10:00', 30),
      type: 'CONSULTATION',
      pet: { id: 1, number: 1, name: 'Toby', species: 'DOG', aggressive: false },
      client: { id: 1, name: 'Rosa', phone: '987654321' },
    } as Appointment;
    const url = new URL(confirmationLink(a, 'Vet Sol', 'jueves, 29 de octubre'));
    expect(url.pathname).toBe('/51987654321');
    expect(url.searchParams.get('text')).toBe(
      'Hola, le escribimos de Vet Sol. Le recordamos su cita para Toby el jueves, 29 de octubre a las 10:00. ¿Nos confirma su asistencia?',
    );
  });
});
