import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { purchaseCode } from '../common/sequence/clinic-sequence.js';
import { normalizeSearch } from '../common/text/search.js';
import {
  fromDbDate,
  startOfDayIn,
  toDbDate,
} from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  BaseUnit,
  IgvAffectation,
  ProductCategory,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ControlledQuery,
  CountDto,
  CreateProductDto,
  ListProductsQuery,
  OutflowDto,
  PresentationDto,
  PurchaseDto,
  UpdatePresentationDto,
  UpdateProductDto,
} from './dto/inventory.dto.js';
import { documentCode } from '../billing/billing.types.js';
import { addDays, expiryStatus } from './expiry.js';
import type { ExpiryStatus } from './expiry.js';
import { lastUnitCosts } from './last-cost.js';
import { StockService } from './stock.service.js';

const D = Prisma.Decimal;
const PAGE_SIZE = 20;
const KARDEX_PAGE = 30;
/** Ventana del semáforo: lo que vence en 60 días o ya venció */
const EXPIRY_WINDOW = 60;
/** Días desde hoy [desde, hasta] de cada filtro de vencimiento (desde null = sin límite; hasta -1 = vencidos) */
const EXPIRY_RANGES: Partial<Record<string, [number | null, number]>> = {
  expiring: [null, EXPIRY_WINDOW],
  expired: [null, -1],
  exp30: [0, 30],
  exp60: [31, 60],
};

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

export interface PresentationView {
  id: number;
  name: string;
  factor: number;
  price: number | null;
  barcode: string | null;
  active: boolean;
}

/** Lo que no vence por defecto: accesorios (camas, juguetes, correas, collares) */
export const defaultTracksExpiry = (category: ProductCategory) =>
  category !== 'ACCESSORY';

/** Los insumos no se cobran aparte: se descuentan con el servicio o como "insumos usados" */
export const defaultChargeable = (category: ProductCategory) =>
  category !== 'SUPPLY';

export interface ProductSummary {
  id: number;
  code: string | null;
  name: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  totalStock: number;
  minStock: number;
  lowStock: boolean;
  controlled: boolean;
  requiresPrescription: boolean;
  /** Se cobra al cliente (los insumos, no) */
  chargeable: boolean;
  /** Tiene lote y vencimiento (los accesorios, no) */
  tracksExpiry: boolean;
  igv: IgvAffectation;
  active: boolean;
  presentations: PresentationView[];
  nextExpiry:
    (ExpiryStatus & { date: string; lotNumber: string | null }) | null;
  /** Último costo sin IGV por unidad mínima (null si nunca se compró por el sistema) */
  unitCost: number | null;
}

export interface BatchView {
  id: number;
  lotNumber: string | null;
  expiresAt: string | null;
  expiry: ExpiryStatus | null;
  quantity: number;
  initialQuantity: number;
  unitCost: number | null;
  supplier: string | null;
  documentNumber: string | null;
  receivedAt: Date;
  /** Compra (ficha) en la que entró, para abrirla desde el lote */
  purchase: { id: number; code: string } | null;
}

export interface ProductDetail extends Omit<ProductSummary, 'nextExpiry'> {
  barcode: string | null;
  sunatUnit: string;
  igv: IgvAffectation;
  notes: string | null;
  batches: BatchView[];
  usedIn: { id: number; name: string; quantity: number }[];
}

const PRESENTATION_SELECT = {
  id: true,
  name: true,
  factor: true,
  price: true,
  barcode: true,
  active: true,
} as const;

function toPresentation(p: {
  id: number;
  name: string;
  factor: Prisma.Decimal;
  price: Prisma.Decimal | null;
  barcode: string | null;
  active: boolean;
}): PresentationView {
  return { ...p, factor: Number(p.factor), price: num(p.price) };
}

/** Lo que pagó la clínica (costo y proveedor de cada lote) lo ven solo el administrador y el veterinario */
export function withoutCosts(detail: ProductDetail): ProductDetail {
  return {
    ...detail,
    batches: detail.batches.map((b) => ({
      ...b,
      unitCost: null,
      supplier: null,
      documentNumber: null,
      purchase: null,
    })),
  };
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  // ── Catálogo ──

  async list(
    clinicId: number,
    query: ListProductsQuery,
  ): Promise<{
    items: ProductSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const today = await clinicToday(this.prisma, clinicId);
    const where: Prisma.ProductWhereInput = { clinicId };
    const status = query.status ?? 'active';
    if (status !== 'all') where.active = status === 'active';
    if (query.category) where.category = query.category;
    if (query.chargeable) where.chargeable = true;

    const term = normalizeSearch(query.q ?? '');
    if (term) {
      const raw = (query.q ?? '').trim();
      where.OR = [
        { nameSearch: { contains: term } },
        { code: { equals: raw, mode: 'insensitive' } },
        { barcode: raw },
        { presentations: { some: { barcode: raw } } },
      ];
    }
    if (query.filter === 'low') {
      where.id = { in: await this.lowStockIds(clinicId) };
    }
    // Por vencimiento: cada tarjeta su rango, y el que vence antes primero
    const range = EXPIRY_RANGES[query.filter ?? 'all'];
    let ordered: number[] | null = null;
    if (range) {
      const day = (offset: number) => toDbDate(addDays(today, offset));
      const expiresAt =
        range[1] < 0
          ? { lt: day(0) }
          : {
              ...(range[0] !== null ? { gte: day(range[0]) } : {}),
              lte: day(range[1]),
            };
      const groups = await this.prisma.productBatch.groupBy({
        by: ['productId'],
        where: { clinicId, quantity: { gt: 0 }, expiresAt },
        _min: { expiresAt: true },
        orderBy: { _min: { expiresAt: 'asc' } },
      });
      const candidates = groups.map((g) => g.productId);
      const matching = new Set(
        (
          await this.prisma.product.findMany({
            where: { ...where, id: { in: candidates } },
            select: { id: true },
          })
        ).map((p) => p.id),
      );
      ordered = candidates.filter((id) => matching.has(id));
      where.id = {
        in: ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      };
    }

    const [found, counted] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...(ordered ? {} : { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          baseUnit: true,
          totalStock: true,
          minStock: true,
          controlled: true,
          requiresPrescription: true,
          chargeable: true,
          tracksExpiry: true,
          igv: true,
          active: true,
          presentations: {
            where: { active: true },
            select: PRESENTATION_SELECT,
            orderBy: { factor: 'desc' },
          },
          batches: {
            where: { quantity: { gt: 0 }, expiresAt: { not: null } },
            orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { expiresAt: true, lotNumber: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    const rows = ordered
      ? [...found].sort((a, b) => ordered.indexOf(a.id) - ordered.indexOf(b.id))
      : found;
    const total = ordered ? ordered.length : counted;

    const costs = await lastUnitCosts(
      this.prisma,
      clinicId,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map(({ batches, ...p }) => {
        const next = batches[0];
        const date = next ? fromDbDate(next.expiresAt) : null;
        const status = expiryStatus(date, today);
        return {
          ...p,
          totalStock: Number(p.totalStock),
          minStock: Number(p.minStock),
          lowStock: lowStock(p.totalStock, p.minStock),
          presentations: p.presentations.map(toPresentation),
          nextExpiry:
            date && status
              ? { ...status, date, lotNumber: next.lotNumber }
              : null,
          unitCost: costs.get(p.id) ?? null,
        };
      }),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async get(clinicId: number, id: number): Promise<ProductDetail> {
    const today = await clinicToday(this.prisma, clinicId);
    const p = await this.prisma.product.findFirst({
      where: { id, clinicId },
      include: {
        presentations: {
          select: PRESENTATION_SELECT,
          orderBy: [{ active: 'desc' }, { factor: 'desc' }],
        },
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: [
            { expiresAt: { sort: 'asc', nulls: 'last' } },
            { id: 'asc' },
          ],
          include: { purchase: { select: { id: true, number: true } } },
        },
        usedIn: {
          select: {
            quantity: true,
            service: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('El producto no existe');
    const costs = await lastUnitCosts(this.prisma, clinicId, [p.id]);
    return {
      unitCost: costs.get(p.id) ?? null,
      id: p.id,
      code: p.code,
      barcode: p.barcode,
      name: p.name,
      category: p.category,
      baseUnit: p.baseUnit,
      totalStock: Number(p.totalStock),
      minStock: Number(p.minStock),
      lowStock: lowStock(p.totalStock, p.minStock),
      controlled: p.controlled,
      requiresPrescription: p.requiresPrescription,
      chargeable: p.chargeable,
      tracksExpiry: p.tracksExpiry,
      sunatUnit: p.sunatUnit,
      igv: p.igv,
      notes: p.notes,
      active: p.active,
      presentations: p.presentations.map(toPresentation),
      batches: p.batches.map((b) => {
        const expiresAt = fromDbDate(b.expiresAt);
        return {
          id: b.id,
          lotNumber: b.lotNumber,
          expiresAt,
          expiry: expiryStatus(expiresAt, today),
          quantity: Number(b.quantity),
          initialQuantity: Number(b.initialQuantity),
          unitCost: num(b.unitCost),
          supplier: b.supplier,
          documentNumber: b.documentNumber,
          receivedAt: b.receivedAt,
          purchase: b.purchase
            ? { id: b.purchase.id, code: purchaseCode(b.purchase.number) }
            : null,
        };
      }),
      usedIn: p.usedIn.map((u) => ({
        id: u.service.id,
        name: u.service.name,
        quantity: Number(u.quantity),
      })),
    };
  }

  async create(
    actor: AuthUser,
    dto: CreateProductDto,
    ip?: string,
  ): Promise<ProductDetail> {
    assertUniqueNames(dto.presentations);
    assertIgvChange(actor, 'TAXED', dto.igv);
    let id: number;
    try {
      ({ id } = await this.prisma.product.create({
        data: {
          clinicId: actor.clinicId,
          code: dto.code ?? null,
          barcode: dto.barcode ?? null,
          name: dto.name,
          nameSearch: normalizeSearch(dto.name).slice(0, 120),
          category: dto.category,
          baseUnit: dto.baseUnit,
          minStock: dto.minStock ?? 0,
          requiresPrescription: dto.requiresPrescription ?? false,
          controlled: dto.controlled ?? false,
          chargeable: dto.chargeable ?? defaultChargeable(dto.category),
          tracksExpiry: dto.tracksExpiry ?? defaultTracksExpiry(dto.category),
          sunatUnit: dto.sunatUnit ?? 'NIU',
          igv: dto.igv ?? 'TAXED',
          notes: dto.notes ?? null,
          presentations: {
            create: dto.presentations.map((pr) => ({
              clinicId: actor.clinicId,
              name: pr.name,
              factor: pr.factor,
              price: pr.price ?? null,
              barcode: pr.barcode ?? null,
            })),
          },
        },
        select: { id: true },
      }));
    } catch (error) {
      throw duplicate(error, 'Ya existe un producto con ese código');
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'product.create',
      entity: 'product',
      entityId: id,
      ip,
      data: { name: dto.name, controlled: dto.controlled ?? false },
    });
    return this.get(actor.clinicId, id);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateProductDto,
    ip?: string,
  ): Promise<ProductDetail> {
    const current = await this.prisma.product.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        baseUnit: true,
        controlled: true,
        tracksExpiry: true,
        active: true,
        igv: true,
        _count: { select: { movements: true } },
      },
    });
    if (!current) throw new NotFoundException('El producto no existe');
    if (
      dto.baseUnit &&
      dto.baseUnit !== current.baseUnit &&
      current._count.movements > 0
    )
      throw new BadRequestException(
        'No se puede cambiar la unidad mínima de un producto con movimientos: crea uno nuevo',
      );

    // Desactivar un insumo de servicios dejaría esos servicios descontando de un producto oculto
    if (dto.active === false && current.active) {
      const services = await this.prisma.careService.findMany({
        where: {
          clinicId: actor.clinicId,
          active: true,
          supplies: { some: { productId: id } },
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      if (services.length)
        throw new BadRequestException(
          `Se usa como insumo en ${services.map((s) => s.name).join(', ')}: quítalo de ${
            services.length === 1 ? 'ese servicio' : 'esos servicios'
          } (Servicios y precios) antes de desactivarlo`,
        );
    }

    assertIgvChange(actor, current.igv, dto.igv);
    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.nameSearch = normalizeSearch(dto.name).slice(0, 120);
    }
    for (const key of [
      'code',
      'barcode',
      'category',
      'baseUnit',
      'minStock',
      'requiresPrescription',
      'controlled',
      'chargeable',
      'tracksExpiry',
      'sunatUnit',
      'igv',
      'notes',
      'active',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(data, { [key]: dto[key] });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data });
        // Si deja de vencer, sus lotes ya no se marcan como vencidos ni por vencer
        if (dto.tracksExpiry === false && current.tracksExpiry)
          await tx.productBatch.updateMany({
            where: { productId: id },
            data: { expiresAt: null },
          });
      });
    } catch (error) {
      throw duplicate(error, 'Ya existe un producto con ese código');
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'product.update',
      entity: 'product',
      entityId: id,
      ip,
      data: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue,
    });
    return this.get(actor.clinicId, id);
  }

  async addPresentation(
    actor: AuthUser,
    productId: number,
    dto: PresentationDto,
    ip?: string,
  ): Promise<PresentationView> {
    await this.ensureProduct(actor.clinicId, productId);
    try {
      const created = await this.prisma.productPresentation.create({
        data: {
          clinicId: actor.clinicId,
          productId,
          name: dto.name,
          factor: dto.factor,
          price: dto.price ?? null,
          barcode: dto.barcode ?? null,
        },
        select: PRESENTATION_SELECT,
      });
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        action: 'product.presentation_add',
        entity: 'product',
        entityId: productId,
        ip,
        data: { name: dto.name, factor: dto.factor, price: dto.price ?? null },
      });
      return toPresentation(created);
    } catch (error) {
      throw duplicate(error, 'Ya existe una presentación con ese nombre');
    }
  }

  async updatePresentation(
    actor: AuthUser,
    id: number,
    dto: UpdatePresentationDto,
    ip?: string,
  ): Promise<PresentationView> {
    const current = await this.prisma.productPresentation.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { productId: true, price: true, name: true },
    });
    if (!current) throw new NotFoundException('La presentación no existe');
    let updated;
    try {
      updated = await this.prisma.productPresentation.update({
        where: { id },
        data: {
          name: dto.name,
          factor: dto.factor,
          price: dto.price,
          barcode: dto.barcode,
          active: dto.active,
        },
        select: PRESENTATION_SELECT,
      });
    } catch (error) {
      throw duplicate(error, 'Ya existe una presentación con ese nombre');
    }
    // Los cambios de precio quedan en la bitácora: protegen al dueño
    const before = num(current.price);
    if (dto.price !== undefined && dto.price !== before) {
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        action: 'product.price_change',
        entity: 'product',
        entityId: current.productId,
        ip,
        data: { presentation: current.name, before, after: dto.price },
      });
    }
    return toPresentation(updated);
  }

  // ── Movimientos de stock ──

  /** Ingreso de compra: 5 "Caja x 100" = 500 unidades mínimas en un lote nuevo. */
  async purchase(
    actor: AuthUser,
    productId: number,
    dto: PurchaseDto,
    ip?: string,
  ): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, clinicId: actor.clinicId },
      select: { tracksExpiry: true, active: true, controlled: true },
    });
    if (!product) throw new NotFoundException('El producto no existe');
    if (!product.active)
      throw new BadRequestException(
        'El producto está inactivo: actívalo antes de ingresar stock',
      );
    // Controlados: DIGEMID pide el lote de cada entrada
    if (product.controlled && !dto.lotNumber)
      throw new BadRequestException('Ingresa el número de lote');
    const supplier = dto.supplierId
      ? await this.prisma.supplier.findFirst({
          where: { id: dto.supplierId, clinicId: actor.clinicId },
          select: { id: true, name: true },
        })
      : null;
    if (dto.supplierId && !supplier)
      throw new BadRequestException('El proveedor no existe');
    const presentation = await this.presentationOf(
      actor.clinicId,
      productId,
      dto.presentationId,
    );
    const today = await clinicToday(this.prisma, actor.clinicId);

    // Lo que vence pide lote y vencimiento; lo que no vence (camas, juguetes) no guarda fecha
    if (product.tracksExpiry) {
      if (!dto.lotNumber)
        throw new BadRequestException('Ingresa el número de lote');
      if (!dto.expiresAt)
        throw new BadRequestException('Ingresa la fecha de vencimiento');
    }
    const expiresAt = product.tracksExpiry ? (dto.expiresAt ?? null) : null;
    if (expiresAt) {
      if (fromDbDate(toDbDate(expiresAt)) !== expiresAt)
        throw new BadRequestException('La fecha de vencimiento no es válida');
      if (expiresAt < today)
        throw new BadRequestException(
          'Ese lote ya está vencido: no se puede ingresar',
        );
    }

    const quantity = new D(dto.quantity).times(presentation.factor);
    const unitCost =
      dto.costPerPresentation == null
        ? null
        : new D(dto.costPerPresentation)
            .div(presentation.factor)
            .toDecimalPlaces(4);

    const { batchId } = await this.prisma.$transaction((tx) =>
      this.stock.receive(tx, {
        clinicId: actor.clinicId,
        productId,
        userId: actor.id,
        quantity,
        lotNumber: dto.lotNumber ?? null,
        expiresAt,
        unitCost,
        supplier: supplier?.name ?? dto.supplier ?? null,
        supplierId: supplier?.id ?? null,
        documentNumber: dto.documentNumber ?? null,
      }),
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'stock.purchase',
      entity: 'product',
      entityId: productId,
      ip,
      data: {
        batchId,
        presentation: presentation.name,
        presentations: dto.quantity,
        units: Number(quantity),
        documentNumber: dto.documentNumber ?? null,
      },
    });
    return this.get(actor.clinicId, productId);
  }

  /**
   * Merma (vencido, roto, perdido) o uso interno/aplicación a un paciente.
   * En un controlado aplicado a un paciente se exigen paciente, receta y un veterinario colegiado.
   */
  async outflow(
    actor: AuthUser,
    productId: number,
    dto: OutflowDto,
    ip?: string,
  ): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, clinicId: actor.clinicId },
      select: { controlled: true },
    });
    if (!product) throw new NotFoundException('El producto no existe');

    let quantity = new D(dto.quantity);
    if (dto.presentationId) {
      const presentation = await this.presentationOf(
        actor.clinicId,
        productId,
        dto.presentationId,
      );
      quantity = quantity.times(presentation.factor);
    }

    let vetId: number | null = null;
    if (dto.petId) {
      const pet = await this.prisma.pet.findFirst({
        where: { id: dto.petId, clinicId: actor.clinicId },
        select: { id: true },
      });
      if (!pet) throw new NotFoundException('La mascota no existe');
    }
    if (dto.type === 'TREATMENT' && (product.controlled || dto.petId)) {
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { licenseNumber: true },
      });
      if (product.controlled) {
        if (!dto.petId)
          throw new BadRequestException('Indica el paciente al que se aplicó');
        if (!dto.prescriptionRef)
          throw new BadRequestException('Indica el N.º de receta');
        if (!me.licenseNumber)
          throw new ForbiddenException(
            'Solo un veterinario con colegiatura registra la aplicación de un controlado',
          );
      }
      vetId = me.licenseNumber ? actor.id : null;
    }

    const today = await clinicToday(this.prisma, actor.clinicId);
    const lines = await this.prisma.$transaction((tx) =>
      this.stock.deduct(tx, {
        clinicId: actor.clinicId,
        productId,
        quantity,
        type: dto.type,
        userId: actor.id,
        today,
        reason: dto.reason,
        batchId: dto.batchId ?? null,
        includeExpired: dto.type === 'WASTE',
        petId: dto.petId ?? null,
        vetId,
        prescriptionRef: dto.prescriptionRef ?? null,
      }),
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: dto.type === 'WASTE' ? 'stock.waste' : 'stock.treatment',
      entity: 'product',
      entityId: productId,
      ip,
      data: {
        units: Number(quantity),
        batches: lines.map((l) => l.batchId),
        reason: dto.reason,
        petId: dto.petId ?? null,
      },
    });
    return this.get(actor.clinicId, productId);
  }

  /** Conteo físico: solo el administrador, con motivo. */
  async count(
    actor: AuthUser,
    productId: number,
    dto: CountDto,
    ip?: string,
  ): Promise<ProductDetail> {
    const lines = await this.prisma.$transaction((tx) =>
      this.stock.adjustCount(tx, {
        clinicId: actor.clinicId,
        productId,
        userId: actor.id,
        reason: dto.reason,
        items: dto.items.map((i) => ({
          batchId: i.batchId,
          counted: new D(i.counted),
        })),
      }),
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'stock.count_adjust',
      entity: 'product',
      entityId: productId,
      ip,
      data: {
        reason: dto.reason,
        adjustments: lines.map((l) => ({
          batchId: l.batchId,
          diff: Number(l.quantity),
        })),
      },
    });
    return this.get(actor.clinicId, productId);
  }

  // ── Consultas ──

  /** Kardex del producto, del más reciente al más antiguo. */
  async movements(clinicId: number, productId: number, page = 1) {
    await this.ensureProduct(clinicId, productId);
    const where = { clinicId, productId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * KARDEX_PAGE,
        take: KARDEX_PAGE,
        select: {
          id: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          reason: true,
          prescriptionRef: true,
          createdAt: true,
          /** 'charge' = salió por un cargo (servicio o venta), no a mano */
          refType: true,
          refId: true,
          batch: { select: { id: true, lotNumber: true } },
          user: { select: { fullName: true } },
          vet: { select: { fullName: true } },
          pet: { select: { id: true, name: true, clientId: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const sales = await this.salesOf(
      clinicId,
      rows.flatMap((m) => (m.refType === 'charge' && m.refId ? [m.refId] : [])),
    );
    return {
      items: rows.map(({ refId, ...m }) => ({
        ...m,
        id: Number(m.id),
        quantity: Number(m.quantity),
        balanceAfter: Number(m.balanceAfter),
        /** Venta suelta: a quién y con qué comprobante (el kardex no repite el producto) */
        sale: (m.refType === 'charge' && refId && sales.get(refId)) || null,
      })),
      total,
      page,
      pageSize: KARDEX_PAGE,
    };
  }

  /** De cada cargo de producto (venta suelta): el cliente y el comprobante vigente del cobro */
  private async salesOf(
    clinicId: number,
    chargeIds: number[],
  ): Promise<Map<number, { client: string; document: string | null }>> {
    if (!chargeIds.length) return new Map();
    const charges = await this.prisma.charge.findMany({
      where: { clinicId, id: { in: chargeIds }, kind: 'PRODUCT' },
      select: {
        id: true,
        client: { select: { name: true } },
        allocations: { select: { receiptId: true }, take: 1 },
      },
    });
    const receiptIds = charges.flatMap((c) =>
      c.allocations.map((a) => a.receiptId),
    );
    const docs = receiptIds.length
      ? await this.prisma.electronicDocument.findMany({
          where: {
            clinicId,
            receiptId: { in: receiptIds },
            type: { in: ['BOLETA', 'FACTURA'] },
            status: { not: 'REJECTED' },
          },
          orderBy: { id: 'desc' },
          select: { receiptId: true, series: true, number: true },
        })
      : [];
    const docOf = new Map<number, string>();
    for (const d of docs)
      if (d.receiptId && !docOf.has(d.receiptId))
        docOf.set(d.receiptId, documentCode(d.series, d.number));
    return new Map(
      charges.map((c) => [
        c.id,
        {
          client: c.client.name,
          document: docOf.get(c.allocations[0]?.receiptId ?? -1) ?? null,
        },
      ]),
    );
  }

  /** Semáforo de vencimientos y stock bajo (para la lista y el dashboard). */
  async alerts(clinicId: number) {
    const today = await clinicToday(this.prisma, clinicId);
    const base = { clinicId, quantity: { gt: 0 }, product: { active: true } };
    const t = (offset: number) => toDbDate(addDays(today, offset));
    const [expired, red, yellow, soon, lowIds] = await Promise.all([
      this.prisma.productBatch.count({
        where: { ...base, expiresAt: { lt: t(0) } },
      }),
      this.prisma.productBatch.count({
        where: { ...base, expiresAt: { gte: t(0), lte: t(30) } },
      }),
      this.prisma.productBatch.count({
        where: { ...base, expiresAt: { gt: t(30), lte: t(60) } },
      }),
      this.prisma.productBatch.findMany({
        where: { ...base, expiresAt: { lte: t(EXPIRY_WINDOW) } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: 10,
        select: {
          id: true,
          lotNumber: true,
          expiresAt: true,
          quantity: true,
          product: { select: { id: true, name: true, baseUnit: true } },
        },
      }),
      this.lowStockIds(clinicId),
    ]);
    const low = lowIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: lowIds } },
          orderBy: { name: 'asc' },
          take: 10,
          select: {
            id: true,
            name: true,
            baseUnit: true,
            totalStock: true,
            minStock: true,
          },
        })
      : [];
    return {
      expired,
      red,
      yellow,
      lowStock: lowIds.length,
      batches: soon.map((b) => {
        const expiresAt = fromDbDate(b.expiresAt);
        return {
          id: b.id,
          lotNumber: b.lotNumber,
          expiresAt,
          expiry: expiryStatus(expiresAt, today),
          quantity: Number(b.quantity),
          product: b.product,
        };
      }),
      low: low.map((p) => ({
        ...p,
        totalStock: Number(p.totalStock),
        minStock: Number(p.minStock),
      })),
    };
  }

  /** Libro de controlados: cada movimiento con paciente, dueño, veterinario, lote y receta. */
  async controlled(clinicId: number, query: ControlledQuery) {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = startOfDayIn(timezone, query.from);
    if (query.to) createdAt.lt = startOfDayIn(timezone, addDays(query.to, 1));
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        clinicId,
        product: { controlled: true },
        ...(query.from || query.to ? { createdAt } : {}),
      },
      orderBy: { id: 'desc' },
      take: 500,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        reason: true,
        prescriptionRef: true,
        createdAt: true,
        product: { select: { id: true, name: true, baseUnit: true } },
        batch: {
          select: { lotNumber: true, supplier: true, documentNumber: true },
        },
        user: { select: { fullName: true } },
        vet: { select: { fullName: true, licenseNumber: true } },
        pet: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    });
    return rows.map((m) => ({
      ...m,
      id: Number(m.id),
      quantity: Number(m.quantity),
      balanceAfter: Number(m.balanceAfter),
    }));
  }

  // ── Ayudantes ──

  private async lowStockIds(clinicId: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT id FROM products
      WHERE clinic_id = ${clinicId} AND active AND min_stock > 0 AND total_stock <= min_stock`);
    return rows.map((r) => r.id);
  }

  private async ensureProduct(clinicId: number, id: number): Promise<void> {
    const found = await this.prisma.product.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('El producto no existe');
  }

  private async presentationOf(
    clinicId: number,
    productId: number,
    id: number,
  ) {
    const presentation = await this.prisma.productPresentation.findFirst({
      where: { id, productId, clinicId, active: true },
      select: { name: true, factor: true },
    });
    if (!presentation)
      throw new BadRequestException(
        'Elige una presentación válida del producto',
      );
    return presentation;
  }
}

function lowStock(total: Prisma.Decimal, min: Prisma.Decimal): boolean {
  return Number(min) > 0 && Number(total) <= Number(min);
}

function assertUniqueNames(presentations: { name: string }[]): void {
  const names = presentations.map((p) => normalizeSearch(p.name));
  if (new Set(names).size !== names.length)
    throw new BadRequestException('Hay dos presentaciones con el mismo nombre');
}

function duplicate(error: unknown, message: string): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    return new ConflictException(message);
  return error;
}

/**
 * El IGV decide cuánto impuesto declara la clínica: un producto mal marcado como exonerado
 * paga menos de lo debido y SUNAT no lo detecta al emitir. Solo el administrador lo cambia.
 */
function assertIgvChange(
  actor: AuthUser,
  current: IgvAffectation,
  next: IgvAffectation | undefined,
): void {
  if (next !== undefined && next !== current && actor.role !== 'ADMIN')
    throw new ForbiddenException(
      'El IGV del producto lo cambia el administrador (consúltalo con el contador)',
    );
}
