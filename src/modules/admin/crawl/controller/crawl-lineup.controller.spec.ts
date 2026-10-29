import { BadRequestException } from '@nestjs/common';
import { ADMIN_ROLES_KEY } from '../../auth/admin-roles.decorator';
import { CrawlLineupController } from './crawl-lineup.controller';

describe('CrawlLineupController input boundary', () => {
  const service = { list: jest.fn(), stage: jest.fn(), review: jest.fn() };
  const controller = new CrawlLineupController(service as never);
  const request = { admin: { id: 'admin-id' } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('requires viewer for private evidence and editor for decisions', () => {
    const roles = (method: string): unknown =>
      Reflect.getMetadata(
        ADMIN_ROLES_KEY,
        Reflect.get(CrawlLineupController.prototype, method) as object,
      ) as unknown;
    expect(roles('list')).toEqual(['viewer']);
    for (const action of ['stage', 'approve', 'reject'])
      expect(roles(action)).toEqual(['editor']);
  });

  it('rejects caller-supplied image, stage or performance time at approval', () => {
    expect(() =>
      controller.approve(
        '00000000-0000-4000-8000-000000000001',
        {
          imageHash: 'a'.repeat(64),
          artists: [],
          imageUrl: 'https://fake.test/photo.jpg',
        },
        request,
      ),
    ).toThrow(BadRequestException);
    expect(service.review).not.toHaveBeenCalled();
  });

  it('passes only immutable evidence identifiers to staging', () => {
    void controller.stage({
      runId: '00000000-0000-4000-8000-000000000002',
      imageUrl:
        'https://ticketimage.interpark.com/Play/image/etc/26/26014246-02.jpg',
      imageHash: 'a'.repeat(64),
    });
    expect(service.stage).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      'https://ticketimage.interpark.com/Play/image/etc/26/26014246-02.jpg',
      'a'.repeat(64),
    );
  });
});
