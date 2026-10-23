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
  'artist-image',
];
const PARSERS: CrawlParser[] = [
  'html-table',
  'html-text',
  'image-ocr',
  'regex-days',
  'ticket-list',
];

export class CreateCrawlSourceDto {
  @ApiPropertyOptional({
    description:
      '관리자 초안 축제 ID. discovery·artist-image·이미지 시간표 소스는 생략합니다.',
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
    description:
      '소스 형식에 맞는 파서. timetable의 image-ocr은 공식 이미지에서 검토용 후보를 만듭니다.',
  })
  @IsEnum(PARSERS)
  parser!: CrawlParser;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213793',
      artistName: '아티스트 이름',
      imageHint: 'profile-photo',
    },
    description:
      '파서별 설정. artist-image는 festivalSourceUrl·artistName·imageHint를 지정합니다. timetable/image-ocr은 festivalSourceUrl·sourcePageUrl·date·expectedRows 및 무대 영역(columns)을 JSON 문자열로 지정합니다.',
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
