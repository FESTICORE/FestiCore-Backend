import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../auth/entity/user.entity';
import { Device } from './device.entity';

export type DevicePrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'device'; deviceId: string; tokenId: string }
  | { kind: 'anonymous' };

export type DeviceRequest = Request & { devicePrincipal: DevicePrincipal };
export const ALLOW_ANONYMOUS_DEVICE_REGISTRATION =
  'allowAnonymousDeviceRegistration';

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const header = request.headers.authorization;
    const anonymousRegistration = this.reflector.get<boolean>(
      ALLOW_ANONYMOUS_DEVICE_REGISTRATION,
      context.getHandler(),
    );
    if (!header && anonymousRegistration && request.method === 'PUT') {
      request.devicePrincipal = { kind: 'anonymous' };
      return true;
    }
    request.devicePrincipal = await this.resolvePrincipal(request);
    return true;
  }

  async resolveOptionalPrincipal(
    request: Request,
  ): Promise<DevicePrincipal | undefined> {
    try {
      return await this.resolvePrincipal(request);
    } catch (error) {
      if (error instanceof UnauthorizedException) return undefined;
      throw error;
    }
  }

  private async resolvePrincipal(request: Request): Promise<DevicePrincipal> {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('인증 토큰이 없습니다.');
    let payload: {
      typ?: string;
      sub?: string;
      jti?: string;
      provider?: string;
    };
    try {
      payload = await this.jwt.verifyAsync(match[1], {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }
    if (payload.typ === 'device' && payload.sub && payload.jti) {
      const deviceId = request.header('x-device-id');
      if (deviceId !== payload.sub)
        throw new UnauthorizedException('기기 토큰과 기기 ID가 다릅니다.');
      const device = await this.devices.findOne({ where: { id: deviceId } });
      if (!device || device.deviceTokenId !== payload.jti) {
        throw new UnauthorizedException('유효하지 않은 기기 토큰입니다.');
      }
      return { kind: 'device', deviceId, tokenId: payload.jti };
    }
    if (
      payload.typ === 'access' &&
      payload.sub &&
      (payload.provider === 'google' || payload.provider === 'apple')
    ) {
      const user = await this.users.findOne({
        where: { id: payload.sub },
        select: { id: true, provider: true },
      });
      if (user?.provider === payload.provider) {
        return { kind: 'user', userId: user.id };
      }
    }
    throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
  }
}
