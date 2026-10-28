import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  BaseUnit,
  CareServiceCategory,
  IgvAffectation,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCareServiceDto,
  SupplyDto,
  UpdateCareServiceDto,
} from './care-service.dto.js';

export interface CareServiceView {
  id: number;
  name: string;
  category: CareServiceCategory;
  price: number;
  igv: IgvAffectation;
  durationMin: number | null;
  active: boolean;
  supplies: {
    productId: number;
    name: string;
    baseUnit: BaseUnit;
    quantity: number;
  }[];
}

const SELECT = {
  id: true,
  name: true,
  category: true,
  price: true,
  igv: true,
  durationMin: true,
  active: true,
  supplies: {
    select: {
      quantity: true,
      product: { select: { id: true, name: true, baseUnit: true } },
    },
  },
} satisfies Prisma.CareServiceSelect;

type Row = Prisma.CareServiceGetPayload<{ select: typeof SELECT }>;

/** Catálogo de servicios. Los insumos se descuentan del inventario al cobrar (Fase 4). */
@Injectable()
export class CareServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clinicId: number,
    status: 'active' | 'inactive' | 'all' = 'active',
  ) {
    const rows = await this.prisma.careService.findMany({
      where: {
        clinicId,
        ...(status === 'all' ? {} : { active: status === 'active' }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: SELECT,
    });
    return rows.map(toView);
  }

  async create(
    actor: AuthUser,
    dto: CreateCareServiceDto,
    ip?: string,
  ): Promise<CareServiceView> {
    await this.checkSupplies(actor.clinicId, dto.supplies);
    let row: Row;
    try {
      row = await this.prisma.careService.create({
        data: {
          clinicId: actor.clinicId,
          name: dto.name,
          category: dto.category,
          price: dto.price,
          igv: dto.igv ?? 'TAXED',
          durationMin: dto.durationMin ?? null,
          supplies: dto.supplies?.length
            ? {
                create: dto.supplies.map((s) => ({
                  productId: s.productId,
                  quantity: s.quantity,
                })),
              }
            : undefined,
        },
        select: SELECT,
      });
    } catch (error) {
      throw duplicate(error);
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'service.create',
      entity: 'care_service',
      entityId: row.id,
      ip,
      data: { name: row.name, price: dto.price },
    });
    return toView(row);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateCareServiceDto,
    ip?: string,
  ): Promise<CareServiceView> {
    const current = await this.prisma.careService.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { price: true, name: true },
    });
    if (!current) throw new NotFoundException('El servicio no existe');
    await this.checkSupplies(actor.clinicId, dto.supplies);

    let row: Row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        if (dto.supplies) {
          // Los insumos se reemplazan completos
          await tx.careServiceSupply.deleteMany({ where: { serviceId: id } });
          if (dto.supplies.length)
            await tx.careServiceSupply.createMany({
              data: dto.supplies.map((s) => ({
                serviceId: id,
                productId: s.productId,
                quantity: s.quantity,
              })),
            });
        }
        return tx.careService.update({
          where: { id },
          data: {
            name: dto.name,
            category: dto.category,
            price: dto.price,
            igv: dto.igv,
            durationMin: dto.durationMin,
            active: dto.active,
          },
          select: SELECT,
        });
      });
    } catch (error) {
      throw duplicate(error);
    }
    const before = Number(current.price);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action:
        dto.price !== undefined && dto.price !== before
          ? 'service.price_change'
          : 'service.update',
      entity: 'care_service',
      entityId: id,
      ip,
      data: {
        name: current.name,
        before,
        after: dto.price ?? before,
        fields: Object.keys(dto),
      },
    });
    return toView(row);
  }

  private async checkSupplies(
    clinicId: number,
    supplies?: SupplyDto[],
  ): Promise<void> {
    if (!supplies?.length) return;
    const ids = supplies.map((s) => s.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'Un producto aparece dos veces en los insumos',
      );
    const found = await this.prisma.product.count({
      where: { clinicId, id: { in: ids }, active: true },
    });
    if (found !== ids.length)
      throw new BadRequestException('Algún insumo no existe o está inactivo');
  }
}

function toView(row: Row): CareServiceView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    igv: row.igv,
    durationMin: row.durationMin,
    active: row.active,
    supplies: row.supplies.map((s) => ({
      productId: s.product.id,
      name: s.product.name,
      baseUnit: s.product.baseUnit,
      quantity: Number(s.quantity),
    })),
  };
}

function duplicate(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    return new ConflictException('Ya existe un servicio con ese nombre');
  return error;
}
