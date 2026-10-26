import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller';
import { ApiKeyGuard, AuthedRequest } from './auth/api-key.guard';
import { BanksModule } from './banks/banks.module';
import { DatabaseModule } from './database/database.module';

const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        if (!env.API_KEYS)
          throw new Error('API_KEYS must be set (comma-separated)');
        return env;
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          // Reuse a caller's x-request-id if it is sane, otherwise mint one; echo it back.
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.headers.cookie',
          ],
          // Audit trail: which key made the call (set by ApiKeyGuard, read when the response finishes).
          customProps: (req) => ({
            apiKey: (req as AuthedRequest).apiKey?.name,
          }),
        },
      }),
    }),
    // ponytail: in-memory rate limit, per instance; move to a Redis store when running replicas
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    BanksModule,
    // a string key would treat "unset" as true; only connect when a URL is present
    ConditionalModule.registerWhen(DatabaseModule, (env) => !!env.DATABASE_URL),
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
