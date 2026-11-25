import { TestBed } from '@angular/core/testing';
import { WeightChartComponent } from './weight-chart.component';

describe('WeightChartComponent (curva de peso)', () => {
  it('dibuja un punto por peso y lo describe para lectores de pantalla', () => {
    const fixture = TestBed.createComponent(WeightChartComponent);
    fixture.componentRef.setInput('points', [
      { at: '2026-01-10T15:00:00Z', kg: 10 },
      { at: '2026-06-10T15:00:00Z', kg: 12 },
      { at: '2026-10-10T15:00:00Z', kg: 11.5 },
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe(
      'Peso de 10 kg el 10/01/2026 a 11.5 kg el 10/10/2026',
    );
    // Escala con margen: no toca los bordes
    expect(el.textContent).toContain('12.3 kg');
    expect(el.textContent).toContain('9.7 kg');
    expect(el.querySelectorAll('table tr')).toHaveLength(4);
  });
});
