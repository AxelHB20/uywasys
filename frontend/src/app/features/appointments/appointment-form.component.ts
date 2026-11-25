import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  APPOINTMENT_DURATIONS,
  APPOINTMENT_TYPE_LABELS,
  AgendaStaff,
  Appointment,
  AppointmentType,
  limaClock,
  limaIso,
  nextSlot,
  timeSlots,
} from '../../core/services/appointments.models';
import { AppointmentsService } from '../../core/services/appointments.service';
import {
  PetPickerComponent,
  PickedPet,
  PickedPetComponent,
} from '../../shared/ui/pet-picker/pet-picker.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  TransportFieldsComponent,
  transportGroup,
  transportInvalid,
  transportValue,
} from '../../shared/ui/transport-fields/transport-fields.component';
import { ImmunizationsService } from '../../core/services/immunizations.service';
import { VisitsService } from '../../core/services/visits.service';
import { limaToday } from '../../shared/utils/dates';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Datos con los que se abre el formulario de una cita nueva */
export interface AppointmentDraft {
  day: string;
  time?: string;
  vetId?: number | null;
  pet?: PickedPet | null;
  reason?: string;
}

/** Agendar o reprogramar una cita. Si el veterinario ya tiene otra cita, ofrece el sobrecupo. */
@Component({
  selector: 'app-appointment-form',
  imports: [ReactiveFormsModule, PetPickerComponent, PickedPetComponent, TransportFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      id="appointment-form"
      [formGroup]="form"
      (ngSubmit)="submit()"
      novalidate
      class="space-y-4"
    >
      @if (!editing()) {
        <div>
          <span class="field-label"
            >Paciente <span class="text-rose-600" aria-hidden="true">*</span></span
          >
          <div class="mt-1.5">
            @if (pet(); as p) {
              <app-picked-pet [pet]="p" (change)="pet.set(null)" />
            } @else {
              <app-pet-picker
                inputId="appt-pet"
                [invalid]="petMissing()"
                (picked)="pet.set($event); petMissing.set(false)"
              />
            }
          </div>
          @if (petMissing()) {
            <p class="field-error">Elige el paciente</p>
          }
        </div>
      } @else {
        <p class="rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200">
          <span class="font-medium text-slate-900">{{ editing()!.pet.name }}</span>
          <span class="text-slate-600"> · {{ editing()!.client.name }}</span>
        </p>
      }

      <div>
        <span id="appt-type" class="field-label">Tipo</span>
        <div
          class="mt-1.5 inline-flex rounded-xl bg-slate-100 p-1"
          role="radiogroup"
          aria-labelledby="appt-type"
        >
          @for (t of types; track t) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="form.controls.type.value === t"
              class="h-9 rounded-lg px-4 text-sm font-medium transition-colors"
              [class]="
                form.controls.type.value === t
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              "
              (click)="form.controls.type.setValue(t)"
            >
              {{ typeLabels[t] }}
            </button>
          }
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div class="col-span-2 sm:col-span-1">
          <label for="appt-day" class="field-label">Día</label>
          <input
            id="appt-day"
            type="date"
            formControlName="day"
            class="field-input"
            [min]="today"
            [attr.aria-invalid]="bad('day')"
          />
        </div>
        <div>
          <label for="appt-time" class="field-label">Hora</label>
          <select id="appt-time" formControlName="time" class="field-input">
            @for (s of slots; track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </div>
        <div>
          <label for="appt-duration" class="field-label">Duración</label>
          <select id="appt-duration" formControlName="durationMin" class="field-input">
            @for (d of durations; track d) {
              <option [ngValue]="d">
                {{ d < 60 ? d + ' min' : d / 60 + (d === 60 ? ' hora' : ' horas') }}
              </option>
            }
          </select>
        </div>
      </div>

      <div>
        <label for="appt-vet" class="field-label">Atiende</label>
        <select id="appt-vet" formControlName="vetId" class="field-input">
          <option [ngValue]="null">Quien esté disponible</option>
          @for (s of staff(); track s.id) {
            <option [ngValue]="s.id">{{ s.fullName }}</option>
          }
        </select>
      </div>

      <div>
        <label for="appt-reason" class="field-label">Motivo</label>
        <input
          id="appt-reason"
          formControlName="reason"
          class="field-input"
          maxlength="200"
          autocomplete="off"
          placeholder="Ej.: refuerzo de vacuna, control post operatorio"
        />
      </div>
      <div>
        <label for="appt-notes" class="field-label">Notas internas</label>
        <input
          id="appt-notes"
          formControlName="notes"
          class="field-input"
          maxlength="300"
          autocomplete="off"
          placeholder="Ej.: viene en ayunas, traer análisis"
        />
      </div>
      <app-transport-fields
        prefix="appt-mov"
        [group]="form.controls.move"
        [clientAddress]="clientAddress()"
        [lastPrice]="lastTransportPrice()"
        [submitted]="submitted()"
      />

      @if (overlap(); as message) {
        <div
          class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
          role="alert"
        >
          <p class="font-medium">{{ message }}</p>
          <p class="mt-0.5">Puedes elegir otra hora o agendarla igual como sobrecupo.</p>
          <button type="button" class="btn btn-secondary mt-2 h-9" (click)="submit(true)">
            Agendar igual
          </button>
        </div>
      }
    </form>
  `,
})
export class AppointmentFormComponent implements OnInit {
  private readonly api = inject(AppointmentsService);
  private readonly toast = inject(ToastService);
  private readonly cardsApi = inject(ImmunizationsService);
  private readonly visitsApi = inject(VisitsService);

  readonly staff = input.required<AgendaStaff[]>();
  /** Cita nueva: lo que ya se sabe (día, hora, veterinario, paciente) */
  readonly draft = input<AppointmentDraft | null>(null);
  /** Reprogramar una cita existente */
  readonly editing = input<Appointment | null>(null);
  readonly saved = output<Appointment>();
  readonly busy = output<boolean>();

  protected readonly types: AppointmentType[] = ['CONSULTATION', 'GROOMING'];
  protected readonly typeLabels = APPOINTMENT_TYPE_LABELS;
  protected readonly durations = APPOINTMENT_DURATIONS;
  protected readonly slots = timeSlots();
  protected readonly today = limaToday();
  protected readonly pet = signal<PickedPet | null>(null);
  protected readonly petMissing = signal(false);
  protected readonly overlap = signal<string | null>(null);
  private saving = false;

  protected readonly form = new FormGroup({
    type: new FormControl<AppointmentType>('CONSULTATION', { nonNullable: true }),
    day: new FormControl(this.today, { nonNullable: true, validators: [Validators.required] }),
    time: new FormControl('09:00', { nonNullable: true, validators: [Validators.required] }),
    durationMin: new FormControl(30, { nonNullable: true }),
    vetId: new FormControl<number | null>(null),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    move: transportGroup(),
  });
  /** Para la movilidad: dirección del dueño y lo que pagó la última vez */
  protected readonly clientAddress = signal('');
  protected readonly lastTransportPrice = signal<number | null>(null);
  protected readonly submitted = signal(false);

  constructor() {
    effect(() => {
      const petId = this.pet()?.petId ?? this.editing()?.pet.id;
      if (petId) untracked(() => this.loadOwner(petId));
    });
  }

  private loadOwner(petId: number): void {
    this.cardsApi.card(petId).subscribe({
      next: (card) => {
        const c = card.pet.client;
        this.clientAddress.set([c.address, c.district].filter(Boolean).join(', '));
        this.visitsApi.lastTransportPrice(c.id).subscribe({
          next: ({ price }) => this.lastTransportPrice.set(price),
          error: () => undefined,
        });
      },
      error: () => undefined,
    });
  }

  ngOnInit(): void {
    const a = this.editing();
    if (a) {
      const clock = limaClock(a.startsAt);
      this.form.reset({
        type: a.type,
        day: clock.day,
        time: this.slots.includes(clock.time) ? clock.time : this.slots[0],
        durationMin: a.durationMin,
        vetId: a.vet?.id ?? null,
        reason: a.reason ?? '',
        notes: a.notes ?? '',
        move: {
          transport: a.transport ?? 'NONE',
          transportAddress: a.transportAddress ?? '',
          transportPrice:
            a.transportPrice === null || a.transportPrice === undefined
              ? null
              : Number(a.transportPrice),
        },
      });
      return;
    }
    const d = this.draft();
    if (d) {
      this.form.patchValue({
        day: d.day,
        // Hoy, por defecto el próximo horario libre del reloj (no una hora que ya pasó)
        time:
          d.time && this.slots.includes(d.time)
            ? d.time
            : ((d.day === this.today ? nextSlot() : null) ?? '09:00'),
        vetId: d.vetId ?? null,
        reason: d.reason ?? '',
      });
      this.pet.set(d.pet ?? null);
    }
    this.form.valueChanges.subscribe(() => this.overlap.set(null));
  }

  protected bad(name: 'day'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  submit(allowOverlap = false): void {
    if (this.saving) return;
    const editing = this.editing();
    if (!editing && !this.pet()) {
      this.petMissing.set(true);
      return;
    }
    this.submitted.set(true);
    if (this.form.invalid || transportInvalid(this.form.controls.move)) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      vetId: v.vetId,
      startsAt: limaIso(v.day, v.time),
      durationMin: v.durationMin,
      type: v.type,
      reason: v.reason.trim() || null,
      notes: v.notes.trim() || null,
      ...transportValue(this.form.controls.move),
      ...(allowOverlap ? { allowOverlap: true } : {}),
    };
    this.saving = true;
    this.busy.emit(true);
    const request = editing
      ? this.api.update(editing.id, body)
      : this.api.create({ ...body, petId: this.pet()!.petId });
    request.subscribe({
      next: (saved) => {
        this.saving = false;
        this.busy.emit(false);
        this.toast.success(editing ? 'Cita reprogramada.' : `Cita de ${saved.pet.name} agendada.`);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.saving = false;
        this.busy.emit(false);
        if (
          error instanceof HttpErrorResponse &&
          error.status === 409 &&
          (error.error as { details?: { code?: string } })?.details?.code === 'OVERLAP'
        ) {
          this.overlap.set(apiErrorMessage(error));
          return;
        }
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
