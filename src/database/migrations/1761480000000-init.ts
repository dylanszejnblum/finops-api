import { MigrationInterface, QueryRunner, Table } from 'typeorm';

// Written with the Table API (not raw SQL) so it runs on postgres, mysql and mariadb alike.
export class Init1761480000000 implements MigrationInterface {
  name = 'Init1761480000000';

  async up(q: QueryRunner) {
    const ts =
      q.connection.driver.options.type === 'postgres'
        ? 'timestamptz'
        : 'datetime';
    const str = (name: string, length: number, nullable = false) => ({
      name,
      type: 'varchar',
      length: String(length),
      isNullable: nullable,
    });

    await q.createTable(
      new Table({
        name: 'api_keys',
        columns: [
          { ...str('id', 36), isPrimary: true },
          str('name', 64),
          { ...str('hash', 64), isUnique: true },
          { name: 'scopes', type: 'text' },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'revokedAt', type: ts, isNullable: true },
        ],
      }),
    );

    await q.createTable(
      new Table({
        name: 'expenses',
        columns: [
          { ...str('id', 100), isPrimary: true },
          str('bank', 32),
          str('externalId', 64),
          str('accountId', 64),
          { name: 'amount', type: 'decimal', precision: 18, scale: 2 },
          str('currency', 3),
          str('counterparty', 255),
          str('description', 1024, true),
          str('category', 128, true),
          str('cardId', 64, true),
          str('status', 16),
          str('kind', 64),
          { name: 'createdAt', type: ts },
          { name: 'postedAt', type: ts, isNullable: true },
          { name: 'syncedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [
          { name: 'IDX_expenses_createdAt', columnNames: ['createdAt'] },
        ],
      }),
    );
  }

  async down(q: QueryRunner) {
    await q.dropTable('expenses');
    await q.dropTable('api_keys');
  }
}
