import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminRoles } from '../../auth/admin-roles.decorator';
import type { AdminRequest } from '../../auth/admin-session.guard';
import { ProposalService } from '../service/proposal.service';

@ApiTags('Admin Proposals')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '유효한 access JWT가 없습니다.' })
@ApiResponse({
  status: 403,
  description: '권한이 부족하거나 관리자 요청 출처가 허용되지 않았습니다.',
})
@Controller('admin/proposals')
export class ProposalController {
  constructor(private readonly proposals: ProposalService) {}

  @Get()
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 변경 제안 목록',
    description: 'viewer 이상. 기본 상태는 open이며 최신순입니다.',
  })
  @ApiQuery({ name: 'festivalId', required: false, example: 'fst_demo2026' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'partial', 'applied', 'rejected'],
  })
  @ApiResponse({ status: 200, description: '제안을 items 배열로 반환합니다.' })
  list(
    @Query('festivalId') festivalId?: string,
    @Query('status') status?: string,
  ) {
    return this.proposals.list(festivalId, status);
  }

  @Get(':id')
  @AdminRoles('viewer')
  @ApiOperation({
    summary: '크롤 제안 상세',
    description:
      'viewer 이상. 원본 증거, 제안 항목의 전후 값, 현재 초안 값을 함께 확인합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '제안 ID' })
  @ApiResponse({ status: 200, description: '제안 상세와 currentDraftValues' })
  @ApiResponse({ status: 404, description: '제안을 찾을 수 없습니다.' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.get(id);
  }

  @Post(':id/decide')
  @AdminRoles('editor')
  @ApiOperation({
    summary: '크롤 제안 항목 수락 또는 거절',
    description:
      'editor 이상. 기존 축제 변경은 초안에 적용합니다. festival.new 수락 시 검토한 name, venue, days로 비공개 축제 초안을 생성합니다. URL은 발견 원본을 유지합니다. 검증·동시 수정 충돌 항목은 pending으로 유지하며 발행은 별도 관리자 API가 필요합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '제안 ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['decisions'],
      properties: {
        decisions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['itemId', 'decision'],
            properties: {
              itemId: { type: 'string', example: '0' },
              decision: { type: 'string', enum: ['accepted', 'rejected'] },
              after: {
                type: 'object',
                description:
                  'festival.new 수락 시 검토한 값. 발견 URL은 수정할 수 없습니다.',
                properties: {
                  name: { type: 'string', example: '샘플 뮤직 페스티벌' },
                  venue: { type: 'string', example: '서울 올림픽공원' },
                  days: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        date: { type: 'string', example: '2026-10-25' },
                        startsAt: {
                          type: 'string',
                          example: '2026-10-25T10:00:00+09:00',
                        },
                        endsAt: {
                          type: 'string',
                          example: '2026-10-25T22:00:00+09:00',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    examples: {
      review: {
        summary: '기존 축제 항목별 검토',
        value: {
          decisions: [
            { itemId: 'set_main', decision: 'accepted' },
            { itemId: 'set_old', decision: 'rejected' },
          ],
        },
      },
      discovery: {
        summary: '발견한 축제의 초안 생성',
        value: {
          decisions: [
            {
              itemId: '0',
              decision: 'accepted',
              after: {
                name: '샘플 뮤직 페스티벌',
                venue: '서울 올림픽공원',
                days: [
                  {
                    date: '2026-10-25',
                    startsAt: '2026-10-25T10:00:00+09:00',
                    endsAt: '2026-10-25T22:00:00+09:00',
                  },
                ],
              },
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '제안 상태, 충돌 항목, 변경된 초안 버전을 반환합니다.',
  })
  @ApiResponse({
    status: 400,
    description: '중복·잘못된 항목 또는 이미 결정된 제안입니다.',
  })
  @ApiResponse({ status: 404, description: '제안을 찾을 수 없습니다.' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      decisions: {
        itemId: string;
        decision: 'accepted' | 'rejected';
        after?: {
          name?: string;
          venue?: string;
          days?: { date: string; startsAt: string; endsAt: string }[];
        };
      }[];
    },
    @Req() request: AdminRequest,
  ) {
    return this.proposals.decide(
      id,
      body?.decisions,
      request.admin?.id ?? null,
    );
  }

  @Post(':id/dismiss')
  @AdminRoles('editor')
  @ApiOperation({
    summary: '남은 크롤 제안 거절',
    description:
      'editor 이상. pending 항목을 모두 거절하고 사유를 증거에 보관합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: '제안 ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          example: '공식 사이트의 일정과 다릅니다.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: '거절 처리된 제안' })
  @ApiResponse({
    status: 400,
    description: '사유가 없거나 제안이 이미 결정되었습니다.',
  })
  @ApiResponse({ status: 404, description: '제안을 찾을 수 없습니다.' })
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @Req() request: AdminRequest,
  ) {
    return this.proposals.dismiss(id, body?.reason, request.admin?.id ?? null);
  }
}
