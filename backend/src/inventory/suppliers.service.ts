import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { normalizeSearch } from '../common/text/search.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ListSuppliersQuery,
  SupplierDto,
  UpdateSupplierDto,
} from './dto/purchases.dto.js';

export interface SupplierView {
  id: number;
  name: string;
  ruc: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  purchases: number;
  lastPurchaseAt: string | null;
  /** Comprado en el año (sin anuladas, con IGV): solo para el administrador */
  yearTotal?: number;
}

const SELECT = {
  id: true,
  name: true,
  ruc: true,
  contact: true,
  phone: true,
  email: true,
  notes: true,
  active: true,
} satisfies Prisma.SupplierSelect;

/** El total en dinero por proveedor es información del dueño */
export const canSeeTotals = (role: Role) => role === 'ADMIN';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    role: Role,
    query: ListSuppliersQuery,
  ): Promise<SupplierView[]> {
    const q = query.q ? normalizeSearch(query.q) : '';
    const rows = await this.prisma.supplier.findMany({
      where: {
        clinicId,
        ...(query.all ? {} : { active: true }),
        ...(q
          ? {
              OR: [
                { nameSearch: { contains: q } },
                { ruc: { startsWith: q.replace(/\D/g, '') || '-' } },
              ],
            }
          : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: 300,
      select: SELECT,
    });
    return this.withStats(clinicId, role, rows);
  }

  async get(clinicId: number, role: Role, id: number): Promise<SupplierView> {
    const row = await this.prisma.supplier.findFirst({
      where: { id, clinicId },
      select: SELECT,
    });
    if (!row) throw new NotFoundException('El proveedor no existe');
    return (await this.withStats(clinicId, role, [row]))[0];
  }

  async create(
    actor: AuthUser,
    dto: SupplierDto,
    ip?: string,
  ): Promise<SupplierView> {
    await this.ensureUnique(actor.clinicId, dto);
    const row = await this.prisma.supplier
      .create({
        data: {
          clinicId: actor.clinicId,
          ...this.data(dto),
        },
        select: SELECT,
      })
      .catch(duplicate);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'supplier.create',
      entity: 'supplier',
      entityId: row.id,
      ip,
      data: { name: row.name, ruc: row.ruc },
    });
    return this.get(actor.clinicId, actor.role, row.id);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateSupplierDto,
    ip?: string,
  ): Promise<SupplierView> {
    const current = await this.prisma.supplier.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { id: true, name: true },
    });
    if (!current) throw new NotFoundException('El proveedor no existe');
    await this.ensureUnique(actor.clinicId, dto, id);
    await this.prisma
      .$transaction(async (tx) => {
        await tx.supplier.update({
          where: { id },
          data: {
            ...this.data(dto),
            ...(dto.active === undefined ? {} : { active: dto.active }),
          },
        });
        // El nombre copiado en los lotes sigue al de la lista (kardex y ficha del producto)
        if (current.name !== dto.name)
          await tx.productBatch.updateMany({
            where: { clinicId: actor.clinicId, supplierId: id },
            data: { supplier: dto.name },
          });
      })
      .catch(duplicate);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'supplier.update',
      entity: 'supplier',
      entityId: id,
      ip,
      data: { name: dto.name, ruc: dto.ruc ?? null, active: dto.active },
    });
    return this.get(actor.clinicId, actor.role, id);
  }

  /**
   * Une dos proveedores repetidos ("Distrib. Vet" y "DISTRIBUIDORA VET SAC"): las compras y los
   * lotes del primero pasan al segundo y el primero se borra.
   */
  async merge(
    actor: AuthUser,
    fromId: number,
    intoId: number,
    ip?: string,
  ): Promise<SupplierView> {
    if (fromId === intoId)
      throw new BadRequestException('Elige otro proveedor para unirlo');
    const both = await this.prisma.supplier.findMany({
      where: { id: { in: [fromId, intoId] }, clinicId: actor.clinicId },
      select: { id: true, name: true, ruc: true },
    });
    const from = both.find((s) => s.id === fromId);
    const into = both.find((s) => s.id === intoId);
    if (!from || !into) throw new NotFoundException('El proveedor no existe');
    if (from.ruc && into.ruc && from.ruc !== into.ruc)
      throw new ConflictException(
        'Tienen RUC distintos: son proveedores diferentes',
      );

    await this.prisma
      .$transaction(async (tx) => {
        await tx.purchase.updateMany({
          where: { clinicId: actor.clinicId, supplierId: fromId },
          data: { supplierId: intoId },
        });
        await tx.productBatch.updateMany({
          where: { clinicId: actor.clinicId, supplierId: fromId },
          data: { supplierId: intoId, supplier: into.name },
        });
        await tx.supplier.delete({ where: { id: fromId } });
        // Si solo el que se borra tenía RUC, el que queda lo hereda
        if (!into.ruc && from.ruc)
          await tx.supplier.update({
            where: { id: intoId },
            data: { ruc: from.ruc },
          });
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Los dos tienen registrada la misma ficha de compra: anula la repetida antes de unirlos',
          );
        throw error;
      });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'supplier.merge',
      entity: 'supplier',
      entityId: intoId,
      ip,
      data: { from: from.name, into: into.name },
    });
    return this.get(actor.clinicId, actor.role, intoId);
  }

  private data(dto: SupplierDto) {
    return {
      name: dto.name,
      nameSearch: normalizeSearch(dto.name).slice(0, 150),
      ruc: dto.ruc ?? null,
      contact: dto.contact ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      notes: dto.notes ?? null,
    };
  }

  /** Mensajes claros antes de chocar con la base: RUC repetido o el mismo nombre */
  private async ensureUnique(
    clinicId: number,
    dto: SupplierDto,
    exceptId?: number,
  ): Promise<void> {
    const nameSearch = normalizeSearch(dto.name);
    const other = await this.prisma.supplier.findFirst({
      where: {
        clinicId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [{ nameSearch }, ...(dto.ruc ? [{ ruc: dto.ruc }] : [])],
      },
      select: { name: true, ruc: true },
    });
    if (!other) return;
    throw new ConflictException(
      dto.ruc && other.ruc === dto.ruc
        ? `Ese RUC ya está registrado: ${other.name}`
        : `Ya existe un proveedor con ese nombre: ${other.name}`,
    );
  }

  private async withStats(
    clinicId: number,
    role: Role,
    rows: Prisma.SupplierGetPayload<{ select: typeof SELECT }>[],
  ): Promise<SupplierView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const year = Number((await clinicToday(this.prisma, clinicId)).slice(0, 4));
    const stats = await this.prisma.$queryRaw<
      {
        supplier_id: number;
        n: bigint;
        last_at: Date | null;
        year_total: Prisma.Decimal | null;
      }[]
    >(Prisma.sql`
      SELECT supplier_id, count(*) AS n, max(issued_at) AS last_at,
             sum(total) FILTER (WHERE issued_at >= make_date(${year}, 1, 1)) AS year_total
      FROM purchases
      WHERE clinic_id = ${clinicId} AND status = 'RECEIVED'
        AND supplier_id IN (${Prisma.join(ids)})
      GROUP BY supplier_id`);
    const totals = canSeeTotals(role);
    return rows.map((r) => {
      const s = stats.find((x) => x.supplier_id === r.id);
      return {
        ...r,
        purchases: Number(s?.n ?? 0),
        lastPurchaseAt: s?.last_at
          ? s.last_at.toISOString().slice(0, 10)
          : null,
        ...(totals ? { yearTotal: Number(s?.year_total ?? 0) } : {}),
      };
    });
  }
}

function duplicate(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    throw new ConflictException('Ya existe un proveedor con ese RUC');
  throw error;
}
