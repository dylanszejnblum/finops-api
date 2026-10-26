import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { ApiKeyGuard, hashKey } from './api-key.guard';
import { Scope } from './scopes';

const DB_KEY = 'fo_scoped';

const guard = (
  opts: { keys?: string; isPublic?: boolean; scope?: Scope; db?: boolean } = {},
) => {
  const findOneBy = jest.fn(({ hash }: { hash: string }) =>
    Promise.resolve(
      hash === hashKey(DB_KEY)
        ? { id: 'k1', name: 'dashboard', scopes: ['balances'] }
        : null,
    ),
  );
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === 'isPublic' ? opts.isPublic : opts.scope,
  } as unknown as Reflector;
  const db = opts.db
    ? ({ getRepository: () => ({ findOneBy }) } as unknown as DataSource)
    : undefined;
  const g = new ApiKeyGuard(
    reflector,
    { getOrThrow: () => opts.keys ?? 'k1,k2' } as unknown as ConfigService,
    db,
  );
  return { g, findOneBy };
};

const ctx = (key?: string) => {
  const req: Record<string, unknown> = { header: () => key };
  return {
    req,
    ctx: {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
};

describe('ApiKeyGuard', () => {
  it('accepts env keys (trimmed) as admin and records the identity on the request', async () => {
    const { g } = guard({ keys: ' k1 , k2 ,', scope: 'reports' });
    for (const key of ['k1', 'k2']) {
      const { req, ctx: c } = ctx(key);
      await expect(g.canActivate(c)).resolves.toBe(true);
      expect(req.apiKey).toMatchObject({ scopes: ['admin'] });
    }
  });

  it.each([undefined, '', 'k3', 'k1 ', 'k'])('rejects key %p', async (key) => {
    await expect(guard().g.canActivate(ctx(key).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('never accepts the empty string even with a trailing comma in API_KEYS', async () => {
    await expect(
      guard({ keys: 'k1,' }).g.canActivate(ctx('').ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('lets @Public() routes through without a key', async () => {
    await expect(
      guard({ isPublic: true }).g.canActivate(ctx().ctx),
    ).resolves.toBe(true);
  });

  it('accepts a DB key within its scope and forbids it elsewhere', async () => {
    await expect(
      guard({ db: true, scope: 'balances' }).g.canActivate(ctx(DB_KEY).ctx),
    ).resolves.toBe(true);
    await expect(
      guard({ db: true, scope: 'reports' }).g.canActivate(ctx(DB_KEY).ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires admin on routes with no declared scope (default deny)', async () => {
    await expect(
      guard({ db: true }).g.canActivate(ctx(DB_KEY).ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('only hits the DB for keys with the fo_ prefix', async () => {
    const { g, findOneBy } = guard({ db: true, scope: 'balances' });
    await expect(g.canActivate(ctx('random').ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findOneBy).not.toHaveBeenCalled();
    await expect(g.canActivate(ctx('fo_unknown').ctx)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  it('ignores DB-style keys when no DB is configured', async () => {
    await expect(
      guard({ scope: 'balances' }).g.canActivate(ctx(DB_KEY).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });
});
