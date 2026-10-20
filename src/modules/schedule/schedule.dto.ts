import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaceScheduleDto {
  @ApiProperty({
    description: '공개된 축제 팩의 공연 ID 목록. 빈 배열이면 일정을 비웁니다.',
    example: ['set_a1b2c3d4'],
    maxItems: 60,
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique()
  @Matches(/^set_[0-9a-z]+$/, { each: true })
  setIds!: string[];

  @ApiProperty({
    description:
      '클라이언트에서 변경한 시각. 오프라인 재전송 순서 판정에 사용합니다.',
    example: '2026-10-21T12:00:00+09:00',
    format: 'date-time',
  })
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  clientAt!: string;
}
