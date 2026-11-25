import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { LogoComponent } from '../../shared/ui/logo/logo.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
  apiErrorMessage,
  matchFields,
} from '../../shared/utils/validators';

@Component({
  selector: 'app-change-password-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-password.page.html',
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);
  private readonly currentInput = viewChild.required<ElementRef<HTMLInputElement>>('currentInput');

  /** Si entró con clave temporal, esta pantalla es obligatoria y no tiene "volver". */
  protected readonly forced = this.session.mustChangePassword();
  protected readonly rule = PASSWORD_RULE;

  protected readonly form = new FormGroup(
    {
      current: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      next: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(PASSWORD_PATTERN)],
      }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: matchFields('next', 'confirm') },
  );

  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly show = signal(false);

  protected submit(): void {
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { current, next } = this.form.getRawValue();
    this.saving.set(true);
    this.auth.changePassword(current, next).subscribe({
      next: () => {
        this.toast.success('Contraseña actualizada');
        void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.serverError.set(apiErrorMessage(error));
        this.form.controls.current.reset();
        this.currentInput().nativeElement.focus();
      },
    });
  }

  protected logout(): void {
    this.auth.logout();
  }

  protected invalid(name: 'current' | 'next' | 'confirm'): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  protected mismatch(): boolean {
    return this.form.hasError('mismatch') && this.form.controls.confirm.touched;
  }
}
