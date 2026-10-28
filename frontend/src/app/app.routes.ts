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
      // Módulos pendientes: cada uno reemplaza su pantalla temporal cuando se construye.
      {
        path: 'cola',
        title: 'Cola de hoy · Uywa',
        loadComponent: () => import('./features/queue/queue.page').then((m) => m.QueuePage),
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
        loadComponent: comingSoon,
        data: {
          title: 'Grooming',
          icon: 'scissors',
          phase: 'Fase 3',
          description:
            'Check-in con checklist, tablero por estados, aviso por WhatsApp y comisiones.',
        },
      },
      {
        path: 'citas',
        title: 'Citas · Uywa',
        loadComponent: comingSoon,
        data: {
          title: 'Citas',
          icon: 'calendar',
          phase: 'Fase 5',
          description: 'Agenda de citas por veterinario.',
        },
      },
      {
        path: 'consultas',
        title: 'Consultas · Uywa',
        loadComponent: comingSoon,
        data: {
          title: 'Consultas',
          icon: 'stethoscope',
          phase: 'Fase 5',
          description: 'Historia clínica con método SOAP, recetas y adjuntos.',
        },
      },
      {
        path: 'vacunas',
        title: 'Vacunas · Uywa',
        loadComponent: comingSoon,
        data: {
          title: 'Vacunas',
          icon: 'syringe',
          phase: 'Fase 5',
          description:
            'Vacunas y desparasitaciones con fecha del próximo refuerzo y carnet imprimible.',
        },
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
        loadComponent: comingSoon,
        data: {
          title: 'Caja y ventas',
          icon: 'receipt',
          phase: 'Fase 4',
          description: 'Cuenta del paciente, boletas electrónicas, Yape y cierre de caja.',
        },
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
        path: 'usuarios',
        title: 'Usuarios · Uywa',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./features/users/users.page').then((m) => m.UsersPage),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
