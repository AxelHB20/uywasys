import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Role } from '../auth/auth.models';

export interface TeamMember {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  licenseNumber: string | null;
  /** Groomers: % de comisión sobre lo cobrado de sus servicios */
  commissionPercent: number | null;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
}

export interface NewUser {
  fullName: string;
  email: string;
  role: Role;
  licenseNumber: string | null;
  commissionPercent: number | null;
}

export type UserChanges = Partial<
  Pick<TeamMember, 'fullName' | 'role' | 'licenseNumber' | 'commissionPercent' | 'active'>
>;

/** Equipo de la clínica (solo administradores). */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>('/api/users');
  }

  create(user: NewUser): Observable<{ user: TeamMember; temporaryPassword: string }> {
    return this.http.post<{ user: TeamMember; temporaryPassword: string }>('/api/users', user);
  }

  update(id: number, changes: UserChanges): Observable<TeamMember> {
    return this.http.patch<TeamMember>(`/api/users/${id}`, changes);
  }

  resetPassword(id: number): Observable<{ temporaryPassword: string }> {
    return this.http.post<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, {});
  }
}
