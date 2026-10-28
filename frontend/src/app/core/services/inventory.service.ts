import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ControlledMovement,
  InventoryAlerts,
  Movement,
  OutflowInput,
  Presentation,
  PresentationInput,
  ProductCategory,
  ProductDetail,
  ProductInput,
  ProductPage,
  PurchaseInput,
  StockFilter,
} from './inventory.models';

export interface ProductQuery {
  q?: string;
  category?: ProductCategory | null;
  filter?: StockFilter;
  status?: 'active' | 'inactive' | 'all';
  page?: number;
}

/** Inventario: productos, presentaciones, lotes y kardex. */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);

  list(query: ProductQuery): Observable<ProductPage> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.category) params = params.set('category', query.category);
    if (query.filter && query.filter !== 'all') params = params.set('filter', query.filter);
    if (query.status && query.status !== 'active') params = params.set('status', query.status);
    if (query.page && query.page > 1) params = params.set('page', query.page);
    return this.http.get<ProductPage>('/api/inventory/products', { params });
  }

  get(id: number): Observable<ProductDetail> {
    return this.http.get<ProductDetail>(`/api/inventory/products/${id}`);
  }

  create(
    product: ProductInput & { presentations: PresentationInput[] },
  ): Observable<ProductDetail> {
    return this.http.post<ProductDetail>('/api/inventory/products', product);
  }

  update(
    id: number,
    changes: Partial<ProductInput> & { active?: boolean },
  ): Observable<ProductDetail> {
    return this.http.patch<ProductDetail>(`/api/inventory/products/${id}`, changes);
  }

  addPresentation(productId: number, presentation: PresentationInput): Observable<Presentation> {
    return this.http.post<Presentation>(
      `/api/inventory/products/${productId}/presentations`,
      presentation,
    );
  }

  updatePresentation(
    id: number,
    changes: Partial<PresentationInput> & { active?: boolean },
  ): Observable<Presentation> {
    return this.http.patch<Presentation>(`/api/inventory/presentations/${id}`, changes);
  }

  purchase(productId: number, purchase: PurchaseInput): Observable<ProductDetail> {
    return this.http.post<ProductDetail>(
      `/api/inventory/products/${productId}/purchases`,
      purchase,
    );
  }

  outflow(productId: number, outflow: OutflowInput): Observable<ProductDetail> {
    return this.http.post<ProductDetail>(`/api/inventory/products/${productId}/outflows`, outflow);
  }

  count(
    productId: number,
    count: { reason: string; items: { batchId: number; counted: number }[] },
  ): Observable<ProductDetail> {
    return this.http.post<ProductDetail>(`/api/inventory/products/${productId}/counts`, count);
  }

  movements(
    productId: number,
    page = 1,
  ): Observable<{ items: Movement[]; total: number; page: number; pageSize: number }> {
    return this.http.get<{ items: Movement[]; total: number; page: number; pageSize: number }>(
      `/api/inventory/products/${productId}/movements`,
      { params: page > 1 ? { page } : {} },
    );
  }

  alerts(): Observable<InventoryAlerts> {
    return this.http.get<InventoryAlerts>('/api/inventory/alerts');
  }

  controlled(from?: string, to?: string): Observable<ControlledMovement[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<ControlledMovement[]>('/api/inventory/controlled', { params });
  }
}
