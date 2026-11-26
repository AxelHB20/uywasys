import {
  canMove,
  checklistFlags,
  nextStatus,
  nextStatusFor,
  priceForSize,
  readyMessageLink,
  sizeForWeight,
  whatsappPhone,
} from './grooming.models';

describe('grooming.models', () => {
  it('avanza saltando pasos y vuelve solo uno atrás', () => {
    expect(canMove('WAITING', 'READY')).toBe(true);
    expect(canMove('CUTTING', 'BATHING')).toBe(true);
    expect(canMove('CUTTING', 'WAITING')).toBe(false);
    expect(canMove('READY', 'READY')).toBe(false);
    expect(canMove('DELIVERED', 'READY')).toBe(false);
    expect(nextStatus('WAITING')).toBe('BATHING');
    expect(nextStatus('READY')).toBeNull();
  });

  it('elige tamaño por peso y el precio de ese tamaño', () => {
    expect(sizeForWeight(null)).toBe('SMALL');
    expect(sizeForWeight(18)).toBe('MEDIUM');
    expect(sizeForWeight(32)).toBe('LARGE');
    expect(sizeForWeight(45)).toBe('GIANT');
    const bath = { price: 35, sizePrices: [{ size: 'MEDIUM' as const, price: 45 }] };
    expect(priceForSize(bath, 'MEDIUM')).toBe(45);
    expect(priceForSize(bath, 'LARGE')).toBe(35);
  });

  it('arma el aviso de WhatsApp solo con un celular peruano', () => {
    expect(whatsappPhone('987 654 321')).toBe('51987654321');
    expect(whatsappPhone('+51 987654321')).toBe('51987654321');
    expect(whatsappPhone('014567890')).toBeNull();
    const card = {
      pet: { name: 'Copito' },
      client: { name: 'Rosa Quispe', phone: '987654321' },
      pending: 55,
      transport: 'NONE' as const,
    } as Parameters<typeof readyMessageLink>[0];
    const link = readyMessageLink(card, 'Vet Sur')!;
    expect(link.startsWith('https://wa.me/51987654321?text=')).toBe(true);
    const text = decodeURIComponent(link.split('text=')[1]);
    expect(text).toContain('Hola Rosa, Copito ya está listo(a) en Vet Sur.');
    expect(text).toContain('Total por pagar: S/ 55.00.');
    expect(
      readyMessageLink({ ...card, client: { ...card.client, phone: '12345' } }, 'X'),
    ).toBeNull();
  });

  it('resume el checklist', () => {
    expect(checklistFlags({ fleas: true, ticks: false, matting: true, aggressive: true })).toEqual([
      'Agresivo',
      'Pulgas',
      'Nudos',
    ]);
  });

  describe('nextStatusFor (salta el paso que no se pidió)', () => {
    const card = (status: 'WAITING' | 'BATHING' | 'CUTTING', ...names: string[]) => ({
      status,
      services: names.map((description) => ({ description })),
    });
    it('solo baño: de Baño pasa a Listo', () => {
      expect(nextStatusFor(card('WAITING', 'Baño completo', 'Movilidad · Recojo'))).toBe('BATHING');
      expect(nextStatusFor(card('BATHING', 'Baño completo', 'Movilidad · Recojo'))).toBe('READY');
    });
    it('solo uñas: de En espera pasa a Corte', () => {
      expect(nextStatusFor(card('WAITING', 'Corte de uñas'))).toBe('CUTTING');
    });
    it('baño y corte: paso a paso', () => {
      expect(nextStatusFor(card('BATHING', 'Baño medicado', 'Corte de pelo (mediano)'))).toBe(
        'CUTTING',
      );
    });
    it('sin servicios o anulados: paso a paso', () => {
      expect(nextStatusFor(card('WAITING'))).toBe('BATHING');
      expect(
        nextStatusFor({
          status: 'BATHING',
          services: [
            { description: 'Corte de pelo', status: 'VOID' },
            { description: 'Baño completo' },
          ],
        }),
      ).toBe('READY');
    });
  });
});
