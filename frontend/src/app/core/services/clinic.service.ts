import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { SessionService, withClinic } from '../auth/session.service';
import { DayHours } from '../../shared/utils/opening-hours';

export interface ClinicProfile {
  id: number;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  openingHours: DayHours[];
  /** El portal del dueño muestra el carnet completo y las recetas */
  portalShowRecords: boolean;
  /** Descuento máximo por línea (%) sin el administrador */
  maxDiscountPercent: number;
}

export type ClinicProfileUpdate = Omit<
  ClinicProfile,
  'id' | 'logoUrl' | 'openingHours' | 'portalShowRecords' | 'maxDiscountPercent'
> & { portalShowRecords?: boolean; maxDiscountPercent?: number };

/** Espacio que ocupan los archivos de la clínica */
export interface StorageUsage {
  attachments: { count: number; bytes: number };
  purchaseFiles: { count: number; bytes: number };
  totalBytes: number;
}

export interface SetupStatus {
  profileComplete: boolean;
  teamMembers: number;
}

/** Datos de la clínica. Al guardar, actualiza también el nombre y el logo que muestra el menú. */
@Injectable({ providedIn: 'root' })
export class ClinicService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  get(): Observable<ClinicProfile> {
    return this.http.get<ClinicProfile>('/api/clinic');
  }

  update(data: ClinicProfileUpdate): Observable<ClinicProfile> {
    return this.http
      .patch<ClinicProfile>('/api/clinic', data)
      .pipe(tap((clinic) => this.syncSession(clinic)));
  }

  /** Tope de descuento sin administrador (cualquier rol: Caja, Atención y Presupuestos) */
  discountLimit(): Observable<{ maxDiscountPercent: number }> {
    return this.http.get<{ maxDiscountPercent: number }>('/api/clinic/discount-limit');
  }

  /** Horario de atención (cualquier rol: la agenda sombrea lo cerrado) */
  hours(): Observable<DayHours[]> {
    return this.http.get<DayHours[]>('/api/clinic/hours');
  }

  updateHours(days: DayHours[]): Observable<ClinicProfile> {
    return this.http.put<ClinicProfile>('/api/clinic/hours', { days });
  }

  uploadLogo(file: File): Observable<ClinicProfile> {
    const form = new FormData();
    form.append('logo', file);
    return this.http
      .put<ClinicProfile>('/api/clinic/logo', form)
      .pipe(tap((clinic) => this.syncSession(clinic)));
  }

  removeLogo(): Observable<ClinicProfile> {
    return this.http
      .delete<ClinicProfile>('/api/clinic/logo')
      .pipe(tap((clinic) => this.syncSession(clinic)));
  }

  /** Espacio que ocupan los archivos (solo administrador) */
  storage(): Observable<StorageUsage> {
    return this.http.get<StorageUsage>('/api/clinic/storage');
  }

  setupStatus(): Observable<SetupStatus> {
    return this.http.get<SetupStatus>('/api/clinic/setup');
  }

  private syncSession(clinic: ClinicProfile): void {
    const user = this.session.user();
    if (user)
      this.session.user.set(withClinic(user, { name: clinic.name, logoUrl: clinic.logoUrl }));
  }
}
