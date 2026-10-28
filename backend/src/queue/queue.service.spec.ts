import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { QueueService, TRANSITIONS } from './queue.service.js';

const reception: AuthUser = { id: 5, clinicId: 10, role: 'RECEPTION' };

function row(status: string) {
  return {
    id: 1,
    day: new Date('2026-10-27T00:00:00.000Z'),
    type: 'CONSULTATION',
    status,
    urgent: false,
    reason: null,
    arrivedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    pet: {
      id: 3,
      name: 'Toby',
      species: 'DOG',
      aggressive: false,
      allergies: null,
      client: { id: 2, name: 'Rosa Quispe', phone: '987654321' },
    },
    attendedBy: null,
    visits: [],
  };
}

function setup(opts: {
  pet?: Record<string, unknown> | null;
  open?: boolean;
  status?: string;
}) {
  const prisma = {
    clinic: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ timezone: 'America/Lima' }),
    },
    pet: {
      findFirst: vi.fn().mockResolvedValue(
        opts.pet === undefined
          ? {
              name: 'Toby',
              active: true,
              deceasedAt: null,
              client: { active: true },
            }
          : opts.pet,
      ),
    },
    queueEntry: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.status
            ? { status: opts.status, visits: [] }
            : opts.open
              ? { id: 9 }
              : null,
        ),
      create: vi.fn().mockResolvedValue(row('ARRIVED')),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...row(opts.status ?? 'ARRIVED'), ...data }),
        ),
    },
  };
  return {
    service: new QueueService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('QueueService', () => {
  it('no deja poner dos veces la misma mascota en la cola del día', async () => {
    const { service } = setup({ open: true });
    await expect(
      service.create(reception, { petId: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('no deja poner en cola a una mascota fallecida', async () => {
    const { service } = setup({
      pet: {
        name: 'Toby',
        active: false,
        deceasedAt: new Date(),
        client: { active: true },
      },
    });
    await expect(
      service.create(reception, { petId: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guarda el día de la clínica y quién la registró', async () => {
    const { service, prisma } = setup({});
    await service.create(reception, { petId: 3, urgent: true });
    const data = prisma.queueEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      clinicId: 10,
      petId: 3,
      urgent: true,
      createdById: 5,
    });
    expect(data.day).toBeInstanceOf(Date);
  });

  it('al pasar a atención guarda la hora y quién atiende', async () => {
    const { service, prisma } = setup({ status: 'WAITING' });
    await service.update(reception, 1, { status: 'IN_PROGRESS' });
    const data = prisma.queueEntry.update.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.attendedBy).toEqual({ connect: { id: 5 } });
  });

  it('rechaza saltos no permitidos y cambios en atenciones cerradas', async () => {
    await expect(
      setup({ status: 'ARRIVED' }).service.update(reception, 1, {
        status: 'DONE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ status: 'DONE' }).service.update(reception, 1, { urgent: true }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('atendido y cancelado son estados finales', () => {
    expect(TRANSITIONS.DONE).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
});
