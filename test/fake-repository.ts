import { randomUUID } from 'crypto';

/** 엔티티 클래스는 인덱스 시그니처가 없으므로 id 만 요구하고 접근은 캐스팅으로 푼다. */
type Row = { id?: string };
type Where = Record<string, unknown>;

/** TypeORM IsNull() 같은 FindOperator 를 흉내낸다(_type === 'isNull'). */
function matches(value: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === 'object' &&
    (expected as { _type?: string })._type === 'isNull'
  ) {
    return value === null || value === undefined;
  }
  return value === expected;
}

/**
 * e2e 용 인메모리 리포지토리.
 * TypeORM 전체를 흉내내지 않고 auth 코드가 실제로 호출하는 메서드만 구현한다.
 */
export class FakeRepository<T extends Row> {
  readonly rows: T[] = [];
  /** 다음 save 에서 한 번 던질 에러(동시성 시나리오 재현용). */
  failNextSave?: unknown;

  create(data: Partial<T>): T {
    return { ...data } as T;
  }

  save(entity: T): Promise<T> {
    if (this.failNextSave) {
      const error = this.failNextSave;
      this.failNextSave = undefined;
      return Promise.reject(error instanceof Error ? error : new Error('save'));
    }
    const bag = entity as unknown as Record<string, unknown>;
    if (!entity.id) {
      entity.id = randomUUID();
      bag.createdAt ??= new Date();
    }
    bag.updatedAt = new Date();
    const idx = this.rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity;
    else this.rows.push(entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where: Where }): Promise<T | null> {
    return Promise.resolve(this.match(options.where)[0] ?? null);
  }

  update(where: Where, partial: Partial<T>): Promise<{ affected: number }> {
    const rows = this.match(where);
    rows.forEach((row) => Object.assign(row, partial));
    return Promise.resolve({ affected: rows.length });
  }

  delete(where: Where): Promise<{ affected: number }> {
    const rows = this.match(where);
    for (const row of rows) this.rows.splice(this.rows.indexOf(row), 1);
    return Promise.resolve({ affected: rows.length });
  }

  private match(where: Where): T[] {
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, expected]) =>
        matches((row as unknown as Record<string, unknown>)[key], expected),
      ),
    );
  }
}
