import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../common/audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ClientsService } from './clients.service.js';
import { CONSENT_VERSION } from './consent.js';

const reception: AuthUser = { id: 5, clinicId: 10, role: 'RECEPTION' };

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    docType: 'DNI',
    docNumber: '45678912',
    name: 'Rosa Quispe',
    phone: '987654321',
    email: null,
    address: null,
    district: null,
    notes: null,
    active: true,
    consentAt: new Date(),
    consentVersion: CONSENT_VERSION,
    consentChannel: 'FORM',
    marketingConsent: false,
    createdAt: new Date(),
    pets: [],
    authorized: [],
    ...overrides,
  };
}

function setup() {
  const prisma = {
    clinic: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ timezone: 'America/Lima' }),
    },
    client: {
      findFirst: vi.fn().mockResolvedValue({
        docType: 'DNI',
        docNumber: '45678912',
        name: 'Rosa Quispe',
        phone: '987654321',
      }),
      create: vi.fn().mockResolvedValue(detail()),
      update: vi.fn().mockResolvedValue(detail()),
    },
    queueEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    // Correlativo: el contador de la clínica devuelve 7
    $queryRaw: vi.fn().mockResolvedValue([{ last_value: 7 }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const audit = { log: vi.fn() };
  return {
    service: new ClientsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    prisma,
    audit,
  };
}

const base = {
  name: 'Rosa Quispe',
  phone: '987654321',
  consent: true,
};

describe('ClientsService', () => {
  it('guarda el consentimiento con versión, canal y quién lo registró', async () => {
    const { service, prisma, audit } = setup();
    await service.create(reception, {
      ...base,
      docType: 'DNI',
      docNumber: '45678912',
    });
    const data = prisma.client.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      clinicId: 10,
      number: 7,
      consentVersion: CONSENT_VERSION,
      consentChannel: 'FORM',
      consentById: 5,
      searchText: 'rosa quispe 45678912 987654321',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'client.create' }),
    );
  });

  it('crea la primera mascota en la misma operación', async () => {
    const { service, prisma } = setup();
    await service.create(reception, {
      ...base,
      pet: {
        name: 'Toby',
        species: 'DOG',
        aggressive: false,
        aggressiveNote: 'x',
      },
    });
    const pet = prisma.client.create.mock.calls[0][0].data.pets.create[0];
    expect(pet).toMatchObject({
      name: 'Toby',
      nameSearch: 'toby',
      clinicId: 10,
    });
    expect(pet.aggressiveNote).toBeNull();
  });

  it('rechaza una mascota con fecha de nacimiento futura', async () => {
    const { service } = setup();
    await expect(
      service.create(reception, {
        ...base,
        pet: { name: 'Toby', species: 'DOG', birthDate: '2999-01-01' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('avisa con 409 si el documento ya existe', async () => {
    const { service, prisma } = setup();
    prisma.client.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.create(reception, {
        ...base,
        docType: 'DNI',
        docNumber: '45678912',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('al cambiar a RUC valida el número con el tipo nuevo', async () => {
    const { service } = setup();
    await expect(
      service.update(reception, 1, { docType: 'RUC' }),
    ).rejects.toThrow('El RUC no es válido');
  });

  it('quitar el documento deja tipo y número vacíos', async () => {
    const { service, prisma } = setup();
    await service.update(reception, 1, { docType: null });
    expect(prisma.client.update.mock.calls[0][0].data).toMatchObject({
      docType: null,
      docNumber: null,
      searchText: 'rosa quispe 987654321',
    });
  });
});
