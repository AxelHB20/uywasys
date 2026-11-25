import { TestBed } from '@angular/core/testing';
import { PrintDocument } from '../../../core/services/billing.models';
import { DocumentSheetComponent } from './document-sheet.component';

const base: PrintDocument = {
  id: 9,
  type: 'FACTURA',
  code: 'F001-00000014',
  status: 'ACCEPTED',
  issueDate: '2026-11-15',
  issuedAt: '2026-11-15T21:16:00.000Z',
  simulated: false,
  clinic: {
    name: 'Veterinaria Huellitas',
    legalName: 'VETERINARIA HUELLITAS S.A.C.',
    ruc: '20612345679',
    address: 'Av. Lima 245, Chosica',
    phone: '987 000 111',
    email: 'hola@huellitas.pe',
    logo: null,
  },
  customer: {
    docType: '6',
    docNumber: '20603657862',
    name: 'CARRIER & ENTERPRISE NETWORK SOLUTIONS SOCIEDAD ANONIMA CERRADA',
    address: 'Av. Manuel Olguin 325, Surco',
  },
  lines: [
    {
      code: 'S4',
      description: 'Vacunación antirrábica',
      unit: 'ZZ',
      quantity: 1,
      unitValue: 38.1356,
      unitPrice: 45,
      total: 45,
      affectation: 'TAXED',
    },
    {
      code: 'P6',
      description: 'Alimento renal',
      unit: 'NIU',
      quantity: 1.5,
      unitValue: 50,
      unitPrice: 50,
      total: 75,
      affectation: 'EXEMPT',
    },
  ],
  totals: { taxed: 38.14, exempt: 75, unaffected: 0, igv: 6.86, total: 120 },
  amountInWords: 'SON: CIENTO VEINTE CON 00/100 SOLES',
  hash: 'SFvVbr=',
  qrText: null,
  related: null,
  reason: null,
  annulledBy: null,
  receiptCode: 'NV-000521',
  contactPhone: null,
};

function render(doc: PrintDocument) {
  const fixture = TestBed.createComponent(DocumentSheetComponent);
  fixture.componentRef.setInput('doc', doc);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Hoja A4 del comprobante', () => {
  it('lleva lo que pide SUNAT: RUC y número en recuadro, cliente, detalle, totales y resumen', () => {
    const el = render(base);
    const box = el.querySelector('[data-testid="sheet-box"]')!.textContent!;
    expect(box).toContain('RUC 20612345679');
    expect(box).toContain('Factura electrónica');
    expect(box).toContain('F001-00000014');
    expect(el.textContent).toContain('Señor(es)');
    expect(el.textContent).toContain(
      'CARRIER & ENTERPRISE NETWORK SOLUTIONS SOCIEDAD ANONIMA CERRADA',
    );
    expect(el.textContent).toContain('Forma de pago:');
    expect(el.textContent).toContain('Servicio');
    expect(el.textContent).toContain('1.5');
    expect(el.textContent).toContain('Exonerado');
    const totals = el.querySelector('[data-testid="sheet-totals"]')!.textContent!;
    expect(totals).toContain('Op. gravada');
    expect(totals).toContain('Op. exonerada');
    expect(totals).not.toContain('Op. inafecta');
    expect(el.textContent).toContain('Resumen: SFvVbr=');
    expect(el.textContent).toContain('Cobro interno NV-000521');
    // Aceptado: sin sellos ni avisos
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('la nota de crédito dice qué comprobante anula y no lleva forma de pago', () => {
    const el = render({
      ...base,
      type: 'CREDIT_NOTE',
      code: 'FC01-00000001',
      related: { type: 'FACTURA', code: 'F001-00000014', issueDate: '2026-11-15' },
      reason: 'Error de cobro',
    });
    expect(el.textContent).toContain('Nota de crédito electrónica');
    expect(el.querySelector('[data-testid="sheet-related"]')!.textContent).toContain(
      'Factura electrónica F001-00000014',
    );
    expect(el.textContent).toContain('Anulación de la operación — Error de cobro');
    expect(el.textContent).not.toContain('Forma de pago:');
  });

  it('marca lo que no vale: simulación, rechazado, anulado y pendiente', () => {
    expect(render({ ...base, simulated: true }).textContent).toContain('sin valor tributario');
    expect(render({ ...base, status: 'REJECTED' }).textContent).toContain('no tiene validez');
    expect(
      render({ ...base, annulledBy: { code: 'FC01-00000001', status: 'ACCEPTED' } }).textContent,
    ).toContain('Anulado con la nota de crédito FC01-00000001');
    expect(render({ ...base, status: 'PENDING' }).textContent).toContain(
      'Pendiente de confirmación de SUNAT',
    );
  });
});
