import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_KEY_HEADER } from './auth/api-key.guard';

// Shared by main.ts and the e2e tests so both run the exact same app.
export function configureApp(app: INestApplication) {
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('FinOps API')
    .setDescription(
      'Bank-agnostic, read-only finance aggregator. Per-bank routes live under /v1/{country}/{bank}; ' +
        'aggregate and report routes span every configured bank. Reports, ledger and API-key admin need DATABASE_URL.',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: API_KEY_HEADER },
      'api-key',
    )
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );
  return app;
}
