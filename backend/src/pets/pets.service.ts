import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { anonymizedError } from '../clients/anonymized.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePetDto, UpdatePetDto } from './dto/pet.dto.js';
import {
  PET_SELECT,
  petCreateData,
  petUpdateData,
  toPetView,
} from './pet.mapper.js';
import type { PetView } from './pet.mapper.js';
import { reserveNumbers } from '../common/sequence/clinic-sequence.js';

export interface PetDetail extends PetView {
  client: { id: number; name: string; phone: string };
}

@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(clinicId: number, id: number): Promise<PetDetail> {
    const pet = await this.prisma.pet.findFirst({
      where: { id, clinicId },
      select: {
        ...PET_SELECT,
        client: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    const { client, ...row } = pet;
    return { ...toPetView(row), client };
  }

  async create(
    actor: AuthUser,
    clientId: number,
    dto: CreatePetDto,
    ip?: string,
  ): Promise<PetView> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, clinicId: actor.clinicId },
      select: { id: true, anonymizedAt: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    if (client.anonymizedAt) throw anonymizedError();
    const today = await clinicToday(this.prisma, actor.clinicId);

    const pet = await this.prisma.$transaction(async (tx) =>
      tx.pet.create({
        data: {
          ...petCreateData(dto, today),
          clinicId: actor.clinicId,
          clientId,
          number: await reserveNumbers(tx, actor.clinicId, 'pet'),
        },
        select: PET_SELECT,
      }),
    );
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'pet.create',
      entity: 'pet',
      entityId: pet.id,
      ip,
      data: { clientId, name: pet.name },
    });
    return toPetView(pet);
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdatePetDto,
    ip?: string,
  ): Promise<PetView> {
    const current = await this.prisma.pet.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: PET_SELECT,
    });
    if (!current) throw new NotFoundException('La mascota no existe');
    const owner = await this.prisma.pet.findUniqueOrThrow({
      where: { id },
      select: { client: { select: { anonymizedAt: true } } },
    });
    if (owner.client.anonymizedAt) throw anonymizedError();
    const today = await clinicToday(this.prisma, actor.clinicId);

    const pet = await this.prisma.pet.update({
      where: { id },
      data: petUpdateData(dto, current, today),
      select: PET_SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'pet.update',
      entity: 'pet',
      entityId: id,
      ip,
      data: { fields: Object.keys(dto) },
    });
    return toPetView(pet);
  }
}
