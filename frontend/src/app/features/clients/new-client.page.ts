import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import {
  DOCUMENT_LABELS,
  DOCUMENT_SHORT,
  DocumentType,
  NewClient,
} from '../../core/services/clients.models';
import { ClientsService } from '../../core/services/clients.service';
import { QueueService } from '../../core/services/queue.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  DOCUMENT_ERRORS,
  DOCUMENT_HINTS,
  documentValidator,
  isValidDocument,
  mobileValidator,
  normalizeDocNumber,
  normalizePhone,
} from '../../shared/utils/peru';
import { apiErrorMessage } from '../../shared/utils/validators';
import { PetFieldsComponent } from './pet-fields/pet-fields.component';
import { createPetForm, toPetInput } from './pet-fields/pet-form';

type DocChoice = DocumentType | 'NONE';
type Duplicate = { id: number; name: string; phone: string; active: boolean };

const DOC_CHOICES: DocChoice[] = ['DNI', 'CE', 'RUC', 'PASSPORT', 'NONE'];

/** Registro rápido: dueño + mascota en una sola pantalla (meta: menos de 1 minuto). */
@Component({
  selector: 'app-new-client-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, PetFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-client.page.html',
})
export class NewClientPage {
  private readonly clients = inject(ClientsService);
  private readonly queue = inject(QueueService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly docInput = viewChild<ElementRef<HTMLInputElement>>('docInput');

  protected readonly docChoices = DOC_CHOICES;
  protected readonly docShort: Record<DocChoice, string> = {
    ...DOCUMENT_SHORT,
    NONE: 'Sin documento',
  };
  protected readonly docLabels = DOCUMENT_LABELS;
  protected readonly docHints = DOCUMENT_HINTS;
  protected readonly docErrors = DOCUMENT_ERRORS;

  protected readonly form = new FormGroup({
    docType: new FormControl<DocChoice>('DNI', { nonNullable: true }),
    docNumber: new FormControl('', {
      nonNullable: true,
      validators: [documentValidator(() => this.currentDocType())],
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
    consent: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
    marketingConsent: new FormControl(false, { nonNullable: true }),
    pet: createPetForm(),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    urgent: new FormControl(false, { nonNullable: true }),
  });

  protected readonly docType = toSignal(this.form.controls.docType.valueChanges, {
    initialValue: this.form.controls.docType.value,
  });
  protected readonly includePet = signal(true);
  protected readonly saving = signal<'save' | 'queue' | null>(null);
  protected readonly duplicate = signal<Duplicate | null>(null);
  protected readonly consentText = toSignal(
    this.clients.consentText().pipe(catchError(() => of(null))),
  );
  /** Tipo de documento para textos y límites (cuando no es "sin documento"). */
  protected readonly docKind = computed<DocumentType>(() => {
    const type = this.docType();
    return type === 'NONE' ? 'DNI' : type;
  });
  protected readonly nameLabel = computed(() =>
    this.docType() === 'RUC' ? 'Razón social' : 'Nombres y apellidos',
  );

  constructor() {
    this.form.controls.docType.valueChanges.subscribe(() => {
      this.duplicate.set(null);
      this.form.controls.docNumber.updateValueAndValidity();
      this.docInput()?.nativeElement.focus();
    });
    this.form.controls.docNumber.valueChanges.subscribe(() => this.duplicate.set(null));
    afterNextRender(() => this.docInput()?.nativeElement.focus());
  }

  private currentDocType(): DocumentType | null {
    const type = this.form?.controls.docType.value;
    return type && type !== 'NONE' ? type : null;
  }

  /** Al salir del campo: si el documento ya está registrado, se avisa antes de llenar el resto. */
  protected checkDuplicate(): void {
    const type = this.currentDocType();
    const number = normalizeDocNumber(this.form.controls.docNumber.value);
    if (!type || !isValidDocument(type, number)) return;
    this.clients
      .lookup(type, number)
      .pipe(catchError(() => of({ client: null })))
      .subscribe(({ client }) => this.duplicate.set(client));
  }

  protected togglePet(include: boolean): void {
    this.includePet.set(include);
    const pet = this.form.controls.pet;
    if (include) pet.enable();
    else pet.disable();
  }

  protected submit(mode: 'save' | 'queue'): void {
    if (this.saving()) return;
    if (this.duplicate()) {
      this.focus('#duplicate-alert');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Esperar a que se pinten los errores y llevar el foco al primero
      setTimeout(() => this.focus('[aria-invalid="true"]', '.field-error'));
      return;
    }

    const v = this.form.getRawValue();
    const docType = this.currentDocType();
    const data: NewClient = {
      docType,
      docNumber: docType ? normalizeDocNumber(v.docNumber) : null,
      name: v.name.trim(),
      phone: normalizePhone(v.phone),
      email: v.email.trim().toLowerCase() || null,
      address: v.address.trim() || null,
      district: v.district.trim() || null,
      notes: null,
      marketingConsent: v.marketingConsent,
      consent: true,
      pet: this.includePet() ? toPetInput(this.form.controls.pet) : undefined,
    };
    const toQueue = mode === 'queue' && this.includePet();

    this.saving.set(mode);
    this.clients.create(data).subscribe({
      next: (client) => {
        const pet = client.pets[0];
        if (!toQueue || !pet) {
          this.done(client.id, `${client.name} quedó registrado`);
          return;
        }
        this.queue
          .add({ petId: pet.id, urgent: v.urgent, reason: v.reason.trim() || null })
          .subscribe({
            next: () => this.done(client.id, `${pet.name} está en la cola de hoy`),
            error: (error: unknown) => {
              this.toast.error(
                `Cliente guardado, pero no se pudo poner en cola: ${apiErrorMessage(error)}`,
              );
              this.router.navigate(['/clientes', client.id]);
            },
          });
      },
      error: (error: unknown) => {
        this.saving.set(null);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }

  protected invalid(name: 'docNumber' | 'name' | 'phone' | 'email' | 'consent'): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  private done(clientId: number, message: string): void {
    this.toast.success(message);
    this.router.navigate(['/clientes', clientId]);
  }

  /** Lleva el foco al primer elemento que coincida; si no es enfocable (un error de la especie), lo muestra. */
  private focus(selector: string, fallback?: string): void {
    const root = this.host.nativeElement as HTMLElement;
    const target = root.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus();
      return;
    }
    if (fallback) root.querySelector<HTMLElement>(fallback)?.scrollIntoView?.({ block: 'center' });
  }
}
