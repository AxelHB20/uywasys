import { ROLE_LABELS, Role } from '../auth/auth.models';
import { money } from '../../shared/utils/stock';
import { METHOD_LABELS, PaymentMethod } from './cash.models';

export type ActivityArea = 'access' | 'cash' | 'care' | 'clients' | 'inventory' | 'settings';

export const AREA_LABELS: Record<ActivityArea, string> = {
  access: 'Accesos',
  cash: 'Caja',
  care: 'Atenciones',
  clients: 'Clientes',
  inventory: 'Inventario',
  settings: 'Configuración',
};

export interface ActivityItem {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  important: boolean;
  user: { id: number; fullName: string } | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityFilters {
  area?: ActivityArea | null;
  userId?: number | null;
  from?: string | null;
  to?: string | null;
  important?: boolean;
  page?: number;
}

/** Qué pasó, dicho como lo diría el dueño. Una acción nueva sin texto se muestra con su código. */
export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inició sesión',
  'auth.login_failed': 'Intento de ingreso con contraseña incorrecta',
  'auth.locked': 'Cuenta bloqueada por intentos fallidos',
  'auth.password_change': 'Cambió su contraseña',
  'cash.open': 'Abrió la caja',
  'cash.close': 'Cerró la caja (cuadró)',
  'cash.close_difference': 'Cerró la caja con diferencia',
  'cash.collect': 'Registró un cobro',
  'cash.receipt_void': 'Anuló un cobro',
  'cash.expense': 'Registró un egreso de caja',
  'cash.expense_void': 'Anuló un egreso de caja',
  'sale.cancel': 'Anuló una venta',
  'visit.open': 'Abrió una atención',
  'visit.close': 'Cerró una atención',
  'visit.cancel': 'Canceló una atención',
  'visit.addendum': 'Agregó una adenda a una atención cerrada',
  'immunization.create': 'Registró una vacuna o desparasitación',
  'immunization.void': 'Anuló una vacuna o desparasitación',
  'prescription.create': 'Emitió una receta',
  'prescription.void': 'Anuló una receta',
  'appointment.create': 'Agendó una cita',
  'appointment.update': 'Reprogramó o editó una cita',
  'appointment.arrive': 'Marcó la llegada de una cita',
  'appointment.no_show': 'Marcó una cita como no asistió',
  'appointment.cancel': 'Canceló una cita',
  'estimate.create': 'Emitió un presupuesto',
  'estimate.accept': 'Registró la aceptación de un presupuesto',
  'estimate.reject': 'Registró el rechazo de un presupuesto',
  'estimate.convert': 'Cargó un presupuesto a la cuenta',
  'attachment.create': 'Subió un archivo a la historia clínica',
  'attachment.void': 'Anuló un archivo de la historia clínica',
  'consent.create': 'Registró un consentimiento firmado',
  'consent.void': 'Anuló un consentimiento firmado',
  'grooming.check_in': 'Registró el ingreso de una mascota a grooming',
  'grooming.status': 'Movió una mascota en el tablero de grooming',
  'grooming.assign': 'Asignó el groomer de un servicio',
  'grooming.deliver': 'Entregó una mascota de grooming',
  'grooming.cancel': 'Canceló un servicio de grooming',
  'charge.create': 'Agregó cargos a una cuenta',
  'charge.void': 'Anuló un cargo',
  'client.create': 'Registró un cliente',
  'client.update': 'Editó los datos de un cliente',
  'client.import': 'Importó clientes desde Excel',
  'client.authorized_add': 'Agregó una persona autorizada a recoger',
  'client.authorized_remove': 'Quitó una persona autorizada a recoger',
  'client.export': 'Exportó los datos de un cliente (derecho de acceso)',
  'client.anonymize': 'Anonimizó a un cliente (derecho de cancelación)',
  'pet.create': 'Registró una mascota',
  'pet.update': 'Editó los datos de una mascota',
  'product.create': 'Creó un producto',
  'product.update': 'Editó un producto',
  'product.import': 'Importó productos desde Excel',
  'product.presentation_add': 'Agregó una presentación de venta',
  'product.price_change': 'Cambió el precio de un producto',
  'stock.purchase': 'Registró una compra',
  'stock.count_adjust': 'Ajustó el stock por conteo físico',
  'stock.waste': 'Registró una merma',
  'stock.treatment': 'Registró uso interno de stock',
  'stock.shortage_resolve': 'Regularizó un insumo usado sin stock',
  'service.create': 'Creó un servicio',
  'service.update': 'Editó un servicio',
  'service.price_change': 'Cambió el precio de un servicio',
  'clinic.update': 'Editó los datos de la clínica',
  'clinic.logo_update': 'Cambió el logo de la clínica',
  'clinic.logo_remove': 'Quitó el logo de la clínica',
  'user.create': 'Creó un usuario',
  'user.update': 'Editó un usuario',
  'user.deactivate': 'Desactivó un usuario',
  'user.reset_password': 'Restableció la contraseña de un usuario',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Enlace a lo que se tocó, si tiene pantalla propia. */
export function activityLink(
  item: Pick<ActivityItem, 'entity' | 'entityId' | 'action'>,
): string[] | null {
  const id = item.entityId;
  // Un cliente anonimizado ya no tiene datos que mostrar; un ingreso no tiene nada que abrir
  if (!id || item.action === 'client.anonymize' || item.action.startsWith('auth.')) return null;
  switch (item.entity) {
    case 'client':
      return ['/clientes', id];
    case 'visit':
      return ['/atenciones', id];
    case 'receipt':
      return ['/caja/tickets', id];
    case 'product':
      return ['/inventario', id];
    case 'care_service':
      return ['/servicios'];
    case 'user':
      return ['/usuarios'];
    default:
      return null;
  }
}

const KEY_LABELS: Record<string, string> = {
  openingAmount: 'Monto inicial',
  expected: 'Esperado',
  counted: 'Contado',
  difference: 'Diferencia',
  note: 'Nota',
  code: 'Comprobante',
  cliente: 'Cliente',
  total: 'Total',
  paid: 'Pagado',
  amount: 'Monto',
  reason: 'Motivo',
  motivo: 'Motivo',
  email: 'Correo',
  rol: 'Rol',
  role: 'Rol',
  name: 'Nombre',
  fullName: 'Nombre',
  price: 'Precio',
  presentation: 'Presentación',
  factor: 'Equivalencia',
  presentations: 'Cantidad',
  units: 'Unidades',
  documentNumber: 'Comprobante de compra',
  controlled: 'Controlado',
  clients: 'Clientes',
  products: 'Productos',
  created: 'Creados',
  errors: 'Con errores',
  skipped: 'Omitidos',
  active: 'Activo',
  licenseNumber: 'Colegiatura',
  ruc: 'RUC',
  phone: 'Teléfono',
  address: 'Dirección',
  tipo: 'Tipo de archivo',
  marketingConsent: 'Acepta promociones',
  consentVersion: 'Versión del consentimiento',
};

const MONEY_KEYS = new Set([
  'openingAmount',
  'expected',
  'counted',
  'difference',
  'total',
  'paid',
  'amount',
  'price',
  'before',
  'after',
]);

/** Campos técnicos que no le dicen nada al dueño (ids, listas de ids). */
const HIDDEN_KEYS =
  /(^id$|Id$|^ids$|^batches$|^fields$|^adjustments$|^discounts$|^shortages$|^bytes$)/;

function value(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number' && MONEY_KEYS.has(key)) return money(v);
  if ((key === 'rol' || key === 'role') && typeof v === 'string' && v in ROLE_LABELS)
    return ROLE_LABELS[v as Role];
  return String(v);
}

/**
 * Los datos de cada acción en líneas legibles: "Precio: S/ 10.00 → S/ 12.00", "Motivo: …".
 * Sin ids ni nombres técnicos, y como máximo 4 líneas.
 */
export function describeActivity(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const d = data as Record<string, unknown>;
  const lines: string[] = [];

  if ('before' in d && 'after' in d) {
    lines.push(`Precio: ${value('before', d['before'])} → ${value('after', d['after'])}`);
  }
  for (const [key, raw] of Object.entries(d)) {
    if (key === 'before' || key === 'after' || HIDDEN_KEYS.test(key)) continue;
    if (key === 'payments' && Array.isArray(raw)) {
      const parts = (raw as { method: PaymentMethod; amount: number }[]).map(
        (p) => `${METHOD_LABELS[p.method] ?? p.method} ${money(p.amount)}`,
      );
      if (parts.length) lines.push(`Pagos: ${parts.join(', ')}`);
      continue;
    }
    if (key === 'charges' && Array.isArray(raw)) {
      const parts = (raw as { description: string; total: number }[]).map(
        (c) => `${c.description} (${money(c.total)})`,
      );
      if (parts.length) lines.push(parts.join(', '));
      continue;
    }
    if (Array.isArray(raw)) continue;
    const label = KEY_LABELS[key];
    if (raw && typeof raw === 'object' && 'antes' in raw && 'ahora' in raw) {
      const change = raw as { antes: unknown; ahora: unknown };
      lines.push(`${label ?? key}: ${value(key, change.antes)} → ${value(key, change.ahora)}`);
      continue;
    }
    if (raw && typeof raw === 'object') continue;
    // Un campo vacío ("Nota: —") no dice nada
    if (!label || raw === null || raw === undefined || raw === '') continue;
    lines.push(`${label}: ${value(key, raw)}`);
  }
  return lines.slice(0, 4);
}
