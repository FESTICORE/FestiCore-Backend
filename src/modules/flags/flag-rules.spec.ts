import { ConflictException } from '@nestjs/common';
import { Flag } from './flag.entity';
import {
  bearerStatusView,
  forcedStatus,
  nextStatus,
  repeatsAppliedStatus,
  statusView,
  validateProfilePatch,
} from './flag-rules';

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
    statusClientAt: new Date('2026-11-20T08:59:00.000Z'),
    createdAt: new Date('2026-11-19T00:00:00.000Z'),
    updatedAt: now,
  });

describe('Flag status rules', () => {
  it('shows the last bearer in the bearer view only', () => {
    const changed = Object.assign(flag('active'), {
      statusUpdatedBy: 'usr_co',
    });
    expect(bearerStatusView(changed, '민지').updatedBy).toEqual({
      userId: 'usr_co',
      nickname: '민지',
    });
    expect(bearerStatusView(changed, null).updatedBy).toEqual({
      userId: 'usr_co',
      nickname: '',
    });
    expect(statusView(changed)).not.toHaveProperty('updatedBy');
    const forced = Object.assign(flag('active'), { statusUpdatedBy: null });
    expect(bearerStatusView(forced, undefined).updatedBy).toBeNull();
  });

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

  it('compares stale updates with the last applied clientAt, not server time', () => {
    // 오프라인에서 08:50·08:51에 누른 두 변경을 09:00에 차례로 보낸다.
    const queued = Object.assign(flag('active'), {
      statusClientAt: new Date('2026-11-20T08:50:00.000Z'),
      statusUpdatedAt: new Date('2026-11-20T09:00:00.000Z'),
    });
    expect(
      nextStatus(
        queued,
        { status: 'resting', clientAt: '2026-11-20T08:51:00.000Z' },
        now,
      ),
    ).toMatchObject({
      status: 'resting',
      statusClientAt: new Date('2026-11-20T08:51:00.000Z'),
    });
    expect(() =>
      nextStatus(
        queued,
        { zoneId: 'zon_b', clientAt: '2026-11-20T08:49:00.000Z' },
        now,
      ),
    ).toThrow(ConflictException);
    const legacy = Object.assign(flag('active'), { statusClientAt: null });
    expect(
      nextStatus(
        legacy,
        { zoneId: 'zon_b', clientAt: '2026-11-20T08:00:00.000Z' },
        now,
      ),
    ).toMatchObject({ zoneId: 'zon_b' });
  });

  it('clamps a future clientAt so other bearers are not blocked', () => {
    const future = nextStatus(
      flag('active'),
      { zoneId: 'zon_b', clientAt: '2026-11-20T09:03:00.000Z' },
      now,
    );
    expect(future.statusClientAt).toEqual(now);
    const afterFuture = Object.assign(flag('active'), {
      statusClientAt: future.statusClientAt,
    });
    expect(
      nextStatus(
        afterFuture,
        { activity: 'sing', clientAt: now.toISOString() },
        now,
      ),
    ).toMatchObject({ activity: 'sing' });
  });

  it('accepts a clientAt equal to the last applied one and detects a repeat', () => {
    const applied = flag('active');
    expect(
      nextStatus(
        applied,
        { zoneId: 'zon_b', clientAt: '2026-11-20T08:59:00.000Z' },
        now,
      ),
    ).toMatchObject({ zoneId: 'zon_b' });
    const same = { zoneId: 'zon_a', clientAt: '2026-11-20T08:59:00.000Z' };
    expect(repeatsAppliedStatus(applied, same)).toBe(true);
    expect(repeatsAppliedStatus(applied, { ...same, zoneId: 'zon_b' })).toBe(
      false,
    );
    expect(
      repeatsAppliedStatus(applied, {
        ...same,
        clientAt: '2026-11-20T08:59:01.000Z',
      }),
    ).toBe(false);
    expect(
      repeatsAppliedStatus(
        Object.assign(flag('active'), { statusClientAt: null }),
        same,
      ),
    ).toBe(false);
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
