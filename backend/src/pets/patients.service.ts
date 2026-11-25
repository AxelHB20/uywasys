import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { Species, VisitType } from '../generated/prisma/enums.js';
import { normalizeSearch } from '../common/text/search.js';
import { clinicDay, fromDbDate } from '../common/time/clinic-day.js';
import { latestDoses } from '../medical/latest-doses.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListPatientsQuery, PatientStatus } from './dto/patients.dto.js';

const PAGE_SIZE = 20;

/** Una fila de Historias clínicas */
export interface PatientRow {
  id: number;
  number: number;
  name: string;
  species: Species;
  breed: string | null;
  sex: 'MALE' | 'FEMALE' | null;
  birthDate: string | null;
  birthDateEstimated: boolean;
  deceasedAt: string | null;
  /** false: retirado (por ejemplo, el dueño pidió cancelar sus datos) */
  active: boolean;
  allergies: string | null;
  aggressive: boolean;
  client: { id: number; name: string; phone: string };
  /** Última consulta o internamiento (no anulada) */
  lastVisit: {
    id: number;
    type: VisitType;
    openedAt: Date;
    diagnosis: string | null;
    reason: string | null;
    attendedBy: string;
  } | null;
  /** Si está ahora en consulta o internado */
  openVisit: { id: number; type: VisitType } | null;
  /** Vacunas o antiparasitarios con el refuerzo vencido */
  overdue: number;
}

export interface PatientPage {
  items: PatientRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Cuántos hay en cada pestaña con la búsqueda y la especie elegidas */
  counts: Record<PatientStatus, number>;
}

const STATUS_SQL: Record<PatientStatus, Prisma.Sql> = {
  ACTIVE: Prisma.sql`p.active AND p.deceased_at IS NULL`,
  // Fallecidos o retirados: ya no se atienden, pero su historia se conserva
  INACTIVE: Prisma.sql`(NOT p.active OR p.deceased_at IS NOT NULL)`,
};

/**
 * Historias clínicas: los pacientes de la clínica con su última atención y sus avisos. Lista
 * para el veterinario (piensa en el paciente, no en el dueño); la ficha es la de siempre.
 */
@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clinicId: number, query: ListPatientsQuery): Promise<PatientPage> {
    const page = query.page ?? 1;
    const status = query.status ?? 'ACTIVE';
    const filters: Prisma.Sql[] = [Prisma.sql`p.clinic_id = ${clinicId}`];
    if (query.species === 'DOG' || query.species === 'CAT')
      filters.push(Prisma.sql`p.species = ${query.species}::"Species"`);
    if (query.species === 'OTHER')
      filters.push(Prisma.sql`p.species NOT IN ('DOG', 'CAT')`);
    const search = this.searchFilter(query.q);
    if (search) filters.push(search);
    const where = Prisma.join(filters, ' AND ');

    const order =
      query.sort === 'NAME'
        ? Prisma.sql`p.name_search ASC, p.number ASC`
        : query.sort === 'NUMBER'
          ? Prisma.sql`p.number DESC`
          : // Atendidos recientemente; los que nunca vinieron, por los más nuevos
            Prisma.sql`last_at DESC NULLS LAST, p.number DESC`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: number; total: bigint }[]>(Prisma.sql`
        SELECT p.id, count(*) OVER () AS total
        FROM pets p
        JOIN clients c ON c.id = p.client_id
        LEFT JOIN LATERAL (
          SELECT max(v.opened_at) AS last_at FROM visits v
          WHERE v.pet_id = p.id AND v.status <> 'CANCELLED' AND v.type <> 'GROOMING'
        ) lv ON true
        WHERE ${where} AND ${STATUS_SQL[status]}
        ORDER BY ${order}
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
      this.prisma.$queryRaw<{ active: bigint; inactive: bigint }[]>(
        Prisma.sql`
        SELECT count(*) FILTER (WHERE ${STATUS_SQL.ACTIVE}) AS active,
               count(*) FILTER (WHERE ${STATUS_SQL.INACTIVE}) AS inactive
        FROM pets p JOIN clients c ON c.id = p.client_id
        WHERE ${where}`,
      ),
    ]);
    const counts = {
      ACTIVE: Number(countRows[0]?.active ?? 0),
      INACTIVE: Number(countRows[0]?.inactive ?? 0),
    };
    const ids = rows.map((r) => r.id);
    return {
      items: await this.details(clinicId, ids),
      total: Number(rows[0]?.total ?? 0),
      page,
      pageSize: PAGE_SIZE,
      counts,
    };
  }

  /** Nombre de la mascota, dueño, DNI, celular o N° de historia ("HC-00026", "hc26" o "26") */
  private searchFilter(q: string | undefined): Prisma.Sql | null {
    const term = normalizeSearch(q ?? '');
    if (!term) return null;
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const text = Prisma.sql`(p.name_search LIKE ${like} OR c.search_text LIKE ${like})`;
    const hc = /^(?:hc[\s-]*)?0*(\d{1,7})$/.exec(term);
    if (!hc) return text;
    const number = Number(hc[1]);
    // "hc26": solo la historia; "26": la historia o un DNI/celular que lo contenga
    return term.startsWith('hc')
      ? Prisma.sql`p.number = ${number}`
      : Prisma.sql`(p.number = ${number} OR ${text})`;
  }

  /** Datos de las filas de la página, en el mismo orden */
  private async details(
    clinicId: number,
    ids: number[],
  ): Promise<PatientRow[]> {
    if (!ids.length) return [];
    const clinical = { in: ['CONSULTATION', 'HOSPITALIZATION'] as VisitType[] };
    const [pets, lastVisits, open, doses, clinic] = await Promise.all([
      this.prisma.pet.findMany({
        where: { clinicId, id: { in: ids } },
        select: {
          id: true,
          number: true,
          name: true,
          species: true,
          breed: true,
          sex: true,
          birthDate: true,
          birthDateEstimated: true,
          deceasedAt: true,
          active: true,
          allergies: true,
          aggressive: true,
          client: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.visit.findMany({
        where: {
          clinicId,
          petId: { in: ids },
          status: { not: 'CANCELLED' },
          type: clinical,
        },
        distinct: ['petId'],
        orderBy: [{ petId: 'asc' }, { openedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          petId: true,
          type: true,
          openedAt: true,
          diagnosis: true,
          reason: true,
          attendedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.visit.findMany({
        where: { clinicId, petId: { in: ids }, status: 'OPEN', type: clinical },
        orderBy: { openedAt: 'desc' },
        select: { id: true, petId: true, type: true },
      }),
      this.prisma.immunization.findMany({
        where: { clinicId, petId: { in: ids }, voidedAt: null },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        select: { petId: true, name: true, kind: true, nextDueAt: true },
      }),
      this.prisma.clinic.findUniqueOrThrow({
        where: { id: clinicId },
        select: { timezone: true },
      }),
    ]);
    const today = clinicDay(clinic.timezone);
    const byPet = <T extends { petId: number }>(list: T[]) => {
      const map = new Map<number, T[]>();
      for (const x of list) map.set(x.petId, [...(map.get(x.petId) ?? []), x]);
      return map;
    };
    const last = new Map(lastVisits.map((v) => [v.petId, v]));
    const openNow = new Map<number, (typeof open)[number]>();
    for (const v of open) if (!openNow.has(v.petId)) openNow.set(v.petId, v);
    const dosesByPet = byPet(doses);
    const byId = new Map(pets.map((p) => [p.id, p]));

    return ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p) return [];
      const lv = last.get(id);
      const ov = openNow.get(id);
      const overdue = latestDoses(dosesByPet.get(id) ?? []).filter((d) => {
        const due = fromDbDate(d.nextDueAt);
        return !!due && due < today;
      }).length;
      return [
        {
          ...p,
          birthDate: fromDbDate(p.birthDate),
          deceasedAt: fromDbDate(p.deceasedAt),
          lastVisit: lv
            ? {
                id: lv.id,
                type: lv.type,
                openedAt: lv.openedAt,
                diagnosis: lv.diagnosis,
                reason: lv.reason,
                attendedBy: lv.attendedBy.fullName,
              }
            : null,
          openVisit: ov ? { id: ov.id, type: ov.type } : null,
          // Un inactivo no tiene refuerzos pendientes
          overdue: p.deceasedAt || !p.active ? 0 : overdue,
        },
      ];
    });
  }
}
