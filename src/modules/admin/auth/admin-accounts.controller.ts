import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import type { Response } from 'express';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminRoles } from './admin-roles.decorator';
import type { AdminRole } from './admin-roles.decorator';
import type { AdminRequest } from './admin-session.guard';

class InviteAdminDto {
  @ApiProperty({
    example: 'editor@festicore.com',
    format: 'email',
    required: true,
  })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['viewer', 'editor', 'owner'], example: 'editor' })
  @IsIn(['viewer', 'editor', 'owner'])
  role!: AdminRole;
}

@ApiTags('관리자 계정')
@ApiBearerAuth()
@AdminRoles('owner')
@Controller('admin/admins')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @ApiOperation({
    summary: '관리자 계정 목록',
    description:
      'owner 전용. 비활성 계정을 포함하며 이메일, 역할, 활성 상태만 반환합니다.',
  })
  @ApiResponse({ status: 200, description: '관리자 계정 목록' })
  @ApiResponse({ status: 401, description: '유효한 access 토큰 없음' })
  @ApiResponse({ status: 403, description: 'owner 권한 또는 요청 출처 불일치' })
  list(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.accounts.list();
  }

  @Post('invite')
  @ApiOperation({
    summary: '관리자 초대',
    description:
      'owner 전용. 확인된 Google 로그인 시 연결할 이메일 권한을 등록합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '관리자 권한 등록',
  })
  @ApiResponse({ status: 400, description: '이메일 또는 역할 오류' })
  @ApiResponse({ status: 409, description: '이미 활성화된 관리자' })
  @ApiResponse({ status: 401, description: '유효한 access 토큰 없음' })
  @ApiResponse({ status: 403, description: 'owner 권한 또는 요청 출처 불일치' })
  invite(
    @Body() body: InviteAdminDto,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.accounts.invite(request.admin!.id, body.email, body.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '관리자 계정 비활성화',
    description:
      'owner 전용. 계정을 비활성화합니다. 자신과 마지막 활성 owner는 삭제할 수 없습니다.',
  })
  @ApiResponse({ status: 204, description: '비활성화 완료' })
  @ApiResponse({ status: 400, description: '관리자 ID 형식 오류' })
  @ApiResponse({ status: 403, description: '권한 부족 또는 자기 계정 삭제' })
  @ApiResponse({ status: 404, description: '활성 관리자 계정 없음' })
  @ApiResponse({ status: 409, description: '마지막 owner 삭제 불가' })
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    await this.accounts.disable(request.admin!.id, id);
  }
}
