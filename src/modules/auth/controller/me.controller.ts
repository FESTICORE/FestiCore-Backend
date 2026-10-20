import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../decorator/current-user.decorator';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../types/social-profile';

class UpdateMeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname!: string;
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto) {
    return this.auth.updateMe(user.userId, body.nickname);
  }

  @Delete()
  async withdraw(@CurrentUser() user: AuthUser) {
    await this.auth.withdraw(user.userId);
    return { success: true };
  }
}
