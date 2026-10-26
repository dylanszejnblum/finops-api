import { DataSource } from 'typeorm';
import { AppController } from './app.controller';

const db = (ok: boolean) =>
  ({
    query: () => (ok ? Promise.resolve([]) : Promise.reject(new Error('down'))),
  }) as unknown as DataSource;

describe('health', () => {
  it('reports db disabled when no DataSource is registered', async () => {
    expect(await new AppController().health()).toEqual({
      status: 'ok',
      db: 'disabled',
    });
  });

  it('reports db up', async () => {
    expect(await new AppController(db(true)).health()).toEqual({
      status: 'ok',
      db: 'up',
    });
  });

  it('reports degraded when the db query fails', async () => {
    expect(await new AppController(db(false)).health()).toEqual({
      status: 'degraded',
      db: 'down',
    });
  });
});
