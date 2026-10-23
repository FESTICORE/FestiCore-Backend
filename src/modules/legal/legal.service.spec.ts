import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { renderPrivacyContent } from './legal.controller';
import { LegalService } from './legal.service';

describe('개인정보처리방침 편집', () => {
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn((work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new LegalService(
    dataSource as unknown as DataSource,
    audit as unknown as AdminAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('저장 전에는 현재 공개된 기본 본문을 편집본으로 반환한다', async () => {
    dataSource.query.mockResolvedValue([]);
    const document = await service.privacy();
    expect(document.version).toBe(0);
    expect(document.content).toContain('개인정보 문의');
  });

  it('버전이 일치할 때만 저장하고 같은 트랜잭션에 감사 기록을 남긴다', async () => {
    manager.query
      .mockResolvedValueOnce([{ content: '이전', version: 2 }])
      .mockResolvedValueOnce([
        {
          content: '새 문서',
          version: 3,
          updatedAt: new Date('2026-10-23T00:00:00Z'),
        },
      ]);
    await expect(
      service.updatePrivacy('admin-id', '새 문서', 2),
    ).resolves.toMatchObject({ content: '새 문서', version: 3 });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE "kind" = $3'),
      ['새 문서', 'admin-id', 'privacy'],
    );
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'legal.privacy.update',
        actor: 'admin-id',
      }),
    );
  });

  it('첫 저장은 version 0에서 생성하고 동시 생성 충돌을 거부한다', async () => {
    manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        content: '첫 문서',
        version: 1,
        updatedAt: new Date('2026-10-23T00:00:00Z'),
      },
    ]);
    await expect(
      service.updatePrivacy('admin-id', '첫 문서', 0),
    ).resolves.toMatchObject({ version: 1 });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT ("kind") DO NOTHING'),
      ['privacy', '첫 문서', 'admin-id'],
    );

    jest.clearAllMocks();
    manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      service.updatePrivacy('admin-id', '다른 첫 문서', 0),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('오래된 편집본과 빈 본문을 거부한다', async () => {
    manager.query.mockResolvedValueOnce([{ content: '새 문서', version: 3 }]);
    await expect(
      service.updatePrivacy('admin-id', '수정', 2),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updatePrivacy('admin-id', '   ', 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('관리자 본문을 HTML로 실행하지 않고 텍스트로 표시한다', () => {
    const html = renderPrivacyContent(
      '## 안내\n본문\n\n<script>alert(1)</script>',
    );
    expect(html).toContain('<h2>안내</h2>');
    expect(html).toContain('<p>본문</p>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
