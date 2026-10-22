import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CacheService } from './cache.service';

jest.mock('ioredis', () => jest.fn());

describe('CacheService', () => {
  const Client = Redis as jest.MockedClass<typeof Redis>;

  beforeEach(() => Client.mockReset());

  it('does not connect or issue commands without REDIS_URL', async () => {
    const cache = new CacheService({ get: () => undefined } as never);
    expect(Client).not.toHaveBeenCalled();
    expect(await cache.status()).toBe('disabled');
    expect(await cache.packGeneration('fst_1')).toBeNull();
    expect(await cache.getJson('key')).toBeNull();
    await expect(cache.setJson('key', {}, 60)).resolves.toBeUndefined();
    await expect(cache.del('key')).resolves.toBeUndefined();
    await expect(cache.invalidatePack('fst_1')).resolves.toBeUndefined();
  });

  it('treats command failures as misses and reports down', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const failure = jest.fn().mockRejectedValue(new Error('offline'));
    Client.mockImplementation(
      () =>
        ({
          on: jest.fn(),
          get: failure,
          set: failure,
          del: failure,
          incr: failure,
          ping: failure,
          quit: jest.fn().mockResolvedValue('OK'),
        }) as never,
    );
    const cache = new CacheService({ get: () => 'redis://test' } as never);
    expect(Client).toHaveBeenCalledWith(
      'redis://test',
      expect.objectContaining({
        enableOfflineQueue: false,
        family: 0,
        commandTimeout: 500,
      }),
    );
    expect(await cache.packGeneration('fst_1')).toBeNull();
    expect(await cache.getJson('key')).toBeNull();
    await expect(cache.setJson('key', {}, 60)).resolves.toBeUndefined();
    await expect(cache.del('key')).resolves.toBeUndefined();
    await expect(cache.invalidatePack('fst_1')).resolves.toBeUndefined();
    expect(await cache.status()).toBe('down');
    expect(warn).toHaveBeenCalledTimes(1);
    await cache.onModuleDestroy();
    warn.mockRestore();
  });

  it('seeds a missing generation before reading any cached pack', async () => {
    const values = new Map([['pack:fst_1:g0', '{"name":"stale"}']]);
    const get = jest.fn((key: string) =>
      Promise.resolve(values.get(key) ?? null),
    );
    const set = jest.fn((key: string, value: string) => {
      if (!values.has(key)) values.set(key, value);
      return Promise.resolve('OK');
    });
    Client.mockImplementation(() => ({ on: jest.fn(), get, set }) as never);
    const cache = new CacheService({ get: () => 'redis://test' } as never);

    const generation = await cache.packGeneration('fst_1');
    expect(generation).toBeGreaterThan(0);
    expect(set).toHaveBeenCalledWith(
      'pack:fst_1:gen',
      String(generation),
      'NX',
    );
    expect(await cache.getPack('fst_1', generation!)).toBeNull();
    expect(get).not.toHaveBeenCalledWith('pack:fst_1:g0');
  });

  it('logs repeated connection errors once and reports recovery once', () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    Client.mockImplementation(
      () =>
        ({
          on: jest.fn((event: string, listener: (...args: never[]) => void) => {
            listeners.set(event, listener);
          }),
        }) as never,
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    new CacheService({ get: () => 'redis://test' } as never);

    listeners.get('error')!(new Error('offline') as never);
    listeners.get('error')!(new Error('retry') as never);
    listeners.get('ready')!();
    listeners.get('ready')!();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    log.mockRestore();
  });
});
