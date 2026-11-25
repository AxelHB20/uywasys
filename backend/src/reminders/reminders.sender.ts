import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RemindersService } from './reminders.service.js';

/** Revisa cada pocos minutos los avisos automáticos que tocan (refuerzos y citas de mañana). */
@Injectable()
export class RemindersSender implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersSender.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly enabled: boolean;
  private readonly everyMinutes: number;

  constructor(
    private readonly reminders: RemindersService,
    config: ConfigService,
  ) {
    // En las pruebas se llama a tick() a mano
    this.enabled = config.get<string>('NODE_ENV') !== 'test';
    this.everyMinutes =
      Number(config.get('REMINDERS_POLL_MINUTES') ?? 10) || 10;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.everyMinutes * 60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.reminders.sendDue();
    } catch (error) {
      this.logger.error(
        'Los avisos automáticos fallaron',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}
