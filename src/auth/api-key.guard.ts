import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import { ApiKeyEntity } from './api-key.entity';
import { ApiKeyIdentity, Scope, SCOPE_KEY } from './scopes';

export const API_KEY_HEADER = 'x-api-key';
export const DB_KEY_PREFIX = 'fo_';
const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { apiKey?: ApiKeyIdentity };

const digest = (s: string) => createHash('sha256').update(s).digest();
export const hashKey = (key: string) => digest(key).toString('hex');

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly envKeys: Buffer[];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
    @Optional() private readonly db?: DataSource,
  ) {
    this.envKeys = config
      .getOrThrow<string>('API_KEYS')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map(digest);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const key = req.header(API_KEY_HEADER);
    const identity = key
      ? (this.fromEnv(key) ?? (await this.fromDb(key)))
      : undefined;
    if (!identity)
      throw new UnauthorizedException('Invalid or missing API key');
    req.apiKey = identity;

    // Default-deny: a route without @RequireScope needs admin.
    const needed =
      this.reflector.getAllAndOverride<Scope>(SCOPE_KEY, targets) ?? 'admin';
    if (identity.scopes.includes('admin') || identity.scopes.includes(needed))
      return true;
    throw new ForbiddenException(`API key lacks the "${needed}" scope`);
  }

  private fromEnv(key: string): ApiKeyIdentity | undefined {
    // compare fixed-length digests so timingSafeEqual never throws on length mismatch
    const i = this.envKeys.findIndex((k) => timingSafeEqual(k, digest(key)));
    return i < 0
      ? undefined
      : { id: `env-${i}`, name: `env-${i}`, scopes: ['admin'] };
  }

  private async fromDb(key: string): Promise<ApiKeyIdentity | undefined> {
    if (!this.db || !key.startsWith(DB_KEY_PREFIX)) return undefined;
    // Keys are 192-bit random, so an indexed lookup by sha256 is safe (no slow hash needed).
    const row = await this.db
      .getRepository(ApiKeyEntity)
      .findOneBy({ hash: hashKey(key), revokedAt: IsNull() });
    return row ? { id: row.id, name: row.name, scopes: row.scopes } : undefined;
  }
}
