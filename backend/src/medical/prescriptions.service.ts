import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clinicLogoUrl } from '../auth/session-user.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  prescriptionCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import { fromDbDate } from '../common/time/clinic-day.js';
import type { Species } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../visits/charges.service.js';
import type { ChargePrep, CreatedCharges } from '../visits/charges.service.js';
import { lockVisit } from '../visits/visit.views.js';
import type {
  CreatePrescriptionDto,
  VoidPrescriptionDto,
} from './dto/prescription.dto.js';
import {
  PRESCRIPTION_SUMMARY_SELECT,
  toPrescriptionSummary,
} from './prescription.views.js';
import type { PrescriptionSummary } from './prescription.views.js';

/** Receta para imprimir: con la clínica, el paciente y el propietario */
export interface PrescriptionPrint extends PrescriptionSummary {
  clinic: {
    name: string;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: string | null;
    birthDate: string | null;
    weightKg: number | null;
    allergies: string | null;
  };
  client: {
    id: number;
    name: string;
    phone: string;
    docType: string | null;
    docNumber: string | null;
  };
}

const PRESCRIBER_ROLES = ['ADMIN', 'VET'];

/**
 * Recetas médicas veterinarias. Las emite un veterinario con colegiatura (CMVP) en una
 * atención abierta. Lo que se entrega en la clínica se carga a la cuenta y baja del stock
 * en la misma transacción; los controlados llevan el número de la receta como receta retenida.
 */
@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthUser,
    visitId: number,
    dto: CreatePrescriptionDto,
    ip?: string,
  ): Promise<PrescriptionPrint> {
    if (!PRESCRIBER_ROLES.includes(actor.role))
      throw new ForbiddenException('Las recetas las emite un veterinario');
    const prep: ChargePrep = await this.charges.prepare(actor);
    if (!prep.licenseNumber)
      throw new ForbiddenException(
        'Para emitir recetas registra tu N.º de colegiatura (CMVP) en Usuarios',
      );
    for (const item of dto.items)
      if (item.dispenseQuantity != null && !item.productId)
        throw new BadRequestException(
          `${item.drug}: para entregarlo en la clínica elígelo del inventario`,
        );

    const { id, created } = await this.prisma.$transaction(
      async (tx) => {
        const visit = await lockVisit(tx, actor.clinicId, visitId);
        if (!visit) throw new NotFoundException('La atención no existe');
        if (visit.status !== 'OPEN')
          throw new ConflictException(
            'La atención ya se cerró: la receta se emite durante la atención',
          );

        // Productos del inventario: deben ser de la clínica; la presentación, del producto
        const productIds = [
          ...new Set(
            dto.items.flatMap((i) => (i.productId ? [i.productId] : [])),
          ),
        ];
        const products = productIds.length
          ? await tx.product.findMany({
              where: { id: { in: productIds }, clinicId: actor.clinicId },
              select: {
                id: true,
                controlled: true,
                presentations: { select: { id: true } },
              },
            })
          : [];
        const byId = new Map(products.map((p) => [p.id, p]));
        for (const item of dto.items) {
          if (!item.productId) continue;
          const product = byId.get(item.productId);
          if (!product)
            throw new NotFoundException(`${item.drug}: el producto no existe`);
          if (
            item.presentationId &&
            !product.presentations.some((p) => p.id === item.presentationId)
          )
            throw new BadRequestException(
              `${item.drug}: esa presentación no es del producto`,
            );
        }

        const number = await reserveNumbers(tx, actor.clinicId, 'prescription');
        const code = prescriptionCode(number);

        // Lo que se entrega en la clínica: cargos con stock por FEFO y la receta como referencia
        const dispensed = dto.items.filter((i) => i.dispenseQuantity != null);
        let created: CreatedCharges | null = null;
        if (dispensed.length)
          created = await this.charges.createInTx(
            tx,
            actor,
            {
              visitId,
              items: dispensed.map((i) => ({
                productId: i.productId,
                presentationId: i.presentationId,
                quantity: i.dispenseQuantity!,
                prescriptionRef: code,
              })),
            },
            prep,
          );
        const chargeIds = created?.charges.map((c) => c.id) ?? [];

        let next = 0;
        const row = await tx.prescription.create({
          data: {
            clinicId: actor.clinicId,
            number,
            visitId,
            petId: visit.pet_id,
            clientId: visit.client_id,
            vetId: actor.id,
            notes: dto.notes ?? null,
            items: {
              create: dto.items.map((item, position) => ({
                position,
                productId: item.productId ?? null,
                presentationId: item.presentationId ?? null,
                drug: item.drug,
                dose: item.dose,
                route: item.route ?? null,
                frequency: item.frequency,
                duration: item.duration,
                instructions: item.instructions ?? null,
                controlled: item.productId
                  ? byId.get(item.productId)!.controlled
                  : false,
                dispensedQuantity: item.dispenseQuantity ?? null,
                chargeId:
                  item.dispenseQuantity != null ? chargeIds[next++] : null,
              })),
            },
          },
          select: { id: true },
        });
        return { id: row.id, created };
      },
      { timeout: 20_000 },
    );

    if (created) await this.charges.logCreated(actor, visitId, created, ip);
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'prescription.create',
      entity: 'prescription',
      entityId: id,
      ip,
      data: {
        visitId,
        drugs: dto.items.map((i) => i.drug),
        charges: created?.charges.map((c) => c.id) ?? [],
      },
    });
    return this.get(actor.clinicId, id);
  }

  async get(clinicId: number, id: number): Promise<PrescriptionPrint> {
    const row = await this.prisma.prescription.findFirst({
      where: { id, clinicId },
      select: {
        ...PRESCRIPTION_SUMMARY_SELECT,
        clinic: {
          select: {
            name: true,
            address: true,
            phone: true,
            logoMime: true,
            logoUpdatedAt: true,
          },
        },
        pet: {
          select: {
            id: true,
            number: true,
            name: true,
            species: true,
            breed: true,
            sex: true,
            birthDate: true,
            weightKg: true,
            allergies: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            docType: true,
            docNumber: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('La receta no existe');
    const { clinic, pet, client, ...summary } = row;
    return {
      ...toPrescriptionSummary(summary),
      clinic: {
        name: clinic.name,
        address: clinic.address,
        phone: clinic.phone,
        logoUrl: clinicLogoUrl(clinic),
      },
      pet: {
        ...pet,
        birthDate: fromDbDate(pet.birthDate),
        weightKg: pet.weightKg === null ? null : Number(pet.weightKg),
      },
      client,
    };
  }

  /** Anula la receta (quien la emitió o el administrador). Lo entregado se quita antes. */
  async void(
    actor: AuthUser,
    id: number,
    dto: VoidPrescriptionDto,
    ip?: string,
  ): Promise<PrescriptionPrint> {
    const current = await this.prisma.prescription.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        vetId: true,
        voidedAt: true,
        visitId: true,
        items: { select: { charge: { select: { status: true } } } },
      },
    });
    if (!current) throw new NotFoundException('La receta no existe');
    if (current.vetId !== actor.id && actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Solo quien emitió la receta o el administrador puede anularla',
      );
    if (current.voidedAt)
      throw new ConflictException('La receta ya está anulada');
    if (current.items.some((i) => i.charge && i.charge.status !== 'VOID'))
      throw new ConflictException(
        'Primero quita de la atención lo que se entregó con esta receta',
      );
    await this.prisma.prescription.update({
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
      action: 'prescription.void',
      entity: 'prescription',
      entityId: id,
      ip,
      data: { visitId: current.visitId, reason: dto.reason },
    });
    return this.get(actor.clinicId, id);
  }
}
