import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clientSearchText, normalizeSearch } from '../common/text/search.js';
import { fromDbDate } from '../common/time/clinic-day.js';
import { clinicToday } from '../common/time/clinic-today.js';
import { documentError, isValidDocument } from '../common/validators/peru.js';
import { Prisma } from '../generated/prisma/client.js';
import type { DocumentType, Species } from '../generated/prisma/enums.js';
import { PET_SELECT, petCreateData, toPetView } from '../pets/pet.mapper.js';
import {
  parseRecordCode,
  reserveNumbers,
} from '../common/sequence/clinic-sequence.js';
import type { PetView } from '../pets/pet.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
  aggressive: boolean;
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
  active: boolean;
  consentAt: Date;
  consentVersion: string;
  consentChannel: string;
  marketingConsent: boolean;
  createdAt: Date;
  pets: (PetView & { lastVisit: string | null })[];
  authorized: AuthorizedPersonView[];
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
  active: true,
  consentAt: true,
  consentVersion: true,
  consentChannel: true,
  marketingConsent: true,
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

    const where: Prisma.ClientWhereInput = { clinicId };
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
              aggressive: true,
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
      rows.flatMap((r) => r.pets.map((p) => p.id)),
    );
    return {
      items: rows.map((row) => ({
        ...row,
        lastVisit: latest(row.pets.map((p) => visits.get(p.id) ?? null)),
        pets: row.pets.map(({ allergies, ...pet }) => ({
          ...pet,
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

  async get(clinicId: number, id: number): Promise<ClientDetail> {
    const client = await this.prisma.client.findFirst({
      where: { id, clinicId },
      select: DETAIL_SELECT,
    });
    if (!client) throw new NotFoundException('El cliente no existe');
    return this.withVisits(toDetail(client));
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
    return this.withVisits(toDetail(client));
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateClientDto,
    ip?: string,
  ): Promise<ClientDetail> {
    const current = await this.prisma.client.findFirst({
      where: { id, clinicId: actor.clinicId },
      select: { docType: true, docNumber: true, name: true, phone: true },
    });
    if (!current) throw new NotFoundException('El cliente no existe');

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
      'marketingConsent',
      'active',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(data, { [key]: dto[key] });
    }

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
    return this.withVisits(toDetail(client));
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

  /** Última atención terminada de cada mascota (cola en estado DONE). */
  private async lastVisits(petIds: number[]): Promise<Map<number, string>> {
    if (petIds.length === 0) return new Map();
    const rows = await this.prisma.queueEntry.groupBy({
      by: ['petId'],
      where: { petId: { in: petIds }, status: 'DONE' },
      _max: { day: true },
    });
    return new Map(
      rows
        .filter((r) => r._max.day)
        .map((r) => [r.petId, fromDbDate(r._max.day) as string]),
    );
  }

  private async withVisits(
    detail: Omit<ClientDetail, 'pets'> & { pets: PetView[] },
  ): Promise<ClientDetail> {
    const visits = await this.lastVisits(detail.pets.map((p) => p.id));
    return {
      ...detail,
      pets: detail.pets.map((p) => ({
        ...p,
        lastVisit: visits.get(p.id) ?? null,
      })),
    };
  }

  private async ensureClient(clinicId: number, id: number): Promise<void> {
    const found = await this.prisma.client.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('El cliente no existe');
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
