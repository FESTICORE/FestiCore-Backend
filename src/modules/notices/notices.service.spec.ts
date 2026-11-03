import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { NoticesService } from './notices.service';

const id = '2c75c8de-517d-4611-9c51-b4ff804dd597';
const at = new Date('2026-11-04T00:00:00.000Z');
const row = {
  id,
  title: '안내',
  content: '본문',
  published: true,
  publishedAt: at,
  createdAt: at,
  updatedAt: at,
};

const calls = (mock: jest.Mock): unknown[][] => mock.mock.calls as unknown[][];

describe('NoticesService', () => {
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new NoticesService(
    dataSource as unknown as DataSource,
    audit as unknown as AdminAuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    dataSource.query.mockReset();
    manager.query.mockReset();
  });

  it('공개 목록은 게시된 최신 100건만 읽고 본문을 노출하지 않는다', async () => {
    dataSource.query.mockResolvedValue([row]);
    await expect(service.publicList()).resolves.toEqual({
      items: [{ id, title: '안내', publishedAt: at.toISOString() }],
    });
    const sql = String(calls(dataSource.query)[0][0]);
    expect(sql).toContain('WHERE "published" = true');
    expect(sql).toContain('ORDER BY "publishedAt" DESC, "id" DESC LIMIT 100');
  });

  it('비공개·없는 상세는 찾을 수 없고 공개 상세만 본문을 준다', async () => {
    dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    await expect(service.publicDetail(id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.publicDetail(id)).resolves.toMatchObject({
      id,
      title: '안내',
      content: '본문',
      publishedAt: at.toISOString(),
    });
    expect(String(calls(dataSource.query)[0][0])).toContain(
      '"published" = true',
    );
  });

  it('관리자 목록은 100건을 기본으로 페이지 조회하고 범위를 검증한다', async () => {
    dataSource.query.mockResolvedValue([row]);
    await expect(service.adminList()).resolves.toMatchObject({
      items: [{ id, published: true }],
    });
    expect(calls(dataSource.query)[0][1]).toEqual([100, 0]);
    await service.adminList('20', '100');
    expect(calls(dataSource.query)[1][1]).toEqual([20, 100]);
    await expect(service.adminList('101')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.adminList('20', '-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('작성은 정규화한 값을 저장하고 동일 트랜잭션에서 원문 없는 감사를 남긴다', async () => {
    manager.query.mockResolvedValue([
      { ...row, title: '안내', content: '본문' },
    ]);
    await expect(
      service.create('admin-id', {
        title: ' 안내 ',
        content: ' 본문 ',
        published: true,
      }),
    ).resolves.toMatchObject({ id, title: '안내', content: '본문' });
    expect(calls(manager.query)[0][1]).toEqual(['안내', '본문', true]);
    expect(calls(audit.record)[0][0]).toBe(manager);
    expect(calls(audit.record)[0][1]).toMatchObject({
      actor: 'admin-id',
      action: 'notices.create',
      target: id,
      before: null,
      after: { contentLength: 2 },
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(calls(audit.record)[0][1])).not.toContain('본문');
  });

  it('초안의 첫 게시·게시 취소·재게시에는 DB 시각을 쓰고 게시 중 수정은 유지한다', async () => {
    const draft = { ...row, published: false, publishedAt: null };
    manager.query.mockResolvedValueOnce([draft]).mockResolvedValueOnce([row]);
    await service.update('admin-id', id, { published: true });
    const updateSql = String(calls(manager.query)[1][0]);
    expect(updateSql).toContain(
      'WHEN $4 = true AND "published" = false THEN now()',
    );
    expect(calls(manager.query)[1][1]).toEqual([id, '안내', '본문', true]);

    manager.query.mockReset();
    manager.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
    await service.update('admin-id', id, { title: '새 안내' });
    expect(String(calls(manager.query)[1][0])).toContain(
      'WHEN $4 = true THEN "publishedAt"',
    );

    manager.query.mockReset();
    manager.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([draft]);
    await service.update('admin-id', id, { published: false });
    expect(calls(manager.query)[1][1]).toEqual([id, '안내', '본문', false]);
    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('없는 관리자 상세·수정과 비어 있거나 NUL이 포함된 입력을 거부한다', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(service.adminDetail(id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    manager.query.mockResolvedValue([]);
    await expect(
      service.update('admin-id', id, { title: '새 제목' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('admin-id', id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    for (const title of ['   ', 'a\0b']) {
      await expect(
        service.create('admin-id', {
          title,
          content: '본문',
          published: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      service.create('admin-id', {
        title: '안내',
        content: ' \0 ',
        published: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
