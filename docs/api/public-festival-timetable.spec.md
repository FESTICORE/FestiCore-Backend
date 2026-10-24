# 공개 축제 상세의 공식 시간표 연결

## API

`GET /api/v1/festivals/{id}`의 `data.timetable`은 검토 완료(`verified`)된 공연만 반환한다. 각 공연에는 출연진, 날짜, 무대, 시작·종료 시각, 공식 출처와 보관된 원본 이미지 경로를 포함한다.

## 출처 연결

- 공개 축제에 병합된 예매·공식 출처 URL과 시간표 revision의 `festivalSourceUrl`이 일치하면 연결한다.
- 공식 행사 페이지가 공개 목록의 예매 URL과 다를 때는 두 연결을 모두 확인한다. 시간표 `crawl_sources.parserConfig.festivalSourceUrl`은 revision의 공식 행사 페이지 URL과 일치해야 하며, 그 공식 페이지의 discovery source가 `parserConfig.festivalSourceUrl`로 공개 축제의 예매 URL을 가리켜야 한다.
- revision과 시간표 source ID가 같아야 한다. 두 소스의 `kind`는 각각 `timetable`·`discovery`, `enabled`는 `true`여야 한다. URL이나 공연 이름을 코드에 고정하지 않는다.
- `pending`·`rejected` revision은 노출하지 않는다. 같은 source의 최신 검토 완료 revision을 사용하고, 중복 공연은 한 번만 표시한다.

관리자 검토 완료와 공개 API 노출은 별도로 검증한다. 공식 원본에 없는 공연명·시각·출연진 이미지는 추정해 채우지 않는다.
