import { describe, expect, it } from 'vitest';
import { buildIcs, icsText } from './ics.js';

describe('calendario del dueño (ics)', () => {
  const now = new Date('2026-11-10T15:00:00Z');

  it('arma un refuerzo de día completo con alarma la víspera y una cita con hora', () => {
    const ics = buildIcs(
      'Mascotas · Huellitas',
      [
        {
          uid: 'imm-7@uywa',
          summary: 'Misifú: Triple felina',
          day: '2026-12-15',
          alarmMinutes: 900,
        },
        {
          uid: 'appt-3@uywa',
          summary: 'Cita de Misifú',
          start: new Date('2026-11-11T15:30:00Z'),
          durationMin: 45,
          location: 'Av. Carapongo 497, Lurigancho',
          alarmMinutes: 120,
        },
      ],
      now,
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain(
      'DTSTART;VALUE=DATE:20261215\r\nDTEND;VALUE=DATE:20261216',
    );
    expect(ics).toContain('TRIGGER:-PT900M');
    expect(ics).toContain('DTSTART:20261111T153000Z\r\nDTEND:20261111T161500Z');
    expect(ics).toContain('LOCATION:Av. Carapongo 497\\, Lurigancho');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapa el texto y parte las líneas largas', () => {
    expect(icsText('a;b,c\nd\\')).toBe('a\\;b\\,c\\nd\\\\');
    const ics = buildIcs(
      'X',
      [{ uid: 'u', summary: 'ñ'.repeat(60), day: '2026-01-01' }],
      now,
    );
    for (const line of ics.split('\r\n'))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
