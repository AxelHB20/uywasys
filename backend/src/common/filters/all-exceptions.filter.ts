import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

/** Forma única de los errores que recibe el frontend. */
export interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[];
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
    const req = ctx.getRequest<Request>();
    const { statusCode, message, errors } = this.toApiError(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiError = {
      statusCode,
      message,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    };
    if (errors?.length) body.errors = errors;
    res.status(statusCode).json(body);
  }

  private toApiError(
    exception: unknown,
  ): Pick<ApiError, 'statusCode' | 'message' | 'errors'> {
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
          errors: (response as { message: string[] }).message,
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
      return { statusCode, message: exception.message };
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
