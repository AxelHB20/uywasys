import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import type { RequestWithId } from '../http/request-id.js';

/** Forma única de los errores que recibe el frontend. */
export interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[];
  /** Datos extra para la pantalla, por ejemplo { visitId } o { available } en un 409 */
  details?: Record<string, unknown>;
  /** Código de la petición: el usuario lo dicta a soporte y se busca en los registros */
  reference?: string;
  path: string;
  timestamp: string;
}

/**
 * Convierte cualquier error en una respuesta JSON consistente.
 * Los errores inesperados se registran en el log y al cliente solo le llega un mensaje genérico.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestWithId>();
    const apiError = this.toApiError(exception);
    const { statusCode, errors, details } = apiError;
    let { message } = apiError;
    // La importación de Excel admite archivos más grandes que el logo
    if (
      statusCode === HttpStatus.PAYLOAD_TOO_LARGE &&
      /\/(clients|inventory)\/import/.test(req.originalUrl ?? '')
    ) {
      message = 'El archivo pesa más de lo permitido (2 MB)';
    }
    if (
      statusCode === HttpStatus.PAYLOAD_TOO_LARGE &&
      /\/attachments/.test(req.originalUrl ?? '')
    ) {
      message = 'El archivo pesa más de lo permitido (10 MB)';
    }

    if (statusCode >= 500) {
      this.logger.error(
        `[${req.id ?? '-'}] ${req.method} ${req.originalUrl} · usuario ${req.user?.id ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiError = {
      statusCode,
      message,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    };
    if (req.id) body.reference = req.id;
    if (errors?.length) body.errors = errors;
    if (details) body.details = details;
    res.status(statusCode).json(body);
  }

  private toApiError(
    exception: unknown,
  ): Pick<ApiError, 'statusCode' | 'message' | 'errors' | 'details'> {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        Array.isArray((response as { message?: unknown }).message)
      ) {
        // Errores de validación de DTOs (class-validator)
        return {
          statusCode,
          message: 'Datos inválidos',
          errors: (response as { message: string[] }).message.map(readablePath),
        };
      }
      // Multer rechaza archivos que superan el límite con un mensaje en inglés
      if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
        return {
          statusCode,
          message: 'El archivo pesa más de lo permitido (1 MB)',
        };
      }
      // Express responde "Cannot GET /ruta" cuando la ruta no existe
      if (
        statusCode === HttpStatus.NOT_FOUND &&
        exception.message.startsWith('Cannot ')
      ) {
        return { statusCode, message: 'Ruta no encontrada' };
      }
      return {
        statusCode,
        message: exception.message,
        details: extraFields(response),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'Ya existe un registro con esos datos',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'El registro no existe',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'El registro está relacionado con otros datos',
          };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
    };
  }
}

/** Campos propios de una excepción lanzada con objeto: new ConflictException({ message, visitId }). */
function extraFields(response: unknown): Record<string, unknown> | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const {
    message: _message,
    error: _error,
    statusCode: _statusCode,
    ...rest
  } = response as Record<string, unknown>;
  return Object.keys(rest).length ? rest : undefined;
}

/** Nombre de cada lista anidada tal como la ve el usuario */
const LIST_NAMES: Record<string, string> = {
  presentations: 'Presentación',
  lines: 'Línea',
  items: 'Fila',
};

/**
 * class-validator antepone la ruta del campo anidado ("presentations.0.El precio…"), que el usuario
 * veía tal cual. Se cambia por "Presentación 1: el precio…".
 */
export function readablePath(message: string): string {
  const match = /^([A-Za-z]+)\.(\d+)\.(?:[A-Za-z]+\.(?:\d+\.)?)*(.+)$/.exec(
    message,
  );
  if (!match) return message;
  const [, list, index, rest] = match;
  const label = LIST_NAMES[list] ?? 'Fila';
  return `${label} ${Number(index) + 1}: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
}
