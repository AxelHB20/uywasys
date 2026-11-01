import {
  BadRequestException,
  ConflictException,
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
import { PrismaService } from '../prisma/prisma.service.js';
import { amountInWords } from './amount-in-words.js';
import type { BillingSettingsDto, DocumentsQuery } from './billing.dto.js';
import {
  BillingProviderClient,
  DocumentLine,
  documentCode,
  OutgoingDocument,
  ProviderConfig,
  ProviderError,
} from './billing.types.js';
import { buildLines, customerFor } from './document-builder.js';
import { NubefactProvider } from './providers/nubefact.provider.js';
import { SimulatedProvider } from './providers/simulated.provider.js';
import { SecretBox } from './secret-box.js';

type Tx = Prisma.TransactionClient;
const PAGE_SIZE = 50;

export interface BillingSettingsView {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  legalName: string | null;
  apiUrl: string | null;
  /** El token nunca sale del servidor: solo si hay uno guardado */
  hasToken: boolean;
  boletaSeries: string;
  facturaSeries: string;
  boletaCreditSeries: string;
  facturaCreditSeries: string;
  /** Faltantes para activar (RUC de la clínica, ruta, token…) */
  missing: string[];
}

export interface BillingStatus {
  enabled: boolean;
  provider: BillingProvider;
  production: boolean;
  /** true = los comprobantes no van a SUNAT (demo) */
  simulated: boolean;
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
  pdfUrl: string | null;
  xmlUrl: string | null;
  cdrUrl: string | null;
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
  related: { select: { series: true, number: true } },
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
  pdfUrl: d.pdfUrl,
  xmlUrl: d.xmlUrl,
  cdrUrl: d.cdrUrl,
});

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
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
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
        select: { ruc: true },
      }),
    ]);
    const s = row ?? {
      enabled: false,
      provider: 'SIMULATED' as const,
      production: false,
      legalName: null,
      apiUrl: null,
      apiTokenEnc: null,
      boletaSeries: 'B001',
      facturaSeries: 'F001',
      boletaCreditSeries: 'BC01',
      facturaCreditSeries: 'FC01',
    };
    return {
      enabled: s.enabled,
      provider: s.provider,
      production: s.production,
      legalName: s.legalName,
      apiUrl: s.apiUrl,
      hasToken: !!s.apiTokenEnc,
      boletaSeries: s.boletaSeries,
      facturaSeries: s.facturaSeries,
      boletaCreditSeries: s.boletaCreditSeries,
      facturaCreditSeries: s.facturaCreditSeries,
      missing: missingFor({
        provider: s.provider,
        apiUrl: s.apiUrl,
        hasToken: !!s.apiTokenEnc,
        legalName: s.legalName,
        ruc: clinic.ruc,
      }),
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
    };
  }

  async updateSettings(
    actor: AuthUser,
    dto: BillingSettingsDto,
    ip?: string,
  ): Promise<BillingSettingsView> {
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
    if (dto.enabled) {
      const missing = missingFor({
        provider: dto.provider,
        apiUrl: dto.apiUrl ?? null,
        hasToken: !!apiTokenEnc,
        legalName: dto.legalName ?? null,
        ruc: clinic.ruc,
      });
      if (missing.length)
        throw new BadRequestException(
          `Para activar la facturación falta: ${missing.join(', ')}`,
        );
    }
    if (dto.production && dto.provider === 'SIMULATED')
      throw new BadRequestException(
        'La simulación no puede estar en producción: elige el PSE',
      );
    const data = {
      enabled: dto.enabled,
      provider: dto.provider,
      production: dto.production,
      legalName: dto.legalName ?? null,
      apiUrl: dto.apiUrl ?? null,
      apiTokenEnc,
      boletaSeries: dto.boletaSeries,
      facturaSeries: dto.facturaSeries,
      boletaCreditSeries: dto.boletaCreditSeries,
      facturaCreditSeries: dto.facturaCreditSeries,
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
      },
    });
    return this.settings(actor.clinicId);
  }

  /** Prueba la ruta y el token guardados, sin emitir nada. */
  async test(clinicId: number): Promise<{ ok: true; message: string }> {
    const s = await this.prisma.billingSettings.findUnique({
      where: { clinicId },
    });
    if (!s) throw new BadRequestException('Primero guarda la configuración');
    try {
      await this.providers[s.provider].check(this.providerConfig(s));
    } catch (error) {
      throw new BadRequestException(
        error instanceof ProviderError
          ? error.message
          : 'No se pudo conectar con el PSE',
      );
    }
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
  }): ProviderConfig {
    return {
      url: s.apiUrl,
      token: s.apiTokenEnc ? this.box.open(s.apiTokenEnc) : null,
      production: s.production,
    };
  }

  // ── Emisión (dentro de la transacción del cobro) ──

  /** Emite la boleta o factura de un cobro recién creado. Devuelve el id del comprobante. */
  async issueInTx(
    tx: Tx,
    actor: AuthUser,
    receiptId: number,
    kind: 'BOLETA' | 'FACTURA',
  ): Promise<number> {
    const settings = await tx.billingSettings.findUnique({
      where: { clinicId: actor.clinicId },
    });
    if (!settings?.enabled)
      throw new BadRequestException(
        'La facturación electrónica no está activada: emite una nota de venta o actívala en Configuración',
      );
    const receipt = await tx.receipt.findFirstOrThrow({
      where: { id: receiptId, clinicId: actor.clinicId },
      select: {
        client: {
          select: {
            name: true,
            docType: true,
            docNumber: true,
            address: true,
            walkIn: true,
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
    const customer = customerFor(kind, receipt.client, totals.total);
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
   * Al anular un cobro con boleta o factura, se emite su nota de crédito (motivo 01, anulación de
   * la operación). Si SUNAT había rechazado el comprobante, no hace falta.
   */
  async creditNoteInTx(
    tx: Tx,
    actor: AuthUser,
    receiptId: number,
    reason: string,
  ): Promise<number | null> {
    const original = await tx.electronicDocument.findFirst({
      where: {
        clinicId: actor.clinicId,
        receiptId,
        type: { in: ['BOLETA', 'FACTURA'] },
      },
      include: { creditNotes: { select: { id: true } } },
    });
    if (
      !original ||
      original.status === 'REJECTED' ||
      original.creditNotes.length
    )
      return null;
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
  }> {
    const d = await this.prisma.electronicDocument.findUniqueOrThrow({
      where: { id },
      include: {
        related: {
          select: { type: true, series: true, number: true, status: true },
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
    if (query.status === 'PROBLEMS')
      where.status = { in: ['ERROR', 'REJECTED'] };
    else if (query.status) where.status = query.status;
    if (query.from || query.to)
      where.issueDate = {
        ...(query.from ? { gte: toDbDate(query.from) } : {}),
        ...(query.to ? { lte: toDbDate(query.to) } : {}),
      };
    const [rows, total, problems] = await this.prisma.$transaction([
      this.prisma.electronicDocument.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: SUMMARY_SELECT,
      }),
      this.prisma.electronicDocument.count({ where }),
      this.prisma.electronicDocument.count({
        where: { clinicId, status: { in: ['ERROR', 'REJECTED'] } },
      }),
    ]);
    return {
      items: rows.map(toSummary),
      total,
      page,
      pageSize: PAGE_SIZE,
      problems,
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
    const d = await this.prisma.electronicDocument.findFirst({
      where: { clinicId, receiptId, type: { in: ['BOLETA', 'FACTURA'] } },
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
  ruc: string | null;
}): string[] {
  const missing: string[] = [];
  if (s.provider === 'SIMULATED') return missing;
  if (!s.ruc) missing.push('el RUC de la clínica (Configuración → Clínica)');
  if (!s.legalName) missing.push('la razón social');
  if (!s.apiUrl) missing.push('la ruta del PSE');
  if (!s.hasToken) missing.push('el token del PSE');
  return missing;
}
