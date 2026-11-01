import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  AREA_LABELS,
  ActivityArea,
  ActivityItem,
  actionLabel,
  activityLink,
  describeActivity,
} from '../../core/services/activity.models';
import { ActivityService } from '../../core/services/activity.service';
import { UsersService } from '../../core/services/users.service';
import { FechaPipe } from '../../shared/pipes/fecha.pipe';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { limaDate, relativeDay } from '../../shared/utils/records';
import { formatDate } from '../../shared/utils/dates';

interface DayGroup {
  day: string;
  label: string;
  items: ActivityItem[];
}

/** Bitácora: quién hizo qué y cuándo. Lo delicado (anulaciones, ajustes, precios) se marca. */
@Component({
  selector: 'app-activity-page',
  imports: [ReactiveFormsModule, RouterLink, FechaPipe, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity.page.html',
})
export class ActivityPage {
  private readonly activity = inject(ActivityService);
  private readonly usersApi = inject(UsersService);

  protected readonly areas = Object.entries(AREA_LABELS) as [ActivityArea, string][];
  protected readonly actionLabel = actionLabel;
  protected readonly link = activityLink;
  protected readonly describe = describeActivity;

  protected readonly filters = new FormGroup({
    area: new FormControl<ActivityArea | null>(null),
    userId: new FormControl<number | null>(null),
    from: new FormControl<string | null>(null),
    to: new FormControl<string | null>(null),
    important: new FormControl(false, { nonNullable: true }),
  });
  protected readonly page = signal(1);

  private readonly values = toSignal(
    this.filters.valueChanges.pipe(
      map(() => {
        // Cambiar un filtro vuelve a la primera página
        this.page.set(1);
        return this.filters.getRawValue();
      }),
    ),
    { initialValue: this.filters.getRawValue() },
  );

  protected readonly users = rxResource({ stream: () => this.usersApi.list() });

  protected readonly list = rxResource({
    params: () => ({ ...this.values(), page: this.page() }),
    stream: ({ params }) => this.activity.list(params),
  });
  protected readonly items = computed(() => this.list.value()?.items ?? []);
  protected readonly total = computed(() => this.list.value()?.total ?? 0);
  protected readonly pages = computed(() => {
    const v = this.list.value();
    return v ? Math.max(1, Math.ceil(v.total / v.pageSize)) : 1;
  });
  protected readonly filtered = computed(() => {
    const v = this.values();
    return !!(v.area || v.userId || v.from || v.to || v.important);
  });

  /** Agrupado por día de Lima: "Hoy", "Ayer" o la fecha. */
  protected readonly groups = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const item of this.items()) {
      const day = limaDate(new Date(item.at));
      let group = groups.at(-1);
      if (!group || group.day !== day) {
        const relative = relativeDay(day);
        group = {
          day,
          label: /^\d/.test(relative) ? formatDate(item.at, 'date') : relative,
          items: [],
        };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  });

  protected who(item: ActivityItem): string {
    if (item.user) return item.user.fullName;
    // Un intento con un correo que no existe no tiene usuario
    return item.action.startsWith('auth.') ? 'Correo desconocido' : 'Sistema';
  }

  protected clear(): void {
    this.filters.reset({ area: null, userId: null, from: null, to: null, important: false });
  }
}
