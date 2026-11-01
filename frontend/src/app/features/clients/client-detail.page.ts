import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import {
  AuthorizedPerson,
  ClientDetail,
  DOCUMENT_LABELS,
  DOCUMENT_SHORT,
  DocumentType,
  FRONT_DESK_ROLES,
  Pet,
  SEX_LABELS,
  SPECIES_LABELS,
} from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { CASH_ROLES } from '../../core/services/cash.models';
import { QueueService } from '../../core/services/queue.service';
import {
  ClientAccount,
  VISIT_STATUS_LABELS,
  VisitSummary,
} from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  DNI_PATTERN,
  DOCUMENT_ERRORS,
  documentValidator,
  formatPhone,
  mobileValidator,
  normalizeDocNumber,
  normalizePhone,
  whatsappLink,
} from '../../shared/utils/peru';
import { petAge, toIsoDate } from '../../shared/utils/pet-age';
import {
  SPECIES_ICONS,
  clientCode,
  initials,
  petCode,
  relativeDay,
} from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { apiErrorDetails, apiErrorMessage } from '../../shared/utils/validators';
import { PetFieldsComponent } from './pet-fields/pet-fields.component';
import { createPetForm, patchPetForm, toPetInput } from './pet-fields/pet-form';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

type DocChoice = DocumentType | 'NONE';
type Modal = 'client' | 'pet' | 'queue' | 'authorized' | 'remove-authorized' | 'anonymize' | null;

@Component({
  selector: 'app-client-detail-page',
  imports: [
    FechaPipe,
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    PetFieldsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-detail.page.html',
})
export class ClientDetailPage {
  private readonly clients = inject(ClientsService);
  private readonly queue = inject(QueueService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);
  private readonly visits = inject(VisitsService);
  private readonly router = inject(Router);

  /** :id de la ruta */
  readonly id = input.required<string>();

  protected readonly docShort = DOCUMENT_SHORT;
  protected readonly docLabels = DOCUMENT_LABELS;
  protected readonly docErrors = DOCUMENT_ERRORS;
  protected readonly docChoices: DocChoice[] = ['DNI', 'CE', 'RUC', 'PASSPORT', 'NONE'];
  protected readonly docChoiceLabels: Record<DocChoice, string> = {
    ...DOCUMENT_SHORT,
    NONE: 'Sin documento',
  };
  protected readonly speciesLabels = SPECIES_LABELS;
  protected readonly sexLabels = SEX_LABELS;
  protected readonly formatPhone = formatPhone;
  protected readonly whatsappLink = whatsappLink;
  protected readonly petAge = petAge;
  protected readonly speciesIcons = SPECIES_ICONS;
  protected readonly clientCode = clientCode;
  protected readonly petCode = petCode;
  protected readonly initials = initials;
  protected readonly relativeDay = relativeDay;
  protected readonly today = toIsoDate(new Date());
  /** Un cliente anonimizado ya no se edita: solo queda su historia, sin datos personales. */
  protected readonly canEdit = computed(
    () =>
      FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER') && !this.client()?.anonymizedAt,
  );
  protected readonly isAdmin = this.session.isAdmin;
  protected readonly downloading = signal(false);
  protected readonly anonymizeForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(5), Validators.maxLength(300)],
    }),
    confirm: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  protected readonly money = money;
  protected readonly canCollect = computed(() =>
    CASH_ROLES.includes(this.session.role() ?? 'GROOMER'),
  );
  protected readonly visitLabels = VISIT_STATUS_LABELS;
  protected readonly client = signal<ClientDetail | null>(null);
  /** Lo que debe y sus últimos cobros */
  protected readonly account = signal<ClientAccount | null>(null);
  /** Atenciones de sus mascotas, de la más reciente a la más antigua */
  protected readonly history = signal<VisitSummary[]>([]);
  protected readonly historyTotal = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activePets = computed(() => this.client()?.pets.filter((p) => p.active) ?? []);
  protected readonly inactivePets = computed(
    () => this.client()?.pets.filter((p) => !p.active) ?? [],
  );

  protected readonly modal = signal<Modal>(null);
  protected readonly saving = signal(false);
  protected readonly editingPet = signal<Pet | null>(null);
  protected readonly queuePet = signal<Pet | null>(null);
  protected readonly removing = signal<AuthorizedPerson | null>(null);

  // Editar cliente
  protected readonly clientForm = new FormGroup({
    docType: new FormControl<DocChoice>('DNI', { nonNullable: true }),
    docNumber: new FormControl('', {
      nonNullable: true,
      validators: [documentValidator(() => this.editDocType())],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(150)],
    }),
    phone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, mobileValidator],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(120)],
    }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    district: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    marketingConsent: new FormControl(false, { nonNullable: true }),
    active: new FormControl(true, { nonNullable: true }),
  });
  protected readonly editDocChoice = signal<DocChoice>('DNI');

  // Mascota (crear / editar)
  protected readonly petForm = createPetForm();
  protected readonly petStatus = new FormGroup({
    deceased: new FormControl(false, { nonNullable: true }),
    deceasedAt: new FormControl('', { nonNullable: true }),
    active: new FormControl(true, { nonNullable: true }),
  });
  protected readonly deceased = signal(false);

  // Poner en cola
  protected readonly queueForm = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    urgent: new FormControl(false, { nonNullable: true }),
  });

  // Persona autorizada
  protected readonly authorizedForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(120)],
    }),
    dni: new FormControl('', { nonNullable: true, validators: [Validators.pattern(DNI_PATTERN)] }),
    phone: new FormControl('', { nonNullable: true, validators: [mobileValidator] }),
    relation: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
  });

  constructor() {
    effect(() => this.load(Number(this.id())));
    this.clientForm.controls.docType.valueChanges.subscribe((type) => {
      this.editDocChoice.set(type);
      this.clientForm.controls.docNumber.updateValueAndValidity();
    });
    this.petStatus.controls.deceased.valueChanges.subscribe((value) => this.deceased.set(value));
  }

  protected load(id = Number(this.id())): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.clients.get(id).subscribe({
      next: (client) => {
        this.client.set(client);
        this.loading.set(false);
        this.loadAccount(id);
      },
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar la ficha del cliente.'));
        this.loading.set(false);
      },
    });
  }

  /** Cuenta e historial: si fallan, la ficha igual se ve. */
  private loadAccount(id: number): void {
    this.visits.account(id).subscribe({
      next: (account) => this.account.set(account),
      error: () => this.account.set(null),
    });
    this.visits.list({ clientId: id }).subscribe({
      next: (page) => {
        this.history.set(page.items);
        this.historyTotal.set(page.total);
      },
      error: () => this.history.set([]),
    });
  }

  /** Atender sin pasar por la cola (por ejemplo, una venta o un control rápido). */
  protected attend(pet: Pet): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.visits.open(pet.id).subscribe({
      next: (visit) => {
        this.saving.set(false);
        void this.router.navigate(['/atenciones', visit.id]);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        const { visitId } = apiErrorDetails<{ visitId: number }>(error);
        if (visitId) void this.router.navigate(['/atenciones', visitId]);
        else this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected petSummary(pet: Pet): string {
    return [
      this.speciesLabels[pet.species],
      pet.breed,
      pet.sex ? this.sexLabels[pet.sex] : null,
      pet.neutered ? (pet.sex === 'FEMALE' ? 'esterilizada' : 'esterilizado') : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ── Cliente ──
  protected openClient(): void {
    const c = this.client();
    if (!c) return;
    this.clientForm.reset({
      docType: c.docType ?? 'NONE',
      docNumber: c.docNumber ?? '',
      name: c.name,
      phone: c.phone,
      email: c.email ?? '',
      address: c.address ?? '',
      district: c.district ?? '',
      notes: c.notes ?? '',
      marketingConsent: c.marketingConsent,
      active: c.active,
    });
    this.editDocChoice.set(c.docType ?? 'NONE');
    this.modal.set('client');
  }

  protected saveClient(): void {
    const c = this.client();
    if (!c || this.invalidForm(this.clientForm)) return;
    const v = this.clientForm.getRawValue();
    const docType = this.editDocType();
    this.run(
      this.clients.update(c.id, {
        docType,
        docNumber: docType ? normalizeDocNumber(v.docNumber) : null,
        name: v.name.trim(),
        phone: normalizePhone(v.phone),
        email: v.email.trim().toLowerCase() || null,
        address: v.address.trim() || null,
        district: v.district.trim() || null,
        notes: v.notes.trim() || null,
        marketingConsent: v.marketingConsent,
        active: v.active,
      }),
      (updated) => {
        this.client.set(updated);
        this.toast.success('Datos del cliente actualizados');
      },
    );
  }

  // ── Mascotas ──
  protected openPet(pet: Pet | null): void {
    this.editingPet.set(pet);
    if (pet) patchPetForm(this.petForm, pet);
    else this.petForm.reset();
    this.petStatus.reset({
      deceased: !!pet?.deceasedAt,
      deceasedAt: pet?.deceasedAt ?? '',
      active: pet?.active ?? true,
    });
    this.deceased.set(!!pet?.deceasedAt);
    this.modal.set('pet');
  }

  protected savePet(): void {
    const c = this.client();
    if (!c || this.invalidForm(this.petForm)) return;
    const input = toPetInput(this.petForm);
    const editing = this.editingPet();

    if (!editing) {
      this.run(this.clients.addPet(c.id, input), (pet) => {
        this.client.set({ ...c, pets: [...c.pets, pet] });
        this.toast.success(`${pet.name} quedó registrado`);
      });
      return;
    }

    const status = this.petStatus.getRawValue();
    if (status.deceased && !status.deceasedAt) {
      this.toast.error('Indica la fecha de fallecimiento');
      return;
    }
    this.run(
      this.clients.updatePet(editing.id, {
        ...input,
        deceasedAt: status.deceased ? status.deceasedAt : null,
        ...(status.deceased ? {} : { active: status.active }),
      }),
      (pet) => {
        this.client.set({ ...c, pets: c.pets.map((p) => (p.id === pet.id ? pet : p)) });
        this.toast.success('Mascota actualizada');
      },
    );
  }

  // ── Cola ──
  protected openQueue(pet: Pet): void {
    this.queuePet.set(pet);
    this.queueForm.reset({ reason: '', urgent: false });
    this.modal.set('queue');
  }

  protected addToQueue(): void {
    const pet = this.queuePet();
    if (!pet || this.invalidForm(this.queueForm)) return;
    const v = this.queueForm.getRawValue();
    this.run(
      this.queue.add({ petId: pet.id, urgent: v.urgent, reason: v.reason.trim() || null }),
      () => this.toast.success(`${pet.name} está en la cola de hoy`),
    );
  }

  // ── Personas autorizadas ──
  protected openAuthorized(): void {
    this.authorizedForm.reset();
    this.modal.set('authorized');
  }

  protected saveAuthorized(): void {
    const c = this.client();
    if (!c || this.invalidForm(this.authorizedForm)) return;
    const v = this.authorizedForm.getRawValue();
    this.run(
      this.clients.addAuthorized(c.id, {
        name: v.name.trim(),
        dni: v.dni.trim() || null,
        phone: normalizePhone(v.phone) || null,
        relation: v.relation.trim() || null,
      }),
      (person) => {
        this.client.set({ ...c, authorized: [...c.authorized, person] });
        this.toast.success(`${person.name} puede recoger a las mascotas`);
      },
    );
  }

  protected askRemove(person: AuthorizedPerson): void {
    this.removing.set(person);
    this.modal.set('remove-authorized');
  }

  protected removeAuthorized(): void {
    const c = this.client();
    const person = this.removing();
    if (!c || !person) return;
    this.run(this.clients.removeAuthorized(c.id, person.id), () => {
      this.client.set({ ...c, authorized: c.authorized.filter((p) => p.id !== person.id) });
      this.toast.success(`${person.name} ya no está autorizado`);
    });
  }

  // ── Derechos ARCO (Ley 29733) ──
  /** Acceso: descarga todo lo que la clínica guarda del cliente. */
  protected downloadData(): void {
    const c = this.client();
    if (!c || this.downloading()) return;
    this.downloading.set(true);
    this.clients.exportData(c.id).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `datos-${clientCode(c.number)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        this.toast.success('Se descargaron sus datos. Entrégaselos al cliente.');
      },
      error: (error: unknown) => {
        this.downloading.set(false);
        this.toast.error(apiErrorMessage(error, 'No se pudieron descargar sus datos.'));
      },
    });
  }

  protected openAnonymize(): void {
    this.anonymizeForm.reset({ reason: '', confirm: false });
    this.modal.set('anonymize');
  }

  /** Cancelación: borra los datos personales; las atenciones y cobros quedan sin ellos. */
  protected confirmAnonymize(): void {
    const c = this.client();
    if (!c || this.invalidForm(this.anonymizeForm)) return;
    this.run(this.clients.anonymize(c.id, this.anonymizeForm.getRawValue().reason.trim()), () => {
      this.load();
      this.toast.success('Se borraron sus datos personales. Su historia queda sin ellos.');
    });
  }

  protected close(): void {
    if (this.saving()) return;
    this.modal.set(null);
  }

  protected invalid(form: FormGroup, name: string): boolean {
    const control = form.get(name);
    return !!control && control.invalid && control.touched;
  }

  private editDocType(): DocumentType | null {
    const type = this.clientForm?.controls.docType.value;
    return type && type !== 'NONE' ? type : null;
  }

  private invalidForm(form: FormGroup): boolean {
    if (form.valid) return false;
    form.markAllAsTouched();
    setTimeout(() =>
      document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]')?.focus(),
    );
    return true;
  }

  /** Ejecuta un guardado del modal abierto: deshabilita el botón, cierra al terminar y avisa si falla. */
  private run<T>(request: Observable<T>, done: (result: T) => void): void {
    this.saving.set(true);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.modal.set(null);
        done(result);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
