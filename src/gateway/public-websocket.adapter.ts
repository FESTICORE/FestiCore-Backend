import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { IncomingMessage } from 'node:http';
import type { WebSocketServer } from 'ws';
import { PublicFestivalUpdatesGateway } from '../modules/public/public-festival-updates.gateway';

/** Reject invalid public WebSocket upgrades before the HTTP 101 response. */
export class PublicWebSocketAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly updates: PublicFestivalUpdatesGateway,
  ) {
    super(app);
  }

  override create(
    port: number,
    options?: Parameters<WsAdapter['create']>[1],
  ): WebSocketServer {
    if (options?.path !== '/api/v1/festivals/updates') {
      return super.create(port, options) as WebSocketServer;
    }
    return super.create(port, {
      ...options,
      verifyClient: (
        info: { req: IncomingMessage },
        done: (result: boolean, code?: number) => void,
      ) => {
        const rejection = this.updates.upgradeDecision(info.req);
        done(rejection === null, rejection ?? undefined);
      },
    }) as WebSocketServer;
  }
}
