import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  REPORT_PRESETS,
  ReportPeriod,
  ReportPreset,
  rangeIssue,
  reportRange,
} from '../../core/services/reports.models';
import { limaToday } from '../../shared/utils/dates';

/** Cómo se escribe cada período en la dirección (?periodo=30-dias) */
const SLUGS: Record<ReportPreset, string> = {
  today: 'hoy',
  last7: '7-dias',
  last30: '30-dias',
  month: 'este-mes',
  lastMonth: 'mes-pasado',
  last12: '12-meses',
  year: 'este-ano',
  lastYear: 'ano-pasado',
};
const BY_SLUG = new Map(REPORT_PRESETS.map((p) => [SLUGS[p], p]));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface PeriodState {
  period: ReportPeriod;
  from: string;
  to: string;
}

/**
 * El período de Reportes vive en la dirección: se comparte entre Ventas, Margen y Control, no se
 * pierde al recargar y se puede mandar el enlace. Un período rápido (“Hoy”) se guarda por su
 * nombre para que mañana siga siendo “hoy”; las fechas libres, tal cual.
 */
export function injectReportPeriod() {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const today = limaToday();
  const params = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });

  const state = computed<PeriodState>(() => {
    const q = params();
    const preset = BY_SLUG.get(q.get('periodo') ?? '');
    if (preset) return { period: preset, ...reportRange(preset, today) };
    const from = q.get('desde') ?? '';
    const to = q.get('hasta') ?? '';
    if (DATE.test(from) && DATE.test(to) && to <= today && !rangeIssue(from, to, today))
      return { period: 'custom', from, to };
    return { period: 'last30', ...reportRange('last30', today) };
  });

  function set(next: { preset: ReportPreset } | { from: string; to: string }): void {
    void router.navigate([], {
      relativeTo: route,
      queryParams:
        'preset' in next
          ? { periodo: SLUGS[next.preset], desde: null, hasta: null }
          : { periodo: null, desde: next.from, hasta: next.to },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  return { state, set, today };
}
