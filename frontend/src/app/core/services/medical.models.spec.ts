import { DueImmunization, addDays, dueState, reminderLink } from './medical.models';

describe('medical.models', () => {
  it('suma días a una fecha sin hora, también entre meses y años', () => {
    expect(addDays('2026-10-28', 21)).toBe('2026-11-18');
    expect(addDays('2026-12-20', 365)).toBe('2027-12-20');
  });

  it('describe el estado del refuerzo', () => {
    const today = '2026-10-28';
    expect(dueState(null, today)).toBeNull();
    expect(dueState('2026-10-20', today)).toEqual({
      label: 'Vencida hace 8 días',
      tone: 'overdue',
    });
    expect(dueState('2026-10-28', today)?.label).toBe('Toca hoy');
    expect(dueState('2026-10-29', today)?.label).toBe('En 1 día');
    expect(dueState('2027-10-28', today)).toEqual({ label: 'Al día', tone: 'ok' });
  });

  it('arma el mensaje de WhatsApp con el número peruano y la fecha', () => {
    const item: DueImmunization = {
      id: 1,
      kind: 'VACCINE',
      name: 'Antirrábica',
      appliedAt: '2025-11-02',
      nextDueAt: '2026-11-02',
      daysLeft: 5,
      pet: { id: 3, number: 45, name: 'Toby', species: 'DOG' },
      client: { id: 7, name: 'Rosa', phone: '987654321' },
    };
    const url = new URL(reminderLink(item, 'Vet Sol'));
    expect(url.origin + url.pathname).toBe('https://wa.me/51987654321');
    expect(url.searchParams.get('text')).toBe(
      'Hola, le escribimos de Vet Sol. A Toby le toca el 02/11/2026 la vacuna Antirrábica. ¿Le reservamos un horario?',
    );
  });
});
