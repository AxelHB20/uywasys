import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clientSearchText, normalizeSearch } from '../common/text/search.js';
import { clinicDay, fromDbDate } from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { documentError, isValidDocument } from '../common/validators/peru.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  DocumentType,
  PetSex,
  Species,
} from '../generated/prisma/enums.js';
import { PET_SELECT, petCreateData, toPetView } from '../pets/pet.mapper.js';
import {
  parseRecordCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import type { PetView } from '../pets/pet.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { anonymizedError } from './anonymized.js';
import { CONSENT_VERSION } from './consent.js';
import type {
  CreateAuthorizedPersonDto,
  CreateClientDto,
  ListClientsQuery,
  UpdateClientDto,
} from './dto/client.dto.js';

export interface PetBadge {
  id: number;
  number: number;
  name: string;
  species: Species;
  /** Para reconocerla de un vistazo al ponerla en la cola: "Perro · Hembra · 2 años · Shih tzu" */
  sex: PetSex | null;
  breed: string | null;
  birthDate: Date | null;
  aggressive: boolean;
  /** Cómo manejarla ("usar bozal"): solo si es agresiva */
  aggressiveNote: string | null;
  hasAllergies: boolean;
  active: boolean;
}

export interface ClientSummary {
  id: number;
  /** Correlativo de la clínica: C-00012 */
  number: number;
  /** Última atención terminada (AAAA-MM-DD) de cualquiera de sus mascotas */
  lastVisit: string | null;
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  active: boolean;
  pets: PetBadge[];
}

export interface ClientPage {
  items: ClientSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthorizedPersonView {
  id: number;
  name: string;
  dni: string | null;
  phone: string | null;
  relation: string | null;
}

export interface ClientDetail {
  id: number;
  number: number;
  docType: DocumentType | null;
  docNumber: string | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  district: string | null;
  notes: string | null;
  /** Datos de facturación (se llenan solos al facturar desde la caja) */
  invoiceRuc: string | null;
  invoiceName: string | null;
  invoiceAddress: string | null;
  invoiceEmail: string | null;
  active: boolean;
  consentAt: Date;
  consentVersion: string;
  consentChannel: string;
  marketingConsent: boolean;
  /** Fecha en que se anonimizó (derecho de cancelación); null si no */
  anonymizedAt: Date | null;
  createdAt: Date;
  pets: (PetView & {
    lastVisit: string | null;
    /** Próxima cita (por confirmar o confirmada) que todavía no pasó */
    nextAppointment: NextAppointment | null;
  })[];
  authorized: AuthorizedPersonView[];
}

export interface NextAppointment {
  id: number;
  startsAt: Date;
  type: string;
  reason: string | null;
  vet: string | null;
}

const DETAIL_SELECT = {
  id: true,
  number: true,
  docType: true,
  docNumber: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  district: true,
  notes: true,
  invoiceRuc: true,
  invoiceName: true,
  invoiceAddress: true,
  invoiceEmail: true,
  active: true,
  consentAt: true,
  consentVersion: true,
  consentChannel: true,
  marketingConsent: true,
  anonymizedAt: true,
  createdAt: true,
  pets: {
    select: PET_SELECT,
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  },
  authorized: {
    select: { id: true, name: true, dni: true, phone: true, relation: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ClientSelect;

type DetailRow = Prisma.ClientGetPayload<{ select: typeof DETAIL_SELECT }>;

const DUPLICATE_DOC = 'Ya existe un cliente con ese documento';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Busca por nombre, documento, celular o nombre de mascota (sin importar tildes ni mayúsculas). */
  async list(clinicId: number, query: ListClientsQuery): Promise<ClientPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'active';
    const term = normalizeSearch(query.q ?? '');

    // "Cliente varios" es interno de la caja: no aparece en la lista
    const where: Prisma.ClientWhereInput = { clinicId, walkIn: false };
    if (status !== 'all') where.active = status === 'active';
    const code = parseRecordCode(query.q ?? '');
    if (code) {
      // "C-12" o "HC-45": búsqueda exacta por código de cliente o de historia clínica
      where.OR = [
        code.kind === 'client'
          ? { number: code.number }
          : { pets: { some: { clinicId, number: code.number } } },
      ];
    } else if (term) {
      where.OR = [
        { searchText: { contains: term } },
        { pets: { some: { clinicId, nameSearch: { contains: term } } } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          docType: true,
          docNumber: true,
          name: true,
          phone: true,
          active: true,
          pets: {
            select: {
              id: true,
              number: true,
              name: true,
              species: true,
              sex: true,
              breed: true,
              birthDate: true,
              aggressive: true,
              aggressiveNote: true,
              allergies: true,
              active: true,
            },
            orderBy: [{ active: 'desc' }, { name: 'asc' }],
          },
        },
      }),
      this.prisma.client.count({ where }),
    ]);

    const visits = await this.lastVisits(
      clinicId,
      rows.flatMap((r) => r.pets.map((p) => p.id)),
    );
    return {
      items: rows.map((row) => ({
        ...row,
        lastVisit: latest(row.pets.map((p) => visits.get(p.id) ?? null)),
        pets: row.pets.map(({ allergies, aggressiveNote, ...pet }) => ({
          ...pet,
          aggressiveNote: pet.aggressive ? aggressiveNote : null,
          hasAllergies: Boolean(allergies),
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Para avisar en el registro que el documento ya existe. */
  async lookup(
    clinicId: number,
    docType: DocumentType,
    docNumber: string,
  ): Promise<{
    id: number;
    name: string;
    phone: string;
    active: boolean;
  } | null> {
    return this.prisma.client.findFirst({
      where: { clinicId, docType, docNumber },
      select: { id: true, name: true, phone: true, active: true },
    });
  }

  /** Para avisar en el registro que el celular ya es de otro cliente (mismo dueño o un familiar). */
  async lookupPhone(
    clinicId: number,
    phone: string,
  ): Promise<{
    id: number;
    name: string;
    active: boolean;
    pets: string[];
  } | null> {
    const found = await this.prisma.client.findFirst({
      where: { clinicId, phone, anonymizedAt: null },
      select: {
        id: true,
        name: true,
        active: true,
        pets: {
          where: { active: true },
          select: { name: true },
          orderBy: { name: 'asc' },
          take: 4,
        },
      },
      orderBy: [{ active: 'desc' }, { id: 'asc' }],
    });
    return found ? { ...found, pets: found.pets.map((p) => p.name) } : null;
  }

  async get(clinicId: number, id: number): Promise<ClientDetail> {
    const client = await this.prisma.client.findFirst({
      where: { id, clinicId },
      select: DETAIL_SELECT,
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    return this.withVisits(clinicId, toDetail(client));
  }

  /** Registro rápido: cliente + primera mascota (opcional) en una sola transacción. */
  async create(
    actor: AuthUser,
    dto: CreateClientDto,
    ip?: string,
  ): Promise<ClientDetail> {
    const docType = dto.docType ?? null;
    const docNumber = docType ? (dto.docNumber ?? null) : null;
    const today = dto.pet ? await clinicToday(this.prisma, actor.clinicId) : '';

    let client: DetailRow;
    try {
      client = await this.prisma.$transaction(async (tx) => {
        const number = await reserveNumbers(tx, actor.clinicId, 'client');
        const petNumber = dto.pet
          ? await reserveNumbers(tx, actor.clinicId, 'pet')
          : 0;
        return tx.client.create({
          data: {
            clinicId: actor.clinicId,
            number,
            docType,
            docNumber,
            name: dto.name,
            phone: dto.phone,
            email: dto.email ?? null,
            address: dto.address ?? null,
            district: dto.district ?? null,
            notes: dto.notes ?? null,
            consentAt: new Date(),
            consentVersion: CONSENT_VERSION,
            consentChannel: 'FORM',
            consentById: actor.id,
            marketingConsent: dto.marketingConsent ?? false,
            searchText: clientSearchText(dto.name, docNumber, dto.phone),
            pets: dto.pet
              ? {
                  create: [
                    {
                      ...petCreateData(dto.pet, today),
                      clinicId: actor.clinicId,
                      number: petNumber,
                    },
                  ],
                }
              : undefined,
          },
          select: DETAIL_SELECT,
        });
      });
    } catch (error) {
      throw mapDuplicate(error);
    }

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.create',
      entity: 'client',
      entityId: client.id,
      ip,
      data: {
        consentVersion: CONSENT_VERSION,
        marketingConsent: client.marketingConsent,
        pets: client.pets.map((p) => p.id),
      },
    });
    return this.withVisits(actor.clinicId, toDetail(client));
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateClientDto,
    ip?: string,
  ): Promise<ClientDetail> {
    const current = await this.prisma.client.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: {
        docType: true,
        docNumber: true,
        name: true,
        phone: true,
        walkIn: true,
        anonymizedAt: true,
        invoiceRuc: true,
        invoiceName: true,
      },
    });
    if (!current) throw new NotFoundException('El cliente no existe');
    if (current.walkIn)
      throw new BadRequestException('"Cliente varios" no se edita');
    if (current.anonymizedAt) throw anonymizedError();

    const docType = dto.docType === undefined ? current.docType : dto.docType;
    const docNumber = docType
      ? dto.docNumber === undefined
        ? current.docNumber
        : dto.docNumber
      : null;
    if (docType && (!docNumber || !isValidDocument(docType, docNumber)))
      throw new BadRequestException(documentError(docType));
    if (!docType && dto.docNumber)
      throw new BadRequestException('Elige el tipo de documento');

    const name = dto.name ?? current.name;
    const phone = dto.phone ?? current.phone;
    const data: Prisma.ClientUpdateInput = {
      docType,
      docNumber,
      name,
      phone,
      searchText: clientSearchText(name, docNumber, phone),
    };
    for (const key of [
      'email',
      'address',
      'district',
      'notes',
      'invoiceRuc',
      'invoiceName',
      'invoiceAddress',
      'invoiceEmail',
      'marketingConsent',
      'active',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(data, { [key]: dto[key] });
    }
    // Sin RUC de facturación no quedan datos sueltos; con RUC, la razón social es obligatoria
    if (dto.invoiceRuc === null)
      Object.assign(data, {
        invoiceName: null,
        invoiceAddress: null,
        invoiceEmail: null,
      });
    else if (
      (dto.invoiceRuc ?? current.invoiceRuc) &&
      !(dto.invoiceName === undefined ? current.invoiceName : dto.invoiceName)
    )
      throw new BadRequestException(
        'Escribe la razón social de los datos de facturación',
      );

    let client: DetailRow;
    try {
      client = await this.prisma.client.update({
        where: { id },
        data,
        select: DETAIL_SELECT,
      });
    } catch (error) {
      throw mapDuplicate(error);
    }
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.update',
      entity: 'client',
      entityId: id,
      ip,
      data: { fields: Object.keys(dto) },
    });
    return this.withVisits(actor.clinicId, toDetail(client));
  }

  async addAuthorized(
    actor: AuthUser,
    clientId: number,
    dto: CreateAuthorizedPersonDto,
    ip?: string,
  ): Promise<AuthorizedPersonView> {
    await this.ensureClient(actor.clinicId, clientId);
    const person = await this.prisma.authorizedPerson.create({
      data: {
        clinicId: actor.clinicId,
        clientId,
        name: dto.name,
        dni: dto.dni ?? null,
        phone: dto.phone ?? null,
        relation: dto.relation ?? null,
      },
      select: { id: true, name: true, dni: true, phone: true, relation: true },
    });
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.authorized_add',
      entity: 'client',
      entityId: clientId,
      ip,
      data: { personId: person.id, name: person.name },
    });
    return person;
  }

  async removeAuthorized(
    actor: AuthUser,
    clientId: number,
    personId: number,
    ip?: string,
  ): Promise<void> {
    const { count } = await this.prisma.authorizedPerson.deleteMany({
      where: { id: personId, clientId, clinicId: actor.clinicId },
    });
    if (count === 0)
      throw new NotFoundException('La persona autorizada no existe');
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.authorized_remove',
      entity: 'client',
      entityId: clientId,
      ip,
      data: { personId },
    });
  }

  /**
   * Último día que vino cada mascota: su atención más reciente (abierta o cerrada; no las
   * anuladas) o, si no tiene, el último paso por la cola. Antes solo contaba la cola y una
   * atención abierta con "Atender" no aparecía.
   */
  private async lastVisits(
    clinicId: number,
    petIds: number[],
  ): Promise<Map<number, string>> {
    if (petIds.length === 0) return new Map();
    const [clinic, visits, queue] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { timezone: true },
      }),
      this.prisma.visit.groupBy({
        by: ['petId'],
        where: {
          clinicId,
          petId: { in: petIds },
          status: { not: 'CANCELLED' },
        },
        _max: { openedAt: true },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['petId'],
        where: { petId: { in: petIds }, status: 'DONE' },
        _max: { day: true },
      }),
    ]);
    const result = new Map<number, string>();
    const keep = (petId: number, day: string | null) => {
      const current = result.get(petId);
      if (day && (!current || day > current)) result.set(petId, day);
    };
    for (const v of visits)
      keep(
        v.petId,
        v._max.openedAt ? clinicDay(clinic.timezone, v._max.openedAt) : null,
      );
    for (const q of queue) keep(q.petId, fromDbDate(q._max.day));
    return result;
  }

  /** La próxima cita de cada mascota (la primera que no pasó y sigue en pie) */
  private async nextAppointments(
    clinicId: number,
    petIds: number[],
  ): Promise<Map<number, NextAppointment>> {
    if (petIds.length === 0) return new Map();
    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        petId: { in: petIds },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { gte: new Date() },
      },
      select: {
        id: true,
        petId: true,
        startsAt: true,
        type: true,
        reason: true,
        vet: { select: { fullName: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
    const result = new Map<number, NextAppointment>();
    for (const a of rows)
      if (!result.has(a.petId))
        result.set(a.petId, {
          id: a.id,
          startsAt: a.startsAt,
          type: a.type,
          reason: a.reason,
          vet: a.vet?.fullName ?? null,
        });
    return result;
  }

  private async withVisits(
    clinicId: number,
    detail: Omit<ClientDetail, 'pets'> & { pets: PetView[] },
  ): Promise<ClientDetail> {
    const ids = detail.pets.map((p) => p.id);
    const [visits, next] = await Promise.all([
      this.lastVisits(clinicId, ids),
      this.nextAppointments(clinicId, ids),
    ]);
    return {
      ...detail,
      pets: detail.pets.map((p) => ({
        ...p,
        lastVisit: visits.get(p.id) ?? null,
        nextAppointment: next.get(p.id) ?? null,
      })),
    };
  }

  private async ensureClient(clinicId: number, id: number): Promise<void> {
    const found = await this.prisma.client.findFirst({
      where: { id, clinicId },
      select: { id: true, anonymizedAt: true },
    });
    if (!found) throw new NotFoundException('El cliente no existe');
    if (found.anonymizedAt) throw anonymizedError();
  }
}

function toDetail(
  row: DetailRow,
): Omit<ClientDetail, 'pets'> & { pets: PetView[] } {
  return { ...row, pets: row.pets.map(toPetView) };
}

function latest(days: (string | null)[]): string | null {
  return days.reduce<string | null>(
    (max, d) => (d && (!max || d > max) ? d : max),
    null,
  );
}

function mapDuplicate(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
    return new ConflictException(DUPLICATE_DOC);
  return error;
}
