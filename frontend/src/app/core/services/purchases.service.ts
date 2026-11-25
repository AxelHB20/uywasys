import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  LastCost,
  PurchaseDetail,
  PurchaseHeaderInput,
  PurchaseInput,
  PurchasePage,
  PurchaseQuery,
  Supplier,
  SupplierInput,
} from './purchases.models';

/** Compras (fichas del proveedor) y proveedores, dentro de Inventario. */
@Injectable({ providedIn: 'root' })
export class PurchasesService {
  private readonly http = inject(HttpClient);

  // ── Proveedores ──
  suppliers(query: { q?: string; all?: boolean } = {}): Observable<Supplier[]> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.all) params = params.set('all', 'true');
    return this.http.get<Supplier[]>('/api/inventory/suppliers', { params });
  }

  supplier(id: number): Observable<Supplier> {
    return this.http.get<Supplier>(`/api/inventory/suppliers/${id}`);
  }

  createSupplier(input: SupplierInput): Observable<Supplier> {
    return this.http.post<Supplier>('/api/inventory/suppliers', input);
  }

  updateSupplier(id: number, input: SupplierInput): Observable<Supplier> {
    return this.http.patch<Supplier>(`/api/inventory/suppliers/${id}`, input);
  }

  /** El primero pasa sus compras al segundo y se borra (solo el administrador) */
  mergeSupplier(id: number, intoId: number): Observable<Supplier> {
    return this.http.post<Supplier>(`/api/inventory/suppliers/${id}/merge`, { intoId });
  }

  // ── Compras ──
  list(query: PurchaseQuery): Observable<PurchasePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== null && value !== '')
        params = params.set(key, String(value));
    return this.http.get<PurchasePage>('/api/inventory/purchases', { params });
  }

  get(id: number): Observable<PurchaseDetail> {
    return this.http.get<PurchaseDetail>(`/api/inventory/purchases/${id}`);
  }

  create(input: PurchaseInput): Observable<PurchaseDetail> {
    return this.http.post<PurchaseDetail>('/api/inventory/purchases', input);
  }

  update(id: number, input: PurchaseHeaderInput): Observable<PurchaseDetail> {
    return this.http.patch<PurchaseDetail>(`/api/inventory/purchases/${id}`, input);
  }

  void(id: number, reason: string): Observable<PurchaseDetail> {
    return this.http.post<PurchaseDetail>(`/api/inventory/purchases/${id}/void`, { reason });
  }

  uploadFile(id: number, file: Blob, name: string): Observable<{ mime: string; size: number }> {
    const data = new FormData();
    data.append('file', file, name);
    return this.http.post<{ mime: string; size: number }>(
      `/api/inventory/purchases/${id}/file`,
      data,
    );
  }

  file(id: number): Observable<Blob> {
    return this.http.get(`/api/inventory/purchases/${id}/file`, { responseType: 'blob' });
  }

  removeFile(id: number): Observable<void> {
    return this.http.delete<void>(`/api/inventory/purchases/${id}/file`);
  }

  /** Registro de compras para el contador (solo el administrador) */
  excel(from: string, to: string): Observable<Blob> {
    return this.http.get('/api/inventory/purchases/excel', {
      params: { from, to },
      responseType: 'blob',
    });
  }

  lastCost(productId: number): Observable<LastCost | null> {
    return this.http.get<LastCost | null>(`/api/inventory/products/${productId}/last-cost`);
  }
}
