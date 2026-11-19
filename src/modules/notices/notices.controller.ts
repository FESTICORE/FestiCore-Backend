import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorator/public.decorator';
import { NoticesService } from './notices.service';

@ApiTags('Notices')
@Public()
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '게시된 공지사항 목록',
    description:
      '최신 게시 공지 최대 100건을 반환합니다. 페이지네이션은 제공하지 않습니다.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        code: 'SUCCESS',
        data: {
          items: [
            {
              id: '2c75c8de-517d-4611-9c51-b4ff804dd597',
              title: '서비스 안내',
              publishedAt: '2026-11-04T00:00:00.000Z',
            },
          ],
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  list() {
    return this.notices.publicList();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '게시된 공지사항 상세' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        code: 'SUCCESS',
        data: {
          id: '2c75c8de-517d-4611-9c51-b4ff804dd597',
          title: '서비스 안내',
          content: '공지 본문',
          publishedAt: '2026-11-04T00:00:00.000Z',
        },
        message: '성공적으로 처리되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 404, description: '없는·미게시 공지 또는 잘못된 ID' })
  detail(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
  ) {
    return this.notices.publicDetail(id);
  }
}
