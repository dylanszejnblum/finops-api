import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { Scope } from './scopes';

@Entity('api_keys')
export class ApiKeyEntity {
  @PrimaryColumn({ length: 36 }) id: string;
  @Column({ length: 64 }) name: string;
  /** sha256 hex of the key; the plaintext is shown once at creation and never stored. */
  @Column({ length: 64, unique: true }) hash: string;
  @Column('simple-array') scopes: Scope[];
  @CreateDateColumn() createdAt: Date;
  @Column({ nullable: true, type: Date }) revokedAt: Date | null;
}
