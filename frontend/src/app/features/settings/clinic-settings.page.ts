import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { initialsOf } from '../../core/auth/session.service';
import { ClinicProfile, ClinicService } from '../../core/services/clinic.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage, rucValidator } from '../../shared/utils/validators';

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@Component({
  selector: 'app-clinic-settings-page',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clinic-settings.page.html',
})
export class ClinicSettingsPage implements OnInit {
  private readonly clinic = inject(ClinicService);
  private readonly toast = inject(ToastService);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    }),
    ruc: new FormControl('', { nonNullable: true, validators: [rucValidator] }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    phone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^\+?[0-9 ()-]{6,20}$/)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(120)],
    }),
  });

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly logoBusy = signal(false);
  protected readonly logoError = signal<string | null>(null);
  protected readonly profile = signal<ClinicProfile | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.clinic.get().subscribe({
      next: (profile) => {
        this.apply(profile);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(
          apiErrorMessage(error, 'No se pudieron cargar los datos de la clínica.'),
        );
        this.loading.set(false);
      },
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.clinic
      .update({
        name: value.name.trim(),
        ruc: value.ruc.trim() || null,
        address: value.address.trim() || null,
        phone: value.phone.trim() || null,
        email: value.email.trim() || null,
      })
      .subscribe({
        next: (profile) => {
          this.apply(profile);
          this.saving.set(false);
          this.toast.success('Datos de la clínica guardados');
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected chooseLogo(): void {
    this.fileInput().nativeElement.click();
  }

  protected onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.logoError.set(null);
    if (!LOGO_TYPES.includes(file.type)) {
      this.logoError.set('El logo debe ser una imagen PNG, JPG o WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      this.logoError.set(
        `El logo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es 1 MB.`,
      );
      return;
    }

    this.logoBusy.set(true);
    this.clinic.uploadLogo(file).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.logoBusy.set(false);
        this.toast.success('Logo actualizado');
      },
      error: (error: unknown) => {
        this.logoBusy.set(false);
        this.logoError.set(apiErrorMessage(error));
      },
    });
  }

  protected removeLogo(): void {
    this.logoBusy.set(true);
    this.clinic.removeLogo().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.logoBusy.set(false);
        this.toast.success('Logo quitado');
      },
      error: (error: unknown) => {
        this.logoBusy.set(false);
        this.logoError.set(apiErrorMessage(error));
      },
    });
  }

  protected initials(): string {
    return initialsOf(this.profile()?.name ?? '');
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  private apply(profile: ClinicProfile): void {
    this.profile.set(profile);
    this.form.reset({
      name: profile.name,
      ruc: profile.ruc ?? '',
      address: profile.address ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
    });
  }
}
