// Read top-level attributes only; matching text inside alt/title values can
// otherwise attach a different person's image to a performer.
export function imageTagAttributes(tag: string, names: string[]): string[] {
  const start = /^<[a-z][\w:-]*/i.exec(tag)?.[0].length;
  if (!start) return [];
  const values = new Map<string, string[]>();
  let offset = start;
  while (offset < tag.length) {
    const match =
      /^\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(
        tag.slice(offset),
      );
    if (!match) break;
    offset += match[0].length;
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (value !== undefined)
      values.set(name, [...(values.get(name) ?? []), value]);
  }
  return names.flatMap((name) => values.get(name) ?? []);
}
