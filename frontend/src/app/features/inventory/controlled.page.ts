import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ControlledMovement, MOVEMENT_LABELS } from '../../core/services/inventory.models';
import { InventoryService } from '../../core/services/inventory.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { limaDate } from '../../shared/utils/records';
import { formatQty, unitLabel } from '../../shared/utils/stock';
import { apiErrorMessage } from '../../shared/utils/validators';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

/** Libro de medicamentos controlados: qué se usó, en quién, quién lo indicó y con qué receta. */
@Component({
  selector: 'app-controlled-page',
  imports: [FechaPipe, ReactiveFormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './controlled.page.html',
})
export class ControlledPage {
  private readonly inventory = inject(InventoryService);

  protected readonly labels = MOVEMENT_LABELS;
  protected readonly rows = signal<ControlledMovement[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly range = new FormGroup({
    from: new FormControl(limaDate(new Date(Date.now() - 30 * 86_400_000)), { nonNullable: true }),
    to: new FormControl(limaDate(new Date()), { nonNullable: true }),
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    const { from, to } = this.range.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.inventory.controlled(from || undefined, to || undefined).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(apiErrorMessage(error, 'No se pudo cargar el libro.'));
        this.loading.set(false);
      },
    });
  }

  protected qty(m: ControlledMovement): string {
    const value = Math.abs(m.quantity);
    return `${m.quantity > 0 ? '+' : '−'}${formatQty(value)} ${unitLabel(m.product.baseUnit, value)}`;
  }

  protected print(): void {
    window.print();
  }
}
