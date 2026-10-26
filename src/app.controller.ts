import { Controller, Get, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from './auth/api-key.guard';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(@Optional() private readonly db?: DataSource) {}

  @Public()
  @Get('health')
  async health() {
    if (!this.db) return { status: 'ok', db: 'disabled' };
    const up = await this.db.query('SELECT 1').then(
      () => true,
      () => false,
    );
    return { status: up ? 'ok' : 'degraded', db: up ? 'up' : 'down' };
  }
}
