import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/auth.guards';

const comingSoon = () =>
  import('./features/coming-soon/coming-soon.page').then((m) => m.ComingSoonPage);

export const routes: Routes = [
  {
    path: 'login',
    title: 'Iniciar sesión · Uywa',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    // Fuera del layout: si la clave es temporal, el usuario no puede ir a otra pantalla hasta cambiarla.
    path: 'cambiar-clave',
    title: 'Cambiar contraseña · Uywa',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/auth/change-password.page').then((m) => m.ChangePasswordPage),
  },
  {
    // Públicas: se pueden leer antes de iniciar sesión
    path: 'legal/terminos',
    title: 'Términos del servicio · Uywa',
    data: { doc: 'terminos' },
    loadComponent: () => import('./features/legal/legal.page').then((m) => m.LegalPage),
  },
  {
    path: 'legal/privacidad',
    title: 'Política de privacidad · Uywa',
    data: { doc: 'privacidad' },
    loadComponent: () => import('./features/legal/legal.page').then((m) => m.LegalPage),
  },
  {
    // Todo lo que está dentro del layout exige sesión
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · Uywa',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'cola',
        title: 'Cola de hoy · Uywa',
        loadComponent: () => import('./features/queue/queue.page').then((m) => m.QueuePage),
      },
      {
        path: 'atenciones',
        title: 'Atenciones · Uywa',
        loadComponent: () => import('./features/visits/visits.page').then((m) => m.VisitsPage),
      },
      {
        path: 'atenciones/:id',
        title: 'Atención · Uywa',
        loadComponent: () => import('./features/visits/visit.page').then((m) => m.VisitPage),
      },
      {
        path: 'clientes/importar',
        title: 'Importar clientes · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/clients/import/import-clients.page').then((m) => m.ImportClientsPage),
      },
      {
        path: 'clientes',
        title: 'Clientes · Uywa',
        loadComponent: () => import('./features/clients/clients.page').then((m) => m.ClientsPage),
      },
      {
        path: 'clientes/nuevo',
        title: 'Nuevo cliente · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET', 'RECEPTION')],
        loadComponent: () =>
          import('./features/clients/new-client.page').then((m) => m.NewClientPage),
      },
      {
        path: 'clientes/:id',
        title: 'Ficha del cliente · Uywa',
        loadComponent: () =>
          import('./features/clients/client-detail.page').then((m) => m.ClientDetailPage),
      },
      {
        path: 'grooming',
        title: 'Grooming · Uywa',
        loadComponent: () =>
          import('./features/grooming/board.page').then((m) => m.GroomingBoardPage),
      },
      {
        path: 'grooming/comisiones',
        title: 'Comisiones de grooming · Uywa',
        canActivate: [roleGuard('ADMIN', 'GROOMER')],
        loadComponent: () =>
          import('./features/grooming/commissions.page').then((m) => m.GroomingCommissionsPage),
      },
      {
        path: 'grooming/:id/constancia',
        title: 'Constancia de grooming · Uywa',
        loadComponent: () =>
          import('./features/grooming/certificate.page').then((m) => m.GroomingCertificatePage),
      },
      {
        path: 'grooming/ingreso',
        title: 'Ingreso a grooming · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET', 'RECEPTION', 'GROOMER')],
        loadComponent: () =>
          import('./features/grooming/check-in.page').then((m) => m.GroomingCheckInPage),
      },
      {
        path: 'citas',
        title: 'Citas · Uywa',
        loadComponent: () =>
          import('./features/appointments/agenda.page').then((m) => m.AgendaPage),
      },
      {
        path: 'consultas',
        title: 'Consultas · Uywa',
        loadComponent: comingSoon,
        data: {
          title: 'Consultas',
          icon: 'stethoscope',
          description: 'Historia clínica con método SOAP, recetas y adjuntos.',
        },
      },
      {
        path: 'vacunas',
        title: 'Vacunas · Uywa',
        loadComponent: () =>
          import('./features/medical/vaccine-reminders.page').then((m) => m.VaccineRemindersPage),
      },
      {
        path: 'mascotas/:id',
        title: 'Historia clínica · Uywa',
        loadComponent: () =>
          import('./features/medical/pet-record.page').then((m) => m.PetRecordPage),
      },
      {
        path: 'presupuestos',
        title: 'Presupuestos · Uywa',
        loadComponent: () =>
          import('./features/estimates/estimates.page').then((m) => m.EstimatesPage),
      },
      {
        path: 'presupuestos/nuevo',
        title: 'Nuevo presupuesto · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET', 'RECEPTION')],
        loadComponent: () =>
          import('./features/estimates/new-estimate.page').then((m) => m.NewEstimatePage),
      },
      {
        path: 'presupuestos/:id',
        title: 'Presupuesto · Uywa',
        loadComponent: () =>
          import('./features/estimates/estimate.page').then((m) => m.EstimatePage),
      },
      {
        path: 'recetas/:id',
        title: 'Receta · Uywa',
        loadComponent: () =>
          import('./features/medical/prescription-print.page').then((m) => m.PrescriptionPrintPage),
      },
      {
        path: 'mascotas/:id/consentimiento',
        title: 'Consentimiento informado · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET')],
        loadComponent: () =>
          import('./features/medical/consent-sign.page').then((m) => m.ConsentSignPage),
      },
      {
        path: 'consentimientos/:id',
        title: 'Consentimiento · Uywa',
        loadComponent: () =>
          import('./features/medical/consent-print.page').then((m) => m.ConsentPrintPage),
      },
      {
        path: 'mascotas/:id/carnet',
        title: 'Carnet de vacunación · Uywa',
        loadComponent: () =>
          import('./features/medical/immunization-card.page').then((m) => m.ImmunizationCardPage),
      },
      {
        path: 'inventario',
        title: 'Inventario · Uywa',
        loadComponent: () =>
          import('./features/inventory/inventory.page').then((m) => m.InventoryPage),
      },
      {
        path: 'inventario/nuevo',
        title: 'Nuevo producto · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET')],
        loadComponent: () =>
          import('./features/inventory/new-product.page').then((m) => m.NewProductPage),
      },
      {
        path: 'inventario/controlados',
        title: 'Libro de controlados · Uywa',
        canActivate: [roleGuard('ADMIN', 'VET')],
        loadComponent: () =>
          import('./features/inventory/controlled.page').then((m) => m.ControlledPage),
      },
      {
        path: 'inventario/importar',
        title: 'Importar productos · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/inventory/import/import-products.page').then(
            (m) => m.ImportProductsPage,
          ),
      },
      {
        path: 'servicios',
        title: 'Servicios y precios · Uywa',
        loadComponent: () =>
          import('./features/care-services/care-services.page').then((m) => m.CareServicesPage),
      },
      {
        path: 'inventario/:id',
        title: 'Producto · Uywa',
        loadComponent: () =>
          import('./features/inventory/product-detail.page').then((m) => m.ProductDetailPage),
      },
      {
        path: 'caja',
        title: 'Caja · Uywa',
        canActivate: [roleGuard('ADMIN', 'RECEPTION', 'CASHIER')],
        loadComponent: () => import('./features/cash/cash.page').then((m) => m.CashPage),
      },
      {
        path: 'caja/tickets/:id',
        title: 'Ticket · Uywa',
        canActivate: [roleGuard('ADMIN', 'RECEPTION', 'CASHIER')],
        loadComponent: () => import('./features/cash/ticket.page').then((m) => m.TicketPage),
      },
      {
        path: 'comprobantes',
        title: 'Comprobantes · Uywa',
        canActivate: [roleGuard('ADMIN', 'RECEPTION', 'CASHIER')],
        loadComponent: () =>
          import('./features/billing/documents.page').then((m) => m.DocumentsPage),
      },
      {
        path: 'comprobantes/configuracion',
        title: 'Facturación electrónica · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/billing/billing-settings.page').then((m) => m.BillingSettingsPage),
      },
      // Configuración: solo el administrador
      {
        path: 'configuracion',
        title: 'Datos de la clínica · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/settings/clinic-settings.page').then((m) => m.ClinicSettingsPage),
      },
      {
        path: 'actividad',
        title: 'Actividad · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/activity/activity.page').then((m) => m.ActivityPage),
      },
      {
        path: 'usuarios',
        title: 'Usuarios · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./features/users/users.page').then((m) => m.UsersPage),
      },
      {
        // Dirección que no existe: se avisa en vez de mandar al inicio sin explicación
        path: '**',
        title: 'Página no encontrada · Uywa',
        loadComponent: () =>
          import('./features/not-found/not-found.page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
