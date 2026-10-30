// Keeps service unit fixtures focused on their existing catalog SQL responses.
export function publicFestivalTestDataSource(
  query: (sql: string, params?: unknown[]) => unknown,
): Record<string, unknown> {
  return {
    query,
    transaction: (_isolation: string, run: (manager: object) => unknown) =>
      run({
        query: (sql: string, params?: unknown[]) =>
          sql.includes("SELECT DISTINCT item->'after'->>'url'")
            ? [
                {
                  url: 'https://ticket.melon.com/performance/index.htm?prodId=1',
                  date: '2026.12.26',
                },
              ]
            : query(sql, params),
      }),
  };
}
