import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CrawlAlert } from '../entity/crawl-alert.entity';
import { CrawlAlertService } from './crawl-alert.service';

describe('CrawlAlertService', () => {
  const execute = jest.fn();
  const getMany = jest.fn();
  const where = jest.fn();
  const orderBy = jest.fn();
  const take = jest.fn();
  const set = jest.fn();
  const insert = jest.fn();
  const update = jest.fn();
  const values = jest.fn();
  const orIgnore = jest.fn();
  const query = {
    insert,
    update,
    values,
    orIgnore,
    where,
    set,
    orderBy,
    take,
    execute,
    getMany,
  };
  const repository = {
    createQueryBuilder: jest.fn(() => query),
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const alertRepo = {
    findOne: jest.fn(),
    save: jest.fn((value: CrawlAlert) => Promise.resolve(value)),
  };
  const manager = { getRepository: jest.fn(() => alertRepo) };
  const dataSource = {
    transaction: jest.fn(
      (callback: (transactionManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CrawlAlertService(
    repository as unknown as Repository<CrawlAlert>,
    dataSource as unknown as DataSource,
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of [
      insert,
      update,
      values,
      orIgnore,
      where,
      set,
      orderBy,
      take,
    ]) {
      method.mockReturnValue(query);
    }
  });

  it('records a failure once per run with a bounded reason', async () => {
    await service.recordThresholdFailure('source', 'run', 'x'.repeat(1200));
    expect(values).toHaveBeenCalledWith({
      sourceId: 'source',
      runId: 'run',
      reason: 'x'.repeat(1000),
    });
    expect(orIgnore).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('filters unresolved alerts and caps the page size', async () => {
    getMany.mockResolvedValue([{ id: 'alert' }]);
    expect(await service.list('open', '200')).toEqual({
      items: [{ id: 'alert' }],
    });
    expect(where).toHaveBeenCalledWith('alert.acknowledgedAt IS NULL');
    expect(take).toHaveBeenCalledWith(50);
  });

  it('rejects an unknown status filter', async () => {
    await expect(service.list('unknown')).rejects.toThrow(BadRequestException);
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('acknowledges once and preserves the original acknowledgement', async () => {
    const alert = {
      id: 'alert',
      acknowledgedAt: null as Date | null,
      acknowledgedBy: null as string | null,
    } as CrawlAlert;
    alertRepo.findOne.mockResolvedValue(alert);
    expect(await service.acknowledge('alert', 'admin')).toBe(alert);
    expect(await service.acknowledge('alert', 'other')).toBe(alert);
    expect(alert.acknowledgedBy).toBe('admin');
    expect(alert.acknowledgedAt).toBeInstanceOf(Date);
    expect(alertRepo.save).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin',
      action: 'crawl.alert.acknowledged',
      target: 'crawl-alert:alert',
      before: { acknowledgedAt: null, acknowledgedBy: null },
      after: {
        acknowledgedAt: alert.acknowledgedAt,
        acknowledgedBy: 'admin',
      },
    });
  });

  it('returns 404 for an unknown alert', async () => {
    alertRepo.findOne.mockResolvedValue(null);
    await expect(service.acknowledge('missing', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects acknowledgement when the audit record fails', async () => {
    const alert = {
      id: 'alert',
      acknowledgedAt: null,
      acknowledgedBy: null,
    } as CrawlAlert;
    alertRepo.findOne.mockResolvedValue(alert);
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.acknowledge('alert', 'admin')).rejects.toThrow(
      'audit unavailable',
    );
    expect(alertRepo.save).toHaveBeenCalledTimes(1);
  });
});
