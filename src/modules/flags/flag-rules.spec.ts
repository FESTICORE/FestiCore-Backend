import { ConflictException } from '@nestjs/common';
import { Flag } from './flag.entity';
import { forcedStatus, nextStatus, validateProfilePatch } from './flag-rules';

const now = new Date('2026-11-20T09:00:00.000Z');
const flag = (status: Flag['status']): Flag =>
  Object.assign(new Flag(), {
    id: 'flg_test',
    status,
    zoneId: status === 'scheduled' ? null : 'zon_a',
    activity:
      status === 'active' ? 'slam' : status === 'resting' ? 'resting' : null,
    restartDate: null,
    statusUpdatedAt: new Date('2026-11-20T08:59:00.000Z'),
    createdAt: new Date('2026-11-19T00:00:00.000Z'),
    updatedAt: now,
  });

describe('Flag status rules', () => {
  it('requires zone and activity for first update', () => {
    expect(() =>
      nextStatus(
        flag('scheduled'),
        { activity: 'slam', clientAt: now.toISOString() },
        now,
      ),
    ).toThrow(ConflictException);
    expect(
      nextStatus(
        flag('scheduled'),
        { zoneId: 'zon_a', activity: 'slam', clientAt: now.toISOString() },
        now,
      ),
    ).toMatchObject({ status: 'active', zoneId: 'zon_a', activity: 'slam' });
  });

  it('keeps zone while resting, then accepts one activity', () => {
    expect(
      nextStatus(
        flag('active'),
        { status: 'resting', clientAt: now.toISOString() },
        now,
      ),
    ).toMatchObject({
      status: 'resting',
      zoneId: 'zon_a',
      activity: 'resting',
    });
    expect(
      nextStatus(
        flag('resting'),
        { activity: 'sing', clientAt: now.toISOString() },
        now,
      ),
    ).toMatchObject({ status: 'active', zoneId: 'zon_a', activity: 'sing' });
  });

  it('rejects stale client updates and repeated daily restart', () => {
    expect(() =>
      nextStatus(
        flag('active'),
        { zoneId: 'zon_b', clientAt: '2026-11-20T08:58:00Z' },
        now,
      ),
    ).toThrow(ConflictException);
    const ended = flag('ended');
    ended.restartDate = '2026-11-20';
    expect(() =>
      nextStatus(
        ended,
        {
          zoneId: 'zon_a',
          activity: 'slam',
          restart: true,
          clientAt: now.toISOString(),
        },
        now,
      ),
    ).toThrow(ConflictException);
  });

  it('rejects unknown profile keys and duplicate tags', () => {
    expect(() => validateProfilePatch({ ownerId: 'other-user' })).toThrow();
    expect(() => validateProfilePatch({ tags: ['slam', 'slam'] })).toThrow();
  });

  it('accepts a complete forced state and rejects invalid or server-owned fields', () => {
    expect(
      forcedStatus({ status: 'active', zoneId: 'zon_a', activity: 'sing' }),
    ).toEqual({ status: 'active', zoneId: 'zon_a', activity: 'sing' });
    expect(
      forcedStatus({ status: 'ended', zoneId: null, activity: null }),
    ).toEqual({ status: 'ended', zoneId: null, activity: null });
    expect(() =>
      forcedStatus({ status: 'active', zoneId: null, activity: 'sing' }),
    ).toThrow();
    expect(() =>
      forcedStatus({ status: 'resting', zoneId: 'zon_a', activity: 'sing' }),
    ).toThrow();
    expect(() =>
      forcedStatus({ status: 'ended', zoneId: 'zon_a', activity: null }),
    ).toThrow();
    expect(() =>
      forcedStatus({
        status: 'ended',
        zoneId: null,
        activity: null,
        updatedAt: now.toISOString(),
      }),
    ).toThrow();
  });
});
