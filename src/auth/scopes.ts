import { SetMetadata } from '@nestjs/common';

// `admin` implies every scope. Env API_KEYS are admin; DB keys get explicit scopes.
export const SCOPES = ['balances', 'expenses', 'reports', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_KEY = 'requiredScope';
export const RequireScope = (scope: Scope) => SetMetadata(SCOPE_KEY, scope);

export interface ApiKeyIdentity {
  id: string;
  name: string;
  scopes: Scope[];
}
