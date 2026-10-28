import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clinicLogoUrl } from '../auth/session-user.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateClinicDto } from './dto/update-clinic.dto.js';

export const MAX_LOGO_BYTES = 1024 * 1024;

export interface ClinicProfile {
  id: number;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  /** Descuento máximo por línea (%) sin autorización del administrador */
  maxDiscountPercent: number;
}

export interface SetupStatus {
  /** Datos mínimos para tickets y recetas: RUC, dirección y teléfono. */
  profileComplete: boolean;
  /** Usuarios activos además del administrador inicial. */
  teamMembers: number;
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  ruc: true,
  address: true,
  phone: true,
  email: true,
  logoMime: true,
  logoUpdatedAt: true,
  maxDiscountPercent: true,
} as const;

@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(clinicId: number): Promise<ClinicProfile> {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: PROFILE_SELECT,
    });
    return toProfile(clinic);
  }

  async updateProfile(
    actor: AuthUser,
    dto: UpdateClinicDto,
    ip?: string,
  ): Promise<ClinicProfile> {
    const before = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: PROFILE_SELECT,
    });
    const data = {
      name: dto.name,
      ruc: dto.ruc ?? null,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      email: dto.email?.toLowerCase() ?? null,
      // Si no se envía, se mantiene el tope actual
      maxDiscountPercent:
        dto.maxDiscountPercent ?? Number(before.maxDiscountPercent),
    };
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
      (key) =>
        key === 'maxDiscountPercent'
          ? Number(before[key]) !== data[key]
          : before[key] !== data[key],
    );

    const clinic = await this.prisma.clinic.update({
      where: { id: actor.clinicId },
      data,
      select: PROFILE_SELECT,
    });
    if (changed.length) {
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        entity: 'clinic',
        entityId: actor.clinicId,
        ip,
        action: 'clinic.update',
        data: Object.fromEntries(
          changed.map((key) => [
            key,
            {
              antes:
                key === 'maxDiscountPercent'
                  ? Number(before[key])
                  : before[key],
              ahora: data[key],
            },
          ]),
        ),
      });
    }
    return toProfile(clinic);
  }

  async setLogo(
    actor: AuthUser,
    file: { buffer: Buffer; size: number } | undefined,
    ip?: string,
  ): Promise<ClinicProfile> {
    if (!file)
      throw new BadRequestException('Selecciona una imagen para el logo');
    if (file.size > MAX_LOGO_BYTES)
      throw new BadRequestException('El logo pesa más de 1 MB');
    const mime = detectImageType(file.buffer);
    if (!mime)
      throw new BadRequestException(
        'El logo debe ser una imagen PNG, JPG o WebP',
      );

    const clinic = await this.prisma.clinic.update({
      where: { id: actor.clinicId },
      data: {
        logo: new Uint8Array(file.buffer),
        logoMime: mime,
        logoUpdatedAt: new Date(),
      },
      select: PROFILE_SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      entity: 'clinic',
      entityId: actor.clinicId,
      ip,
      action: 'clinic.logo_update',
      data: { tipo: mime, bytes: file.size },
    });
    return toProfile(clinic);
  }

  async removeLogo(actor: AuthUser, ip?: string): Promise<ClinicProfile> {
    const clinic = await this.prisma.clinic.update({
      where: { id: actor.clinicId },
      data: { logo: null, logoMime: null, logoUpdatedAt: null },
      select: PROFILE_SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      entity: 'clinic',
      entityId: actor.clinicId,
      ip,
      action: 'clinic.logo_remove',
    });
    return toProfile(clinic);
  }

  async getLogo(clinicId: number): Promise<{ data: Buffer; mime: string }> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { logo: true, logoMime: true },
    });
    if (!clinic?.logo || !clinic.logoMime)
      throw new NotFoundException('La clínica no tiene logo');
    return { data: Buffer.from(clinic.logo), mime: clinic.logoMime };
  }

  async setupStatus(clinicId: number): Promise<SetupStatus> {
    const [clinic, activeUsers] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { ruc: true, address: true, phone: true },
      }),
      this.prisma.user.count({ where: { clinicId, active: true } }),
    ]);
    return {
      profileComplete: Boolean(clinic.ruc && clinic.address && clinic.phone),
      teamMembers: Math.max(0, activeUsers - 1),
    };
  }
}

function toProfile(clinic: {
  id: number;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoMime: string | null;
  logoUpdatedAt: Date | null;
  maxDiscountPercent: Prisma.Decimal;
}): ClinicProfile {
  const { logoMime: _mime, logoUpdatedAt: _updated, ...rest } = clinic;
  return {
    ...rest,
    logoUrl: clinicLogoUrl(clinic),
    maxDiscountPercent: Number(clinic.maxDiscountPercent),
  };
}

/** Identifica la imagen por sus primeros bytes, no por la extensión que manda el navegador. */
export function detectImageType(
  buffer: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
