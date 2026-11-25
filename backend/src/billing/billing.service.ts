import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { reserveNumbers } from '../common/sequence/clinic-sequence.js';
import { clinicDay, fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  BillingProvider,
  ElectronicDocumentStatus,
} from '../generated/prisma/enums.js';
import { BillingHealthStore } from './billing-health.js';
import { documentsThisMonth, isoDay } from './billing-usage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { amountInWords } from './amount-in-words.js';
import type {
  BillingSettingsDto,
  BuyerDto,
  DocumentsQuery,
} from './billing.dto.js';
import {
  BillingProviderClient,
  DocumentLine,
  documentCode,
  OutgoingDocument,
  ProviderConfig,
  ProviderError,
} from './billing.types.js';
import { BuyerInput, buildLines, customerFor } from './document-builder.js';
import { clientSearchText } from '../common/text/search.js';
import { saleNoteCode } from '../cash/cash-math.js';
import { lookupApisperu, LookupResult } from './lookup.js';
import { NubefactProvider } from './providers/nubefact.provider.js';
import { LucodeProvider } from './providers/lucode.provider.js';
import { MifactProvider } from './providers/mifact.provider.js';
import { SimulatedProvider } from './providers/simulated.provider.js';
import { SecretBox } from './secret-box.js';

type Tx = Prisma.TransactionClient;
const PAGE_SIZE = 50;

/** YYYY-MM-DD del formulario → fecha de la base (nulo si viene vacío) */
const dbDay = (day: string | null | undefined): Date | null =>
  day ? new Date(`${day}T00:00:00Z`) : null;

export interface BillingSettingsView {
  /** false en producción: la opción de simulación no se ofrece */
  simulationAllowed: boolean;
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  legalName: string | null;
  fiscalAddress: string | null;
  ubigeo: string | null;
  apiUrl: string | null;
  /** El token nunca sale del servidor: solo si hay uno guardado */
  hasToken: boolean;
  /** Hay token de la consulta de RUC/DNI (APISPERU) */
  hasLookupToken: boolean;
  boletaSeries: string;
  facturaSeries: string;
  boletaCreditSeries: string;
  facturaCreditSeries: string;
  /** Faltantes para activar (RUC de la clínica, ruta, token…) */
  missing: string[];
  /** Cuándo se guardó el token actual (Mifact lo cambia cada ~6 meses) */
  tokenUpdatedAt: Date | null;
  /** Comprobantes por mes del plan (nulo = sin límite) y cuántos van este mes */
  monthlyQuota: number | null;
  usedThisMonth: number;
  /** Vencimientos del servicio, YYYY-MM-DD */
  planExpiresOn: string | null;
  domainExpiresOn: string | null;
  serverExpiresOn: string | null;
  /** Conexión con el PSE según la última revisión (nulo en simulación o sin revisar) */
  health: {
    state: 'OK' | 'TOKEN' | 'SUSPENDED' | 'UNREACHABLE';
    checkedAt: Date | null;
    since: Date | null;
    error: string | null;
  } | null;
}

/** Sin respuesta de SUNAT pasado este tiempo: se avisa (la factura tiene 3 días para llegar) */
export const LATE_HOURS = 24;
export const LATE_STATUSES: ElectronicDocumentStatus[] = [
  'PENDING',
  'SENT',
  'ERROR',
];
export const lateSince = (now = Date.now()) =>
  new Date(now - LATE_HOURS * 3_600_000);

export interface BillingStatus {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  /** true = los comprobantes no van a SUNAT (demo) */
  simulated: boolean;
  /** false en producción: la simulación no se puede activar ni emitir */
  simulationAllowed: boolean;
}

export interface DocumentSummary {
  id: number;
  type: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
  code: string;
  issueDate: string;
  customerDocType: string;
  customerDocNumber: string;
  customerName: string;
  total: number;
  status: ElectronicDocumentStatus;
  provider: BillingProvider;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sunatDescription: string | null;
  receiptId: number | null;
  related: string | null;
  /** La nota de crédito que la anuló (boletas y facturas) */
  annulledBy: { code: string; date: string } | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  cdrUrl: string | null;
  /** Rechazado ya resuelto: se emitió otro comprobante o se anuló el cobro */
  replacedAt: Date | null;
}

/** El comprobante tal como se imprime en el ticket. */
export interface TicketDocument {
  id: number;
  type: 'BOLETA' | 'FACTURA';
  code: string;
  status: ElectronicDocumentStatus;
  issueDate: string;
  legalName: string | null;
  customer: {
    docType: string;
    docNumber: string;
    name: string;
    address: string | null;
  };
  totals: {
    taxed: number;
    exempt: number;
    unaffected: number;
    igv: number;
    total: number;
  };
  /** Las líneas tal como se emitieron (en un pago a cuenta, solo lo pagado) */
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  amountInWords: string;
  hash: string | null;
  qrText: string | null;
  pdfUrl: string | null;
  simulated: boolean;
  creditNote: { code: string; status: ElectronicDocumentStatus } | null;
}

/** Todo lo que lleva la representación impresa A4 de un comprobante (cualquier tipo). */
export interface PrintDocument {
  id: number;
  type: 'BOLETA' | 'FACTURA' | 'CREDIT_NOTE';
  code: string;
  status: ElectronicDocumentStatus;
  issueDate: string;
  issuedAt: string;
  simulated: boolean;
  clinic: {
    name: string;
    legalName: string | null;
    ruc: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    /** data:image/...;base64 (el logo pesa máximo 1 MB) */
    logo: string | null;
  };
  customer: {
    docType: string;
    docNumber: string;
    name: string;
    address: string | null;
  };
  lines: {
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitValue: number;
    unitPrice: number;
    total: number;
    affectation: string;
  }[];
  totals: {
    taxed: number;
    exempt: number;
    unaffected: number;
    igv: number;
    total: number;
  };
  amountInWords: string;
  hash: string | null;
  qrText: string | null;
  /** Nota de crédito: el comprobante que anula y el motivo */
  related: { type: string; code: string; issueDate: string } | null;
  reason: string | null;
  /** Boleta o factura anulada con nota de crédito (no rechazada) */
  annulledBy: { code: string; status: ElectronicDocumentStatus } | null;
  /** Cobro interno de caja (NV-…) */
  receiptCode: string | null;
  /** Celular del cliente para enviarle el comprobante (no sale en el enlace público) */
  contactPhone: string | null;
}

/** Con problemas: error de envío o rechazado que nadie corrigió todavía */
const PROBLEM_WHERE = {
  OR: [{ status: 'ERROR' }, { status: 'REJECTED', replacedAt: null }],
} satisfies Prisma.ElectronicDocumentWhereInput;

const SUMMARY_SELECT = {
  id: true,
  type: true,
  series: true,
  number: true,
  issueDate: true,
  customerDocType: true,
  customerDocNumber: true,
  customerName: true,
  total: true,
  status: true,
  provider: true,
  attempts: true,
  nextAttemptAt: true,
  lastError: true,
  sunatDescription: true,
  receiptId: true,
  pdfUrl: true,
  xmlUrl: true,
  cdrUrl: true,
  replacedAt: true,
  related: { select: { series: true, number: true } },
  // La nota de crédito que la anula (una rechazada no anula nada)
  creditNotes: {
    where: { status: { not: 'REJECTED' } },
    select: { series: true, number: true, issueDate: true },
    orderBy: { id: 'desc' },
    take: 1,
  },
} satisfies Prisma.ElectronicDocumentSelect;

type SummaryRow = Prisma.ElectronicDocumentGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

const toSummary = (d: SummaryRow): DocumentSummary => ({
  id: d.id,
  type: d.type,
  code: documentCode(d.series, d.number),
  issueDate: fromDbDate(d.issueDate) ?? '',
  customerDocType: d.customerDocType,
  customerDocNumber: d.customerDocNumber,
  customerName: d.customerName,
  total: d.total.toNumber(),
  status: d.status,
  provider: d.provider,
  attempts: d.attempts,
  nextAttemptAt: d.nextAttemptAt,
  lastError: d.lastError,
  sunatDescription: d.sunatDescription,
  receiptId: d.receiptId,
  related: d.related ? documentCode(d.related.series, d.related.number) : null,
  annulledBy: d.creditNotes[0]
    ? {
        code: documentCode(d.creditNotes[0].series, d.creditNotes[0].number),
        date: fromDbDate(d.creditNotes[0].issueDate) ?? '',
      }
    : null,
  pdfUrl: d.pdfUrl,
  xmlUrl: d.xmlUrl,
  cdrUrl: d.cdrUrl,
  replacedAt: d.replacedAt,
});

/** Busca por número (B001-120, F001-00000045 o solo 120), nombre o documento del cliente */
function searchWhere(q?: string): Prisma.ElectronicDocumentWhereInput | null {
  const text = q?.trim();
  if (!text) return null;
  const or: Prisma.ElectronicDocumentWhereInput[] = [
    { customerName: { contains: text, mode: 'insensitive' } },
    { customerDocNumber: { startsWith: text } },
  ];
  const code = /^([A-Za-z][A-Za-z0-9]{3})-?0*(\d{1,8})$/.exec(text);
  if (code) or.push({ series: code[1].toUpperCase(), number: Number(code[2]) });
  else if (/^\d{1,8}$/.test(text)) or.push({ number: Number(text) });
  return { OR: or };
}

/**
 * Comprobantes electrónicos. Se emiten dentro de la transacción del cobro (con su número reservado)
 * y se envían después, fuera de ella, por BillingSender: si el PSE está caído, la caja sigue.
 */
@Injectable()
export class BillingService {
  private readonly box: SecretBox;
  readonly providers: Record<BillingProvider, BillingProviderClient> = {
    SIMULATED: new SimulatedProvider(),
    NUBEFACT: new NubefactProvider(),
    LUCODE: new LucodeProvider(),
    MIFACT: new MifactProvider(),
  };

  /** En producción (false) no se activa ni se emite en simulación */
  private readonly allowSimulated: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly health: BillingHealthStore,
    config: ConfigService,
  ) {
    this.allowSimulated =
      config.get<boolean>('BILLING_ALLOW_SIMULATED') ?? true;
    this.box = new SecretBox(
      config.get<string>('BILLING_SECRET') ||
        config.get<string>('JWT_SECRET') ||
        '',
    );
  }

  // ── Configuración ──

  async settings(clinicId: number): Promise<BillingSettingsView> {
    const [row, clinic] = await Promise.all([
      this.prisma.billingSettings.findUnique({ where: { clinicId } }),
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { ruc: true, timezone: true },
      }),
    ]);
    const s = row ?? {
      enabled: false,
      provider: 'SIMULATED' as const,
      production: false,
      legalName: null,
      fiscalAddress: null,
      ubigeo: null,
      apiUrl: null,
      apiTokenEnc: null,
      lookupTokenEnc: null,
      boletaSeries: 'B001',
      facturaSeries: 'F001',
      boletaCreditSeries: 'BC01',
      facturaCreditSeries: 'FC01',
      health: null,
      healthCheckedAt: null,
      healthSince: null,
      healthError: null,
      tokenUpdatedAt: null,
      monthlyQuota: null,
      planExpiresOn: null,
      domainExpiresOn: null,
      serverExpiresOn: null,
    };
    return {
      simulationAllowed: this.allowSimulated,
      tokenUpdatedAt: s.tokenUpdatedAt,
      monthlyQuota: s.monthlyQuota,
      usedThisMonth:
        s.provider === 'SIMULATED'
          ? 0
          : await documentsThisMonth(this.prisma, clinicId, clinic.timezone),
      planExpiresOn: isoDay(s.planExpiresOn),
      domainExpiresOn: isoDay(s.domainExpiresOn),
      serverExpiresOn: isoDay(s.serverExpiresOn),
      enabled: s.enabled,
      provider: s.provider,
      production: s.production,
      legalName: s.legalName,
      fiscalAddress: s.fiscalAddress,
      ubigeo: s.ubigeo,
      apiUrl: s.apiUrl,
      hasToken: !!s.apiTokenEnc,
      hasLookupToken: !!s.lookupTokenEnc,
      boletaSeries: s.boletaSeries,
      facturaSeries: s.facturaSeries,
      boletaCreditSeries: s.boletaCreditSeries,
      facturaCreditSeries: s.facturaCreditSeries,
      missing: missingFor({
        provider: s.provider,
        apiUrl: s.apiUrl,
        hasToken: !!s.apiTokenEnc,
        legalName: s.legalName,
        fiscalAddress: s.fiscalAddress,
        ubigeo: s.ubigeo,
        production: s.production,
        ruc: clinic.ruc,
      }),
      health:
        s.provider !== 'SIMULATED' && s.health
          ? {
              state: s.health as 'OK' | 'TOKEN' | 'SUSPENDED' | 'UNREACHABLE',
              checkedAt: s.healthCheckedAt,
              since: s.healthSince,
              error: s.healthError,
            }
          : null,
    };
  }

  async status(clinicId: number): Promise<BillingStatus> {
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
      select: { enabled: true, provider: true, production: true },
    });
    return {
      enabled: s?.enabled ?? false,
      provider: s?.provider ?? 'SIMULATED',
      production: s?.production ?? false,
      simulated: (s?.provider ?? 'SIMULATED') === 'SIMULATED',
      simulationAllowed: this.allowSimulated,
    };
  }

  async updateSettings(
    actor: AuthUser,
    dto: BillingSettingsDto,
    ip?: string,
  ): Promise<BillingSettingsView> {
    // Un error aquí deja a la clínica sin comprobantes: solo soporte técnico la cambia
    if (!actor.support)
      throw new ForbiddenException(
        'La configuración de facturación la cambia soporte técnico. Si Mifact te envió un token nuevo, usa "Actualizar token"',
      );
    const current = await this.prisma.billingSettings.findUnique({
      where: { clinicId: actor.clinicId },
    });
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { ruc: true },
    });
    const apiTokenEnc =
      dto.apiToken === undefined || dto.apiToken === null
        ? (current?.apiTokenEnc ?? null)
        : this.box.seal(dto.apiToken);
    const lookupTokenEnc = dto.clearLookupToken
      ? null
      : dto.lookupToken
        ? this.box.seal(dto.lookupToken)
        : (current?.lookupTokenEnc ?? null);
    if (dto.enabled) {
      const missing = missingFor({
        provider: dto.provider,
        apiUrl: dto.apiUrl ?? null,
        hasToken: !!apiTokenEnc,
        legalName: dto.legalName ?? null,
        fiscalAddress: dto.fiscalAddress ?? null,
        ubigeo: dto.ubigeo ?? null,
        production: dto.production,
        ruc: clinic.ruc,
      });
      if (missing.length)
        throw new BadRequestException(
          `Para activar la facturación falta: ${missing.join(', ')}`,
        );
    }
    if (dto.enabled && dto.provider === 'SIMULATED' && !this.allowSimulated)
      throw new BadRequestException(
        'En este servidor la simulación está desactivada: elige el PSE (Mifact) para facturar',
      );
    if (dto.production && dto.provider === 'SIMULATED')
      throw new BadRequestException(
        'La simulación no puede estar en producción: elige el PSE',
      );
    // Los pendientes se consultan con el proveedor y el ambiente con que se enviaron
    if (
      current &&
      (current.provider !== dto.provider ||
        current.production !== dto.production)
    ) {
      const pending = await this.prisma.electronicDocument.count({
        where: {
          clinicId: actor.clinicId,
          status: { in: ['PENDING', 'SENT', 'ERROR'] },
        },
      });
      if (pending)
        throw new ConflictException(
          `Hay ${pending} comprobante${pending === 1 ? '' : 's'} sin respuesta de SUNAT: espera a que terminen (o reintenta) antes de cambiar de proveedor o de ambiente`,
        );
    }
    // Ruta, token o ambiente nuevos: se prueban antes de guardar; si fallan, queda lo anterior
    const connectionChanged =
      !current ||
      dto.apiToken != null ||
      (dto.apiUrl ?? null) !== current.apiUrl ||
      dto.provider !== current.provider ||
      dto.production !== current.production;
    if (dto.enabled && dto.provider !== 'SIMULATED' && connectionChanged)
      await this.checkOrFail(dto.provider, {
        url: dto.apiUrl ?? null,
        token: apiTokenEnc ? this.box.open(apiTokenEnc) : null,
        production: dto.production,
        issuer: {
          legalName: dto.legalName ?? null,
          fiscalAddress: dto.fiscalAddress ?? null,
          ubigeo: dto.ubigeo ?? null,
          ruc: clinic.ruc,
        },
      });
    const data = {
      enabled: dto.enabled,
      provider: dto.provider,
      production: dto.production,
      legalName: dto.legalName ?? null,
      fiscalAddress: dto.fiscalAddress ?? null,
      ubigeo: dto.ubigeo ?? null,
      apiUrl: dto.apiUrl ?? null,
      apiTokenEnc,
      lookupTokenEnc,
      boletaSeries: dto.boletaSeries,
      facturaSeries: dto.facturaSeries,
      boletaCreditSeries: dto.boletaCreditSeries,
      facturaCreditSeries: dto.facturaCreditSeries,
      // Sin el campo (otra pantalla, el script de la demo) se mantiene; null lo borra
      monthlyQuota:
        dto.monthlyQuota === undefined
          ? (current?.monthlyQuota ?? null)
          : dto.monthlyQuota,
      planExpiresOn:
        dto.planExpiresOn === undefined
          ? (current?.planExpiresOn ?? null)
          : dbDay(dto.planExpiresOn),
      domainExpiresOn:
        dto.domainExpiresOn === undefined
          ? (current?.domainExpiresOn ?? null)
          : dbDay(dto.domainExpiresOn),
      serverExpiresOn:
        dto.serverExpiresOn === undefined
          ? (current?.serverExpiresOn ?? null)
          : dbDay(dto.serverExpiresOn),
      ...(dto.apiToken != null ? { tokenUpdatedAt: new Date() } : {}),
    };
    await this.prisma.billingSettings.upsert({
      where: { clinicId: actor.clinicId },
      create: { clinicId: actor.clinicId, ...data },
      update: data,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'billing.settings_update',
      entity: 'clinic',
      entityId: actor.clinicId,
      ip,
      // El token nunca va a la bitácora: solo si cambió
      data: {
        activa: dto.enabled,
        proveedor: dto.provider,
        produccion: dto.production,
        series: [
          dto.boletaSeries,
          dto.facturaSeries,
          dto.boletaCreditSeries,
          dto.facturaCreditSeries,
        ].join(' '),
        tokenCambiado: dto.apiToken != null,
        tokenConsultaCambiado:
          dto.lookupToken != null || !!dto.clearLookupToken,
      },
    });
    if (connectionChanged)
      // Conexión nueva probada (o simulación): empieza limpia y sale lo que esperaba
      await (dto.enabled && dto.provider !== 'SIMULATED'
        ? this.health.record(actor.clinicId, null, 'check')
        : this.prisma.billingSettings.update({
            where: { clinicId: actor.clinicId },
            data: {
              health: null,
              healthError: null,
              healthSince: null,
              healthFailures: 0,
            },
          }));
    return this.settings(actor.clinicId);
  }

  /**
   * El token nuevo que envía el PSE (Mifact lo cambia cada ~6 meses). Lo puede pegar el
   * administrador: se prueba con la configuración guardada y solo se guarda si funciona.
   */
  async updateToken(
    actor: AuthUser,
    token: string,
    ip?: string,
  ): Promise<BillingSettingsView> {
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId: actor.clinicId },
    });
    if (!s || s.provider === 'SIMULATED')
      throw new BadRequestException(
        'Primero soporte técnico debe configurar el PSE',
      );
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { ruc: true },
    });
    const config = this.providerConfig(s);
    await this.checkOrFail(s.provider, {
      ...config,
      token: token.trim(),
      issuer: { ...config.issuer!, ruc: clinic.ruc },
    });
    await this.prisma.billingSettings.update({
      where: { clinicId: actor.clinicId },
      data: {
        apiTokenEnc: this.box.seal(token.trim()),
        tokenUpdatedAt: new Date(),
      },
    });
    // El token nuevo funciona: se apaga la alerta y salen solos los que esperaban
    await this.health.record(actor.clinicId, null, 'check');
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'billing.token_update',
      entity: 'clinic',
      entityId: actor.clinicId,
      ip,
      data: { proveedor: s.provider },
    });
    return this.settings(actor.clinicId);
  }

  /** Vuelve a enviar todos los que no se pudieron enviar (p. ej. tras actualizar el token). */
  async retryAll(actor: AuthUser, ip?: string): Promise<{ count: number }> {
    const { count } = await this.prisma.electronicDocument.updateMany({
      where: { clinicId: actor.clinicId, status: 'ERROR' },
      data: { nextAttemptAt: new Date(), lastError: null },
    });
    if (count)
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        action: 'billing.retry_all',
        entity: 'clinic',
        entityId: actor.clinicId,
        ip,
        data: { comprobantes: count },
      });
    return { count };
  }

  /** Prueba una conexión sin guardarla; el mensaje del PSE llega tal cual. */
  private async checkOrFail(
    provider: BillingProvider,
    config: ProviderConfig,
  ): Promise<void> {
    try {
      await this.providers[provider].check(config);
    } catch (error) {
      throw new BadRequestException(
        `No se guardó: ${
          error instanceof ProviderError
            ? error.message
            : 'no se pudo conectar con el PSE'
        }`,
      );
    }
  }

  /**
   * Revisión automática: prueba la conexión guardada y anota la salud. Solo clínicas con PSE real
   * y token (la simulación y la demo no se revisan). Nunca lanza.
   */
  async checkHealth(clinicId: number): Promise<void> {
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
    });
    if (!s?.enabled || s.provider === 'SIMULATED' || !s.apiTokenEnc) return;
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { ruc: true },
    });
    const config = this.providerConfig(s);
    config.issuer = { ...config.issuer!, ruc: clinic.ruc };
    let error: unknown = null;
    try {
      await this.providers[s.provider].check(config);
    } catch (e) {
      error = e;
    }
    await this.health.record(clinicId, error, 'check');
  }

  /** Prueba la ruta y el token guardados, sin emitir nada. */
  async test(clinicId: number): Promise<{ ok: true; message: string }> {
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
    });
    if (!s) throw new BadRequestException('Primero guarda la configuración');
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { ruc: true },
    });
    const config = this.providerConfig(s);
    config.issuer = { ...config.issuer!, ruc: clinic.ruc };
    try {
      await this.providers[s.provider].check(config);
    } catch (error) {
      await this.health.record(clinicId, error, 'check');
      throw new BadRequestException(
        error instanceof ProviderError
          ? error.message
          : 'No se pudo conectar con el PSE',
      );
    }
    await this.health.record(clinicId, null, 'check');
    return {
      ok: true,
      message:
        s.provider === 'SIMULATED'
          ? 'Simulación lista: los comprobantes no irán a SUNAT'
          : 'Conexión con el PSE correcta',
    };
  }

  providerConfig(s: {
    apiUrl: string | null;
    apiTokenEnc: string | null;
    production: boolean;
    legalName: string | null;
    fiscalAddress: string | null;
    ubigeo: string | null;
  }): ProviderConfig {
    return {
      url: s.apiUrl,
      token: s.apiTokenEnc ? this.box.open(s.apiTokenEnc) : null,
      production: s.production,
      issuer: {
        legalName: s.legalName,
        fiscalAddress: s.fiscalAddress,
        ubigeo: s.ubigeo,
      },
    };
  }

  // ── Emisión (dentro de la transacción del cobro) ──

  /** Emite la boleta o factura de un cobro recién creado. Devuelve el id del comprobante. */
  async issueInTx(
    tx: Tx,
    actor: AuthUser,
    receiptId: number,
    kind: 'BOLETA' | 'FACTURA',
    buyer?: BuyerDto | null,
  ): Promise<number> {
    const settings = await tx.billingSettings.findUnique({
      where: { clinicId: actor.clinicId },
    });
    if (!settings?.enabled)
      throw new BadRequestException(
        'La facturación electrónica no está activada: emite una nota de venta o actívala en Configuración',
      );
    // Un comprobante simulado impreso parece válido y no llegó a SUNAT: en producción no se emite
    if (settings.provider === 'SIMULATED' && !this.allowSimulated)
      throw new BadRequestException(
        'La facturación está en simulación y este servidor no la permite: configura el PSE en Comprobantes → Configuración o emite una nota de venta',
      );
    const receipt = await tx.receipt.findFirstOrThrow({
      where: { id: receiptId, clinicId: actor.clinicId },
      select: {
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            docType: true,
            docNumber: true,
            address: true,
            email: true,
            walkIn: true,
            invoiceRuc: true,
            invoiceName: true,
            invoiceAddress: true,
            invoiceEmail: true,
          },
        },
        clinic: { select: { timezone: true } },
        allocations: {
          orderBy: { chargeId: 'asc' },
          select: {
            amount: true,
            charge: {
              select: {
                id: true,
                description: true,
                quantity: true,
                total: true,
                taxableAmount: true,
                igvAmount: true,
                igvAffectation: true,
                igvRate: true,
                sunatUnit: true,
                productId: true,
                careServiceId: true,
              },
            },
          },
        },
      },
    });
    const { lines, totals } = buildLines(receipt.allocations);
    const customer = customerFor(kind, receipt.client, totals.total, buyer);
    if (buyer && buyer.save !== false && !receipt.client.walkIn)
      await this.saveBuyer(tx, actor.clinicId, receipt.client, buyer);
    const series =
      kind === 'BOLETA' ? settings.boletaSeries : settings.facturaSeries;
    const doc = await tx.electronicDocument.create({
      data: {
        clinicId: actor.clinicId,
        receiptId,
        type: kind,
        series,
        number: await reserveNumbers(tx, actor.clinicId, `cpe:${series}`),
        issueDate: toDbDate(clinicDay(receipt.clinic.timezone)),
        customerDocType: customer.docType,
        customerDocNumber: customer.docNumber,
        customerName: customer.name.slice(0, 150),
        customerAddress: customer.address,
        customerEmail: customer.email,
        taxedAmount: totals.taxed,
        exemptAmount: totals.exempt,
        unaffectedAmount: totals.unaffected,
        igvAmount: totals.igv,
        total: totals.total,
        items: lines as unknown as Prisma.InputJsonValue,
        provider: settings.provider,
        nextAttemptAt: new Date(),
        createdById: actor.id,
      },
      select: { id: true },
    });
    return doc.id;
  }

  /**
   * Guarda en la ficha lo escrito en el cobro, para proponerlo la próxima vez. RUC → datos de
   * facturación (no toca su DNI). DNI → su documento, solo si no tenía uno y nadie más lo usa.
   */
  private async saveBuyer(
    tx: Tx,
    clinicId: number,
    client: {
      id: number;
      name: string;
      phone: string;
      docType: string | null;
      docNumber: string | null;
    },
    buyer: BuyerInput,
  ): Promise<void> {
    if (buyer.docType === 'RUC') {
      // Si su documento principal ya es ese RUC, no hace falta duplicarlo
      if (client.docType === 'RUC' && client.docNumber === buyer.docNumber)
        return;
      await tx.client.update({
        where: { id: client.id },
        data: {
          invoiceRuc: buyer.docNumber,
          invoiceName: buyer.name.slice(0, 150),
          invoiceAddress: buyer.address?.trim() || null,
          invoiceEmail: buyer.email?.trim() || null,
        },
      });
      return;
    }
    if (client.docNumber) return;
    const taken = await tx.client.findFirst({
      where: { clinicId, docType: 'DNI', docNumber: buyer.docNumber },
      select: { id: true },
    });
    if (taken) return;
    await tx.client.update({
      where: { id: client.id },
      data: {
        docType: 'DNI',
        docNumber: buyer.docNumber,
        searchText: clientSearchText(
          client.name,
          buyer.docNumber,
          client.phone,
        ),
      },
    });
  }

  /**
   * Datos de facturación que se proponen al elegir factura: el RUC del cliente, los guardados en
   * su ficha o, si no hay, los de su última factura.
   */
  async buyerFor(
    clinicId: number,
    clientId: number,
  ): Promise<{
    docNumber: string;
    name: string;
    address: string | null;
    email: string | null;
  } | null> {
    const c = await this.prisma.client.findFirst({
      where: { id: clientId, clinicId },
      select: {
        id: true,
        name: true,
        docType: true,
        docNumber: true,
        address: true,
        email: true,
        walkIn: true,
        invoiceRuc: true,
        invoiceName: true,
        invoiceAddress: true,
        invoiceEmail: true,
      },
    });
    if (!c) throw new NotFoundException('El cliente no existe');
    if (c.walkIn) return null;
    if (c.docType === 'RUC' && c.docNumber)
      return {
        docNumber: c.docNumber,
        name: c.name,
        address: c.address,
        email: c.invoiceEmail ?? c.email,
      };
    if (c.invoiceRuc)
      return {
        docNumber: c.invoiceRuc,
        name: c.invoiceName || c.name,
        address: c.invoiceAddress,
        email: c.invoiceEmail,
      };
    const last = await this.prisma.electronicDocument.findFirst({
      where: { clinicId, type: 'FACTURA', receipt: { clientId } },
      orderBy: { id: 'desc' },
      select: {
        customerDocNumber: true,
        customerName: true,
        customerAddress: true,
        customerEmail: true,
      },
    });
    return last
      ? {
          docNumber: last.customerDocNumber,
          name: last.customerName,
          address: last.customerAddress,
          email: last.customerEmail,
        }
      : null;
  }

  /**
   * Busca el nombre de un RUC o DNI: primero en lo que la clínica ya tiene (clientes y
   * comprobantes, sin gastar consultas) y luego en APISPERU si hay token. null = no se encontró
   * (se escribe a mano).
   */
  async lookup(
    clinicId: number,
    type: 'RUC' | 'DNI',
    number: string,
  ): Promise<LookupResult | null> {
    const own = await this.prisma.client.findFirst({
      where:
        type === 'RUC'
          ? {
              clinicId,
              OR: [
                { docType: 'RUC', docNumber: number },
                { invoiceRuc: number },
              ],
            }
          : { clinicId, docType: 'DNI', docNumber: number },
      select: {
        name: true,
        address: true,
        docType: true,
        docNumber: true,
        invoiceRuc: true,
        invoiceName: true,
        invoiceAddress: true,
      },
    });
    if (own) {
      const byInvoice = type === 'RUC' && own.invoiceRuc === number;
      return {
        name: byInvoice ? own.invoiceName || own.name : own.name,
        address: byInvoice ? own.invoiceAddress : own.address,
        status: null,
        condition: null,
        source: 'LOCAL',
      };
    }
    const doc = await this.prisma.electronicDocument.findFirst({
      where: {
        clinicId,
        customerDocType: type === 'RUC' ? '6' : '1',
        customerDocNumber: number,
      },
      orderBy: { id: 'desc' },
      select: { customerName: true, customerAddress: true },
    });
    if (doc)
      return {
        name: doc.customerName,
        address: doc.customerAddress,
        status: null,
        condition: null,
        source: 'LOCAL',
      };
    const settings = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
      select: { lookupTokenEnc: true },
    });
    if (!settings?.lookupTokenEnc) return null;
    return lookupApisperu(this.box.open(settings.lookupTokenEnc), type, number);
  }

  /**
   * Cambia una boleta por factura (el cliente la pidió después de pagar): nota de crédito de la
   * boleta y factura nueva por el mismo detalle, sin tocar el pago ni la caja. Si SUNAT había
   * rechazado la boleta, solo se emite la factura.
   */
  async toFactura(
    actor: AuthUser,
    id: number,
    buyer: BuyerDto,
    ip?: string,
  ): Promise<{ id: number; code: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Bloquea la boleta: dos clics no emiten dos facturas
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM electronic_documents
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row) throw new NotFoundException('El comprobante no existe');
      const boleta = await tx.electronicDocument.findUniqueOrThrow({
        where: { id },
        select: {
          type: true,
          series: true,
          number: true,
          status: true,
          issueDate: true,
          receiptId: true,
          receipt: { select: { status: true } },
          creditNotes: {
            where: { status: { not: 'REJECTED' } },
            select: { id: true },
          },
        },
      });
      if (boleta.type !== 'BOLETA' || !boleta.receiptId)
        throw new BadRequestException(
          'Solo una boleta se puede cambiar por factura',
        );
      if (boleta.receipt?.status !== 'ACTIVE')
        throw new ConflictException('El cobro de esta boleta está anulado');
      if (boleta.creditNotes.length)
        throw new ConflictException('Esta boleta ya fue anulada o cambiada');
      if (buyer.docType !== 'RUC')
        throw new BadRequestException('La factura lleva el RUC del comprador');
      // Una boleta válida de otro mes ya entró en el IGV declarado: se cambia solo en su mes
      if (boleta.status !== 'REJECTED') {
        const { timezone } = await tx.clinic.findUniqueOrThrow({
          where: { id: actor.clinicId },
          select: { timezone: true },
        });
        if (
          (fromDbDate(boleta.issueDate) ?? '').slice(0, 7) !==
          clinicDay(timezone).slice(0, 7)
        )
          throw new ConflictException(
            'Solo se cambia a factura dentro del mes de la boleta: ese mes ya se declaró. Consulta con el contador.',
          );
      }
      const reason = `Cambio a factura (RUC ${buyer.docNumber})`;
      if (boleta.status !== 'REJECTED')
        await this.creditNoteForInTx(tx, actor, id, reason);
      else
        await tx.electronicDocument.update({
          where: { id },
          data: { replacedAt: new Date() },
        });
      const facturaId = await this.issueInTx(
        tx,
        actor,
        boleta.receiptId,
        'FACTURA',
        buyer,
      );
      const factura = await tx.electronicDocument.findUniqueOrThrow({
        where: { id: facturaId },
        select: { series: true, number: true },
      });
      return {
        id: facturaId,
        code: documentCode(factura.series, factura.number),
        boleta: documentCode(boleta.series, boleta.number),
      };
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'billing.to_factura',
      entity: 'electronic_document',
      entityId: result.id,
      ip,
      data: {
        boleta: result.boleta,
        factura: result.code,
        ruc: buyer.docNumber,
        razonSocial: buyer.name,
      },
    });
    return { id: result.id, code: result.code };
  }

  /**
   * Corrige un comprobante que SUNAT rechazó (DNI, RUC o nombre mal escritos): emite otro del mismo
   * tipo para el mismo cobro con los datos corregidos. Sin nota de crédito (el rechazado no tiene
   * valor) y sin tocar el pago ni la caja.
   */
  async reissue(
    actor: AuthUser,
    id: number,
    buyer: BuyerDto,
    ip?: string,
  ): Promise<{ id: number; code: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Bloquea el rechazado: dos clics no emiten dos comprobantes
      const [row] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM electronic_documents
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row) throw new NotFoundException('El comprobante no existe');
      const doc = await tx.electronicDocument.findUniqueOrThrow({
        where: { id },
        select: {
          type: true,
          series: true,
          number: true,
          status: true,
          replacedAt: true,
          receiptId: true,
          receipt: { select: { status: true } },
        },
      });
      if (doc.type === 'CREDIT_NOTE' || !doc.receiptId)
        throw new BadRequestException(
          'Solo se corrige una boleta o una factura',
        );
      if (doc.status !== 'REJECTED')
        throw new ConflictException(
          'Solo se corrige un comprobante rechazado por SUNAT',
        );
      if (doc.replacedAt)
        throw new ConflictException(
          'Ya se emitió otro comprobante para este cobro',
        );
      if (doc.receipt?.status !== 'ACTIVE')
        throw new ConflictException(
          'El cobro de este comprobante está anulado',
        );
      if (doc.type === 'FACTURA' && buyer.docType !== 'RUC')
        throw new BadRequestException('La factura lleva el RUC del comprador');
      if (doc.type === 'BOLETA' && buyer.docType !== 'DNI')
        throw new BadRequestException(
          'La boleta lleva DNI; para RUC usa "Cambiar a factura"',
        );
      await tx.electronicDocument.update({
        where: { id },
        data: { replacedAt: new Date() },
      });
      const newId = await this.issueInTx(
        tx,
        actor,
        doc.receiptId,
        doc.type,
        buyer,
      );
      const created = await tx.electronicDocument.findUniqueOrThrow({
        where: { id: newId },
        select: { series: true, number: true },
      });
      return {
        id: newId,
        code: documentCode(created.series, created.number),
        old: documentCode(doc.series, doc.number),
      };
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'billing.reissue',
      entity: 'electronic_document',
      entityId: result.id,
      ip,
      data: {
        rechazado: result.old,
        nuevo: result.code,
        documento: `${buyer.docType} ${buyer.docNumber}`,
        nombre: buyer.name,
      },
    });
    return { id: result.id, code: result.code };
  }

  /**
   * Al anular un cobro con boleta o factura, se emite su nota de crédito (motivo 01, anulación de
   * la operación). Si SUNAT había rechazado el comprobante, no hace falta.
   */
  async creditNoteInTx(
    tx: Tx,
    actor: AuthUser,
    receiptId: number,
    reason: string,
  ): Promise<number | null> {
    // Los rechazados de este cobro quedan resueltos: el cobro se anula
    await tx.electronicDocument.updateMany({
      where: {
        clinicId: actor.clinicId,
        receiptId,
        status: 'REJECTED',
        replacedAt: null,
      },
      data: { replacedAt: new Date() },
    });
    // El comprobante vigente: si la boleta se cambió por factura, es la factura (la más nueva)
    const current = await tx.electronicDocument.findFirst({
      where: {
        clinicId: actor.clinicId,
        receiptId,
        type: { in: ['BOLETA', 'FACTURA'] },
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return current
      ? this.creditNoteForInTx(tx, actor, current.id, reason)
      : null;
  }

  /** Nota de crédito (anulación) de un comprobante concreto. null = no hace falta. */
  private async creditNoteForInTx(
    tx: Tx,
    actor: AuthUser,
    documentId: number,
    reason: string,
  ): Promise<number | null> {
    const original = await tx.electronicDocument.findFirst({
      where: { id: documentId, clinicId: actor.clinicId },
      include: { creditNotes: { select: { id: true } } },
    });
    if (
      !original ||
      original.type === 'CREDIT_NOTE' ||
      original.status === 'REJECTED' ||
      original.creditNotes.length
    )
      return null;
    const receiptId = original.receiptId;
    const settings = await tx.billingSettings.findUniqueOrThrow({
      where: { clinicId: actor.clinicId },
    });
    const { timezone } = await tx.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { timezone: true },
    });
    const series =
      original.type === 'BOLETA'
        ? settings.boletaCreditSeries
        : settings.facturaCreditSeries;
    const note = await tx.electronicDocument.create({
      data: {
        clinicId: actor.clinicId,
        receiptId,
        type: 'CREDIT_NOTE',
        series,
        number: await reserveNumbers(tx, actor.clinicId, `cpe:${series}`),
        issueDate: toDbDate(clinicDay(timezone)),
        customerDocType: original.customerDocType,
        customerDocNumber: original.customerDocNumber,
        customerName: original.customerName,
        customerAddress: original.customerAddress,
        customerEmail: original.customerEmail,
        taxedAmount: original.taxedAmount,
        exemptAmount: original.exemptAmount,
        unaffectedAmount: original.unaffectedAmount,
        igvAmount: original.igvAmount,
        total: original.total,
        items: original.items as Prisma.InputJsonValue,
        relatedId: original.id,
        reason: reason.slice(0, 200),
        // La nota va por el mismo proveedor que el comprobante que anula
        provider: original.provider,
        nextAttemptAt: new Date(),
        createdById: actor.id,
      },
      select: { id: true },
    });
    return note.id;
  }

  /** Lo que necesita el proveedor para emitir un documento guardado. */
  async outgoing(id: number): Promise<{
    doc: OutgoingDocument;
    status: ElectronicDocumentStatus;
    relatedStatus: ElectronicDocumentStatus | null;
    provider: BillingProvider;
    config: ProviderConfig;
    attempts: number;
    clinicId: number;
  }> {
    const d = await this.prisma.electronicDocument.findUniqueOrThrow({
      where: { id },
      include: {
        related: {
          select: {
            type: true,
            series: true,
            number: true,
            status: true,
            issueDate: true,
          },
        },
        clinic: { select: { ruc: true, billingSettings: true } },
      },
    });
    const settings = d.clinic.billingSettings;
    return {
      status: d.status,
      relatedStatus: d.related?.status ?? null,
      provider: d.provider,
      attempts: d.attempts,
      clinicId: d.clinicId,
      config: settings
        ? this.providerConfig(settings)
        : { url: null, token: null, production: false },
      doc: {
        type: d.type,
        series: d.series,
        number: d.number,
        issueDate: fromDbDate(d.issueDate) ?? '',
        clinicRuc: d.clinic.ruc,
        customer: {
          docType: d.customerDocType,
          docNumber: d.customerDocNumber,
          name: d.customerName,
          address: d.customerAddress,
          email: d.customerEmail,
        },
        totals: {
          taxed: d.taxedAmount.toNumber(),
          exempt: d.exemptAmount.toNumber(),
          unaffected: d.unaffectedAmount.toNumber(),
          igv: d.igvAmount.toNumber(),
          total: d.total.toNumber(),
        },
        lines: d.items as unknown as DocumentLine[],
        related:
          d.related && d.related.type !== 'CREDIT_NOTE'
            ? {
                type: d.related.type,
                series: d.related.series,
                number: d.related.number,
                issueDate: fromDbDate(d.related.issueDate) ?? undefined,
              }
            : null,
        reason: d.reason,
      },
    };
  }

  // ── Consulta ──

  async list(clinicId: number, query: DocumentsQuery) {
    const page = query.page ?? 1;
    const where: Prisma.ElectronicDocumentWhereInput = { clinicId };
    if (query.type) where.type = query.type;
    if (query.status === 'PROBLEMS') Object.assign(where, PROBLEM_WHERE);
    else if (query.status === 'LATE') {
      where.status = { in: LATE_STATUSES };
      where.createdAt = { lt: lateSince() };
    } else if (query.status === 'ANNULLED')
      where.creditNotes = { some: { status: { not: 'REJECTED' } } };
    else if (query.status) where.status = query.status;
    if (query.from || query.to)
      where.issueDate = {
        ...(query.from ? { gte: toDbDate(query.from) } : {}),
        ...(query.to ? { lte: toDbDate(query.to) } : {}),
      };
    const search = searchWhere(query.q);
    if (search) where.AND = [search];
    // El resumen es del periodo y la búsqueda, sin el filtro de tipo ni de estado
    const scope: Prisma.ElectronicDocumentWhereInput = {
      clinicId,
      ...(where.issueDate ? { issueDate: where.issueDate } : {}),
      ...(search ? { AND: [search] } : {}),
    };
    const [rows, total, problems, byType, annulled] =
      await this.prisma.$transaction([
        this.prisma.electronicDocument.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: SUMMARY_SELECT,
        }),
        this.prisma.electronicDocument.count({ where }),
        this.prisma.electronicDocument.count({
          where: { clinicId, ...PROBLEM_WHERE },
        }),
        this.prisma.electronicDocument.groupBy({
          by: ['type'],
          where: { ...scope, status: { not: 'REJECTED' } },
          _count: { _all: true },
          _sum: { total: true },
          orderBy: { type: 'asc' },
        }),
        this.prisma.electronicDocument.count({
          where: {
            ...scope,
            type: { in: ['BOLETA', 'FACTURA'] },
            creditNotes: { some: { status: { not: 'REJECTED' } } },
          },
        }),
      ]);
    const of = (type: DocumentSummary['type']) => {
      const row = byType.find((r) => r.type === type);
      return {
        count: (row?._count as { _all?: number } | undefined)?._all ?? 0,
        amount: row?._sum?.total?.toNumber() ?? 0,
      };
    };
    const boletas = of('BOLETA');
    const facturas = of('FACTURA');
    const credits = of('CREDIT_NOTE');
    return {
      items: rows.map(toSummary),
      total,
      page,
      pageSize: PAGE_SIZE,
      problems,
      summary: {
        boletas,
        facturas,
        creditNotes: credits,
        annulled,
        net:
          Math.round(
            (boletas.amount + facturas.amount - credits.amount) * 100,
          ) / 100,
      },
    };
  }

  /** Reintentar a mano un envío que se cansó de reintentar solo (por ejemplo, tras corregir el token). */
  async retry(
    actor: AuthUser,
    id: number,
    ip?: string,
  ): Promise<DocumentSummary> {
    const doc = await this.prisma.electronicDocument.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { status: true, series: true, number: true },
    });
    if (!doc) throw new NotFoundException('El comprobante no existe');
    if (doc.status === 'ACCEPTED')
      throw new ConflictException('SUNAT ya aceptó este comprobante');
    if (doc.status === 'REJECTED')
      throw new ConflictException(
        'SUNAT rechazó este comprobante: no se puede reenviar con el mismo número',
      );
    const row = await this.prisma.electronicDocument.update({
      where: { id },
      data: { nextAttemptAt: new Date(), lastError: null },
      select: SUMMARY_SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'billing.retry',
      entity: 'electronic_document',
      entityId: id,
      ip,
      data: { comprobante: documentCode(doc.series, doc.number) },
    });
    return toSummary(row);
  }

  /** Comprobante (y su nota de crédito, si la tiene) para imprimir en el ticket. */
  async forTicket(
    clinicId: number,
    receiptId: number,
  ): Promise<TicketDocument | null> {
    // El vigente: si la boleta se cambió por factura, la factura
    const d = await this.prisma.electronicDocument.findFirst({
      where: { clinicId, receiptId, type: { in: ['BOLETA', 'FACTURA'] } },
      orderBy: { id: 'desc' },
      include: {
        creditNotes: { select: { series: true, number: true, status: true } },
        clinic: {
          select: { billingSettings: { select: { legalName: true } } },
        },
      },
    });
    if (!d || d.type === 'CREDIT_NOTE') return null;
    const note = d.creditNotes[0];
    return {
      id: d.id,
      type: d.type,
      code: documentCode(d.series, d.number),
      status: d.status,
      issueDate: fromDbDate(d.issueDate) ?? '',
      legalName: d.clinic.billingSettings?.legalName ?? null,
      customer: {
        docType: d.customerDocType,
        docNumber: d.customerDocNumber,
        name: d.customerName,
        address: d.customerAddress,
      },
      totals: {
        taxed: d.taxedAmount.toNumber(),
        exempt: d.exemptAmount.toNumber(),
        unaffected: d.unaffectedAmount.toNumber(),
        igv: d.igvAmount.toNumber(),
        total: d.total.toNumber(),
      },
      lines: (d.items as unknown as DocumentLine[]).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        total: l.total,
      })),
      amountInWords: amountInWords(d.total.toNumber()),
      hash: d.hash,
      qrText: d.qrText,
      pdfUrl: d.pdfUrl,
      simulated: d.provider === 'SIMULATED',
      creditNote: note
        ? { code: documentCode(note.series, note.number), status: note.status }
        : null,
    };
  }

  /**
   * Representación impresa A4 de un comprobante (boleta, factura o nota de crédito): se arma con
   * lo mismo que se envió al PSE (las líneas guardadas en el comprobante), así cuadra al céntimo.
   * No se guarda ningún PDF: el navegador lo dibuja cada vez.
   */
  async printView(clinicId: number, id: number): Promise<PrintDocument> {
    const d = await this.prisma.electronicDocument.findFirst({
      where: { id, clinicId },
      include: {
        related: {
          select: { type: true, series: true, number: true, issueDate: true },
        },
        creditNotes: {
          where: { status: { not: 'REJECTED' } },
          orderBy: { id: 'desc' },
          select: { series: true, number: true, status: true },
          take: 1,
        },
        receipt: {
          select: {
            number: true,
            client: { select: { phone: true, walkIn: true } },
          },
        },
        clinic: {
          select: {
            name: true,
            ruc: true,
            address: true,
            phone: true,
            email: true,
            logo: true,
            logoMime: true,
            billingSettings: { select: { legalName: true } },
          },
        },
      },
    });
    if (!d) throw new NotFoundException('El comprobante no existe');
    const c = d.clinic;
    const note = d.creditNotes[0];
    return {
      id: d.id,
      type: d.type,
      code: documentCode(d.series, d.number),
      status: d.status,
      issueDate: fromDbDate(d.issueDate) ?? '',
      issuedAt: d.createdAt.toISOString(),
      simulated: d.provider === 'SIMULATED',
      clinic: {
        name: c.name,
        legalName: c.billingSettings?.legalName ?? null,
        ruc: c.ruc,
        address: c.address,
        phone: c.phone,
        email: c.email,
        logo:
          c.logo && c.logoMime
            ? `data:${c.logoMime};base64,${Buffer.from(c.logo).toString('base64')}`
            : null,
      },
      customer: {
        docType: d.customerDocType,
        docNumber: d.customerDocNumber,
        name: d.customerName,
        address: d.customerAddress,
      },
      lines: (d.items as unknown as DocumentLine[]).map((l) => ({
        code: l.code,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitValue: Number(l.unitValue),
        unitPrice: Number(l.unitPrice),
        total: l.total,
        affectation: l.affectation,
      })),
      totals: {
        taxed: d.taxedAmount.toNumber(),
        exempt: d.exemptAmount.toNumber(),
        unaffected: d.unaffectedAmount.toNumber(),
        igv: d.igvAmount.toNumber(),
        total: d.total.toNumber(),
      },
      amountInWords: amountInWords(d.total.toNumber()),
      hash: d.hash,
      qrText: d.qrText,
      related: d.related
        ? {
            type: d.related.type,
            code: documentCode(d.related.series, d.related.number),
            issueDate: fromDbDate(d.related.issueDate) ?? '',
          }
        : null,
      reason: d.reason,
      annulledBy: note
        ? { code: documentCode(note.series, note.number), status: note.status }
        : null,
      receiptCode: d.receipt ? saleNoteCode(d.receipt.number) : null,
      contactPhone:
        d.receipt && !d.receipt.client.walkIn ? d.receipt.client.phone : null,
    };
  }

  /** Registro de ventas del periodo en Excel, para el contador. */
  async report(clinicId: number, from: string, to: string): Promise<Buffer> {
    const rows = await this.prisma.electronicDocument.findMany({
      where: {
        clinicId,
        issueDate: { gte: toDbDate(from), lte: toDbDate(to) },
      },
      orderBy: [{ issueDate: 'asc' }, { series: 'asc' }, { number: 'asc' }],
      select: SUMMARY_SELECT,
    });
    const full = await this.prisma.electronicDocument.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: {
        id: true,
        taxedAmount: true,
        exemptAmount: true,
        unaffectedAmount: true,
        igvAmount: true,
      },
    });
    const amounts = new Map(full.map((f) => [f.id, f]));
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Registro de ventas');
    sheet.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Tipo', key: 'type', width: 16 },
      { header: 'Serie-Número', key: 'code', width: 16 },
      { header: 'Tipo doc.', key: 'docType', width: 9 },
      { header: 'N.° doc.', key: 'docNumber', width: 14 },
      { header: 'Cliente', key: 'name', width: 34 },
      { header: 'Op. gravada', key: 'taxed', width: 13 },
      { header: 'Op. exonerada', key: 'exempt', width: 13 },
      { header: 'Op. inafecta', key: 'unaffected', width: 13 },
      { header: 'IGV', key: 'igv', width: 11 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Estado SUNAT', key: 'status', width: 14 },
      { header: 'Doc. que modifica', key: 'related', width: 16 },
    ];
    const TYPE = {
      BOLETA: 'Boleta',
      FACTURA: 'Factura',
      CREDIT_NOTE: 'Nota de crédito',
    };
    const STATUS = {
      PENDING: 'Por enviar',
      SENT: 'Enviado',
      ACCEPTED: 'Aceptado',
      REJECTED: 'Rechazado',
      ERROR: 'Error de envío',
    };
    for (const r of rows) {
      const a = amounts.get(r.id)!;
      // Las notas de crédito restan
      const sign = r.type === 'CREDIT_NOTE' ? -1 : 1;
      sheet.addRow({
        date: fromDbDate(r.issueDate),
        type: TYPE[r.type],
        code: documentCode(r.series, r.number),
        docType: r.customerDocType,
        docNumber: r.customerDocNumber,
        name: r.customerName,
        taxed: sign * a.taxedAmount.toNumber(),
        exempt: sign * a.exemptAmount.toNumber(),
        unaffected: sign * a.unaffectedAmount.toNumber(),
        igv: sign * a.igvAmount.toNumber(),
        total: sign * r.total.toNumber(),
        status: STATUS[r.status],
        related: r.related
          ? documentCode(r.related.series, r.related.number)
          : '',
      });
    }
    sheet.getRow(1).font = { bold: true };
    for (const key of ['taxed', 'exempt', 'unaffected', 'igv', 'total'])
      sheet.getColumn(key).numFmt = '#,##0.00';
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}

function missingFor(s: {
  provider: BillingProvider;
  apiUrl: string | null;
  hasToken: boolean;
  legalName: string | null;
  fiscalAddress: string | null;
  ubigeo: string | null;
  production: boolean;
  ruc: string | null;
}): string[] {
  const missing: string[] = [];
  if (s.provider === 'SIMULATED') return missing;
  if (!s.ruc) missing.push('el RUC de la clínica (Configuración → Clínica)');
  if (!s.legalName) missing.push('la razón social');
  // Lucode no pide ruta: usa su sandbox o su app según "Producción"
  if (!s.apiUrl && s.provider === 'NUBEFACT') missing.push('la ruta del PSE');
  if (s.provider === 'MIFACT') {
    if (!s.fiscalAddress) missing.push('la dirección fiscal');
    if (!s.ubigeo) missing.push('el ubigeo');
    // Sin ruta se usa el demo de Mifact; en producción hay que pegar la que entrega Mifact
    if (!s.apiUrl && s.production)
      missing.push('la ruta de producción que entrega Mifact');
  }
  if (!s.hasToken) missing.push('el token del PSE');
  return missing;
}
