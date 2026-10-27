import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  generateTemporaryPassword,
  hashPassword,
} from '../common/security/passwords.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';

export interface TeamMember {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  licenseNumber: string | null;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: Date | null;
}

const MEMBER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  licenseNumber: true,
  active: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
} as const;

type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(clinicId: number): Promise<TeamMember[]> {
    const users = await this.prisma.user.findMany({
      where: { clinicId },
      select: MEMBER_SELECT,
      orderBy: [{ active: 'desc' }, { fullName: 'asc' }],
    });
    return users.map(toMember);
  }

  /** Crea el usuario con una clave temporal que se muestra una sola vez; debe cambiarla al primer ingreso. */
  async create(
    actor: AuthUser,
    dto: CreateUserDto,
    ip?: string,
  ): Promise<{ user: TeamMember; temporaryPassword: string }> {
    requireLicenseForVet(dto.role, dto.licenseNumber);
    const temporaryPassword = generateTemporaryPassword();

    let user: MemberRow;
    try {
      user = await this.prisma.user.create({
        data: {
          clinicId: actor.clinicId,
          fullName: dto.fullName,
          email: dto.email,
          role: dto.role,
          licenseNumber: dto.licenseNumber ?? null,
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
        },
        select: MEMBER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un usuario con ese correo');
      }
      throw error;
    }

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      entity: 'user',
      entityId: user.id,
      ip,
      action: 'user.create',
      data: { email: user.email, rol: user.role },
    });
    return { user: toMember(user), temporaryPassword };
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateUserDto,
    ip?: string,
  ): Promise<TeamMember> {
    const target = await this.findInClinic(actor.clinicId, id);
    const next = {
      fullName: dto.fullName ?? target.fullName,
      role: dto.role ?? target.role,
      licenseNumber:
        dto.licenseNumber === undefined
          ? target.licenseNumber
          : dto.licenseNumber,
      active: dto.active ?? target.active,
    };

    if (id === actor.id && !next.active)
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    requireLicenseForVet(next.role, next.licenseNumber);
    if (
      target.role === 'ADMIN' &&
      target.active &&
      (next.role !== 'ADMIN' || !next.active)
    ) {
      await this.ensureAnotherActiveAdmin(actor.clinicId, id);
    }

    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => target[key] !== next[key],
    );
    if (!changed.length) return toMember(target);

    const user = await this.prisma.user.update({
      where: { id },
      data: next,
      select: MEMBER_SELECT,
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      entity: 'user',
      entityId: id,
      ip,
      action:
        changed.includes('active') && !next.active
          ? 'user.deactivate'
          : 'user.update',
      data: Object.fromEntries(
        changed.map((key) => [key, { antes: target[key], ahora: next[key] }]),
      ),
    });
    return toMember(user);
  }

  /** Genera una nueva clave temporal y desbloquea la cuenta. */
  async resetPassword(
    actor: AuthUser,
    id: number,
    ip?: string,
  ): Promise<{ temporaryPassword: string }> {
    if (id === actor.id) {
      throw new BadRequestException(
        'Para tu propia cuenta usa la opción "Cambiar contraseña"',
      );
    }
    await this.findInClinic(actor.clinicId, id);
    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      entity: 'user',
      entityId: id,
      ip,
      action: 'user.reset_password',
    });
    return { temporaryPassword };
  }

  private async findInClinic(clinicId: number, id: number): Promise<MemberRow> {
    // Se busca dentro de la clínica del administrador: nunca se puede tocar un usuario de otra clínica.
    const user = await this.prisma.user.findFirst({
      where: { id, clinicId },
      select: MEMBER_SELECT,
    });
    if (!user) throw new NotFoundException('El usuario no existe');
    return user;
  }

  private async ensureAnotherActiveAdmin(
    clinicId: number,
    excludeId: number,
  ): Promise<void> {
    const others = await this.prisma.user.count({
      where: { clinicId, role: 'ADMIN', active: true, id: { not: excludeId } },
    });
    if (others === 0)
      throw new ConflictException(
        'Debe quedar al menos un administrador activo en la clínica',
      );
  }
}

function requireLicenseForVet(
  role: Role,
  licenseNumber: string | null | undefined,
): void {
  if (role === 'VET' && !licenseNumber) {
    throw new BadRequestException(
      'Ingresa el número de colegiatura (CMVP) del veterinario',
    );
  }
}

function toMember(user: MemberRow): TeamMember {
  const { lockedUntil, ...rest } = user;
  return { ...rest, locked: Boolean(lockedUntil && lockedUntil > new Date()) };
}
