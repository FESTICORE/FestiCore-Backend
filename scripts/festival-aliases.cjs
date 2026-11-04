/** 동일 COUNTDOWN 행사에 대한 YES24 영문·국문 수집 ID를 공식 Mint Paper 축제 ID로 연결한다. */
const FESTIVAL_ALIASES = Object.freeze({
  fst_546789e480f1630f: 'fst_c39663182b10a105',
  fst_c6dacea8997cd72b: 'fst_c39663182b10a105',
});

function canonicalFestivalId(id) {
  return FESTIVAL_ALIASES[id] ?? id;
}

module.exports = { FESTIVAL_ALIASES, canonicalFestivalId };
