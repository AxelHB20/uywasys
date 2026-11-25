import { ROLE_LABELS, Role } from '../auth/auth.models';
import { money } from '../../shared/utils/stock';
import { METHOD_LABELS, PaymentMethod } from './cash.models';

import { IconName } from '../../shared/ui/icon/icons';

export type ActivityArea =
  | 'access'
  | 'cash'
  | 'care'
  | 'billing'
  | 'hospitalization'
  | 'lab'
  | 'clients'
  | 'inventory'
  | 'settings';

/** En el orden de los botones del filtro */
export const AREA_LABELS: Record<ActivityArea, string> = {
  cash: 'Caja',
  care: 'Atenciones',
  billing: 'Facturación',
  hospitalization: 'Hospitalización',
  lab: 'Exámenes',
  inventory: 'Inventario',
  clients: 'Clientes',
  access: 'Accesos',
  settings: 'Configuración',
};

/** Grupos de "Para revisar" (los arma el servidor) */
export type ReviewKind =
  'closings' | 'voids' | 'prices' | 'stock' | 'access' | 'billing' | 'people';

export interface ActivityReview {
  from: string;
  to: string;
  total: number;
  kinds: { kind: ReviewKind; count: number }[];
}

export const REVIEW_LABELS: Record<
  ReviewKind,
  { one: string; many: string; hint: string; icon: IconName; tone: string }
> = {
  closings: {
    one: 'cierre con diferencia',
    many: 'cierres con diferencia',
    hint: 'sobró o faltó en caja',
    icon: 'banknote',
    tone: 'bg-emerald-50 text-emerald-700',
  },
  voids: {
    one: 'anulación',
    many: 'anulaciones',
    hint: 'cobros, cargos, recetas…',
    icon: 'ban',
    tone: 'bg-rose-50 text-rose-700',
  },
  prices: {
    one: 'cambio de precio',
    many: 'cambios de precio',
    hint: 'catálogo y movilidad',
    icon: 'tag',
    tone: 'bg-anil-50 text-anil-700',
  },
  stock: {
    one: 'ajuste de stock',
    many: 'ajustes de stock',
    hint: 'conteos y mermas',
    icon: 'package',
    tone: 'bg-orange-50 text-orange-700',
  },
  access: {
    one: 'acceso fallido',
    many: 'accesos fallidos',
    hint: 'contraseña incorrecta o bloqueo',
    icon: 'key-round',
    tone: 'bg-slate-100 text-slate-700',
  },
  billing: {
    one: 'cambio en facturación',
    many: 'cambios en facturación',
    hint: 'correcciones y configuración',
    icon: 'receipt',
    tone: 'bg-sky-50 text-sky-700',
  },
  people: {
    one: 'cambio de usuarios o datos',
    many: 'cambios de usuarios o datos',
    hint: 'desactivar, contraseñas, unir',
    icon: 'user-cog',
    tone: 'bg-slate-100 text-slate-700',
  },
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
  /** La cuenta de soporte llega como "Soporte Uywa" (support: true) */
  user: { id: number; fullName: string; support?: boolean } | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  /** Hay más registros que el tope que cuenta el servidor (10 000) */
  totalCapped?: boolean;
  page: number;
  pageSize: number;
}

export interface ActivityFilters {
  area?: ActivityArea | null;
  userId?: number | null;
  from?: string | null;
  to?: string | null;
  important?: boolean;
  kind?: ReviewKind | null;
  page?: number;
}

/** Qué pasó, dicho como lo diría el dueño. Una acción nueva sin texto se muestra con su código. */
export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inició sesión',
  'auth.login_failed': 'Intento de ingreso con contraseña incorrecta',
  'auth.locked': 'Cuenta bloqueada por intentos fallidos',
  'auth.password_change': 'Cambió su contraseña',
  'auth.reset_requested': 'Pidió recuperar su contraseña por correo',
  'auth.password_reset': 'Creó una contraseña nueva con el enlace del correo',
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
  'portal.link_create': 'Generó el enlace del portal del dueño',
  'portal.link_revoke': 'Desactivó el enlace del portal del dueño',
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
  'purchase.create': 'Registró una compra (ficha del proveedor)',
  'purchase.update': 'Corrigió el comprobante de una compra',
  'purchase.void': 'Anuló una compra',
  'purchase.file': 'Guardó la foto de una ficha de compra',
  'purchase.file_remove': 'Quitó la foto de una ficha de compra',
  'supplier.create': 'Agregó un proveedor',
  'supplier.update': 'Editó un proveedor',
  'supplier.merge': 'Unió dos proveedores repetidos',
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
  'clinic.hours_update': 'Cambió el horario de atención',
  'billing.settings_update': 'Cambió la configuración de facturación',
  'billing.token_update': 'Actualizó la conexión con el facturador',
  'billing.retry': 'Reintentó enviar un comprobante a SUNAT',
  'billing.retry_all': 'Reintentó enviar los comprobantes con error',
  'billing.to_factura': 'Cambió una boleta a factura',
  'billing.reissue': 'Corrigió un comprobante rechazado',
  'hospitalization.admit': 'Internó a una mascota',
  'hospitalization.order': 'Indicó un tratamiento de internamiento',
  'hospitalization.order_stop': 'Suspendió una indicación de internamiento',
  'hospitalization.discharge': 'Dio de alta a una mascota internada',
  'lab.order': 'Pidió exámenes',
  'lab.result': 'Registró el resultado de un examen',
  'lab.review': 'Revisó el resultado de un examen',
  'lab.cancel': 'Canceló un examen',
  'charge.transport_price': 'Cambió el precio de la movilidad',
  'queue.transport': 'Cambió la movilidad de una consulta',
  'queue.delivered_home': 'Entregó una mascota en casa',
  'grooming.transport': 'Cambió la movilidad de un grooming',
};

/** Ícono y color de cada área, para ubicarse rápido en la lista */
const AREA_ICONS: { prefixes: string[]; icon: IconName; tone: string }[] = [
  { prefixes: ['auth'], icon: 'key-round', tone: 'bg-slate-100 text-slate-700' },
  { prefixes: ['cash', 'sale'], icon: 'banknote', tone: 'bg-emerald-50 text-emerald-700' },
  { prefixes: ['billing'], icon: 'receipt', tone: 'bg-sky-50 text-sky-700' },
  { prefixes: ['hospitalization'], icon: 'bed', tone: 'bg-pink-50 text-pink-700' },
  { prefixes: ['lab'], icon: 'flask', tone: 'bg-violet-50 text-violet-700' },
  { prefixes: ['grooming'], icon: 'scissors', tone: 'bg-anil-50 text-anil-700' },
  { prefixes: ['queue'], icon: 'truck', tone: 'bg-anil-50 text-anil-700' },
  {
    prefixes: ['client', 'pet', 'portal'],
    icon: 'clients',
    tone: 'bg-teal-50 text-teal-700',
  },
  {
    prefixes: ['product', 'stock', 'purchase', 'supplier'],
    icon: 'package',
    tone: 'bg-orange-50 text-orange-700',
  },
  {
    prefixes: ['clinic', 'user', 'service'],
    icon: 'settings',
    tone: 'bg-slate-100 text-slate-700',
  },
];

export function activityIcon(item: Pick<ActivityItem, 'action' | 'user'>): {
  icon: IconName;
  tone: string;
} {
  if (item.user?.support && !item.action.startsWith('auth.'))
    return { icon: 'shield-check', tone: 'bg-anil-50 text-anil-800' };
  if (item.action === 'charge.transport_price')
    return { icon: 'truck', tone: 'bg-anil-50 text-anil-700' };
  const prefix = item.action.split('.')[0];
  return (
    AREA_ICONS.find((a) => a.prefixes.includes(prefix)) ?? {
      icon: 'stethoscope',
      tone: 'bg-anil-50 text-anil-700',
    }
  );
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Lo que hace soporte se dice simple, sin detalles técnicos: "Ajuste técnico en facturación" */
const SUPPORT_AREAS: Record<string, string> = {
  billing: 'en facturación',
  clinic: 'en la configuración de la clínica',
  user: 'en usuarios',
  service: 'en servicios y precios',
  product: 'en inventario',
  stock: 'en inventario',
};

function isSupportChange(item: Pick<ActivityItem, 'action' | 'user'>): boolean {
  return !!item.user?.support && !item.action.startsWith('auth.');
}

/** El título de la fila: la acción en palabras, o el ajuste de soporte dicho simple */
export function activityTitle(item: Pick<ActivityItem, 'action' | 'user'>): string {
  if (isSupportChange(item)) {
    const area = SUPPORT_AREAS[item.action.split('.')[0]];
    return area ? `Ajuste técnico ${area}` : 'Ajuste técnico';
  }
  return actionLabel(item.action);
}

/** Las líneas de detalle; lo de soporte no lleva detalle técnico */
/**
 * La conexión de un ingreso, limpia: sin el prefijo "::ffff:" y nada si es una dirección interna
 * (red del servidor o de la clínica), que no le dice nada al dueño.
 */
export function activityIp(item: Pick<ActivityItem, 'ip' | 'action'>): string | null {
  if (!item.ip || !item.action.startsWith('auth.')) return null;
  const ip = item.ip.replace(/^::ffff:/i, '');
  const internal =
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
    /^(::1$|f[cd]|fe80:)/i.test(ip);
  return internal ? null : ip;
}

export function activityLines(item: Pick<ActivityItem, 'action' | 'user' | 'data'>): string[] {
  return isSupportChange(item) ? [] : describeActivity(item.data);
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
    case 'Client':
      return ['/clientes', id];
    case 'pet':
      return ['/mascotas', id];
    case 'appointment':
      return ['/citas'];
    case 'grooming':
      return ['/grooming'];
    case 'queue':
      return ['/cola'];
    case 'cash_session':
      // El reporte de cierre existe cuando la caja se cerró
      return item.action === 'cash.open' ? ['/caja'] : ['/caja/cierres', id];
    case 'cash_movement':
      return ['/caja'];
    case 'estimate':
      return ['/presupuestos', id];
    case 'hospitalization':
      return ['/hospitalizacion', id];
    case 'labOrder':
      return ['/examenes'];
    case 'electronic_document':
      return ['/comprobantes'];
    case 'prescription':
      return ['/recetas', id];
    case 'consent':
      return ['/consentimientos', id];
    case 'clinic':
      // La configuración de facturación la ve solo soporte
      return item.action.startsWith('billing.') ? null : ['/configuracion'];
    case 'visit':
      return ['/atenciones', id];
    case 'receipt':
      return ['/caja/tickets', id];
    case 'product':
      return ['/inventario', id];
    case 'purchase':
      return ['/inventario/compras', id];
    case 'supplier':
      return ['/inventario/proveedores'];
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
  comprobante: 'Comprobante',
  comprobantes: 'Comprobantes',
  boleta: 'Boleta',
  factura: 'Factura',
  razonSocial: 'Razón social',
  rechazado: 'Rechazado',
  nuevo: 'Nuevo',
  documento: 'Documento',
  nombre: 'Nombre',
  proveedor: 'Proveedor',
  activa: 'Activa',
  produccion: 'Producción (envía a SUNAT)',
  series: 'Series',
  tokenCambiado: 'Token cambiado',
  days: 'Días internado',
  outcome: 'Salida',
  transport: 'Movilidad',
  charged: 'Se cobró',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  outcome: { DISCHARGED: 'Alta', DECEASED: 'Falleció' },
  transport: {
    NONE: 'Sin movilidad',
    PICKUP: 'Solo recojo',
    DROPOFF: 'Solo entrega',
    ROUND_TRIP: 'Recojo y entrega',
  },
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
  if (typeof v === 'string' && VALUE_LABELS[key]?.[v]) return VALUE_LABELS[key][v];
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
    if (key === 'exams' && Array.isArray(raw)) {
      if (raw.length) lines.push(`Exámenes: ${raw.join(', ')}`);
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
