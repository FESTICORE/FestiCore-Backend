/**
 * 같은 행사의 중복 수집 ID를 대표 축제 ID로 연결한다.
 * - COUNTDOWN: YES24 영문·국문 수집 ID → 공식 Mint Paper 축제 ID
 * - 썸띵 뉴 뮤직 페스티벌 2026: YES24 60785 → NOL World 26015181
 */
const FESTIVAL_ALIASES = Object.freeze({
  fst_546789e480f1630f: 'fst_c39663182b10a105',
  fst_c6dacea8997cd72b: 'fst_c39663182b10a105',
  fst_1f4d52004988a8b4: 'fst_3224612795ec9b7d',
});

/**
 * 제목 때문에 수집됐지만 음악 축제가 아닌 항목. 공개 목록과 상세에서 뺀다.
 * - fst_f864aa29fdde4c6e: 국립무용단 설 공연 「축제」(NOL World 26016327)
 * - fst_1411d33669e8acd5: FISM 세계 마술 챔피언십(YES24 54606)
 */
const HIDDEN_FESTIVAL_IDS = Object.freeze(
  new Set(['fst_f864aa29fdde4c6e', 'fst_1411d33669e8acd5']),
);

function canonicalFestivalId(id) {
  return FESTIVAL_ALIASES[id] ?? id;
}

function isHiddenFestival(id) {
  return HIDDEN_FESTIVAL_IDS.has(id);
}

module.exports = {
  FESTIVAL_ALIASES,
  HIDDEN_FESTIVAL_IDS,
  canonicalFestivalId,
  isHiddenFestival,
};
