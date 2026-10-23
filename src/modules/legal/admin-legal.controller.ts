import { Body, Controller, Get, Put, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { AdminRoles } from '../admin/auth/admin-roles.decorator';
import type { AdminRequest } from '../admin/auth/admin-session.guard';
import { LegalService } from './legal.service';

class UpdatePrivacyDto {
  @ApiProperty({
    description: '일반 텍스트. ## 제목과 빈 줄로 단락을 구분합니다.',
    maxLength: 30000,
  })
  @IsString()
  @MaxLength(30000)
  content!: string;

  @ApiProperty({
    description: '조회 응답의 version. 최초 저장 전에는 0입니다.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;
}

class PrivacyDocumentDto {
  @ApiProperty({ description: '공개 페이지에 표시되는 일반 텍스트' })
  content!: string;

  @ApiProperty({
    description: '문서 버전. 최초 수정 전에는 0입니다.',
    minimum: 0,
  })
  version!: number;

  @ApiProperty({
    description: '마지막 저장 시각. 최초 수정 전에는 null입니다.',
    nullable: true,
    type: String,
  })
  updatedAt!: string | null;
}

@ApiTags('관리자 법적 문서')
@ApiBearerAuth()
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('privacy')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '개인정보처리방침 편집본 조회',
    description:
      '관리자 전용. 아직 편집되지 않았다면 기본 본문과 version 0을 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'content, version, updatedAt 반환',
    type: PrivacyDocumentDto,
  })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  get(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.legal.privacy();
  }

  @Put('privacy')
  @AdminRoles('owner')
  @ApiOperation({
    summary: '개인정보처리방침 수정',
    description:
      'owner 전용. expectedVersion으로 동시 수정을 방지하며 변경을 감사 기록에 남깁니다. HTML은 그대로 출력되지 않습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '저장된 content, version, updatedAt 반환',
    type: PrivacyDocumentDto,
  })
  @ApiResponse({ status: 400, description: '본문 또는 버전 형식 오류' })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 403, description: 'owner 권한 또는 허용된 출처 없음' })
  @ApiResponse({ status: 409, description: '다른 관리자가 먼저 변경함' })
  update(
    @Body() body: UpdatePrivacyDto,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.legal.updatePrivacy(
      request.admin!.id,
      body.content,
      body.expectedVersion,
    );
  }
}
