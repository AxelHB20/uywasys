import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { AllExceptionsFilter, ApiError } from './all-exceptions.filter.js';

function run(exception: unknown): { status: number; body: ApiError } {
  let status = 0;
  let body = {} as ApiError;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: ApiError) {
      body = payload;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({
        method: 'GET',
        url: '/test',
        originalUrl: '/api/test',
      }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('lista los errores de validación', () => {
    const { status, body } = run(
      new BadRequestException(['email must be an email']),
    );
    expect(status).toBe(400);
    expect(body.message).toBe('Datos inválidos');
    expect(body.errors).toEqual(['email must be an email']);
    expect(body.path).toBe('/api/test');
  });

  it('respeta el mensaje de los errores HTTP', () => {
    const { status, body } = run(
      new NotFoundException('Cliente no encontrado'),
    );
    expect(status).toBe(404);
    expect(body.message).toBe('Cliente no encontrado');
  });

  it('convierte un registro duplicado de Prisma en 409', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    expect(run(error).status).toBe(409);
  });

  it('oculta el detalle de errores inesperados', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('password=1234 leaked'));
    expect(status).toBe(500);
    expect(body.message).toBe('Error interno del servidor');
  });
});
