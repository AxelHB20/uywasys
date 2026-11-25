import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReportPreset } from '../../core/services/reports.models';
import { PeriodState } from './report-period';
import { ReportPeriodComponent } from './report-period.component';
import { buttonByText, settle } from './testing/page-harness';

@Component({
  imports: [ReportPeriodComponent],
  template: `<app-report-period
    [value]="value()"
    today="2026-11-24"
    (choose)="chosen.set($event)"
    (custom)="custom.set($event)"
  />`,
})
class HostComponent {
  value = signal<PeriodState>({ period: 'last30', from: '2026-10-26', to: '2026-11-24' });
  chosen = signal<ReportPreset | null>(null);
  custom = signal<{ from: string; to: string } | null>(null);
}

describe('ReportPeriodComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('8 períodos rápidos con aria-pressed', async () => {
    const { el, host } = await setup();
    const buttons = el.querySelectorAll('[aria-label="Período"] button');
    expect(buttons.length).toBe(8);
    expect([...buttons].map((b) => b.textContent?.trim())).toContain('Año pasado');
    buttonByText(el, '12 meses')!.click();
    expect(host.chosen()).toBe('last12');
  });

  it('fechas: hasta 2 años, aviso en ámbar con 2 arreglos y Aplicar desactivado', async () => {
    const { el, fixture, host } = await setup();
    el.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click();
    await settle(fixture);
    const from = el.querySelector<HTMLInputElement>('#rp-from')!;
    expect(from.min).toBe('2024-11-24');
    expect(el.textContent).toContain('Puedes elegir hasta 2 años');
    type(from, '2023-05-01');
    await settle(fixture);
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Son 3 años y 6 meses');
    expect(buttonByText(el, 'Aplicar')!.disabled).toBe(true);
    buttonByText(el, 'Usar los últimos 2 años')!.click();
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    buttonByText(el, 'Aplicar')!.click();
    expect(host.custom()).toEqual({ from: '2024-11-24', to: '2026-11-24' });
  });

  it('si las fechas quedan al revés, un botón las intercambia', async () => {
    const { el, fixture, host } = await setup();
    el.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click();
    await settle(fixture);
    type(el.querySelector<HTMLInputElement>('#rp-from')!, '2026-11-20');
    type(el.querySelector<HTMLInputElement>('#rp-to')!, '2026-11-01');
    await settle(fixture);
    expect(el.textContent).toContain('La fecha inicial va después de la final');
    buttonByText(el, 'Intercambiar fechas')!.click();
    await settle(fixture);
    buttonByText(el, 'Aplicar')!.click();
    expect(host.custom()).toEqual({ from: '2026-11-01', to: '2026-11-20' });
  });
});
