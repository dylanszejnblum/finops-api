import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../auth/api-keys.module';
import { LedgerModule } from '../ledger/ledger.module';
import { Init1761480000000 } from './migrations/1761480000000-init';

// URL scheme -> TypeORM driver. Add a scheme here (and install its driver) to support another DB.
const DRIVERS = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
} as const;

export const driverFor = (url: string) => {
  const scheme = new URL(url).protocol.slice(0, -1) as keyof typeof DRIVERS;
  const type = DRIVERS[scheme];
  if (!type) throw new Error(`Unsupported DATABASE_URL scheme "${scheme}"`);
  return type;
};

// true = verified TLS; no-verify = TLS without cert check (some managed DBs); anything else = off.
const sslFor = (v?: string) =>
  v === 'true'
    ? true
    : v === 'no-verify'
      ? { rejectUnauthorized: false }
      : undefined;

// Everything that needs a DB lives here; AppModule only imports this when DATABASE_URL is set.
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('DATABASE_URL');
        return {
          type: driverFor(url),
          url,
          autoLoadEntities: true,
          synchronize: false, // never let the ORM alter a finance DB; schema lives in migrations
          migrations: [Init1761480000000],
          migrationsRun: true, // ponytail: migrate on boot; move to a release step if boots must stay read-only
          ssl: sslFor(config.get<string>('DATABASE_SSL')),
        };
      },
    }),
    ApiKeysModule,
    LedgerModule,
  ],
})
export class DatabaseModule {}
