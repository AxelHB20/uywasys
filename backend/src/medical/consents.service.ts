import { createHash } from 'node:crypto';
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
  consentCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import { clinicDay } from '../common/time/clinic-day.js';
import type { ConsentType, Species } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CONSENT_TITLES, consentTemplate } from './consent-templates.js';
import type {
  ConsentTemplateQuery,
  CreateConsentDto,
  VoidConsentDto,
} from './dto/consent.dto.js';

const SPECIES: Record<Species, string> = {
  DOG: 'perro',
  CAT: 'gato',
  BIRD: 'ave',
  RABBIT: 'conejo',
  GUINEA_PIG: 'cuy',
  REPTILE: 'reptil',
  OTHER: 'otra especie',
};

export interface ConsentSummary {
  id: number;
  /** CI-00012 */
  code: string;
  title: string;
  type: ConsentType;
  procedure: string;
  visitId: number | null;
  signerName: string;
  signedAt: Date;
  vet: { id: number; fullName: string };
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface ConsentDocument extends ConsentSummary {
  text: string;
  signerDocument: string | null;
  signerRelation: string;
  /** data:image/png;base64,… */
  signature: string;
  hash: string;
  vet: { id: number; fullName: string; licenseNumber: string | null };
  clinic: {
    name: string;
    ruc: string | null;
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
  };
  client: { id: number; name: string; phone: string };
}

/** Lo que se sella con el hash: si cambia cualquiera de estos datos, el hash ya no coincide */
function sealOf(input: {
  type: ConsentType;
  procedure: string;
  text: string;
  signerName: string;
  signerDocument: string | null;
  signerRelation: string;
  petId: number;
  signedAt: Date;
  signature: Buffer;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        signedAt: input.signedAt.toISOString(),
        signature: input.signature.toString('base64'),
      }),
    )
    .digest('hex');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Consentimientos informados (cirugía, anestesia, eutanasia, hospitalización). Se firman en
 * pantalla con el veterinario presente; el texto firmado, la firma y un hash quedan en la
 * historia. No se editan: un error se anula con motivo y se firma uno nuevo.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async template(
    clinicId: number,
    query: ConsentTemplateQuery,
  ): Promise<{ title: string; text: string }> {
    const [clinic, pet] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { name: true, timezone: true },
      }),
      this.prisma.pet.findFirst({
        where: { id: query.petId, clinicId },
        select: {
          name: true,
          species: true,
          breed: true,
          client: { select: { name: true } },
        },
      }),
    ]);
    if (!pet) throw new NotFoundException('La mascota no existe');
    const [y, m, d] = clinicDay(clinic.timezone).split('-');
    return {
      title: CONSENT_TITLES[query.type],
      text: consentTemplate(query.type, {
        clinic: clinic.name,
        pet: pet.name,
        species: SPECIES[pet.species] ?? 'mascota',
        breed: pet.breed,
        owner: pet.client.name,
        procedure: query.procedure?.trim() || '______________________',
        date: `${d}/${m}/${y}`,
      }),
    };
  }

  async listForPet(clinicId: number, petId: number): Promise<ConsentSummary[]> {
    const pet = await this.prisma.pet.findFirst({
      where: { id: petId, clinicId },
      select: { id: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    const rows = await this.prisma.consent.findMany({
      where: { clinicId, petId },
      select: {
        id: true,
        number: true,
        type: true,
        procedure: true,
        visitId: true,
        signerName: true,
        signedAt: true,
        voidedAt: true,
        voidReason: true,
        vet: { select: { id: true, fullName: true } },
      },
      orderBy: { id: 'desc' },
    });
    return rows.map(({ number, ...r }) => ({
      ...r,
      code: consentCode(number),
      title: CONSENT_TITLES[r.type],
    }));
  }

  async create(
    actor: AuthUser,
    dto: CreateConsentDto,
    ip?: string,
  ): Promise<ConsentDocument> {
    if (actor.role !== 'ADMIN' && actor.role !== 'VET')
      throw new ForbiddenException(
        'El consentimiento se firma con el veterinario presente',
      );
    const signature = Buffer.from(dto.signature.split(',')[1], 'base64');
    if (signature.length < 300 || !signature.subarray(0, 8).equals(PNG))
      throw new BadRequestException('Falta la firma');
    const pet = await this.prisma.pet.findFirst({
      where: { id: dto.petId, clinicId: actor.clinicId },
      select: { clientId: true },
    });
    if (!pet) throw new NotFoundException('La mascota no existe');
    if (dto.visitId) {
      const visit = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, clinicId: actor.clinicId, petId: dto.petId },
        select: { id: true },
      });
      if (!visit) throw new NotFoundException('La atención no existe');
    }

    const signedAt = new Date();
    const signerDocument = dto.signerDocument ?? null;
    const hash = sealOf({
      type: dto.type,
      procedure: dto.procedure,
      text: dto.text,
      signerName: dto.signerName,
      signerDocument,
      signerRelation: dto.signerRelation,
      petId: dto.petId,
      signedAt,
      signature,
    });
    const id = await this.prisma.$transaction(async (tx) => {
      const number = await reserveNumbers(tx, actor.clinicId, 'consent');
      const row = await tx.consent.create({
        data: {
          clinicId: actor.clinicId,
          number,
          petId: dto.petId,
          clientId: pet.clientId,
          visitId: dto.visitId ?? null,
          type: dto.type,
          procedure: dto.procedure,
          text: dto.text,
          signerName: dto.signerName,
          signerDocument,
          signerRelation: dto.signerRelation,
          signature: new Uint8Array(signature),
          signedAt,
          vetId: actor.id,
          hash,
        },
        select: { id: true },
      });
      return row.id;
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'consent.create',
      entity: 'consent',
      entityId: id,
      ip,
      data: { petId: dto.petId, type: dto.type, hash },
    });
    return this.get(actor.clinicId, id);
  }

  async get(clinicId: number, id: number): Promise<ConsentDocument> {
    const row = await this.prisma.consent.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        number: true,
        type: true,
        procedure: true,
        visitId: true,
        text: true,
        signerName: true,
        signerDocument: true,
        signerRelation: true,
        signature: true,
        signedAt: true,
        hash: true,
        voidedAt: true,
        voidReason: true,
        vet: { select: { id: true, fullName: true, licenseNumber: true } },
        clinic: {
          select: {
            name: true,
            ruc: true,
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
          },
        },
        client: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!row) throw new NotFoundException('El consentimiento no existe');
    const { number, signature, clinic, ...rest } = row;
    return {
      ...rest,
      code: consentCode(number),
      title: CONSENT_TITLES[row.type],
      signature: `data:image/png;base64,${Buffer.from(signature).toString('base64')}`,
      clinic: {
        name: clinic.name,
        ruc: clinic.ruc,
        address: clinic.address,
        phone: clinic.phone,
        logoUrl: clinicLogoUrl(clinic),
      },
    };
  }

  async void(
    actor: AuthUser,
    id: number,
    dto: VoidConsentDto,
    ip?: string,
  ): Promise<ConsentDocument> {
    const current = await this.prisma.consent.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { vetId: true, voidedAt: true, petId: true },
    });
    if (!current) throw new NotFoundException('El consentimiento no existe');
    if (current.vetId !== actor.id && actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Solo el veterinario que lo tomó o el administrador puede anularlo',
      );
    if (current.voidedAt)
      throw new ConflictException('Ese consentimiento ya está anulado');
    await this.prisma.consent.update({
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
      action: 'consent.void',
      entity: 'consent',
      entityId: id,
      ip,
      data: { petId: current.petId, reason: dto.reason },
    });
    return this.get(actor.clinicId, id);
  }
}
