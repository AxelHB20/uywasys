import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from './auth.models';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/** Protege las pantallas del sistema: sin sesión, manda al login y recuerda a dónde volver. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const session = inject(SessionService);
  const router = inject(Router);
  if (!(await auth.restore())) {
    return router.createUrlTree(['/login'], { queryParams: { volver: state.url } });
  }
  // Con clave temporal solo se puede entrar a cambiarla (la API también lo exige).
  if (session.mustChangePassword() && !state.url.startsWith('/cambiar-clave')) {
    return router.createUrlTree(['/cambiar-clave']);
  }
  return true;
};

/** Restringe una pantalla a ciertos roles. Si no corresponde, vuelve al dashboard. */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return () => {
    const session = inject(SessionService);
    const role = session.role();
    return role && roles.includes(role) ? true : inject(Router).createUrlTree(['/dashboard']);
  };
}

/** Solo la cuenta de soporte técnico (configuración de facturación, token del PSE). */
export const supportGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isSupport() ? true : inject(Router).createUrlTree(['/dashboard']);
};

/** Si ya hay sesión, el login redirige directo al dashboard. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.restore()) ? router.createUrlTree(['/dashboard']) : true;
};
