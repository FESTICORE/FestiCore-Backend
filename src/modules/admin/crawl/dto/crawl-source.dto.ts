import {
  Equals,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsUrl,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CrawlKind, CrawlParser } from '../entity/crawl-source.entity';

const KINDS: CrawlKind[] = [
  'timetable',
  'notice',
  'directions',
  'days',
  'discovery',
];
const PARSERS: CrawlParser[] = [
  'html-table',
  'html-text',
  'regex-days',
  'ticket-list',
];

export class CreateCrawlSourceDto {
  @ApiPropertyOptional({
    description: '대상 축제 ID. discovery 소스는 생략할 수 있습니다.',
    example: 'fst_demo2026',
  })
  @IsOptional()
  @Matches(/^fst_[a-z0-9]+$/)
  festivalId?: string;
  @ApiProperty({ enum: KINDS, description: '수집 결과의 종류' })
  @IsEnum(KINDS)
  kind!: CrawlKind;
  @ApiProperty({
    description: '수집할 HTTPS 원본 주소. robots.txt가 허용해야 합니다.',
    example: 'https://festival.example.com/timetable',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;
  @ApiProperty({
    enum: PARSERS,
    description: '소스 형식에 맞는 파서. image-ocr은 OCR 연동 후 제공됩니다.',
  })
  @IsEnum(PARSERS)
  parser!: CrawlParser;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { sourceName: '축제 공식 사이트' },
    description: '파서별 설정. 적용 가능한 키는 파서 구현에 따릅니다.',
  })
  @IsObject()
  parserConfig!: Record<string, string>;
}

export class UpdateCrawlSourceDto {
  @ApiPropertyOptional({
    description: 'false이면 예약 수집에서 제외합니다.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: '파서별 설정을 교체합니다.',
  })
  @IsOptional()
  @IsObject()
  parserConfig?: Record<string, string>;
  @ApiPropertyOptional({
    enum: [1440],
    description: '고정값 1440. 서버가 매일 00:00 KST 이후 실행합니다.',
    example: 1440,
  })
  @IsOptional()
  @Equals(1440, { message: '모든 크롤 소스는 매일 00:00(KST)에 실행됩니다.' })
  intervalMinutes?: number;
  @ApiPropertyOptional({
    description: '변경할 HTTPS 원본 주소. robots.txt를 다시 확인합니다.',
    example: 'https://festival.example.com/schedule',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url?: string;
}
