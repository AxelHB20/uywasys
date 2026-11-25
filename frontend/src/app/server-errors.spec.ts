import { Type } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionService } from './core/auth/session.service';
import { ActivityPage } from './features/activity/activity.page';
import { AgendaPage } from './features/appointments/agenda.page';
import { DocumentsPage } from './features/billing/documents.page';
import { CareServicesPage } from './features/care-services/care-services.page';
import { PortalCardComponent } from './features/clients/portal-card.component';
import { EstimatesPage } from './features/estimates/estimates.page';
import { GroomingCheckInPage } from './features/grooming/check-in.page';
import { LabOrdersComponent } from './features/medical/lab-orders.component';
import { LabOrdersPage } from './features/medical/lab-orders.page';
import { VaccineRemindersPage } from './features/medical/vaccine-reminders.page';
import { PurchaseDetailPage } from './features/purchases/purchase-detail.page';
import { PurchaseFormPage } from './features/purchases/purchase-form.page';
import { PurchasesPage } from './features/purchases/purchases.page';
import { SuppliersPage } from './features/purchases/suppliers.page';

/**
 * Si el servidor falla, cada pantalla muestra su aviso con "Reintentar" en vez de quedar en blanco.
 * (Leer `resource.value()` cuando el recurso falló lanza un error y rompe la pantalla entera.)
 */
interface Case {
  name: string;
  component: Type<unknown>;
  expected: string;
  inputs?: Record<string, unknown>;
  /** Para lo que solo se pide al abrir algo (p. ej. el modal de pedir examen) */
  open?: (instance: Record<string, { set(v: unknown): void }>) => void;
}

/** Las pantallas que traducen el error dicen esto ante un 500 */
const UNEXPECTED = 'Ocurrió un error inesperado';

const CASES: Case[] = [
  { name: 'Compras', component: PurchasesPage, expected: 'No se pudieron cargar las compras.' },
  {
    name: 'Detalle de una compra',
    component: PurchaseDetailPage,
    inputs: { id: '12' },
    expected: 'No se pudo cargar la compra.',
  },
  {
    name: 'Recibir compra (lista de proveedores)',
    component: PurchaseFormPage,
    expected: 'No se pudo cargar la lista.',
  },
  {
    name: 'Proveedores',
    component: SuppliersPage,
    expected: 'No se pudieron cargar los proveedores.',
  },
  {
    name: 'Ingreso de grooming',
    component: GroomingCheckInPage,
    expected: 'No se pudieron cargar los servicios.',
  },
  {
    name: 'Comprobantes',
    component: DocumentsPage,
    expected: 'No se pudieron cargar los comprobantes.',
  },
  { name: 'Actividad', component: ActivityPage, expected: 'No se pudo cargar la actividad.' },
  {
    name: 'Refuerzos',
    component: VaccineRemindersPage,
    expected: UNEXPECTED,
  },
  {
    name: 'Presupuestos',
    component: EstimatesPage,
    expected: UNEXPECTED,
  },
  {
    name: 'Servicios y precios',
    component: CareServicesPage,
    expected: 'No se pudo cargar el catálogo.',
  },
  { name: 'Exámenes', component: LabOrdersPage, expected: UNEXPECTED },
  { name: 'Agenda', component: AgendaPage, expected: UNEXPECTED },
  {
    name: 'Pedir examen (dentro de la atención)',
    component: LabOrdersComponent,
    inputs: { orders: [], visitId: 9 },
    open: (c) => c['ordering'].set(true),
    expected: 'No se pudo cargar el catálogo de exámenes.',
  },
  {
    name: 'Portal del dueño (ficha del cliente)',
    component: PortalCardComponent,
    inputs: { clientId: 7, clientName: 'Ana Quispe', phone: '987654321', canEdit: true },
    expected: 'No se pudo ver el estado del portal.',
  },
];

describe('Si el servidor falla, ninguna pantalla queda en blanco', () => {
  // jsdom no implementa <dialog>
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  for (const c of CASES) {
    it(c.name, async () => {
      TestBed.configureTestingModule({
        imports: [c.component],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });
      const http = TestBed.inject(HttpTestingController);
      TestBed.inject(SessionService).user.set({
        id: 1,
        fullName: 'Ana',
        email: 'ana@uywa.pe',
        role: 'ADMIN',
        mustChangePassword: false,
        clinic: { id: 1, name: 'Huellitas', logoUrl: null },
      } as never);

      const fixture: ComponentFixture<unknown> = TestBed.createComponent(c.component);
      for (const [key, value] of Object.entries(c.inputs ?? {}))
        fixture.componentRef.setInput(key, value);
      fixture.detectChanges();
      c.open?.(fixture.componentInstance as never);

      // Todo lo que pida la pantalla (también lo que pide después) responde con error 500
      for (let round = 0; round < 4; round++) {
        TestBed.tick();
        for (const req of http.match(() => true)) {
          req.flush('error', { status: 500, statusText: 'Error' });
        }
        await fixture.whenStable();
      }
      expect(() => fixture.detectChanges()).not.toThrow();

      const el = fixture.nativeElement as HTMLElement;
      const text = el.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain(c.expected);
      expect(
        [...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Reintentar')),
      ).toBe(true);
    });
  }
});
