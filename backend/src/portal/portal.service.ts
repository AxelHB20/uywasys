import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clinicDay, fromDbDate } from '../common/time/clinic-day.js';
import type {
  AppointmentStatus,
  ImmunizationKind,
  PetSex,
  Species,
  VisitType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildIcs, IcsEvent } from './ics.js';
import { latestDoses } from '../medical/latest-doses.js';

/** Cuánto vale un enlace: lo bastante para la próxima vacuna anual, y se puede renovar */
export const PORTAL_LINK_DAYS = 180;
/** Recetas que se muestran: las de los últimos meses (el tratamiento en curso) */
const PRESCRIPTION_DAYS = 120;
const DAY_MS = 86_400_000;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export interface PortalLinkStatus {
  active: boolean;
  createdAt: Date | null;
  expiresAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  createdBy: string | null;
}

export interface PortalView {
  clinic: {
    name: string;
    address: string | null;
    phone: string | null;
    hasLogo: boolean;
  };
  /** Solo el primer nombre: el enlace se puede reenviar, no se exponen documento ni celular */
  ownerFirstName: string;
  expiresAt: Date;
  /** La clínica muestra el carnet completo y las recetas; si no, solo próximas dosis y citas */
  showRecords: boolean;
  pets: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: PetSex | null;
    neutered: boolean;
    birthDate: string | null;
    birthDateEstimated: boolean;
    weightKg: number | null;
    microchip: string | null;
    immunizations: {
      id: number;
      kind: ImmunizationKind;
      name: string;
      laboratory: string | null;
      batchNumber: string | null;
      appliedAt: string;
      nextDueAt: string | null;
      external: boolean;
      externalClinic: string | null;
      appliedBy: string | null;
      licenseNumber: string | null;
    }[];
    appointments: {
      id: number;
      startsAt: Date;
      durationMin: number;
      type: VisitType;
      reason: string | null;
      status: AppointmentStatus;
      vet: string | null;
    }[];
    prescriptions: {
      id: number;
      number: number;
      createdAt: Date;
      vet: string;
      licenseNumber: string | null;
      notes: string | null;
      items: {
        drug: string;
        dose: string;
        route: string | null;
        frequency: string;
        duration: string;
        instructions: string | null;
      }[];
    }[];
  }[];
}

const invalidLink = () =>
  new NotFoundException(
    'Este enlace no es válido o ya venció. Pide uno nuevo a tu veterinaria.',
  );

/**
 * Portal del dueño: un enlace personal (sin contraseña) para ver el carnet de vacunas, las
 * próximas citas y las recetas recientes de sus mascotas. Ley 29733: muestra lo mínimo, se puede
 * revocar y vence. Crear y revocar quedan en la bitácora; las vistas se cuentan en el enlace.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async client(clinicId: number, clientId: number) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, clinicId },
      select: { id: true, walkIn: true, anonymizedAt: true, active: true },
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    if (client.walkIn || client.anonymizedAt || !client.active)
      throw new BadRequestException(
        'Este cliente no puede tener portal (varios, inactivo o anonimizado)',
      );
    return client;
  }

  /** El cliente es de esta clínica (si no, 404 como cualquier ficha ajena) */
  private async exists(clinicId: number, clientId: number): Promise<void> {
    const found = await this.prisma.client.count({
      where: { id: clientId, clinicId },
    });
    if (!found) throw new NotFoundException('El cliente no existe');
  }

  async status(clinicId: number, clientId: number): Promise<PortalLinkStatus> {
    await this.exists(clinicId, clientId);
    const link = await this.prisma.portalLink.findFirst({
      where: {
        clinicId,
        clientId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { id: 'desc' },
      select: {
        createdAt: true,
        expiresAt: true,
        lastViewedAt: true,
        viewCount: true,
        createdBy: { select: { fullName: true } },
      },
    });
    return {
      active: !!link,
      createdAt: link?.createdAt ?? null,
      expiresAt: link?.expiresAt ?? null,
      lastViewedAt: link?.lastViewedAt ?? null,
      viewCount: link?.viewCount ?? 0,
      createdBy: link?.createdBy.fullName ?? null,
    };
  }

  /** Crea un enlace nuevo y revoca el anterior. El token se devuelve una sola vez. */
  async create(
    actor: AuthUser,
    clientId: number,
    ip?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.client(actor.clinicId, clientId);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + PORTAL_LINK_DAYS * DAY_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.portalLink.updateMany({
        where: { clinicId: actor.clinicId, clientId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.portalLink.create({
        data: {
          clinicId: actor.clinicId,
          clientId,
          tokenHash: hashToken(token),
          createdById: actor.id,
          expiresAt,
        },
      });
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'portal.link_create',
      entity: 'Client',
      entityId: clientId,
      data: { expiresAt: expiresAt.toISOString() },
      ip,
    });
    return { token, expiresAt };
  }

  async revoke(actor: AuthUser, clientId: number, ip?: string): Promise<void> {
    await this.exists(actor.clinicId, clientId);
    const { count } = await this.prisma.portalLink.updateMany({
      where: { clinicId: actor.clinicId, clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count)
      await this.audit.log({
        clinicId: actor.clinicId,
        userId: actor.id,
        action: 'portal.link_revoke',
        entity: 'Client',
        entityId: clientId,
        ip,
      });
  }

  /** Enlace vigente del token (404 si no existe, venció o se revocó) */
  async resolve(token: string) {
    if (!/^[\w-]{20,64}$/.test(token)) throw invalidLink();
    const link = await this.prisma.portalLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        clinicId: true,
        clientId: true,
        expiresAt: true,
        revokedAt: true,
        client: {
          select: { name: true, anonymizedAt: true, active: true },
        },
        clinic: { select: { active: true } },
      },
    });
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt <= new Date() ||
      link.client.anonymizedAt ||
      !link.client.active ||
      !link.clinic.active
    )
      throw invalidLink();
    return link;
  }

  async view(token: string): Promise<PortalView> {
    const link = await this.resolve(token);
    const { clinicId, clientId } = link;
    const now = new Date();
    const [clinic, pets] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: {
          name: true,
          address: true,
          phone: true,
          logoMime: true,
          portalShowRecords: true,
        },
      }),
      this.prisma.pet.findMany({
        where: { clinicId, clientId, active: true, deceasedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          number: true,
          name: true,
          species: true,
          breed: true,
          sex: true,
          neutered: true,
          birthDate: true,
          birthDateEstimated: true,
          weightKg: true,
          microchip: true,
          immunizations: {
            where: { voidedAt: null },
            orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              kind: true,
              name: true,
              laboratory: true,
              batchNumber: true,
              appliedAt: true,
              nextDueAt: true,
              external: true,
              externalClinic: true,
              appliedBy: { select: { fullName: true, licenseNumber: true } },
            },
          },
          appointments: {
            where: {
              status: { in: ['SCHEDULED', 'CONFIRMED'] },
              startsAt: { gte: new Date(now.getTime() - 2 * 3_600_000) },
            },
            orderBy: { startsAt: 'asc' },
            take: 5,
            select: {
              id: true,
              startsAt: true,
              durationMin: true,
              type: true,
              reason: true,
              status: true,
              vet: { select: { fullName: true } },
            },
          },
          prescriptions: {
            where: {
              voidedAt: null,
              createdAt: {
                gte: new Date(now.getTime() - PRESCRIPTION_DAYS * DAY_MS),
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              number: true,
              createdAt: true,
              notes: true,
              vet: { select: { fullName: true, licenseNumber: true } },
              items: {
                orderBy: { position: 'asc' },
                select: {
                  drug: true,
                  dose: true,
                  route: true,
                  frequency: true,
                  duration: true,
                  instructions: true,
                },
              },
            },
          },
        },
      }),
    ]);
    await this.prisma.portalLink.update({
      where: { id: link.id },
      data: { lastViewedAt: now, viewCount: { increment: 1 } },
    });
    return {
      clinic: {
        name: clinic.name,
        address: clinic.address,
        phone: clinic.phone,
        hasLogo: !!clinic.logoMime,
      },
      ownerFirstName: link.client.name.trim().split(/\s+/)[0] ?? '',
      expiresAt: link.expiresAt,
      showRecords: clinic.portalShowRecords,
      pets: pets.map((p) => ({
        id: p.id,
        number: p.number,
        name: p.name,
        species: p.species,
        breed: p.breed,
        sex: p.sex,
        neutered: p.neutered,
        birthDate: fromDbDate(p.birthDate),
        birthDateEstimated: p.birthDateEstimated,
        weightKg: p.weightKg === null ? null : Number(p.weightKg),
        microchip: p.microchip,
        immunizations: (clinic.portalShowRecords
          ? p.immunizations
          : latestDoses(p.immunizations)
        )
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            name: i.name,
            laboratory: i.laboratory,
            batchNumber: i.batchNumber,
            appliedAt: fromDbDate(i.appliedAt)!,
            nextDueAt: fromDbDate(i.nextDueAt),
            external: i.external,
            externalClinic: i.externalClinic,
            appliedBy: i.external ? null : i.appliedBy.fullName,
            licenseNumber: i.external ? null : i.appliedBy.licenseNumber,
          }))
          .map((i) => (clinic.portalShowRecords ? i : withoutDetails(i))),
        appointments: p.appointments.map((a) => ({
          id: a.id,
          startsAt: a.startsAt,
          durationMin: a.durationMin,
          type: a.type,
          reason: a.reason,
          status: a.status,
          vet: a.vet?.fullName ?? null,
        })),
        prescriptions: (clinic.portalShowRecords ? p.prescriptions : []).map(
          (r) => ({
            id: r.id,
            number: r.number,
            createdAt: r.createdAt,
            vet: r.vet.fullName,
            licenseNumber: r.vet.licenseNumber,
            notes: r.notes,
            items: r.items,
          }),
        ),
      })),
    };
  }

  /**
   * Calendario del dueño (suscripción .ics): próximos refuerzos con alarma la víspera a las 9:00 y
   * citas con alarma 2 horas antes. No cuenta como vista del portal.
   */
  async calendar(token: string, now = new Date()): Promise<string> {
    const link = await this.resolve(token);
    const { clinicId, clientId } = link;
    const [clinic, pets] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { name: true, address: true, phone: true, timezone: true },
      }),
      this.prisma.pet.findMany({
        where: { clinicId, clientId, active: true, deceasedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          immunizations: {
            where: { voidedAt: null },
            orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
            select: { id: true, kind: true, name: true, nextDueAt: true },
          },
          appointments: {
            where: {
              status: { in: ['SCHEDULED', 'CONFIRMED'] },
              startsAt: { gte: new Date(now.getTime() - DAY_MS) },
            },
            orderBy: { startsAt: 'asc' },
            take: 10,
            select: {
              id: true,
              startsAt: true,
              durationMin: true,
              reason: true,
            },
          },
        },
      }),
    ]);
    const today = clinicDay(clinic.timezone, now);
    const contact = [clinic.name, clinic.phone].filter(Boolean).join(' · ');
    const events: IcsEvent[] = [];
    for (const p of pets) {
      for (const i of latestDoses(p.immunizations)) {
        const day = fromDbDate(i.nextDueAt);
        if (!day || day < today) continue;
        events.push({
          uid: `imm-${i.id}@uywa`,
          summary: `${p.name}: le toca ${i.name}`,
          description: `Refuerzo de ${i.kind === 'VACCINE' ? 'vacuna' : 'desparasitación'}. Pide tu cita: ${contact}`,
          location: clinic.address ?? undefined,
          day,
          // La víspera a las 9:00 (15 h antes del inicio del día)
          alarmMinutes: 15 * 60,
        });
      }
      for (const a of p.appointments)
        events.push({
          uid: `appt-${a.id}@uywa`,
          summary: `Cita de ${p.name} · ${clinic.name}`,
          description: [a.reason, contact].filter(Boolean).join('\n'),
          location: clinic.address ?? undefined,
          start: a.startsAt,
          durationMin: a.durationMin,
          alarmMinutes: 120,
        });
    }
    return buildIcs(`Mascotas · ${clinic.name}`, events, now);
  }

  /** Manifiesto propio del portal: al instalarlo en el celular abre el portal, no el sistema */
  async manifest(token: string): Promise<Record<string, unknown>> {
    const link = await this.resolve(token);
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: link.clinicId },
      select: { name: true },
    });
    return {
      name: `Mis mascotas · ${clinic.name}`,
      short_name: 'Mis mascotas',
      start_url: `/p/${token}`,
      scope: '/p/',
      display: 'standalone',
      background_color: '#f8fafc',
      theme_color: '#4f46e5',
      lang: 'es-PE',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };
  }

  async logo(token: string): Promise<{ data: Buffer; mime: string }> {
    const link = await this.resolve(token);
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: link.clinicId },
      select: { logo: true, logoMime: true },
    });
    if (!clinic.logo || !clinic.logoMime)
      throw new NotFoundException('La clínica no tiene logo');
    return { data: Buffer.from(clinic.logo), mime: clinic.logoMime };
  }
}

/** Sin carnet en el portal: solo nombre y fechas, nada que sirva para hacer pasar una copia */
function withoutDetails<
  T extends {
    laboratory: string | null;
    batchNumber: string | null;
    externalClinic: string | null;
    appliedBy: string | null;
    licenseNumber: string | null;
  },
>(i: T): T {
  return {
    ...i,
    laboratory: null,
    batchNumber: null,
    externalClinic: null,
    appliedBy: null,
    licenseNumber: null,
  };
}
