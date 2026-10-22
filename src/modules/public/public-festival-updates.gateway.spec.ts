import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import type { Repository } from 'typeorm';
import type { IncomingMessage, Server } from 'node:http';
import WebSocket from 'ws';
import { AdminFestival } from '../admin/festival/festival.entity';
import { PublicWebSocketAdapter } from '../../gateway/public-websocket.adapter';
import { PublicFestivalUpdatesGateway } from './public-festival-updates.gateway';

class Client extends EventEmitter {
  readyState = 1;
  send = jest.fn();
  close = jest.fn();
  ping = jest.fn();
  terminate = jest.fn();
}

describe('PublicFestivalUpdatesGateway', () => {
  const find = jest.fn();
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

  beforeEach(() => {
    find.mockReset();
    find.mockResolvedValue([]);
    config.get.mockReset();
    config.get.mockImplementation((key: string) =>
      key === 'NODE_ENV'
        ? 'production'
        : key === 'CORS_ORIGINS'
          ? 'https://admin.example.com'
          : undefined,
    );
    gateway = new PublicFestivalUpdatesGateway(
      { find } as unknown as Repository<AdminFestival>,
      config as unknown as ConfigService,
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

  it('does not broadcast the same version twice or accept client commands', async () => {
    await gateway.onModuleInit();
    const client = new Client();
    gateway.handleConnection(
      client as unknown as WebSocket,
      request('https://admin.example.com'),
    );
    client.emit('message', Buffer.from('{}'));
    expect(client.close).toHaveBeenCalledWith(1008, 'Read-only connection');
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

  it('accepts a real WebSocket upgrade on the documented path', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PublicFestivalUpdatesGateway,
        {
          provide: getRepositoryToken(AdminFestival),
          useValue: { find },
        },
        { provide: ConfigService, useValue: config },
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
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      expect(socket.readyState).toBe(WebSocket.OPEN);
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
      socket.close();
      await app.close();
    }
  });
});
