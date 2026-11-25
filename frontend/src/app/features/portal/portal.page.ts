import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';
import { APPOINTMENT_TYPE_LABELS } from '../../core/services/appointments.models';
import { SEX_LABELS, SPECIES_LABELS } from '../../core/services/clients.models';
import { IMMUNIZATION_KIND_SHORT, dueState } from '../../core/services/medical.models';
import { PortalImmunization, PortalPet, nextDoses } from '../../core/services/portal.models';
import { PortalService } from '../../core/services/portal.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { formatPhone } from '../../shared/utils/peru';
import { petAge } from '../../shared/utils/pet-age';
import { SPECIES_ICONS, petCode } from '../../shared/utils/records';
import { apiErrorMessage } from '../../shared/utils/validators';

const longDate = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const clock = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
/** Estado de los avisos al celular en este navegador */
type PushState = 'off' | 'busy' | 'on' | 'denied' | 'install' | 'unsupported';

/** La clave pública VAPID viene en base64url; el navegador la pide en bytes */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const DUE_STYLE = {
  overdue: 'bg-rose-50 text-rose-800 ring-rose-200',
  soon: 'bg-amber-50 text-amber-900 ring-amber-200',
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
} as const;

/**
 * Portal del dueño (sin sesión): carnet de vacunas, próximas citas y recetas recientes de sus
 * mascotas. Se abre desde el enlace que envía la clínica; no se indexa en buscadores.
 */
@Component({
  selector: 'app-portal-page',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './portal.page.html',
})
export class PortalPage implements OnDestroy {
  private readonly api = inject(PortalService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  readonly token = input.required<string>();

  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly kindShort = IMMUNIZATION_KIND_SHORT;
  protected readonly dueStyle = DUE_STYLE;
  protected readonly petCode = petCode;
  protected readonly formatPhone = formatPhone;
  protected readonly today = limaToday();

  protected readonly data = rxResource({
    params: () => ({ token: this.token() }),
    stream: ({ params }) => this.api.view(params.token),
  });
  protected readonly view = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl = computed(() =>
    this.view()?.clinic.hasLogo && !this.logoFailed() ? this.api.logoUrl(this.token()) : null,
  );

  /** Avisos al celular (notificaciones web) y calendario */
  protected readonly push = signal<PushState>('off');
  private registration: ServiceWorkerRegistration | null = null;
  private previousManifest: string | null = null;
  protected readonly webcal = computed(() =>
    this.api.calendarUrl(this.token()).replace(/^https?:/, 'webcal:'),
  );
  protected readonly googleCalendar = computed(
    () => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(this.webcal())}`,
  );

  protected readonly selectedId = signal<number | null>(null);
  protected readonly pet = computed<PortalPet | null>(() => {
    const pets = this.view()?.pets ?? [];
    return pets.find((p) => p.id === this.selectedId()) ?? pets[0] ?? null;
  });
  protected readonly doses = computed(() => nextDoses(this.pet()?.immunizations ?? []));
  protected readonly pendingDoses = computed(() =>
    this.doses().filter((d) => dueState(d.nextDueAt, this.today)?.tone !== 'ok'),
  );
  protected readonly vaccines = computed(
    () => this.pet()?.immunizations.filter((i) => i.kind === 'VACCINE') ?? [],
  );
  protected readonly dewormings = computed(
    () => this.pet()?.immunizations.filter((i) => i.kind !== 'VACCINE') ?? [],
  );

  /** Celular de la clínica (9 dígitos que empiezan con 9) para escribirle por WhatsApp */
  protected readonly clinicMobile = computed(() => {
    const digits = (this.view()?.clinic.phone ?? '')
      .replace(/\D/g, '')
      .replace(/^51(?=9\d{8}$)/, '');
    return /^9\d{8}$/.test(digits) ? digits : null;
  });
  protected readonly clinicTel = computed(() =>
    (this.view()?.clinic.phone ?? '').replace(/[^\d+]/g, ''),
  );

  constructor() {
    // Es personal: que ningún buscador lo guarde
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    effect(() => {
      const v = this.view();
      if (v) this.title.setTitle(`Mascotas de ${v.ownerFirstName} · ${v.clinic.name}`);
    });
    // Al agregarlo a la pantalla de inicio debe abrir este portal, no el sistema de la clínica
    effect(() => {
      const link = this.document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) return;
      this.previousManifest ??= link.getAttribute('href');
      link.setAttribute('href', this.api.manifestUrl(this.token()));
    });
    effect(() => {
      if (this.view()) void this.preparePush();
    });
  }

  ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
    this.meta.removeTag('name="referrer"');
    if (this.previousManifest)
      this.document
        .querySelector('link[rel="manifest"]')
        ?.setAttribute('href', this.previousManifest);
  }

  /** Registra el service worker del portal y revisa si este celular ya tiene los avisos */
  private async preparePush(): Promise<void> {
    if (this.registration) return;
    const win = this.document.defaultView;
    const nav = win?.navigator;
    if (!win || !nav?.serviceWorker || !('PushManager' in win) || !('Notification' in win)) {
      const ios = /iphone|ipad|ipod/i.test(nav?.userAgent ?? '');
      this.push.set(ios ? 'install' : 'unsupported');
      return;
    }
    try {
      const url = `/portal-sw.js?u=${encodeURIComponent(`/p/${this.token()}`)}`;
      this.registration = await nav.serviceWorker.register(url, { scope: '/p/' });
      if (Notification.permission === 'denied') {
        this.push.set('denied');
        return;
      }
      const current = await this.registration.pushManager.getSubscription();
      if (current) {
        // Se vuelve a enviar: si la clínica renovó el enlace, los avisos siguen llegando
        await firstValueFrom(this.api.subscribe(this.token(), current.toJSON()));
        this.push.set('on');
      }
    } catch {
      this.push.set('unsupported');
    }
  }

  protected async enablePush(): Promise<void> {
    if (!this.registration) return;
    this.push.set('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.push.set(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const { publicKey } = await firstValueFrom(this.api.noticesKey());
      const subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      await firstValueFrom(this.api.subscribe(this.token(), subscription.toJSON()));
      this.push.set('on');
    } catch {
      this.push.set('off');
    }
  }

  protected async disablePush(): Promise<void> {
    const current = await this.registration?.pushManager.getSubscription();
    if (current) {
      await current.unsubscribe();
      this.api.unsubscribe(this.token(), current.endpoint).subscribe({ error: () => undefined });
    }
    this.push.set('off');
  }

  protected age(p: PortalPet): string | null {
    const age = petAge(p.birthDate);
    return age && p.birthDateEstimated ? `${age} aprox.` : age;
  }

  protected due(i: PortalImmunization) {
    return dueState(i.nextDueAt, this.today);
  }

  protected date(value: string | null): string {
    return formatDate(value, 'calendar');
  }

  /** Fecha de un momento (receta, vencimiento del enlace) en hora de Lima */
  protected day(iso: string): string {
    return formatDate(iso, 'date');
  }

  protected rxCode(n: number): string {
    return `RX-${String(n).padStart(5, '0')}`;
  }

  protected appointmentDay(iso: string): string {
    const label = longDate.format(new Date(iso));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  protected appointmentTime(iso: string): string {
    return clock.format(new Date(iso));
  }

  protected typeLabel(type: string): string {
    return APPOINTMENT_TYPE_LABELS[type as keyof typeof APPOINTMENT_TYPE_LABELS] ?? 'Cita';
  }

  protected whatsappClinic(): string | null {
    const mobile = this.clinicMobile();
    const v = this.view();
    if (!mobile || !v) return null;
    const pet = this.pet();
    const text = `Hola, soy ${v.ownerFirstName}${pet ? `, dueño(a) de ${pet.name}` : ''}. Les escribo desde el portal de mascotas.`;
    return `https://wa.me/51${mobile}?text=${encodeURIComponent(text)}`;
  }

  protected errorText(): string {
    return apiErrorMessage(
      this.data.error(),
      'No pudimos abrir este enlace. Revisa tu conexión e inténtalo otra vez.',
    );
  }

  protected print(): void {
    this.document.defaultView?.print();
  }
}
