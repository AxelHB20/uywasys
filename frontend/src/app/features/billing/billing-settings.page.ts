import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BillingProvider, BillingSettings } from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

const series = (prefix: 'B' | 'F') => [
  Validators.required,
  Validators.pattern(new RegExp(`^${prefix}[A-Za-z0-9]{3}$`, 'i')),
];

/**
 * Configuración de la facturación electrónica. Con "Simulación" el sistema numera e imprime
 * boletas y facturas sin enviarlas; al contratar el PSE se pegan la ruta y el token y listo.
 */
@Component({
  selector: 'app-billing-settings-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './billing-settings.page.html',
})
export class BillingSettingsPage {
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);

  protected readonly settings = signal<BillingSettings | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);

  protected readonly form = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    provider: new FormControl<BillingProvider>('SIMULATED', { nonNullable: true }),
    production: new FormControl(false, { nonNullable: true }),
    legalName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(150)] }),
    apiUrl: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^(https:\/\/\S+)?$/), Validators.maxLength(300)],
    }),
    apiToken: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    boletaSeries: new FormControl('B001', { nonNullable: true, validators: series('B') }),
    facturaSeries: new FormControl('F001', { nonNullable: true, validators: series('F') }),
    boletaCreditSeries: new FormControl('BC01', { nonNullable: true, validators: series('B') }),
    facturaCreditSeries: new FormControl('FC01', { nonNullable: true, validators: series('F') }),
  });
  protected readonly provider = toSignal(this.form.controls.provider.valueChanges, {
    initialValue: this.form.controls.provider.value,
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loadError.set(null);
    this.billing.settings().subscribe({
      next: (s) => this.reset(s),
      error: (error: unknown) =>
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la configuración.')),
    });
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const simulated = v.provider === 'SIMULATED';
    this.saving.set(true);
    this.billing
      .save({
        enabled: v.enabled,
        provider: v.provider,
        production: simulated ? false : v.production,
        legalName: v.legalName.trim() || null,
        apiUrl: v.apiUrl.trim() || null,
        apiToken: v.apiToken.trim() || null,
        boletaSeries: v.boletaSeries.toUpperCase(),
        facturaSeries: v.facturaSeries.toUpperCase(),
        boletaCreditSeries: v.boletaCreditSeries.toUpperCase(),
        facturaCreditSeries: v.facturaCreditSeries.toUpperCase(),
      })
      .subscribe({
        next: (s) => {
          this.saving.set(false);
          this.reset(s);
          this.toast.success(
            s.enabled
              ? s.provider === 'SIMULATED'
                ? 'Guardado. Los cobros ya pueden emitir boletas y facturas en simulación.'
                : 'Guardado. Los comprobantes se enviarán a SUNAT por el PSE.'
              : 'Guardado. La facturación electrónica está desactivada.',
          );
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected test(): void {
    this.testing.set(true);
    this.billing.test().subscribe({
      next: (r) => {
        this.testing.set(false);
        this.toast.success(r.message);
      },
      error: (error: unknown) => {
        this.testing.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  private reset(s: BillingSettings): void {
    this.settings.set(s);
    this.form.reset({
      enabled: s.enabled,
      provider: s.provider,
      production: s.production,
      legalName: s.legalName ?? '',
      apiUrl: s.apiUrl ?? '',
      apiToken: '',
      boletaSeries: s.boletaSeries,
      facturaSeries: s.facturaSeries,
      boletaCreditSeries: s.boletaCreditSeries,
      facturaCreditSeries: s.facturaCreditSeries,
    });
  }
}
