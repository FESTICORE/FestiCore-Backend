import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
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
  const service = new CrawlAlertService(
    repository as unknown as Repository<CrawlAlert>,
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
    execute
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });
    const alert = { id: 'alert', acknowledgedBy: 'admin' };
    repository.findOneByOrFail.mockResolvedValue(alert);
    repository.findOneBy.mockResolvedValue(alert);
    expect(await service.acknowledge('alert', 'admin')).toBe(alert);
    expect(await service.acknowledge('alert', 'other')).toBe(alert);
    expect(where).toHaveBeenCalledWith(
      'id = :id AND "acknowledgedAt" IS NULL',
      { id: 'alert' },
    );
  });

  it('returns 404 for an unknown alert', async () => {
    execute.mockResolvedValue({ affected: 0 });
    repository.findOneBy.mockResolvedValue(null);
    await expect(service.acknowledge('missing', 'admin')).rejects.toThrow(
      NotFoundException,
    );
  });
});
