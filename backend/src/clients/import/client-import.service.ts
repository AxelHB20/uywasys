import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { clientSearchText, normalizeSearch } from '../../common/text/search.js';
import { clinicToday } from '../../common/time/clinic-today.js';
import { toDbDate } from '../../common/time/clinic-day.js';
import type { DocumentType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CONSENT_VERSION } from '../consent.js';
import { readWorkbook } from './excel.js';
import { validateRows } from './import-rows.js';
import type { ImportRow } from './import-rows.js';

export interface ImportPreview {
  rows: ImportRow[];
  summary: {
    rows: number;
    ok: number;
    exists: number;
    errors: number;
    /** Lo que se crearía al confirmar */
    clients: number;
    pets: number;
  };
}

export interface ImportResult {
  clients: number;
  pets: number;
  skipped: number;
  errors: number;
}

@Injectable()
export class ClientImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lee y valida el archivo sin guardar nada. */
  async preview(clinicId: number, buffer: Buffer): Promise<ImportPreview> {
    const today = await clinicToday(this.prisma, clinicId);
    const rows = validateRows(await readWorkbook(buffer), today);
    await this.markExisting(clinicId, rows);

    const okRows = rows.filter((r) => r.status === 'ok');
    return {
      rows,
      summary: {
        rows: rows.length,
        ok: okRows.length,
        exists: rows.filter((r) => r.status === 'exists').length,
        errors: rows.filter((r) => r.status === 'error').length,
        clients: new Set(okRows.map((r) => r.key)).size,
        pets: countPets(okRows),
      },
    };
  }

  /**
   * Importa las filas válidas. Se vuelve a leer el archivo (no se confía en la vista previa del navegador).
   * Las filas con error o de clientes que ya existen se saltan: nunca se sobrescribe nada.
   */
  async import(
    actor: AuthUser,
    buffer: Buffer,
    consentDeclared: boolean,
    ip?: string,
  ): Promise<ImportResult> {
    if (!consentDeclared)
      throw new BadRequestException(
        'Confirma que la clínica tiene la autorización de estos clientes para usar sus datos',
      );
    const { rows, summary } = await this.preview(actor.clinicId, buffer);
    const groups = new Map<string, ImportRow[]>();
    for (const row of rows.filter((r) => r.status === 'ok')) {
      groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
    }

    const now = new Date();
    let pets = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const group of groups.values()) {
          const { client } = group[0];
          const uniquePets = dedupePets(group);
          pets += uniquePets.length;
          await tx.client.create({
            data: {
              clinicId: actor.clinicId,
              ...client,
              consentAt: now,
              consentVersion: CONSENT_VERSION,
              consentChannel: 'IMPORT',
              consentById: actor.id,
              searchText: clientSearchText(
                client.name,
                client.docNumber,
                client.phone,
              ),
              pets: {
                create: uniquePets.map((pet) => ({
                  clinicId: actor.clinicId,
                  name: pet.name,
                  nameSearch: normalizeSearch(pet.name).slice(0, 60),
                  species: pet.species,
                  breed: pet.breed,
                  sex: pet.sex,
                  neutered: pet.neutered,
                  birthDate: pet.birthDate ? toDbDate(pet.birthDate) : null,
                  weightKg: pet.weightKg,
                  allergies: pet.allergies,
                })),
              },
            },
            select: { id: true },
          });
        }
      },
      { timeout: 60_000 },
    );

    const result = {
      clients: groups.size,
      pets,
      skipped: summary.exists,
      errors: summary.errors,
    };
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.import',
      entity: 'client',
      ip,
      data: { ...result, consentVersion: CONSENT_VERSION },
    });
    return result;
  }

  /** Marca como "ya existe" lo que ya está en la clínica: por documento, o por celular + nombre si no tiene. */
  private async markExisting(
    clinicId: number,
    rows: ImportRow[],
  ): Promise<void> {
    const candidates = rows.filter((r) => r.status === 'ok');
    const withDoc = candidates.filter(
      (r) => r.client.docType && r.client.docNumber,
    );
    const withoutDoc = candidates.filter((r) => !r.client.docType);

    const existingDocs = new Set<string>();
    if (withDoc.length) {
      const found = await this.prisma.client.findMany({
        where: {
          clinicId,
          docNumber: {
            in: [...new Set(withDoc.map((r) => r.client.docNumber as string))],
          },
        },
        select: { docType: true, docNumber: true },
      });
      for (const c of found)
        existingDocs.add(`${c.docType as DocumentType}:${c.docNumber}`);
    }
    const existingNoDoc = new Set<string>();
    if (withoutDoc.length) {
      const found = await this.prisma.client.findMany({
        where: {
          clinicId,
          docType: null,
          phone: { in: [...new Set(withoutDoc.map((r) => r.client.phone))] },
        },
        select: { phone: true, name: true },
      });
      for (const c of found)
        existingNoDoc.add(`sin-doc:${c.phone}:${normalizeSearch(c.name)}`);
    }

    for (const row of candidates) {
      if (existingDocs.has(row.key) || existingNoDoc.has(row.key)) {
        row.status = 'exists';
        row.errors = ['Ya está registrado: se salta'];
      }
    }
  }
}

function dedupePets(group: ImportRow[]) {
  const seen = new Set<string>();
  return group
    .map((r) => r.pet)
    .filter((pet): pet is NonNullable<typeof pet> => {
      if (!pet) return false;
      const key = normalizeSearch(pet.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function countPets(okRows: ImportRow[]): number {
  const groups = new Map<string, ImportRow[]>();
  for (const row of okRows)
    groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  return [...groups.values()].reduce((sum, g) => sum + dedupePets(g).length, 0);
}
