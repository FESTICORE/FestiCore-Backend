export function normalizeArtistName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function artistNameKeys(name: string): string[] {
  const keys = [normalizeArtistName(name)];
  const parts = /^(.+?)\s*[（(]([^()（）]+)[）)]$/.exec(name.trim());
  if (parts) {
    const [, primary, alias] = parts;
    const koreanAndLatin =
      (/[가-힣]/.test(primary) && /[a-zA-Z]/.test(alias)) ||
      (/[a-zA-Z]/.test(primary) && /[가-힣]/.test(alias));
    if (koreanAndLatin)
      keys.push(normalizeArtistName(primary), normalizeArtistName(alias));
  }
  return [...new Set(keys)];
}
