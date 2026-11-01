import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { LogoComponent } from '../../shared/ui/logo/logo.component';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  /** ?volver=/ruta → a dónde ir después de ingresar. ?expirada=1 → la sesión anterior venció. */
  readonly volver = input<string>();
  readonly expirada = input<string>();

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(120)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
  });

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  protected submit(): void {
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      (this.form.controls.email.invalid
        ? this.emailInput()
        : this.passwordInput()
      ).nativeElement.focus();
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.auth.login(email, password).subscribe({
      next: (user) =>
        void this.router.navigateByUrl(
          user.mustChangePassword ? '/cambiar-clave' : safeReturnUrl(this.volver()),
        ),
      error: (error: unknown) => {
        this.submitting.set(false);
        this.serverError.set(messageFor(error));
        this.form.controls.password.reset();
        this.passwordInput().nativeElement.focus();
      },
    });
  }

  protected showError(control: 'email' | 'password'): boolean {
    const c = this.form.controls[control];
    return c.invalid && c.touched;
  }
}

/** Solo rutas internas: evita que un enlace malicioso redirija fuera del sistema. */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login')
    ? url
    : '/dashboard';
}

function messageFor(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    const message = (error.error as { message?: string } | null)?.message;
    if (error.status === 401 || error.status === 423)
      return message ?? 'Correo o contraseña incorrectos';
  }
  return 'No se pudo iniciar sesión. Inténtalo de nuevo en unos minutos.';
}
