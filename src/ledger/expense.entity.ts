import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

const money = {
  to: (v: number) => v,
  from: (v: string | null) => (v == null ? v : Number(v)),
};

// Only expenses are stored: Mercury access is limited to balances + expenses by design.
@Entity('expenses')
export class ExpenseEntity {
  /** `${bank}:${externalId}` — natural key, makes re-syncs idempotent upserts. */
  @PrimaryColumn({ length: 100 }) id: string;
  @Column({ length: 32 }) bank: string;
  @Column({ length: 64 }) externalId: string;
  @Column({ length: 64 }) accountId: string;
  @Column('decimal', { precision: 18, scale: 2, transformer: money })
  amount: number;
  @Column({ length: 3 }) currency: string;
  @Column({ length: 255 }) counterparty: string;
  @Column({ length: 1024, nullable: true, type: 'varchar' }) description:
    string | null;
  @Column({ length: 128, nullable: true, type: 'varchar' }) category:
    string | null;
  @Column({ length: 64, nullable: true, type: 'varchar' }) cardId:
    string | null;
  @Column({ length: 16 }) status: string;
  @Column({ length: 64 }) kind: string;
  /** When the bank created the transaction. */
  @Index() @Column() createdAt: Date;
  @Column({ nullable: true, type: Date }) postedAt: Date | null;
  @UpdateDateColumn() syncedAt: Date;
}
