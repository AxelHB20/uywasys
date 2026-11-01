import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { VISIT_STATUS_LABELS, VisitStatus, VisitSummary } from '../../core/services/visits.models';
import { VisitsService } from '../../core/services/visits.service';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { SPECIES_ICONS, limaDate, petCode, relativeDay } from '../../shared/utils/records';
import { money } from '../../shared/utils/stock';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';

type Tab = 'open' | 'all';

const TONE: Record<VisitStatus, BadgeTone> = {
  OPEN: 'info',
  CLOSED: 'success',
  CANCELLED: 'neutral',
};

/** Atenciones abiertas (también las que quedaron de días anteriores) y las recientes. */
@Component({
  selector: 'app-visits-page',
  imports: [FechaPipe, RouterLink, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visits.page.html',
})
export class VisitsPage {
  private readonly visits = inject(VisitsService);

  protected readonly tab = signal<Tab>('open');
  protected readonly page = signal(1);
  protected readonly labels = VISIT_STATUS_LABELS;
  protected readonly tone = TONE;
  protected readonly icons = SPECIES_ICONS;
  protected readonly money = money;
  protected readonly petCode = petCode;

  protected readonly list = rxResource({
    params: () => ({ tab: this.tab(), page: this.page() }),
    stream: ({ params }) =>
      this.visits.list({
        status: params.tab === 'open' ? 'OPEN' : undefined,
        page: params.page,
      }),
  });
  protected readonly items = computed(() => this.list.value()?.items ?? []);
  protected readonly pages = computed(() => {
    const v = this.list.value();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  private readonly today = limaDate(new Date());

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.page.set(1);
  }

  /** "Hoy", "Ayer" o la fecha: una abierta de otro día se nota. */
  protected day(v: VisitSummary): string {
    return relativeDay(limaDate(new Date(v.openedAt)));
  }

  protected isOld(v: VisitSummary): boolean {
    return v.status === 'OPEN' && limaDate(new Date(v.openedAt)) !== this.today;
  }
}
