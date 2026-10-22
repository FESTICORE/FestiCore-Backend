import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { CurrentTermsGuard } from '../guard/current-terms.guard';

/** 현재 약관 동의가 필요한 계정 쓰기 작업에만 부착한다. */
export const RequireCurrentTerms = () =>
  applyDecorators(
    UseGuards(CurrentTermsGuard),
    ApiResponse({
      status: 403,
      description: 'TERMS_REQUIRED: 현재 필수 약관 동의가 필요함',
    }),
  );
