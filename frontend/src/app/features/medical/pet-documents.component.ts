import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/auth/session.service';
import { FRONT_DESK_ROLES } from '../../core/services/clients.models';
import {
  ATTACHMENT_KIND_LABELS,
  CONSENT_TYPE_LABELS,
  Attachment,
  AttachmentKind,
  ConsentSummary,
  MAX_ATTACHMENT_MB,
  attachmentUrl,
  fileSize,
} from '../../core/services/documents.models';
import { DocumentsService } from '../../core/services/documents.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { IconName } from '../../shared/ui/icon/icons';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const KIND_ICONS: Record<AttachmentKind, IconName> = {
  PHOTO: 'image',
  LAB: 'activity',
  IMAGING: 'image',
  DOCUMENT: 'file-text',
};

/**
 * Archivos (fotos, análisis, radiografías) y consentimientos firmados de una mascota.
 * En una atención, lo que se sube queda enlazado a ella.
 */
@Component({
  selector: 'app-pet-documents',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card p-5 sm:p-6" aria-labelledby="docs-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="docs-title" class="font-display text-lg font-semibold text-slate-900">
            Archivos y consentimientos
          </h2>
          <p class="mt-0.5 text-sm text-slate-500">
            Fotos, análisis y radiografías (JPG, PNG o PDF de hasta {{ maxMb }} MB).
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          @if (canSign()) {
            <a
              [routerLink]="['/mascotas', petId(), 'consentimiento']"
              [queryParams]="visitId() ? { atencion: visitId() } : {}"
              class="btn btn-secondary h-10"
            >
              <app-icon name="pen-line" class="size-4" /> Consentimiento
            </a>
          }
          @if (canEdit() && !uploading()) {
            <button type="button" class="btn btn-secondary h-10" (click)="openUpload()">
              <app-icon name="upload" class="size-4" /> Subir archivo
            </button>
          }
        </div>
      </div>

      @if (uploading()) {
        <form
          class="mt-4 space-y-4 rounded-2xl bg-slate-50/70 p-4 ring-1 ring-slate-200"
          (submit)="$event.preventDefault(); upload()"
          novalidate
        >
          <label
            class="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors"
            [class]="
              dragging()
                ? 'border-anil-500 bg-anil-50'
                : file()
                  ? 'border-emerald-300 bg-white'
                  : 'border-slate-300 bg-white hover:border-anil-400'
            "
            (dragover)="$event.preventDefault(); dragging.set(true)"
            (dragleave)="dragging.set(false)"
            (drop)="drop($event)"
          >
            <input
              type="file"
              class="sr-only"
              [attr.accept]="accept"
              (change)="pick($any($event.target).files)"
            />
            @if (file(); as f) {
              <app-icon name="check" class="size-6 text-emerald-600" />
              <span class="font-medium text-slate-900">{{ f.name }}</span>
              <span class="text-xs text-slate-500">{{ size(f.size) }} · toca para cambiarlo</span>
            } @else {
              <app-icon name="upload" class="size-6 text-slate-400" />
              <span class="font-medium text-slate-700"
                >Arrastra el archivo o toca para elegirlo</span
              >
              <span class="text-xs text-slate-500"
                >En el celular puedes tomar la foto directamente</span
              >
            }
          </label>
          @if (fileError(); as error) {
            <p class="field-error" role="alert">{{ error }}</p>
          }
          <div class="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div>
              <label for="doc-kind" class="field-label">Tipo</label>
              <select id="doc-kind" class="field-input" [formControl]="kind">
                @for (k of kinds; track k) {
                  <option [value]="k">{{ kindLabels[k] }}</option>
                }
              </select>
            </div>
            <div>
              <label for="doc-title" class="field-label"
                >Título <span class="text-rose-600" aria-hidden="true">*</span></label
              >
              <input
                id="doc-title"
                class="field-input"
                [formControl]="title"
                maxlength="150"
                autocomplete="off"
                placeholder="Ej.: Hemograma 29/10, Rx tórax lateral"
                [attr.aria-invalid]="title.invalid && title.touched"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-secondary" (click)="uploading.set(false)">
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              @if (saving()) {
                <app-icon name="loader" class="size-4 animate-spin" />
              }
              Subir
            </button>
          </div>
        </form>
      }

      <!-- Archivos -->
      @if (activeFiles().length) {
        <ul class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list">
          @for (a of activeFiles(); track a.id) {
            <li class="group relative overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
              <button
                type="button"
                class="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anil-600"
                (click)="view(a)"
                [attr.aria-label]="'Ver ' + a.title"
              >
                <span class="grid aspect-[4/3] place-items-center overflow-hidden bg-slate-50">
                  @if (isImage(a)) {
                    <img
                      [src]="url(a.id)"
                      alt=""
                      loading="lazy"
                      class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  } @else {
                    <span class="flex flex-col items-center gap-1 text-slate-400">
                      <app-icon [name]="kindIcons[a.kind]" class="size-8" />
                      <span class="text-xs font-semibold">PDF</span>
                    </span>
                  }
                </span>
                <span class="block px-3 py-2">
                  <span class="block truncate text-sm font-medium text-slate-900">{{
                    a.title
                  }}</span>
                  <span class="block truncate text-xs text-slate-500">
                    {{ kindLabels[a.kind] }} · {{ a.createdAt | fecha }}
                  </span>
                </span>
              </button>
              @if (canVoid(a)) {
                <button
                  type="button"
                  class="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-white/90 text-slate-500 opacity-0 ring-1 ring-slate-200 transition-opacity group-hover:opacity-100 hover:text-rose-600 focus-visible:opacity-100 max-sm:opacity-100"
                  [attr.aria-label]="'Anular ' + a.title"
                  (click)="askVoid(a)"
                >
                  <app-icon name="trash" class="size-4" />
                </button>
              }
            </li>
          }
        </ul>
      }

      <!-- Consentimientos -->
      @if (consents().length) {
        <h3 class="mt-6 text-sm font-semibold text-slate-900">Consentimientos firmados</h3>
        <ul class="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200" role="list">
          @for (c of consents(); track c.id) {
            <li>
              <a
                [routerLink]="['/consentimientos', c.id]"
                class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <app-icon name="pen-line" class="size-4 shrink-0 text-anil-600" />
                <span class="min-w-0 flex-1">
                  <span
                    class="block text-sm font-medium text-slate-900"
                    [class.line-through]="c.voidedAt"
                  >
                    {{ typeLabels[c.type] }}: {{ c.procedure }}
                  </span>
                  <span class="block text-xs text-slate-500">
                    {{ c.code }} · firmó {{ c.signerName }} · {{ c.signedAt | fecha: 'datetime' }}
                    @if (c.voidedAt) {
                      · anulado
                    }
                  </span>
                </span>
                <app-icon name="chevron-right" class="size-4 shrink-0 text-slate-400" />
              </a>
            </li>
          }
        </ul>
      }

      @if (!activeFiles().length && !consents().length && !uploading()) {
        <p
          class="mt-4 rounded-xl bg-slate-50 px-4 py-5 text-center text-sm text-slate-500 ring-1 ring-slate-200"
        >
          Sin archivos ni consentimientos todavía.
        </p>
      }
    </section>

    <!-- Visor de imagen -->
    <app-modal
      [open]="!!viewing()"
      [title]="viewing()?.title ?? 'Archivo'"
      (closed)="viewing.set(null)"
    >
      @if (viewing(); as a) {
        <img
          [src]="url(a.id)"
          [alt]="a.title"
          class="max-h-[70vh] w-full rounded-xl object-contain"
        />
        <p class="mt-3 text-sm text-slate-500">
          {{ kindLabels[a.kind] }} · subió {{ a.createdBy.fullName }} ·
          {{ a.createdAt | fecha: 'datetime' }}
        </p>
      }
      <ng-container modal-actions>
        @if (viewing(); as a) {
          <a class="btn btn-secondary" [href]="url(a.id)" target="_blank" rel="noopener">
            Abrir en otra pestaña
          </a>
        }
        <button type="button" class="btn btn-primary" (click)="viewing.set(null)">Cerrar</button>
      </ng-container>
    </app-modal>

    <!-- Anular archivo -->
    <app-modal
      [open]="!!voiding()"
      title="Anular archivo"
      description="Deja de mostrarse en la historia; queda registrado quién lo anuló y por qué."
      [dismissible]="false"
      (closed)="voiding.set(null)"
    >
      <form id="void-doc-form" (submit)="$event.preventDefault(); confirmVoid()" novalidate>
        <label for="void-doc-reason" class="field-label"
          >Motivo <span class="text-rose-600" aria-hidden="true">*</span></label
        >
        <input
          id="void-doc-reason"
          class="field-input"
          [formControl]="reason"
          maxlength="200"
          autocomplete="off"
          [attr.aria-invalid]="reason.invalid && reason.touched"
        />
        @if (reason.invalid && reason.touched) {
          <p class="field-error">Escribe el motivo (mínimo 3 letras)</p>
        }
      </form>
      <ng-container modal-actions>
        <button type="button" class="btn btn-secondary" (click)="voiding.set(null)">Volver</button>
        <button type="submit" form="void-doc-form" class="btn btn-danger" [disabled]="saving()">
          Anular
        </button>
      </ng-container>
    </app-modal>
  `,
})
export class PetDocumentsComponent {
  private readonly api = inject(DocumentsService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);

  readonly petId = input.required<number>();
  /** En una atención: los archivos nuevos quedan enlazados a ella */
  readonly visitId = input<number | null>(null);

  protected readonly maxMb = MAX_ATTACHMENT_MB;
  protected readonly accept = ACCEPT.join(',');
  protected readonly kinds = Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[];
  protected readonly kindLabels = ATTACHMENT_KIND_LABELS;
  protected readonly kindIcons = KIND_ICONS;
  protected readonly typeLabels = CONSENT_TYPE_LABELS;
  protected readonly url = attachmentUrl;
  protected readonly size = fileSize;

  protected readonly canEdit = computed(() =>
    FRONT_DESK_ROLES.includes(this.session.role() ?? 'CASHIER'),
  );
  protected readonly canSign = computed(() => ['ADMIN', 'VET'].includes(this.session.role() ?? ''));

  protected readonly files = signal<Attachment[]>([]);
  protected readonly consents = signal<ConsentSummary[]>([]);
  protected readonly activeFiles = computed(() => this.files().filter((a) => !a.voidedAt));

  protected readonly uploading = signal(false);
  protected readonly dragging = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly kind = new FormControl<AttachmentKind>('LAB', { nonNullable: true });
  protected readonly title = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(150)],
  });
  protected readonly viewing = signal<Attachment | null>(null);
  protected readonly voiding = signal<Attachment | null>(null);
  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    effect(() => {
      const petId = this.petId();
      this.api.attachments(petId).subscribe({
        next: (list) => this.files.set(list),
        error: () => this.files.set([]),
      });
      this.api.consents(petId).subscribe({
        next: (list) => this.consents.set(list),
        error: () => this.consents.set([]),
      });
    });
  }

  protected isImage(a: Attachment): boolean {
    return a.mime.startsWith('image/');
  }

  protected canVoid(a: Attachment): boolean {
    return this.session.role() === 'ADMIN' || a.createdBy.id === this.session.user()?.id;
  }

  protected openUpload(): void {
    this.file.set(null);
    this.fileError.set(null);
    this.title.reset('');
    this.uploading.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.pick(event.dataTransfer?.files ?? null);
  }

  protected pick(files: FileList | null): void {
    const f = files?.[0];
    if (!f) return;
    if (!ACCEPT.includes(f.type)) {
      this.fileError.set('Solo fotos (JPG, PNG, WebP) o PDF.');
      return;
    }
    if (f.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      this.fileError.set(
        `El archivo pesa ${fileSize(f.size)}: el máximo es ${MAX_ATTACHMENT_MB} MB.`,
      );
      return;
    }
    this.fileError.set(null);
    this.file.set(f);
    this.kind.setValue(f.type === 'application/pdf' ? 'LAB' : 'PHOTO');
    if (!this.title.value) this.title.setValue(f.name.replace(/\.[^.]+$/, '').slice(0, 150));
  }

  protected upload(): void {
    const f = this.file();
    if (!f) {
      this.fileError.set('Elige el archivo.');
      return;
    }
    if (this.title.invalid) {
      this.title.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.api
      .upload(this.petId(), {
        file: f,
        kind: this.kind.value,
        title: this.title.value.trim(),
        visitId: this.visitId() ?? undefined,
      })
      .subscribe({
        next: (a) => {
          this.saving.set(false);
          this.uploading.set(false);
          this.files.update((list) => [a, ...list]);
          this.toast.success('Archivo agregado a la historia.');
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }

  protected view(a: Attachment): void {
    if (this.isImage(a)) this.viewing.set(a);
    else window.open(attachmentUrl(a.id), '_blank', 'noopener');
  }

  protected askVoid(a: Attachment): void {
    this.reason.reset('');
    this.voiding.set(a);
  }

  protected confirmVoid(): void {
    const a = this.voiding();
    if (!a || this.saving()) return;
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }
    this.saving.set(true);
    this.api.voidAttachment(a.id, this.reason.value.trim()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.voiding.set(null);
        this.files.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
        this.toast.success('Archivo anulado.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toast.error(apiErrorMessage(error));
      },
    });
  }
}
