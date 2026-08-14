# yongsin-engine — 1단계: 만세력(사주팔자 8글자)

[`docs/용신산출_정책명세서_v.0.1.md`](../docs/용신산출_정책명세서_v.0.1.md) §1·§3 구현 + KASI 공공 API 결합. Node 18+, 외부 패키지 의존성 없음.
2단계(용신 5신, §4~§6)는 이 출력(`pillars`의 stem/branch 인덱스)을 입력으로 이어붙일 예정.

## 사용

```js
import { computeSajuPalja } from './src/manse.js';

const r = await computeSajuPalja({
  year: 1979, month: 2, day: 2, hour: 16, minute: 45,
  // 이하 전부 선택 — 기본값은 서울·경도 보정 ON·한국 표준시 이력 자동 판정
  // longitudeDeg: LONGITUDE.부산,   // 출생 도시 경도
  // applyLongitude: false,          // 경도 보정 끄기
  // tzOffsetMinutes: 480,           // 해외 출생 등 표준시를 직접 지정(한국 이력 표 무시)
});
r.palja.ko;    // '무오 을축 경자 갑신'
r.pillars;     // { year:{stem,branch}, month, day, hour } — §1 인덱스 체계
r.solarTime;   // 진태양시 + 보정량 + 조자시 진입 여부
r.meta;        // { sources, warnings, time } — 데이터 소스와 적용된 시각 보정
```

2단계(용신)는 1단계 출력을 그대로 받는다:

```js
import { computeYongsin } from './src/yongsin.js';
const { strength, climate, yongsin } = computeYongsin(r.pillars);
// strength {total:1, band:'strong'} · climate {net:-2, need:1} · yongsin {U:1, hee:0, gi:4, both:true}
```

CLI 확인: `node src/cli.js 1979-02-02 16:45` · 테스트: `npm test` (KASI API 호출 발생)

**KASI 키**: `engine/.kasi-key`에 포함(소유자 결정으로 공개 저장소에 게시). 교체는 이 파일 한 줄 수정
또는 환경변수 `KASI_SERVICE_KEY`(우선). 키가 없어도 오프라인 폴백(일진 JDN+49 · 절기 천문 계산)으로 동작한다.

## 데이터 소스 정책

| 항목 | 1순위 | 2순위 | 3순위 |
|---|---|---|---|
| 일주(일진) | KASI 음양력 API | JDN+49 자체 계산 (§3-1, 항상 동일해야 함) | — |
| 절기(연·월주 경계) | KASI 특일정보 API (분 단위, **2000~2028년만 제공**) | 천문 계산 (Meeus 태양 황경, 분 단위, 전 연도) | 수성공식 근사 (§3-3, ±1일) |
| 시주 | 오서둔 자체 계산 (§3-5) | — | — |

- 연도별로 KASI 절기 데이터가 있으면 KASI, 없으면 천문 계산 (`meta.sources.terms`: `kasi` / `astro` / `astro+kasi`).
- KASI 절기 레코드가 천문 계산과 30분 이상 어긋나면 데이터 이상치로 보고 천문값을 채택하고 `meta.warnings`에 남긴다.
  실측 사례: **2011 입동** — KASI 09:26, Meeus 03:30, sxtwl 03:34 → 독립 천문 계산 둘이 합의, KASI 단독 이탈 → 보정.
- 수성공식은 폴백 강제(`preferExactTerms: false`) 또는 천문 계산 실패 시에만 쓰인다.

## NASA-only 모드 (KASI 무호출)

```js
const r = await computeSajuPalja({
  year: 1979, month: 2, day: 2, hour: 16, minute: 45,
  useKasiIljin: false, termsProvider: 'jpl',
});
```

CLI: `node src/cli.js 1979-02-02 16:45 --nasa`

- 절기를 JPL Horizons 태양 황경 15° 교차로 직접 산출(초 단위 정밀, 연도당 호출 1회·캐시, 응답 ~0.7MB).
  일진은 JDN+49 산술 — 간지는 천문값이 아니라 달력 순환이라 어떤 천문 API에도 없으며, KASI 일진과 전수 일치가 검증돼 있다.
- 이 모드에선 음력 메타(`lunar`)가 null(KASI 전용 정보). Horizons 장애 시 천문 계산(Meeus)으로 자동 폴백.

## 주의: KASI 세차·월건을 연주·월주에 쓰면 안 됨

음양력 API의 `lunSecha`(세차)·`lunWolgeon`(월건)은 **음력 달력(설날·삭일) 기준**이고,
사주 연주·월주는 **입춘·절입 기준**이다. 경계 구간(설날~입춘 사이 등)에서 서로 다르다.
검증 예: 1979-02-02 → API 세차 `기미(己未)`·월건 `병인(丙寅)` vs 사주 연주 `무오`·월주 `을축`(§9 회귀 케이스).
그래서 API에서는 **일진만** 채택하고 연주·월주는 절기로 직접 계산한다.

## 검증 근거 (2026-08-14 실측)

- **KASI 특일 API 전수 대조** (2000~2028, 348개 절): 천문 계산 평균 오차 5.3분, 30분 초과 1건(위 2011 입동뿐).
  수성공식은 같은 구간에서 날짜 불일치 8.9%(31/348) — 근사식 한계 확인.
- **sxtwl(寿星천문력) 교차 검증** (1900~2028, 1회 수행 후 JPL 대조로 대체): 절기 경계 ±1일 스트레스 표본 6,321일 × 연·월·일주 = **18,963건 실질 불일치 0건**.
  예외로 분류된 2건(1917 대설·1927 백로)은 절입이 자정 직후일 때 sxtwl이 월주를 하루 일찍 바꾸는 일계 반올림 규약 차이며,
  절입 시각 자체는 양쪽이 5분 내 합의(우리가 시각 기준으로 맞음). 절기 시각 1,548건: 평균 2.9분, 최대 12분.
  검증 스크립트는 제거됨 — 필요하면 초기 커밋(adf029b)의 `engine/test/sxtwl-dump.py`·`cross-validate-sxtwl.js` 참조.
- **NASA JPL Horizons(DE440/DE441) 대조** (1900·1917·1927·1950·1979·2000·2011·2026년 × 12절 = 96건):
  평균 2.3분 · 최대 8.0분 · 20분 초과 0건. 태양 겉보기 지심 황경(ObsEclLon, 당일 분점 기준)의 15° 교차 시각을 직접 계산해 비교.
  - 2011 입동 = JPL **03:34 KST** → KASI 09:26이 오류임을 최종 확증(sxtwl 03:34·Meeus 03:30과 합의).
  - sxtwl 분쟁 2건(1917 대설·1927 백로)도 JPL이 우리 시각을 지지(각 6.1분·4.5분 차).
  - 회귀 연도 1979는 입춘 0.3분·소한 0.6분.
- 재실행:
  - `node test/validate-astro.js` — 천문 계산 vs KASI 대조
  - `node test/validate-jpl.js [년도들]` — JPL Horizons 대조 (기본 8개 연도, 연도당 API 1회)

## 확정된 시각 정책 (2026-08-14 개정, 명세서 §3-6)

이전에 "남은 결정"으로 열어뒀던 항목이 전부 확정돼 구현에 반영됐다.

| 항목 | 확정 정책 | 구현 |
|---|---|---|
| 경도 보정(진태양시) | **기본 ON**, 한국 기준(서울 −32분). 균시차는 미적용 | `longitudeDeg`·`applyLongitude` |
| 서머타임 | **적용**. 한국 시행 12구간(1948~60, 1987~88)은 1시간 되돌림 | `korea-time.js` |
| 표준시 이력 | **적용**. UTC+8:30 시행기(~1911, 1954~61)를 그 기준으로 환산 | `korea-time.js` |
| 자시 시작 · 일주 경계 | **진태양시 23:00**(둘이 같은 시각 → 야자시 구간 없음) = 서울 KST 23:32. 관습 "자시 23:30"은 경도 보정의 근사치라 함께 쓰면 이중 적용 | `manse.js`의 `ZI_BOUNDARY` |
| 절입 오차 | **±8분 허용**. JPL 대조 실측(평균 2.3분·최대 8.0분)을 허용 오차로 인정 | — |

보정 적용 범위에 주의: **절기 비교(연주·월주)에는 경도·서머타임 보정을 적용하지 않는다.**
절입은 물리적 순간이라 출생지와 무관하므로 순간 대 순간으로 비교해야 한다.
경도 보정은 시주와 일주 경계에만 쓴다(§3-6 (3)).

남은 항목: 음력 입력 미지원(필요 시 음↔양 변환 선행).
