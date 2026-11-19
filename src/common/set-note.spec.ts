import { SET_NOTE_MAX_LENGTH, setNote } from './set-note';

describe('setNote', () => {
  it('trims a one-line note', () => {
    expect(setNote('  리벳 앞 왼쪽이 덜 붐벼요. ')).toBe(
      '리벳 앞 왼쪽이 덜 붐벼요.',
    );
  });

  it('counts characters, not UTF-16 units, up to the limit', () => {
    expect(setNote('🎸'.repeat(SET_NOTE_MAX_LENGTH))).toBe(
      '🎸'.repeat(SET_NOTE_MAX_LENGTH),
    );
    expect(setNote('가'.repeat(SET_NOTE_MAX_LENGTH + 1))).toBeNull();
  });

  it('drops blank, multi-line and non-string values', () => {
    expect(setNote('  ')).toBeNull();
    expect(setNote('첫 줄\r\n둘째 줄')).toBeNull();
    expect(setNote('첫 줄\u2028둘째 줄')).toBeNull();
    expect(setNote('탭\t메모')).toBeNull();
    expect(setNote(undefined)).toBeNull();
    expect(setNote(42)).toBeNull();
  });
});
