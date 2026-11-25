import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { LogoComponent } from '../../shared/ui/logo/logo.component';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
  apiErrorMessage,
  matchFields,
} from '../../shared/utils/validators';

/**
 * "¿Olvidaste tu contraseña?" en dos pasos: sin token pide el correo y envía el enlace; con
 * ?token= (el enlace del correo) crea la contraseña nueva y vuelve a la pantalla de ingreso.
 */
@Component({
  selector: 'app-recover-password-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './recover-password.page.html',
})
export class RecoverPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly token = input<string>();
  /** ?correo= viene del login, para no volver a escribirlo */
  readonly correo = input<string>();
  protected readonly withToken = computed(() => !!this.token());
  protected readonly rule = PASSWORD_RULE;

  protected readonly emailForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(120)],
    }),
  });
  protected readonly passwordForm = new FormGroup(
    {
      next: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(PASSWORD_PATTERN)],
      }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: matchFields('next', 'confirm') },
  );

  protected readonly sending = signal(false);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly show = signal(false);

  constructor() {
    queueMicrotask(() => {
      const email = this.correo();
      if (email) this.emailForm.controls.email.setValue(email);
    });
  }

  protected requestLink(): void {
    this.serverError.set(null);
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      document.getElementById('rp-email')?.focus();
      return;
    }
    const email = this.emailForm.controls.email.value.trim();
    this.sending.set(true);
    this.auth.forgotPassword(email).subscribe({
      next: () => {
        this.sending.set(false);
        this.sentTo.set(email);
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.serverError.set(messageFor(error));
      },
    });
  }

  protected savePassword(): void {
    this.serverError.set(null);
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.sending.set(true);
    this.auth.resetPassword(this.token()!, this.passwordForm.controls.next.value).subscribe({
      next: () =>
        void this.router.navigate(['/login'], {
          queryParams: { restablecida: 1 },
          replaceUrl: true,
        }),
      error: (error: unknown) => {
        this.sending.set(false);
        this.serverError.set(messageFor(error));
      },
    });
  }

  protected emailInvalid(): boolean {
    const c = this.emailForm.controls.email;
    return c.invalid && c.touched;
  }
  protected invalid(name: 'next' | 'confirm'): boolean {
    const c = this.passwordForm.controls[name];
    return c.invalid && c.touched;
  }
  protected mismatch(): boolean {
    return this.passwordForm.hasError('mismatch') && this.passwordForm.controls.confirm.touched;
  }
}

function messageFor(error: unknown): string {
  if ((error as { status?: number } | null)?.status === 429)
    return 'Hiciste varios intentos seguidos. Espera un minuto y vuelve a intentarlo.';
  return apiErrorMessage(error);
}
