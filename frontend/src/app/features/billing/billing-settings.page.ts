import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { NotificationsService } from '../../core/services/notifications.service';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BillingProvider, BillingSettings } from '../../core/services/billing.models';
import { BillingService } from '../../core/services/billing.service';
import { SessionService } from '../../core/auth/session.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';

const series = (prefix: 'B' | 'F') => [
  Validators.required,
  Validators.pattern(new RegExp(`^${prefix}[A-Za-z0-9]{3}$`, 'i')),
];

/**
 * Configuración de la facturación electrónica. Con "Simulación" el sistema numera e imprime
 * boletas y facturas sin enviarlas; al contratar el PSE se pegan la ruta y el token y listo.
 * Solo soporte técnico la cambia; el administrador la ve y pega el token nuevo del PSE
 * (se prueba antes de guardarse, así un token malo no corta la facturación).
 */
@Component({
  selector: 'app-billing-settings-page',
  imports: [BackLinkComponent, ReactiveFormsModule, IconComponent, FechaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './billing-settings.page.html',
})
export class BillingSettingsPage {
  private readonly billing = inject(BillingService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly center = inject(NotificationsService);

  /** Nombre del PSE para los textos ("Mifact") */
  protected readonly pseName = computed(() => {
    const p = this.settings()?.provider;
    return p === 'MIFACT' ? 'Mifact' : p === 'NUBEFACT' ? 'Nubefact' : 'el PSE';
  });

  /** Soporte técnico: el único que cambia proveedor, ruta, ambiente y series */
  protected readonly canEdit = this.session.isSupport;
  /** Cambios delicados esperando que soporte los confirme (series, producción) */
  protected readonly confirmChanges = signal<string[] | null>(null);
  protected readonly tokenSaving = signal(false);
  protected readonly tokenControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(8), Validators.maxLength(200)],
  });
  protected readonly usesPse = computed(() => {
    const s = this.settings();
    return !!s && s.provider !== 'SIMULATED';
  });

  protected readonly settings = signal<BillingSettings | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);

  protected readonly form = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    provider: new FormControl<BillingProvider>('SIMULATED', { nonNullable: true }),
    production: new FormControl(false, { nonNullable: true }),
    legalName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(150)] }),
    fiscalAddress: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(200)],
    }),
    ubigeo: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^(\d{6})?$/)],
    }),
    apiUrl: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^(https:\/\/\S+)?$/), Validators.maxLength(300)],
    }),
    apiToken: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    lookupToken: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1000)],
    }),
    boletaSeries: new FormControl('B001', { nonNullable: true, validators: series('B') }),
    facturaSeries: new FormControl('F001', { nonNullable: true, validators: series('F') }),
    boletaCreditSeries: new FormControl('BC01', { nonNullable: true, validators: series('B') }),
    facturaCreditSeries: new FormControl('FC01', { nonNullable: true, validators: series('F') }),
    // Plan y vencimientos: avisan al dueño antes de que algo se detenga
    monthlyQuota: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^([1-9]\d{0,5})?$/)],
    }),
    planExpiresOn: new FormControl('', { nonNullable: true }),
    domainExpiresOn: new FormControl('', { nonNullable: true }),
    serverExpiresOn: new FormControl('', { nonNullable: true }),
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

  protected save(confirmed = false): void {
    if (this.saving() || !this.canEdit()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const risky = confirmed ? [] : this.riskyChanges();
    if (risky.length) {
      this.confirmChanges.set(risky);
      return;
    }
    this.confirmChanges.set(null);
    const simulated = v.provider === 'SIMULATED';
    this.saving.set(true);
    this.billing
      .save({
        enabled: v.enabled,
        provider: v.provider,
        production: simulated ? false : v.production,
        legalName: v.legalName.trim() || null,
        fiscalAddress: v.fiscalAddress.trim() || null,
        ubigeo: v.ubigeo.trim() || null,
        // Lucode no usa ruta (la elige el sistema según "Producción"); Mifact sin ruta usa su demo
        apiUrl:
          v.provider === 'NUBEFACT' || v.provider === 'MIFACT' ? v.apiUrl.trim() || null : null,
        apiToken: v.apiToken.trim() || null,
        lookupToken: v.lookupToken.trim() || null,
        boletaSeries: v.boletaSeries.toUpperCase(),
        facturaSeries: v.facturaSeries.toUpperCase(),
        boletaCreditSeries: v.boletaCreditSeries.toUpperCase(),
        facturaCreditSeries: v.facturaCreditSeries.toUpperCase(),
        monthlyQuota: v.monthlyQuota ? Number(v.monthlyQuota) : null,
        planExpiresOn: v.planExpiresOn || null,
        domainExpiresOn: v.domainExpiresOn || null,
        serverExpiresOn: v.serverExpiresOn || null,
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

  /** Lo que cambia cómo se numeran o a dónde van los comprobantes: se confirma antes de guardar */
  private riskyChanges(): string[] {
    const s = this.settings();
    if (!s) return [];
    const v = this.form.getRawValue();
    const list: string[] = [];
    if (v.provider !== s.provider) list.push(`Cambiar el proveedor a ${v.provider}`);
    const production = v.provider !== 'SIMULATED' && v.production;
    if (production !== s.production)
      list.push(
        production
          ? 'Activar producción: los comprobantes irán a SUNAT con valor tributario'
          : 'Volver al ambiente de pruebas: los comprobantes dejarán de ir a SUNAT',
      );
    const pairs: [string, string, string][] = [
      ['boletas', s.boletaSeries, v.boletaSeries],
      ['facturas', s.facturaSeries, v.facturaSeries],
      ['notas de crédito de boletas', s.boletaCreditSeries, v.boletaCreditSeries],
      ['notas de crédito de facturas', s.facturaCreditSeries, v.facturaCreditSeries],
    ];
    for (const [label, before, after] of pairs)
      if (before.toUpperCase() !== after.toUpperCase())
        list.push(`Serie de ${label}: ${before} → ${after.toUpperCase()}`);
    return list;
  }

  /** El token nuevo que manda el PSE: se prueba antes de guardarlo */
  protected saveToken(): void {
    if (this.tokenSaving()) return;
    if (this.tokenControl.invalid) {
      this.tokenControl.markAsTouched();
      return;
    }
    this.tokenSaving.set(true);
    this.billing.updateToken(this.tokenControl.value.trim()).subscribe({
      next: (s) => {
        this.tokenSaving.set(false);
        this.tokenControl.reset('');
        this.settings.set(s);
        // El aviso de "facturación detenida" se apaga ya, sin esperar a la próxima consulta
        this.center.refresh();
        this.toast.success(
          'Token actualizado y probado. Los comprobantes que esperaban se envían solos.',
        );
      },
      error: (error: unknown) => {
        this.tokenSaving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  /** Quita el token de la consulta de RUC/DNI: se vuelve a escribir a mano */
  protected clearLookup(): void {
    const s = this.settings();
    if (!s || this.saving()) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.billing
      .save({
        enabled: s.enabled,
        provider: s.provider,
        production: s.production,
        legalName: s.legalName,
        fiscalAddress: s.fiscalAddress,
        ubigeo: s.ubigeo,
        apiUrl: s.apiUrl,
        apiToken: null,
        clearLookupToken: true,
        boletaSeries: s.boletaSeries,
        facturaSeries: s.facturaSeries,
        boletaCreditSeries: s.boletaCreditSeries,
        facturaCreditSeries: s.facturaCreditSeries,
      })
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.reset(saved);
          // Lo que se estaba editando en el resto del formulario no se pierde
          this.form.patchValue({ ...v, lookupToken: '' });
          this.toast.success('Se quitó la búsqueda automática de RUC y DNI.');
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
        this.refreshHealth();
      },
      error: (error: unknown) => {
        this.testing.set(false);
        this.toast.error(apiErrorMessage(error));
        this.refreshHealth();
      },
    });
  }

  /** "Probar conexión" también anota el estado: se vuelve a leer (sin tocar el formulario) */
  private refreshHealth(): void {
    this.billing.settings().subscribe({
      next: (s) => this.settings.update((cur) => (cur ? { ...cur, health: s.health } : s)),
      error: () => undefined,
    });
    this.center.refresh();
  }

  /** Días desde que se guardó el token (Mifact lo cambia cada ~6 meses) */
  protected readonly tokenAgeDays = computed(() => {
    const at = this.settings()?.tokenUpdatedAt;
    return at ? Math.floor((Date.now() - Date.parse(at)) / 86_400_000) : null;
  });

  private reset(s: BillingSettings): void {
    this.settings.set(s);
    this.confirmChanges.set(null);
    this.form.reset({
      enabled: s.enabled,
      provider: s.provider,
      production: s.production,
      legalName: s.legalName ?? '',
      fiscalAddress: s.fiscalAddress ?? '',
      ubigeo: s.ubigeo ?? '',
      apiUrl: s.apiUrl ?? '',
      apiToken: '',
      lookupToken: '',
      boletaSeries: s.boletaSeries,
      facturaSeries: s.facturaSeries,
      boletaCreditSeries: s.boletaCreditSeries,
      facturaCreditSeries: s.facturaCreditSeries,
      monthlyQuota: s.monthlyQuota ? String(s.monthlyQuota) : '',
      planExpiresOn: s.planExpiresOn ?? '',
      domainExpiresOn: s.domainExpiresOn ?? '',
      serverExpiresOn: s.serverExpiresOn ?? '',
    });
    // Sin permiso se ve todo, pero no se puede tocar
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
  }
}
