import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clinicDay, fromDbDate, toDbDate } from '../common/time/clinic-day.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ImmunizationKind, Species } from '../generated/prisma/enums.js';
import { clinicLogoUrl } from '../auth/session-user.js';
import { PET_SELECT, toPetView } from '../pets/pet.mapper.js';
import type { PetView } from '../pets/pet.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockVisit } from '../visits/visit.views.js';
import type {
  CreateImmunizationDto,
  DueImmunizationsQuery,
  VoidImmunizationDto,
} from './dto/immunization.dto.js';
import {
  IMMUNIZATION_SELECT,
  toImmunizationView,
} from './immunization.views.js';
import type { ImmunizationView } from './immunization.views.js';

/** Un refuerzo pendiente: la última aplicación de esa vacuna o producto, con su próxima fecha. */
export interface DueImmunization {
  id: number;
  kind: ImmunizationKind;
  name: string;
  appliedAt: string;
  nextDueAt: string;
  /** Negativo = vencido hace N días */
  daysLeft: number;
  pet: { id: number; number: number; name: string; species: Species };
  client: { id: number; name: string; phone: string };
}

/** Carnet imprimible: datos de la clínica y de la mascota, y las aplicaciones vigentes */
export interface ImmunizationCard {
  clinic: {
    name: string;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  pet: PetView & { client: { id: number; name: string; phone: string } };
  items: ImmunizationView[];
}

/** Vencidos de hasta 6 meses: más atrás ya no es un recordatorio útil */
const OVERDUE_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

/**
 * Carnet de vacunas y desparasitaciones. Se registran en una atención abierta (fecha de hoy)
 * o como antecedente (aplicadas antes o en otra clínica). No se borran: se anulan con motivo.
 */
@Injectable()
export class ImmunizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async forPet(clinicId: number, petId: number): Promise<ImmunizationView[]> {
    await this.findPet(clinicId, petId);
    const rows = await this.prisma.immunization.findMany({
      where: { clinicId, petId },
      select: IMMUNIZATION_SELECT,
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toImmunizationView);
  }

  async card(clinicId: number, petId: number): Promise<ImmunizationCard> {
    const [clinic, pet, rows] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: {
          name: true,
          address: true,
          phone: true,
          logoMime: true,
          logoUpdatedAt: true,
        },
      }),
      this.prisma.pet.findFirst({
        where: { id: petId, clinicId },
        select: {
          ...PET_SELECT,
          client: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.immunization.findMany({
        where: { clinicId, petId, voidedAt: null },
        select: IMMUNIZATION_SELECT,
        orderBy: [{ appliedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    if (!pet) throw new NotFoundException('La mascota no existe');
    const { client, ...petRow } = pet;
    return {
      clinic: {
        name: clinic.name,
        address: clinic.address,
        phone: clinic.phone,
        logoUrl: clinicLogoUrl(clinic),
      },
      pet: { ...toPetView(petRow), client },
      items: rows.map(toImmunizationView),
    };
  }

  async create(
    actor: AuthUser,
    dto: CreateImmunizationDto,
    ip?: string,
  ): Promise<ImmunizationView> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { timezone: true },
    });
    const today = clinicDay(timezone);

    const id = await this.prisma.$transaction(async (tx) => {
      const pet = await this.findPet(actor.clinicId, dto.petId, tx);
      let appliedAt: string;
      let external = false;
      if (dto.visitId) {
        const visit = await lockVisit(tx, actor.clinicId, dto.visitId);
        if (!visit) throw new NotFoundException('La atención no existe');
        if (visit.pet_id !== dto.petId)
          throw new BadRequestException('La atención es de otra mascota');
        if (visit.status !== 'OPEN')
          throw new ConflictException(
            'La atención ya se cerró: registra la vacuna como antecedente',
          );
        if (pet.deceasedAt)
          throw new BadRequestException(
            `${pet.name} está registrada como fallecida`,
          );
        appliedAt = today;
      } else {
        if (!dto.appliedAt)
          throw new BadRequestException('Indica cuándo se aplicó');
        if (dto.appliedAt > today)
          throw new BadRequestException(
            'La fecha de aplicación no puede ser futura',
          );
        appliedAt = dto.appliedAt;
        external = dto.external ?? true;
      }
      if (dto.nextDueAt && dto.nextDueAt <= appliedAt)
        throw new BadRequestException(
          'El próximo refuerzo debe ser posterior a la aplicación',
        );

      const row = await tx.immunization.create({
        data: {
          clinicId: actor.clinicId,
          petId: dto.petId,
          visitId: dto.visitId ?? null,
          kind: dto.kind,
          name: dto.name,
          laboratory: dto.laboratory ?? null,
          batchNumber: dto.batchNumber ?? null,
          appliedAt: toDbDate(appliedAt),
          nextDueAt: dto.nextDueAt ? toDbDate(dto.nextDueAt) : null,
          external,
          externalClinic: external ? (dto.externalClinic ?? null) : null,
          notes: dto.notes ?? null,
          appliedById: actor.id,
        },
        select: { id: true },
      });
      return row.id;
    });

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'immunization.create',
      entity: 'immunization',
      entityId: id,
      ip,
      data: { petId: dto.petId, visitId: dto.visitId ?? null, name: dto.name },
    });
    return this.get(actor.clinicId, id);
  }

  async void(
    actor: AuthUser,
    id: number,
    dto: VoidImmunizationDto,
    ip?: string,
  ): Promise<ImmunizationView> {
    const current = await this.prisma.immunization.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { voidedAt: true, petId: true },
    });
    if (!current) throw new NotFoundException('El registro no existe');
    if (current.voidedAt)
      throw new ConflictException('Ese registro ya está anulado');
    await this.prisma.immunization.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedById: actor.id,
        voidReason: dto.reason,
      },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'immunization.void',
      entity: 'immunization',
      entityId: id,
      ip,
      data: { petId: current.petId, reason: dto.reason },
    });
    return this.get(actor.clinicId, id);
  }

  /**
   * Refuerzos pendientes: por mascota y por vacuna (mismo tipo y nombre) cuenta solo la última
   * aplicación. Si la última no tiene próxima fecha, el esquema terminó y no hay recordatorio.
   */
  async due(
    clinicId: number,
    query: DueImmunizationsQuery,
  ): Promise<DueImmunization[]> {
    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = toDbDate(clinicDay(timezone));
    const overdue = query.status === 'overdue';
    const from = overdue
      ? new Date(today.getTime() - OVERDUE_WINDOW_DAYS * DAY_MS)
      : today;
    const to = overdue
      ? new Date(today.getTime() - DAY_MS)
      : new Date(today.getTime() + (query.days ?? 30) * DAY_MS);

    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        kind: ImmunizationKind;
        name: string;
        applied_at: Date;
        next_due_at: Date;
        pet_id: number;
        pet_number: number;
        pet_name: string;
        species: Species;
        client_id: number;
        client_name: string;
        phone: string;
      }[]
    >(Prisma.sql`
      SELECT l.*, p.number AS pet_number, p.name AS pet_name, p.species::text AS species,
             c.id AS client_id, c.name AS client_name, c.phone
      FROM (
        SELECT DISTINCT ON (i.pet_id, i.kind, lower(i.name))
               i.id, i.kind::text AS kind, i.name, i.applied_at, i.next_due_at, i.pet_id
        FROM immunizations i
        WHERE i.clinic_id = ${clinicId} AND i.voided_at IS NULL
        ORDER BY i.pet_id, i.kind, lower(i.name), i.applied_at DESC, i.id DESC
      ) l
      JOIN pets p ON p.id = l.pet_id
      JOIN clients c ON c.id = p.client_id
      WHERE l.next_due_at BETWEEN ${from} AND ${to}
        AND p.active AND p.deceased_at IS NULL
        AND c.active AND c.anonymized_at IS NULL
      ORDER BY l.next_due_at ${overdue ? Prisma.sql`DESC` : Prisma.sql`ASC`}, p.name
      LIMIT 500`);

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      appliedAt: fromDbDate(r.applied_at)!,
      nextDueAt: fromDbDate(r.next_due_at)!,
      daysLeft: Math.round(
        (r.next_due_at.getTime() - today.getTime()) / DAY_MS,
      ),
      pet: {
        id: r.pet_id,
        number: r.pet_number,
        name: r.pet_name,
        species: r.species,
      },
      client: { id: r.client_id, name: r.client_name, phone: r.phone },
    }));
  }

  private async get(clinicId: number, id: number): Promise<ImmunizationView> {
    const row = await this.prisma.immunization.findFirstOrThrow({
      where: { id, clinicId },
      select: IMMUNIZATION_SELECT,
    });
    return toImmunizationView(row);
  }

  private async findPet(
    clinicId: number,
    petId: number,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const pet = await tx.pet.findFirst({
      where: { id: petId, clinicId },
      select: { name: true, deceasedAt: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    return pet;
  }
}
