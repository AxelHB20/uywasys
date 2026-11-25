import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, finalize, firstValueFrom, of } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { BASE_UNIT_LABELS } from '../../core/services/inventory.models';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  PurchaseDetail,
  PurchaseDocType,
  PurchaseLineView,
} from '../../core/services/purchases.models';
import { PurchasesService } from '../../core/services/purchases.service';
import { BackLinkComponent } from '../../shared/ui/back-link/back-link.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { formatDate, limaToday } from '../../shared/utils/dates';
import { shrinkImage } from '../../shared/utils/image';
import { loaded } from '../../shared/utils/resource';
import { formatQty, money } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';

/** Detalle de una compra: la ficha tal como se registró, su foto, corregir el comprobante o anularla. */
@Component({
  selector: 'app-purchase-detail-page',
  imports: [ReactiveFormsModule, RouterLink, BackLinkComponent, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-detail.page.html',
})
export class PurchaseDetailPage {
  private readonly api = inject(PurchasesService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  readonly id = input.required<string>();

  protected readonly docTypes = DOC_TYPES;
  protected readonly docLabels = DOC_TYPE_LABELS;
  protected readonly money = money;
  protected readonly today = limaToday();

  protected readonly purchase = rxResource({
    params: () => ({ id: Number(this.id()) }),
    stream: ({ params }) => this.api.get(params.id),
  });
  /** La compra mostrada; se reemplaza con lo que devuelve el servidor tras corregir o anular */
  private readonly override = signal<PurchaseDetail | null>(null);
  protected readonly p = computed(() => this.override() ?? loaded(this.purchase)() ?? null);

  protected readonly suppliersRes = rxResource({
    params: () => (this.modal() === 'edit' ? true : undefined),
    stream: () => this.api.suppliers().pipe(catchError(() => of([]))),
  });
  protected readonly suppliers = computed(() => loaded(this.suppliersRes)() ?? []);

  protected readonly modal = signal<'edit' | 'void' | null>(null);
  protected readonly saving = signal(false);
  protected readonly tried = signal(false);
  protected readonly modalError = signal<string | null>(null);

  /** Quien la registró o el administrador pueden anularla */
  protected readonly canVoid = computed(() => {
    const p = this.p();
    const user = this.session.user();
    return !!p?.canVoid && (user?.role === 'ADMIN' || user?.id === p.createdBy.id);
  });

  // ── Foto de la ficha ──
  protected readonly fileUrl = signal<string | null>(null);
  protected readonly fileLoading = signal(false);
  protected readonly uploading = signal(false);
  /** Qué foto ya se pidió (no se vuelve a pedir si falló) */
  private fileKey: string | null = null;

  protected readonly editForm = new FormGroup({
    supplierId: new FormControl<number | null>(null, Validators.required),
    docType: new FormControl<PurchaseDocType>('FACTURA', { nonNullable: true }),
    docNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(30)],
    }),
    issuedAt: new FormControl('', { nonNullable: true, validators: Validators.required }),
    notes: new FormControl('', { nonNullable: true, validators: Validators.maxLength(300) }),
  });
  protected readonly voidReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
  });

  constructor() {
    // La foto se trae como archivo (lleva la sesión) y se muestra con un enlace local
    effect(() => {
      const p = this.p();
      const key = p?.file ? `${p.id}:${p.file.size}` : null;
      if (key && key !== this.fileKey) {
        this.fileKey = key;
        void this.loadFile(p!.id);
      }
      if (!key) this.fileKey = null;
    });
    inject(DestroyRef).onDestroy(() => this.revokeFile());
  }

  protected title(p: PurchaseDetail): string {
    return `${this.docLabels[p.docType]} ${p.docNumber}`;
  }

  protected date(value: string | null, style: 'calendar' | 'datetime' = 'calendar'): string {
    return formatDate(value, style);
  }

  protected units(l: PurchaseLineView, value: number): string {
    const [one, many] = BASE_UNIT_LABELS[l.product.baseUnit];
    return `${formatQty(value)} ${value === 1 ? one : many}`;
  }

  /** "Quedan 480 de 500 tabletas" (o nada si no se usó) */
  protected usage(l: PurchaseLineView): string | null {
    if (l.batch.quantity === l.batch.initialQuantity) return null;
    if (l.batch.quantity === 0) return `Ya se usó todo (${this.units(l, l.batch.initialQuantity)})`;
    return `Quedan ${this.units(l, l.batch.quantity)} de ${formatQty(l.batch.initialQuantity)}`;
  }

  protected qty(value: number): string {
    return formatQty(value);
  }

  // ── Corregir comprobante ──

  protected openEdit(): void {
    const p = this.p();
    if (!p) return;
    this.editForm.reset({
      supplierId: p.supplier.id,
      docType: p.docType,
      docNumber: p.docNumber,
      issuedAt: p.issuedAt,
      notes: p.notes ?? '',
    });
    this.tried.set(false);
    this.modalError.set(null);
    this.modal.set('edit');
  }

  protected saveEdit(): void {
    const p = this.p();
    this.tried.set(true);
    this.editForm.markAllAsTouched();
    if (!p || this.editForm.invalid || this.saving()) return;
    const v = this.editForm.getRawValue();
    this.saving.set(true);
    this.modalError.set(null);
    this.api
      .update(p.id, {
        supplierId: Number(v.supplierId),
        docType: v.docType,
        docNumber: v.docNumber.trim(),
        issuedAt: v.issuedAt,
        notes: v.notes.trim() || null,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => {
          this.override.set(updated);
          this.modal.set(null);
          this.toast.success('Comprobante corregido');
        },
        error: (error) =>
          this.modalError.set(apiErrorMessage(error, 'No se pudo corregir el comprobante')),
      });
  }

  // ── Anular ──

  protected openVoid(): void {
    this.voidReason.reset('');
    this.tried.set(false);
    this.modalError.set(null);
    this.modal.set('void');
  }

  protected confirmVoid(): void {
    const p = this.p();
    this.tried.set(true);
    if (!p || this.voidReason.invalid || this.saving()) return;
    this.saving.set(true);
    this.modalError.set(null);
    this.api
      .void(p.id, this.voidReason.value.trim())
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => {
          this.override.set(updated);
          this.modal.set(null);
          this.toast.success(`Compra ${updated.code} anulada: su stock salió del inventario`);
        },
        error: (error) =>
          this.modalError.set(apiErrorMessage(error, 'No se pudo anular la compra')),
      });
  }

  protected closeModal(): void {
    if (!this.saving()) this.modal.set(null);
  }

  // ── Foto ──

  protected async upload(event: Event): Promise<void> {
    const p = this.p();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!p || !file) return;
    if (!/^image\/|^application\/pdf$/.test(file.type)) {
      this.toast.error('Sube una foto o un PDF');
      return;
    }
    this.uploading.set(true);
    try {
      const shrunk = await shrinkImage(file);
      const meta = await firstValueFrom(this.api.uploadFile(p.id, shrunk.blob, shrunk.name));
      this.revokeFile();
      this.override.set({ ...p, file: meta, hasFile: true });
      this.toast.success('Foto de la ficha guardada');
    } catch (error) {
      this.toast.error(apiErrorMessage(error, 'No se pudo subir la foto'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected removeFile(): void {
    const p = this.p();
    if (!p) return;
    this.api.removeFile(p.id).subscribe({
      next: () => {
        this.revokeFile();
        this.override.set({ ...p, file: null, hasFile: false });
        this.toast.success('Foto quitada');
      },
      error: (error) => this.toast.error(apiErrorMessage(error, 'No se pudo quitar la foto')),
    });
  }

  private async loadFile(id: number): Promise<void> {
    this.fileLoading.set(true);
    try {
      const blob = await firstValueFrom(this.api.file(id));
      this.fileUrl.set(URL.createObjectURL(blob));
    } catch {
      this.fileUrl.set(null);
    } finally {
      this.fileLoading.set(false);
    }
  }

  private revokeFile(): void {
    const url = this.fileUrl();
    if (url) URL.revokeObjectURL(url);
    this.fileUrl.set(null);
  }
}
