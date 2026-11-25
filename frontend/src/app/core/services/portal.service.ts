import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { PortalLinkStatus, PortalView } from './portal.models';

/** Portal del dueño: el personal maneja el enlace; el dueño lo abre sin sesión. */
@Injectable({ providedIn: 'root' })
export class PortalService {
  private readonly http = inject(HttpClient);

  status(clientId: number): Observable<PortalLinkStatus> {
    return this.http.get<PortalLinkStatus>(`/api/clients/${clientId}/portal`);
  }

  create(clientId: number): Observable<{ token: string; expiresAt: string }> {
    return this.http.post<{ token: string; expiresAt: string }>(
      `/api/clients/${clientId}/portal`,
      {},
    );
  }

  revoke(clientId: number): Observable<void> {
    return this.http.delete<void>(`/api/clients/${clientId}/portal`);
  }

  view(token: string): Observable<PortalView> {
    return this.http.get<PortalView>(`/api/portal/${encodeURIComponent(token)}`);
  }

  /** Calendario (.ics) para suscribirse desde el celular */
  calendarUrl(token: string): string {
    return `${location.origin}/api/portal/${encodeURIComponent(token)}/calendario.ics`;
  }

  manifestUrl(token: string): string {
    return `/api/portal/${encodeURIComponent(token)}/manifest.webmanifest`;
  }

  noticesKey(): Observable<{ publicKey: string }> {
    return this.http.get<{ publicKey: string }>('/api/portal/avisos/clave');
  }

  subscribe(token: string, subscription: PushSubscriptionJSON): Observable<void> {
    return this.http.post<void>(`/api/portal/${encodeURIComponent(token)}/avisos`, subscription);
  }

  unsubscribe(token: string, endpoint: string): Observable<void> {
    return this.http.post<void>(`/api/portal/${encodeURIComponent(token)}/avisos/quitar`, {
      endpoint,
    });
  }

  logoUrl(token: string): string {
    return `/api/portal/${encodeURIComponent(token)}/logo`;
  }

  /** Dirección pública del portal (la arma el navegador: sirve igual en demo y producción) */
  link(token: string): string {
    return `${location.origin}/p/${token}`;
  }
}
