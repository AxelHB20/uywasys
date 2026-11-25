import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ControlReport,
  InventoryReport,
  MarginReport,
  MonthSummary,
  SalesReport,
} from './reports.models';

/** Reportes del negocio (solo el administrador). */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  /** Inicio del administrador: el mes en curso contra el anterior al mismo día */
  month(): Observable<MonthSummary> {
    return this.http.get<MonthSummary>('/api/reports/month');
  }

  sales(from: string, to: string): Observable<SalesReport> {
    return this.http.get<SalesReport>('/api/reports/sales', { params: { from, to } });
  }

  margin(from: string, to: string): Observable<MarginReport> {
    return this.http.get<MarginReport>('/api/reports/margin', { params: { from, to } });
  }

  control(from: string, to: string): Observable<ControlReport> {
    return this.http.get<ControlReport>('/api/reports/control', { params: { from, to } });
  }

  inventory(): Observable<InventoryReport> {
    return this.http.get<InventoryReport>('/api/reports/inventory');
  }
}
