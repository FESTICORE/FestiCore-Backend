import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import type { Repository } from 'typeorm';
import type { IncomingMessage, Server } from 'node:http';
import WebSocket from 'ws';
import { AdminFestival } from '../admin/festival/festival.entity';
import { PublicWebSocketAdapter } from '../../gateway/public-websocket.adapter';
import { PublicFestivalUpdatesGateway } from './public-festival-updates.gateway';
import { PublicFestivalService } from './public-festival.service';

class Client extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send = jest.fn((_message: string, callback?: (error?: Error) => void) =>
    callback?.(),
  );
  close = jest.fn();
  ping = jest.fn();
  terminate = jest.fn();
}

describe('PublicFestivalUpdatesGateway', () => {
  const find = jest.fn();
  const findOne = jest.fn();
  const publishedPack = jest.fn();
  const config = {
    get: jest.fn((key: string): string | undefined =>
      key === 'NODE_ENV'
        ? 'production'
        : key === 'CORS_ORIGINS'
          ? 'https://admin.example.com'
          : undefined,
    ),
  };
  let gateway: PublicFestivalUpdatesGateway;
  const request = (origin?: string) =>
    ({
      headers: origin ? { origin } : {},
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage;
  const command = (requestId = 'request-1', ifNoneMatch?: string) =>
    Buffer.from(
      JSON.stringify({
        event: 'pack.get',
        requestId,
        data: {
          festivalId: 'fst_test',
          ...(ifNoneMatch ? { ifNoneMatch } : {}),
        },
      }),
    );
  const messages = (client: Client) =>
    client.send.mock.calls.map(
      ([value]) => JSON.parse(value) as Record<string, unknown>,
    );
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    find.mockReset();
    find.mockResolvedValue([]);
    findOne.mockReset();
    findOne.mockResolvedValue({
      id: 'fst_test',
      publishedVersion: 2,
      published: {},
    });
    publishedPack.mockReset();
    publishedPack.mockResolvedValue({
      document: { id: 'fst_test', packVersion: 2 },
      etag: '"etag-2"',
    });
    config.get.mockReset();
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV'
        ? 'production'
        : key === 'CORS_ORIGINS'
          ? 'https://admin.example.com'
          : undefined,
    );
    gateway = new PublicFestivalUpdatesGateway(
      { find, findOne } as unknown as Repository<AdminFestival>,
      config as unknown as ConfigService,
      { publishedPack } as unknown as PublicFestivalService,
    );
  });

  afterEach(() => gateway.onModuleDestroy());

  it('rejects an unapproved browser Origin and accepts a native client', async () => {
    await gateway.onModuleInit();
    const rejected = new Client();
    gateway.handleConnection(
      rejected as unknown as WebSocket,
      request('https://evil.example'),
    );
    expect(rejected.close).toHaveBeenCalledWith(1008);
    const accepted = new Client();
    gateway.handleConnection(accepted as unknown as WebSocket, request());
    find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 2 }]);
    await gateway.poll();
    expect(accepted.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'pack.updated',
        data: { festivalId: 'fst_test', packVersion: 2 },
      }),
      expect.any(Function),
    );
    expect(rejected.send).not.toHaveBeenCalled();
  });

  it('normalizes a mixed-case configured host for browser upgrades', () => {
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV'
        ? 'production'
        : key === 'CORS_ORIGINS'
          ? 'https://festicoreAdmin-dev.up.railway.app'
          : undefined,
    );
    expect(
      gateway.upgradeDecision(
        request('https://festicoreadmin-dev.up.railway.app'),
      ),
    ).toBeNull();
  });

  it('does not broadcast the same version twice', async () => {
    await gateway.onModuleInit();
    const client = new Client();
    gateway.handleConnection(
      client as unknown as WebSocket,
      request('https://admin.example.com'),
    );
    find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 2 }]);
    await gateway.poll();
    await gateway.poll();
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, publishedVersion: true } }),
    );
    find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 3 }]);
    await gateway.poll();
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('seeds existing versions on startup and only sends later changes', async () => {
    find.mockResolvedValueOnce([{ id: 'fst_test', publishedVersion: 7 }]);
    await gateway.onModuleInit();
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    try {
      find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 7 }]);
      await gateway.poll();
      expect(client.send).not.toHaveBeenCalled();
      find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 8 }]);
      await gateway.poll();
      expect(client.send).toHaveBeenCalledTimes(1);
    } finally {
      gateway.onModuleDestroy();
    }
  });

  it('keeps the API booting after a seed error and retries without an event storm', async () => {
    find.mockRejectedValueOnce(new Error('temporary database failure'));
    await expect(gateway.onModuleInit()).resolves.toBeUndefined();
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    try {
      find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 7 }]);
      await gateway.poll();
      expect(client.send).not.toHaveBeenCalled();
      find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 8 }]);
      await gateway.poll();
      expect(client.send).toHaveBeenCalledTimes(1);
    } finally {
      gateway.onModuleDestroy();
    }
  });

  it('removes an unresponsive socket before it consumes more connection slots', async () => {
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    gateway.heartbeat();
    expect(client.ping).toHaveBeenCalledTimes(1);
    gateway.heartbeat();
    expect(client.terminate).toHaveBeenCalledTimes(1);
    find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 3 }]);
    await gateway.poll();
    expect(find).not.toHaveBeenCalled();
  });

  it('returns a snapshot, then an ETag based not_modified response', async () => {
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command(), false);
    await flush();
    expect(messages(client)).toEqual([
      {
        event: 'pack.snapshot',
        requestId: 'request-1',
        data: {
          festivalId: 'fst_test',
          packVersion: 2,
          etag: '"etag-2"',
          pack: { id: 'fst_test', packVersion: 2 },
        },
      },
    ]);
    client.emit('message', command('request-2', '"etag-2"'), false);
    await flush();
    expect(messages(client)[1]).toEqual({
      event: 'pack.not_modified',
      requestId: 'request-2',
      data: { festivalId: 'fst_test', packVersion: 2, etag: '"etag-2"' },
    });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, publishedVersion: true, published: true },
        where: { id: 'fst_test' },
      }),
    );
  });

  it('delivers a changed image ETag even when packVersion is unchanged', async () => {
    publishedPack.mockResolvedValue({
      document: { packVersion: 2 },
      etag: '"image-changed"',
    });
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command('image', '"etag-2"'), false);
    await flush();
    expect(messages(client)[0].event).toBe('pack.snapshot');
  });

  it('rejects a stale cached pack before comparing ETag and reports missing packs', async () => {
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    findOne.mockResolvedValueOnce({
      id: 'fst_test',
      publishedVersion: 3,
      published: {},
    });
    client.emit('message', command('stale', '"etag-2"'), false);
    await flush();
    expect(messages(client)[0]).toEqual({
      event: 'pack.retry',
      requestId: 'stale',
      data: { festivalId: 'fst_test', packVersion: 3, retryAfterMs: 1000 },
    });
    findOne.mockResolvedValueOnce(null);
    client.emit('message', command('missing'), false);
    await flush();
    expect(messages(client)[1]).toEqual({
      event: 'pack.error',
      requestId: 'missing',
      data: { code: 'FESTIVAL_NOT_FOUND' },
    });
    publishedPack.mockRejectedValueOnce(new NotFoundException());
    client.emit('message', command('unpublished'), false);
    await flush();
    expect(messages(client)[2]).toEqual({
      event: 'pack.error',
      requestId: 'unpublished',
      data: { code: 'FESTIVAL_NOT_FOUND' },
    });
  });

  it('closes malformed JSON, unknown fields, binary, and oversized messages', () => {
    for (const [bytes, binary, expected] of [
      [Buffer.from('{'), false, 1008],
      [Buffer.from('{"event":"other"}'), false, 1008],
      [command(), true, 1008],
      [Buffer.alloc(1025), false, 1009],
    ] as const) {
      const client = new Client();
      gateway.handleConnection(client as unknown as WebSocket, request());
      client.emit('message', bytes, binary);
      expect(client.close).toHaveBeenCalledWith(expected);
    }
  });

  it('limits concurrent requests and ten requests per ten seconds', async () => {
    let finish!: (value: { document: object; etag: string }) => void;
    publishedPack.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command('first'), false);
    client.emit('message', command('busy'), false);
    await flush();
    expect(messages(client)[0]).toEqual({
      event: 'pack.error',
      requestId: 'busy',
      data: { code: 'PACK_BUSY', retryAfterMs: 1000 },
    });
    finish({ document: { packVersion: 2 }, etag: '"etag-2"' });
    await flush();
    for (let index = 0; index < 9; index++) {
      client.emit('message', command(`next-${index}`), false);
      await flush();
    }
    client.emit('message', command('limited'), false);
    await flush();
    expect(messages(client).at(-1)).toEqual({
      event: 'pack.error',
      requestId: 'limited',
      data: { code: 'PACK_BUSY', retryAfterMs: 1000 },
    });
  });

  it('chunks large pack bytes with verifiable digest and ordered callbacks', async () => {
    const pack = { packVersion: 2, payload: '가'.repeat(1_500_000) };
    publishedPack.mockResolvedValue({ document: pack, etag: '"large"' });
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command(), false);
    await flush();
    const sent = messages(client);
    const start = sent[0].data as Record<string, unknown>;
    const chunks = sent.slice(1, -1);
    const joined = Buffer.concat(
      chunks.map((entry, index) => {
        const data = entry.data as Record<string, unknown>;
        expect(data.index).toBe(index);
        return Buffer.from(data.base64 as string, 'base64');
      }),
    );
    expect(sent[0].event).toBe('pack.start');
    expect(sent.at(-1)?.event).toBe('pack.complete');
    expect(start.chunkCount).toBe(chunks.length);
    expect(start.totalBytes).toBe(joined.length);
    expect(start.sha256).toBe(
      createHash('sha256').update(joined).digest('hex'),
    );
    expect(JSON.parse(joined.toString('utf8'))).toEqual(pack);
  });

  it('rejects an excessive expanded pack before sending chunks', async () => {
    publishedPack.mockResolvedValue({
      document: { packVersion: 2, payload: 'x'.repeat(8 * 1024 * 1024) },
      etag: '"oversized"',
    });
    const client = new Client();
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command(), false);
    await flush();
    expect(messages(client)).toEqual([
      {
        event: 'pack.error',
        requestId: 'request-1',
        data: { code: 'PACK_TOO_LARGE' },
      },
    ]);
  });

  it('stops chunk transmission when socket closes and rejects buffered broadcasts', async () => {
    const pack = { packVersion: 2, payload: 'x'.repeat(4_300_000) };
    publishedPack.mockResolvedValue({ document: pack, etag: '"large"' });
    const client = new Client();
    client.send.mockImplementation(
      (_message: string, callback?: (error?: Error) => void) => {
        client.readyState = 3;
        callback?.();
      },
    );
    gateway.handleConnection(client as unknown as WebSocket, request());
    client.emit('message', command(), false);
    await flush();
    expect(client.send).toHaveBeenCalledTimes(1);

    const slow = new Client();
    slow.bufferedAmount = 4 * 1024 * 1024;
    gateway.handleConnection(slow as unknown as WebSocket, request());
    await gateway.onModuleInit();
    find.mockResolvedValue([{ id: 'fst_test', publishedVersion: 3 }]);
    await gateway.poll();
    expect(slow.close).toHaveBeenCalledWith(1013, 'Slow connection');
  });

  it('accepts a real WebSocket upgrade on the documented path', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PublicFestivalUpdatesGateway,
        {
          provide: getRepositoryToken(AdminFestival),
          useValue: { find, findOne },
        },
        { provide: ConfigService, useValue: config },
        { provide: PublicFestivalService, useValue: { publishedPack } },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useWebSocketAdapter(
      new PublicWebSocketAdapter(app, module.get(PublicFestivalUpdatesGateway)),
    );
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string')
      throw new Error('HTTP 주소를 확인할 수 없습니다.');
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/festivals/updates`,
    );
    let reconnected: WebSocket | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      expect(socket.readyState).toBe(WebSocket.OPEN);
      const snapshot = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('pack.snapshot response timed out')),
            2000,
          );
          socket.once('message', (raw) => {
            clearTimeout(timeout);
            try {
              if (!Buffer.isBuffer(raw))
                throw new Error('Expected a text frame');
              resolve(
                JSON.parse(raw.toString('utf8')) as Record<string, unknown>,
              );
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        },
      );
      socket.send(command().toString());
      const savedSnapshot = await snapshot;
      expect(savedSnapshot.event).toBe('pack.snapshot');
      await new Promise<void>((resolve, reject) => {
        socket.once('close', resolve);
        socket.once('error', reject);
        socket.close();
      });
      publishedPack.mockResolvedValue({
        document: { id: 'fst_test', packVersion: 3 },
        etag: '"etag-3"',
      });
      findOne.mockResolvedValue({
        id: 'fst_test',
        publishedVersion: 3,
        published: {},
      });
      reconnected = new WebSocket(
        `ws://127.0.0.1:${address.port}/api/v1/festivals/updates`,
      );
      await new Promise<void>((resolve, reject) => {
        reconnected?.once('open', resolve);
        reconnected?.once('error', reject);
      });
      const recovered = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('reconnected pack.snapshot timed out')),
            2000,
          );
          reconnected?.once('message', (raw) => {
            clearTimeout(timeout);
            try {
              if (!Buffer.isBuffer(raw))
                throw new Error('Expected a text frame');
              resolve(
                JSON.parse(raw.toString('utf8')) as Record<string, unknown>,
              );
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        },
      );
      reconnected.send(command('reconnected', '"etag-2"').toString());
      expect(await recovered).toEqual({
        event: 'pack.snapshot',
        requestId: 'reconnected',
        data: {
          festivalId: 'fst_test',
          packVersion: 3,
          etag: '"etag-3"',
          pack: { id: 'fst_test', packVersion: 3 },
        },
      });
      expect(savedSnapshot).toMatchObject({
        data: { packVersion: 2, etag: '"etag-2"' },
      });
      const rejected = new WebSocket(
        `ws://127.0.0.1:${address.port}/api/v1/festivals/updates`,
        {
          headers: { Origin: 'https://evil.example' },
        },
      );
      const status = await new Promise<number>((resolve, reject) => {
        rejected.once('unexpected-response', (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        rejected.once('error', reject);
      });
      expect(status).toBe(403);
      rejected.terminate();
    } finally {
      socket.terminate();
      reconnected?.terminate();
      await app.close();
    }
  }, 20_000);
});
