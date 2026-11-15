/** 공연 상세 시트(S03)의 한 줄 메모 최대 글자 수 */
export const SET_NOTE_MAX_LENGTH = 80;

/**
 * 공연 세트의 한 줄 메모를 공개 값으로 정리한다.
 * 앞뒤 공백을 지운 1~80자이고 줄바꿈·제어 문자가 없는 문자열만 돌려주고, 그 밖의 값은 null이다.
 */
export function setNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  if (!note || /[\p{Cc}\u2028\u2029]/u.test(note)) return null;
  return [...note].length <= SET_NOTE_MAX_LENGTH ? note : null;
}
