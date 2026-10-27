import { Injectable, computed, signal } from '@angular/core';
import { ROLE_LABELS, SessionUser } from './auth.models';

/** Estado de la sesión actual. Solo guarda datos; las llamadas HTTP están en AuthService. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly user = signal<SessionUser | null>(null);

  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly fullName = computed(() => this.user()?.fullName ?? '');
  readonly firstName = computed(() => this.fullName().split(' ')[0]);
  readonly initials = computed(() => initialsOf(this.fullName()));
  readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  readonly role = computed(() => this.user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'ADMIN');
  readonly mustChangePassword = computed(() => this.user()?.mustChangePassword ?? false);
  readonly clinicName = computed(() => this.user()?.clinic.name ?? '');
  readonly clinicLogo = computed(() => this.user()?.clinic.logoUrl ?? null);
  readonly clinicInitials = computed(() => initialsOf(this.clinicName()));
}

/** Actualiza los datos de la clínica en la sesión (por ejemplo, tras cambiar el nombre o el logo). */
export function withClinic(user: SessionUser, clinic: Partial<SessionUser['clinic']>): SessionUser {
  return { ...user, clinic: { ...user.clinic, ...clinic } };
}

export function initialsOf(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
