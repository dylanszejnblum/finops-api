import { driverFor } from './database.module';

it('maps DATABASE_URL schemes to TypeORM drivers', () => {
  expect(driverFor('postgresql://u:p@h:5432/db')).toBe('postgres');
  expect(driverFor('mysql://u:p@h/db')).toBe('mysql');
  expect(() => driverFor('sqlserver://h/db')).toThrow('Unsupported');
});
