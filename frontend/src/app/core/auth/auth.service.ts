import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of, tap } from 'rxjs';
import { SessionUser } from './auth.models';
import { SessionService } from './session.service';

/** Inicio y cierre de sesión contra la API. La sesión viaja en una cookie httpOnly que el navegador maneja solo. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private restoring: Promise<boolean> | null = null;
  /** Ya se comprobó que no hay sesión: evita volver a preguntar a la API en cada redirección. */
  private knownAnonymous = false;

  login(email: string, password: string): Observable<SessionUser> {
    return this.http.post<{ user: SessionUser }>('/api/auth/login', { email, password }).pipe(
      map((res) => res.user),
      tap((user) => {
        this.knownAnonymous = false;
        this.session.user.set(user);
      }),
    );
  }

  /** Recupera la sesión al abrir o recargar la app. Devuelve true si hay una sesión válida. */
  restore(): Promise<boolean> {
    if (this.session.isAuthenticated()) return Promise.resolve(true);
    if (this.knownAnonymous) return Promise.resolve(false);
    this.restoring ??= firstValueFrom(
      this.http.get<SessionUser>('/api/auth/me').pipe(
        tap((user) => this.session.user.set(user)),
        map(() => true),
        catchError(() => {
          this.knownAnonymous = true;
          return of(false);
        }),
      ),
    ).finally(() => (this.restoring = null));
    return this.restoring;
  }

  changePassword(currentPassword: string, newPassword: string): Observable<SessionUser> {
    return this.http
      .patch<SessionUser>('/api/auth/password', { currentPassword, newPassword })
      .pipe(tap((user) => this.session.user.set(user)));
  }

  logout(): void {
    this.http
      .post('/api/auth/logout', {})
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.session.user.set(null);
        this.knownAnonymous = true;
        void this.router.navigate(['/login']);
      });
  }

  /** La API respondió 401 en medio del trabajo: la sesión venció o la cuenta se desactivó. */
  handleExpiredSession(): void {
    if (!this.session.isAuthenticated()) return;
    this.session.user.set(null);
    this.knownAnonymous = true;
    void this.router.navigate(['/login'], {
      queryParams: { expirada: 1, volver: this.router.url },
    });
  }
}
