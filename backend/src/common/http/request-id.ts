import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Petición con su código de referencia (el que ve el usuario si algo falla). */
export type RequestWithId = Request & { id?: string; user?: { id: number } };

/**
 * Da a cada petición un código corto (por ejemplo 7F3A09C2) que viaja en la cabecera
 * X-Request-Id y en el cuerpo de los errores. Si una clínica llama por un error, con ese
 * código se encuentra la línea exacta en los registros del servidor.
 */
export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = randomBytes(4).toString('hex').toUpperCase();
  (req as RequestWithId).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
