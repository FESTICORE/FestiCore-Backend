import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { brotliCompressSync } from 'zlib';
import { DataSource } from 'typeorm';
import {
  AdminFestival,
  AdminFestivalVersion,
  FestivalDocument,
} from '../admin/festival/festival.entity';
import { validateDraft } from '../admin/festival/festival-validation';
import { Flag } from './flag.entity';

type Profile = Record<string, unknown> & { id: string };

function profiles(value: unknown): Profile[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Profile =>
          item !== null &&
          typeof item === 'object' &&
          typeof (item as Profile).id === 'string',
      )
    : [];
}

function flagProfile(flag: Flag): Profile {
  return {
    id: flag.id,
    name: flag.name,
    thumbUrl: flag.thumbKey
      ? `/api/v1/flags/${encodeURIComponent(flag.id)}/thumbnail`
      : flag.thumbUrl,
    photoUrl: flag.photoKey
      ? `/api/v1/flags/${encodeURIComponent(flag.id)}/photo`
      : flag.photoUrl,
    tags: flag.tags,
    bio: flag.bio,
    followerCount: flag.followerCount,
    planVisible: flag.planVisible,
    plan: flag.planVisible ? flag.plan : [],
    homeZoneId: flag.homeZoneId,
  };
}

function replaceProfile(
  document: FestivalDocument,
  flag: Flag,
): FestivalDocument {
  const current = profiles(document.flags);
  const withoutFlag = current.filter((profile) => profile.id !== flag.id);
  const enabled = document.flagsEnabled !== false;
  if (enabled && flag.visibility === 'public' && !flag.hidden)
    withoutFlag.push(flagProfile(flag));
  return { ...document, flags: withoutFlag };
}

/** Regenerate immutable published pack versions after a flag profile changes. */
@Injectable()
export class FlagPackSyncService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async sync(flagId: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const flags = manager.getRepository(Flag);
      const flag = await flags.findOne({ where: { id: flagId } });
      if (!flag) return;
      const festivals = manager.getRepository(AdminFestival);
      const festival = await festivals.findOne({
        where: { id: flag.festivalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!festival) return;

      const draft = replaceProfile(festival.draft, flag);
      const draftErrors = validateDraft(draft);
      if (draftErrors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          errors: draftErrors,
        });
      if (
        JSON.stringify(draft.flags) !== JSON.stringify(festival.draft.flags)
      ) {
        festival.draft = draft;
        festival.draftVersion += 1;
      }

      if (festival.published) {
        const next = replaceProfile(festival.published, flag);
        if (
          JSON.stringify(next.flags) !==
          JSON.stringify(festival.published.flags)
        ) {
          const packErrors = validateDraft(next, true);
          if (packErrors.length)
            throw new BadRequestException({
              code: 'VALIDATION',
              errors: packErrors,
            });
          const packVersion = festival.publishedVersion + 1;
          const pack = {
            ...next,
            packVersion,
            packUpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          };
          const serialized = JSON.stringify(pack);
          if (brotliCompressSync(Buffer.from(serialized)).length > 200 * 1024)
            throw new BadRequestException('압축된 팩이 200KB를 초과합니다.');
          festival.published = pack;
          festival.publishedVersion = packVersion;
          await manager.getRepository(AdminFestivalVersion).save({
            festivalId: festival.id,
            packVersion,
            pack,
            publishedBy: null,
            note: `Flag ${flag.id} profile update`,
            sizeBytes: Buffer.byteLength(serialized),
          });
        }
      }
      await festivals.save(festival);
    });
  }
}
