import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../common/auth/auth-user.js';
import { groomingCode } from '../common/sequence/clinic-sequence.js';
import { startOfDayIn } from '../common/time/clinic-day.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CommissionsQuery } from './dto/grooming.dto.js';

export interface CommissionLine {
  id: number;
  /** GR-00012 */
  code: string;
  deliveredAt: Date;
  groomer: { id: number; fullName: string } | null;
  pet: { id: number; name: string };
  client: { id: number; name: string };
  services: string;
  /** Cobrado de sus servicios (con IGV); los productos no cuentan */
  paid: number;
  /** Lo que falta cobrar: no genera comisión hasta que se cobre */
  pending: number;
  percent: number;
  commission: number;
}

export interface CommissionRow {
  groomer: { id: number; fullName: string } | null;
  /** % actual del groomer (cada servicio usa el que tenía al entregarse) */
  currentPercent: number | null;
  services: number;
  paid: number;
  pending: number;
  commission: number;
}

export interface CommissionReport {
  from: string;
  to: string;
  rows: CommissionRow[];
  lines: CommissionLine[];
  totals: {
    services: number;
    paid: number;
    pending: number;
    commission: number;
  };
}

const MAX_DAYS = 93;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Comisiones de grooming: por cada servicio entregado en el período, el porcentaje del groomer
 * (congelado al entregar) sobre lo cobrado de los servicios. Lo que aún se debe no comisiona.
 */
@Injectable()
export class GroomingCommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    actor: AuthUser,
    query: CommissionsQuery,
  ): Promise<CommissionReport> {
    if (query.from > query.to)
      throw new BadRequestException('La fecha inicial es posterior a la final');
    const days =
      (Date.parse(`${query.to}T00:00:00Z`) -
        Date.parse(`${query.from}T00:00:00Z`)) /
      86_400_000;
    if (days > MAX_DAYS)
      throw new BadRequestException('El período puede ser de hasta 3 meses');

    const { timezone } = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: actor.clinicId },
      select: { timezone: true },
    });
    const start = startOfDayIn(timezone, query.from);
    const end = new Date(
      startOfDayIn(timezone, query.to).getTime() + 86_400_000,
    );
    // El groomer ve solo lo suyo
    const groomerId = actor.role === 'GROOMER' ? actor.id : query.groomerId;

    const sessions = await this.prisma.groomingSession.findMany({
      where: {
        clinicId: actor.clinicId,
        status: 'DELIVERED',
        deliveredAt: { gte: start, lt: end },
        ...(groomerId ? { groomerId } : {}),
      },
      orderBy: { deliveredAt: 'asc' },
      select: {
        id: true,
        number: true,
        deliveredAt: true,
        commissionPercent: true,
        groomer: {
          select: { id: true, fullName: true, commissionPercent: true },
        },
        pet: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        visit: {
          select: {
            charges: {
              where: { kind: 'SERVICE', status: { not: 'VOID' } },
              select: { description: true, total: true, paidAmount: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });

    const lines: CommissionLine[] = sessions.map((s) => {
      const paid = s.visit.charges.reduce(
        (sum, c) => sum + c.paidAmount.toNumber(),
        0,
      );
      const total = s.visit.charges.reduce(
        (sum, c) => sum + c.total.toNumber(),
        0,
      );
      const percent = s.groomer
        ? ((s.commissionPercent ?? s.groomer.commissionPercent)?.toNumber() ??
          0)
        : 0;
      return {
        id: s.id,
        code: groomingCode(s.number),
        deliveredAt: s.deliveredAt!,
        groomer: s.groomer
          ? { id: s.groomer.id, fullName: s.groomer.fullName }
          : null,
        pet: s.pet,
        client: s.client,
        services: s.visit.charges.map((c) => c.description).join(' + '),
        paid: round2(paid),
        pending: round2(total - paid),
        percent,
        commission: round2((paid * percent) / 100),
      };
    });

    const byGroomer = new Map<number | null, CommissionRow>();
    for (const [i, line] of lines.entries()) {
      const key = line.groomer?.id ?? null;
      const row = byGroomer.get(key) ?? {
        groomer: line.groomer,
        currentPercent:
          sessions[i].groomer?.commissionPercent?.toNumber() ?? null,
        services: 0,
        paid: 0,
        pending: 0,
        commission: 0,
      };
      row.services++;
      row.paid = round2(row.paid + line.paid);
      row.pending = round2(row.pending + line.pending);
      row.commission = round2(row.commission + line.commission);
      byGroomer.set(key, row);
    }
    // Groomers primero (de mayor a menor comisión); lo que no tiene groomer, al final
    const rows = [...byGroomer.values()].sort((a, b) =>
      !a.groomer ? 1 : !b.groomer ? -1 : b.commission - a.commission,
    );

    return {
      from: query.from,
      to: query.to,
      rows,
      lines,
      totals: {
        services: lines.length,
        paid: round2(lines.reduce((s, l) => s + l.paid, 0)),
        pending: round2(lines.reduce((s, l) => s + l.pending, 0)),
        commission: round2(lines.reduce((s, l) => s + l.commission, 0)),
      },
    };
  }

  /** El mismo reporte en Excel: resumen por groomer y detalle por servicio. */
  async excel(actor: AuthUser, query: CommissionsQuery): Promise<Buffer> {
    const report = await this.report(actor, query);
    const book = new ExcelJS.Workbook();
    const money = '#,##0.00';

    const summary = book.addWorksheet('Resumen');
    summary.addRow([
      `Comisiones de grooming del ${dmy(report.from)} al ${dmy(report.to)}`,
    ]).font = {
      bold: true,
      size: 13,
    };
    summary.addRow([
      'Sobre lo cobrado de los servicios entregados (con IGV). Lo que se debe no comisiona hasta que se cobre.',
    ]);
    summary.addRow([]);
    const head = summary.addRow([
      'Groomer',
      'Servicios',
      'Cobrado',
      'Por cobrar',
      'Comisión',
    ]);
    head.font = { bold: true };
    for (const r of report.rows)
      summary.addRow([
        r.groomer?.fullName ?? 'Sin groomer asignado',
        r.services,
        r.paid,
        r.pending,
        r.commission,
      ]);
    const total = summary.addRow([
      'Total',
      report.totals.services,
      report.totals.paid,
      report.totals.pending,
      report.totals.commission,
    ]);
    total.font = { bold: true };
    summary.columns = [
      { width: 32 },
      { width: 11 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
    ];
    for (const col of [3, 4, 5]) summary.getColumn(col).numFmt = money;

    const detail = book.addWorksheet('Detalle');
    detail.columns = [
      { header: 'Entregado', key: 'date', width: 17 },
      { header: 'Constancia', key: 'code', width: 11 },
      { header: 'Groomer', key: 'groomer', width: 26 },
      { header: 'Mascota', key: 'pet', width: 16 },
      { header: 'Cliente', key: 'client', width: 28 },
      { header: 'Servicios', key: 'services', width: 42 },
      { header: 'Cobrado', key: 'paid', width: 12 },
      { header: 'Por cobrar', key: 'pending', width: 12 },
      { header: '%', key: 'percent', width: 7 },
      { header: 'Comisión', key: 'commission', width: 12 },
    ];
    for (const l of report.lines)
      detail.addRow({
        date: limaDateTime(l.deliveredAt),
        code: l.code,
        groomer: l.groomer?.fullName ?? 'Sin groomer',
        pet: l.pet.name,
        client: l.client.name,
        services: l.services,
        paid: l.paid,
        pending: l.pending,
        percent: l.percent,
        commission: l.commission,
      });
    detail.getRow(1).font = { bold: true };
    for (const key of ['paid', 'pending', 'commission'])
      detail.getColumn(key).numFmt = money;
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}

/** AAAA-MM-DD → DD/MM/AAAA */
function dmy(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

function limaDateTime(at: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}
