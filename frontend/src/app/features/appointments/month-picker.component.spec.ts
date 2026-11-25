import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MonthPickerComponent } from './month-picker.component';

describe('MonthPickerComponent', () => {
  it('muestra el mes con los días que tienen citas y elige una fecha', async () => {
    TestBed.configureTestingModule({
      imports: [MonthPickerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MonthPickerComponent);
    fixture.componentRef.setInput('day', '2026-11-19');
    fixture.componentRef.setInput('today', '2026-11-19');
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((d) => picked.push(d));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Noviembre 2026');
    el.querySelector<HTMLButtonElement>('button[aria-haspopup]')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/appointments');
    // Las citas del mes visible
    expect(req.request.params.get('from')).toBe('2026-11-01');
    expect(req.request.params.get('to')).toBe('2026-11-30');
    req.flush([
      { id: 1, status: 'SCHEDULED', startsAt: '2026-11-24T15:00:00Z' },
      { id: 2, status: 'CANCELLED', startsAt: '2026-11-25T15:00:00Z' },
    ]);
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    const day24 = el.querySelector<HTMLButtonElement>('button[aria-label^="2026-11-24"]')!;
    expect(day24.getAttribute('aria-label')).toBe('2026-11-24, 1 cita');
    expect(el.querySelector('button[aria-label="2026-11-25"]')).not.toBeNull();
    day24.click();
    fixture.detectChanges();
    expect(picked).toEqual(['2026-11-24']);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });
});
