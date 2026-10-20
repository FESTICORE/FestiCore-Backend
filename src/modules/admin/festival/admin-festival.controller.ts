import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminFestivalService } from './admin-festival.service';

type AdminRequest = Request & { admin?: { id: string } };

@ApiTags('Admin Festivals')
@Controller('admin/festivals')
export class AdminFestivalController {
  constructor(private readonly service: AdminFestivalService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @AdminRoles('editor')
  @Post()
  create(
    @Body() body: { name: string; venue: string; days: unknown[] },
    @Req() request: AdminRequest,
  ) {
    return this.service.create(body, request.admin?.id ?? null);
  }

  @Get(':id/draft')
  draft(@Param('id') id: string) {
    return this.service.getDraft(id);
  }

  @AdminRoles('editor')
  @Patch(':id/draft')
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.patch(id, body, ifMatch, request.admin?.id ?? null);
  }

  @AdminRoles('editor')
  @Put(':id/draft/sets')
  sets(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.replaceArray(
      id,
      'sets',
      body,
      ifMatch,
      request.admin?.id ?? null,
    );
  }

  @AdminRoles('editor')
  @Put(':id/draft/zones')
  zones(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AdminRequest,
  ) {
    return this.service.replaceArray(
      id,
      'zones',
      body,
      ifMatch,
      request.admin?.id ?? null,
    );
  }

  @Get(':id/draft/diff')
  diff(@Param('id') id: string) {
    return this.service.diff(id);
  }

  @AdminRoles('editor')
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Req() request: AdminRequest,
  ) {
    return this.service.publish(
      id,
      body?.note ?? '',
      request.admin?.id ?? null,
    );
  }

  @Get(':id/versions')
  versions(@Param('id') id: string) {
    return this.service.versionsList(id);
  }

  @AdminRoles('owner')
  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @Param('id') id: string,
    @Body() body: { toVersion: number },
    @Req() request: AdminRequest,
  ) {
    return this.service.rollback(
      id,
      body?.toVersion,
      request.admin?.id ?? null,
    );
  }
}
