import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { saleNoteCode } from '../cash/cash-math.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { clientCode, petCode } from '../common/sequence/clinic-sequence.js';
import { fromDbDate } from '../common/time/clinic-day.js';
import type { Species } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { anonymizedError } from './anonymized.js';

const SPECIES: Record<Species, string> = {
  DOG: 'Perro',
  CAT: 'Gato',
  RABBIT: 'Conejo',
  GUINEA_PIG: 'Cuy',
  BIRD: 'Ave',
  REPTILE: 'Reptil',
  OTHER: 'Otro',
};

const VISIT_STATUS = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};
const CHARGE_STATUS = { PENDING: 'Pendiente', PAID: 'Pagado', VOID: 'Anulado' };

const num = (value: { toNumber(): number } | null) =>
  value ? value.toNumber() : null;

/**
 * Derechos ARCO (Ley 29733) que se atienden desde el sistema:
 * - Acceso: exportar todo lo que la clínica guarda de un cliente.
 * - Cancelación: anonimizar. Se borran sus datos personales; las atenciones de sus mascotas
 *   y los cobros se conservan sin ellos (historia clínica y obligación tributaria).
 * La rectificación es la edición normal de la ficha; la oposición, quitar el consentimiento de promociones.
 */
@Injectable()
export class ClientPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Todo lo que la clínica guarda del cliente, con nombres de campo en español. */
  async export(actor: AuthUser, id: number, ip?: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, clinicId: actor.clinicId, walkIn: false },
      include: {
        clinic: { select: { name: true, ruc: true } },
        authorized: { orderBy: { id: 'asc' } },
        pets: {
          orderBy: { number: 'asc' },
          include: {
            visits: {
              orderBy: { openedAt: 'asc' },
              include: {
                attendedBy: { select: { fullName: true } },
                addenda: {
                  orderBy: { id: 'asc' },
                  include: { author: { select: { fullName: true } } },
                },
              },
            },
          },
        },
        charges: {
          orderBy: { id: 'asc' },
          include: { pet: { select: { name: true } } },
        },
        receipts: { orderBy: { id: 'asc' }, include: { payments: true } },
      },
    });
    if (!client) throw new NotFoundException('El cliente no existe');

    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.export',
      entity: 'client',
      entityId: id,
      ip,
    });

    return {
      documento:
        'Datos personales guardados por la clínica (Ley N.° 29733, derecho de acceso)',
      generado: new Date().toISOString(),
      clinica: { nombre: client.clinic.name, ruc: client.clinic.ruc },
      cliente: {
        codigo: clientCode(client.number),
        nombre: client.name,
        tipoDocumento: client.docType,
        numeroDocumento: client.docNumber,
        celular: client.phone,
        correo: client.email,
        direccion: client.address,
        distrito: client.district,
        notas: client.notes,
        registrado: client.createdAt.toISOString(),
        anonimizado: client.anonymizedAt?.toISOString() ?? null,
        consentimiento: {
          fecha: client.consentAt.toISOString(),
          version: client.consentVersion,
          medio:
            client.consentChannel === 'IMPORT' ? 'Importación' : 'Formulario',
        },
        aceptaPromociones: client.marketingConsent,
      },
      personasAutorizadas: client.authorized.map((a) => ({
        nombre: a.name,
        dni: a.dni,
        celular: a.phone,
        relacion: a.relation,
      })),
      mascotas: client.pets.map((p) => ({
        codigo: petCode(p.number),
        nombre: p.name,
        especie: SPECIES[p.species],
        raza: p.breed,
        sexo: p.sex === 'MALE' ? 'Macho' : p.sex === 'FEMALE' ? 'Hembra' : null,
        esterilizado: p.neutered,
        nacimiento: fromDbDate(p.birthDate),
        pesoKg: num(p.weightKg),
        color: p.color,
        microchip: p.microchip,
        alergias: p.allergies,
        notas: p.notes,
        fallecido: fromDbDate(p.deceasedAt),
        atenciones: p.visits.map((v) => ({
          fecha: v.openedAt.toISOString(),
          estado: VISIT_STATUS[v.status],
          motivo: v.reason,
          pesoKg: num(v.weightKg),
          temperaturaC: num(v.temperatureC),
          notas: v.notes,
          atendio: v.attendedBy.fullName,
          adendas: v.addenda.map((a) => ({
            fecha: a.createdAt.toISOString(),
            autor: a.author.fullName,
            texto: a.text,
          })),
        })),
      })),
      cargos: client.charges.map((c) => ({
        fecha: c.createdAt.toISOString(),
        descripcion: c.description,
        mascota: c.pet?.name ?? null,
        cantidad: c.quantity.toNumber(),
        total: c.total.toNumber(),
        pagado: c.paidAmount.toNumber(),
        estado: CHARGE_STATUS[c.status],
      })),
      cobros: client.receipts.map((r) => ({
        comprobante: saleNoteCode(r.number),
        fecha: r.createdAt.toISOString(),
        total: r.total.toNumber(),
        estado: r.status === 'VOID' ? 'Anulado' : 'Vigente',
        pagos: r.payments.map((p) => ({
          medio: p.method,
          monto: p.amount.toNumber(),
        })),
      })),
    };
  }

  /**
   * Derecho de cancelación. No se puede deshacer, así que exige que no quede nada en curso:
   * ni atenciones abiertas ni deuda (el cobro pendiente necesita saber a quién cobrar).
   */
  async anonymize(actor: AuthUser, id: number, reason: string, ip?: string) {
    const number = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { number: number; walk_in: boolean; anonymized_at: Date | null }[]
      >`SELECT number, walk_in, anonymized_at FROM clients
        WHERE id = ${id} AND clinic_id = ${actor.clinicId} FOR UPDATE`;
      if (!row) throw new NotFoundException('El cliente no existe');
      if (row.walk_in)
        throw new BadRequestException(
          '"Cliente varios" no tiene datos personales',
        );
      if (row.anonymized_at) throw anonymizedError();

      const open = await tx.visit.count({
        where: { clinicId: actor.clinicId, clientId: id, status: 'OPEN' },
      });
      if (open)
        throw new ConflictException(
          'Tiene una atención abierta: ciérrala o cancélala antes de anonimizar',
        );
      const pending = await tx.charge.count({
        where: { clinicId: actor.clinicId, clientId: id, status: 'PENDING' },
      });
      if (pending)
        throw new ConflictException(
          'Tiene cargos pendientes: cóbralos o anúlalos antes de anonimizar',
        );

      await tx.authorizedPerson.deleteMany({ where: { clientId: id } });
      // Su enlace del portal deja de funcionar
      await tx.portalLink.updateMany({
        where: { clientId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.pet.updateMany({
        where: { clientId: id },
        // El microchip identifica al dueño en los registros externos; las notas pueden nombrarlo
        data: { active: false, microchip: null, notes: null },
      });
      await tx.client.update({
        where: { id },
        data: {
          name: 'Cliente anonimizado',
          docType: null,
          docNumber: null,
          phone: '000000000',
          email: null,
          address: null,
          district: null,
          notes: null,
          invoiceRuc: null,
          invoiceName: null,
          invoiceAddress: null,
          invoiceEmail: null,
          marketingConsent: false,
          active: false,
          searchText: `anonimizado ${clientCode(row.number).toLowerCase()}`,
          anonymizedAt: new Date(),
        },
      });
      return row.number;
    });

    // La bitácora guarda el motivo, nunca los datos borrados
    await this.audit.log({
      clinicId: actor.clinicId,
      userId: actor.id,
      action: 'client.anonymize',
      entity: 'client',
      entityId: id,
      ip,
      data: { cliente: clientCode(number), reason },
    });
  }
}
