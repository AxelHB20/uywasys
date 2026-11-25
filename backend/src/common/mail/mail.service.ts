import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Envío de correos (por ahora, solo "¿Olvidaste tu contraseña?"). Se activa con SMTP_USER y
 * SMTP_PASS; con Gmail basta una "contraseña de aplicación" de la cuenta de la clínica.
 * Sin esas variables queda apagado y la pantalla de ingreso no ofrece recuperar la clave.
 * En las pruebas no sale nada: los correos quedan en `outbox`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  private readonly testMode: boolean;
  /** Correos "enviados" en las pruebas */
  readonly outbox: MailMessage[] = [];
  /** Último error al enviar, para avisarlo en Configuración */
  lastError: { at: Date; message: string } | null = null;

  constructor(config: ConfigService) {
    this.testMode = config.get<string>('NODE_ENV') === 'test';
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS')?.replace(/\s+/g, '');
    const port = Number(config.get<string>('SMTP_PORT') ?? 465);
    this.from =
      config.get<string>('SMTP_FROM')?.trim() || (user ? `Uywa <${user}>` : '');
    this.transport =
      user && pass && !this.testMode
        ? createTransport({
            host: config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com',
            port,
            secure: port === 465,
            auth: { user, pass },
            connectionTimeout: 15_000,
            socketTimeout: 20_000,
          })
        : null;
  }

  get enabled(): boolean {
    return this.testMode || this.transport !== null;
  }

  async send(message: MailMessage): Promise<boolean> {
    if (this.testMode) {
      this.outbox.push(message);
      return true;
    }
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: this.from, ...message });
      this.lastError = null;
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.lastError = { at: new Date(), message: text };
      this.logger.error(`No se pudo enviar el correo a ${message.to}: ${text}`);
      return false;
    }
  }
}
