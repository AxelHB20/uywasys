import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClinicalTemplate } from '../../core/services/clinical-templates.service';
import { tick } from '../../shared/testing';
import { ApplyMode, TemplatePickerComponent } from './template-picker.component';

const otitis: ClinicalTemplate = {
  id: 1,
  kind: 'CONSULTATION',
  name: 'Otitis externa',
  consultation: {
    reason: 'Se sacude las orejas',
    anamnesis: 'Se rasca desde hace __ días',
    physicalExam: null,
    diagnosis: 'Otitis externa',
    plan: 'Gotas óticas cada 12 h',
  },
  prescription: null,
  usageCount: 3,
  createdBy: { id: 1, fullName: 'Dra. Ruiz' },
  updatedAt: '2026-11-10T15:00:00Z',
};
const vacuna: ClinicalTemplate = {
  ...otitis,
  id: 2,
  name: 'Vacuna anual',
  consultation: { reason: 'Vacuna anual', diagnosis: 'Paciente sano' },
};

@Component({
  imports: [TemplatePickerComponent],
  template: `<app-template-picker
    kind="CONSULTATION"
    [open]="true"
    [current]="current()"
    (picked)="picked = $event"
  />`,
})
class Host {
  readonly current = signal<Record<string, string | null>>({});
  picked: { template: ClinicalTemplate; mode: ApplyMode } | null = null;
}

describe('TemplatePickerComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(current: Record<string, string | null> = {}) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.current.set(current);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/clinical-templates').flush([otitis, vacuna]);
    fixture.detectChanges();
    await tick();
    const el: HTMLElement = document.body;
    const button = (label: string | RegExp) =>
      [...el.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) =>
        typeof label === 'string'
          ? b.textContent?.trim() === label
          : label.test(b.textContent ?? ''),
      )!;
    return { fixture, el, button };
  }

  it('con la consulta vacía no pregunta nada y completa lo vacío', async () => {
    const { fixture, el, button } = await render();
    button(/Otitis externa/).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('1 dato por llenar');
    expect(el.textContent).not.toContain('Ya escribiste en');
    button(/Usar plantilla/).click();
    http.expectOne('/api/clinical-templates/1/used').flush({});
    expect(fixture.componentInstance.picked?.mode).toBe('fill');
  });

  it('si va a pisar lo escrito, dice en qué campos y deja elegir', async () => {
    const { fixture, el, button } = await render({ reason: 'Cojea', anamnesis: 'Hace 3 días' });
    button(/Otitis externa/).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ya escribiste en Motivo y Anamnesis');
    el.querySelectorAll<HTMLInputElement>('input[name="tp-mode"]')[1].click();
    fixture.detectChanges();
    button(/Usar plantilla/).click();
    http.expectOne('/api/clinical-templates/1/used').flush({});
    expect(fixture.componentInstance.picked?.mode).toBe('replace');
  });

  it('busca en todo el texto y la vista previa sigue a los resultados', async () => {
    const { fixture, el, button } = await render();
    button(/Vacuna anual/).click();
    fixture.detectChanges();
    const search = el.querySelector<HTMLInputElement>('#tp-search')!;
    search.value = 'gotas';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('1 de 2 plantillas');
    expect(el.querySelector('#tp-preview-title')).toBeNull();
    expect(button(/Usar plantilla/).disabled).toBe(true);
  });
});
