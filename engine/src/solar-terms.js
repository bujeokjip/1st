/* 절기(節) 제공자 — 연주(입춘)·월주(절입) 경계 판정용.
   1순위: KASI 특일정보 API (정밀, 분 단위 — 단 데이터 제공 범위가 약 2000~2028년뿐)
   2순위: 천문 계산 (Meeus 태양 겉보기 황경, 분 단위 정밀 — 전 연도. KASI 구간 전수 대조로 검증)
   3순위: 수성(壽星)공식 근사 (명세서 §3-3, ±1일 오차 — 천문 계산 실패 시 비상용)
   절기의 정의: 태양 겉보기 황경이 15° 배수에 도달하는 순간(입춘=315°). */
import { get24Divisions, KasiError } from './kasi-client.js';

/* §3-3 — 12절(월 경계). i=0 소한 … i=11 대설. TERM_JI[i] = 그 절이 여는 월지. */
export const TERM_MONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const TERM_JI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0];
export const TERM_NAMES = ['소한', '입춘', '경칩', '청명', '입하', '망종', '소서', '입추', '백로', '한로', '입동', '대설'];
const TERM_SUN_LONG = [285, 315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255];
const C20 = [6.11, 4.6295, 6.3826, 5.59, 6.318, 6.5, 7.928, 8.35, 8.44, 9.098, 8.218, 7.9];
const C21 = [5.4055, 3.87, 5.63, 4.81, 5.52, 5.678, 7.108, 7.5, 7.646, 8.318, 7.438, 7.18];

/* KST 벽시계 시각 → 머신 타임존과 무관한 비교용 스칼라(UTC ms로 취급) */
export const kstScalar = (y, m, d, hh = 0, mi = 0) => Date.UTC(y, m - 1, d, hh, mi);

/* ── 수성공식 근사 (§3-3) ── */
const approxTermDay = (yr, i) => {
  const Y = yr % 100;
  const C = yr >= 2000 ? C21[i] : C20[i];
  return Math.floor(Y * 0.2422 + C) - Math.floor(Y / 4);
};

function approxNodes(y) {
  const node = (yr, i) => ({
    name: TERM_NAMES[i],
    ji: TERM_JI[i],
    year: yr,
    scalar: kstScalar(yr, TERM_MONTH[i], approxTermDay(yr, i)),
  });
  const nodes = [node(y - 1, 11)];
  for (let i = 0; i < 12; i++) nodes.push(node(y, i));
  nodes.push(node(y + 1, 0));
  nodes.sort((a, b) => a.scalar - b.scalar);
  return nodes;
}

/* ── 천문 계산 (Meeus, Astronomical Algorithms ch.25 저정밀 태양 위치) ── */
const RAD = Math.PI / 180;
const norm360 = x => ((x % 360) + 360) % 360;

/* ΔT(TT−UT, 초) — 실측 표 + 선형 보간. 수 초 오차는 절기 판정에 무의미. */
const DELTA_T = [
  [1900, -2.8], [1910, 10.4], [1920, 21.2], [1930, 24.0], [1940, 24.3],
  [1950, 29.1], [1960, 33.2], [1970, 40.2], [1980, 50.5], [1990, 56.9],
  [2000, 63.8], [2010, 66.1], [2020, 69.4], [2030, 72.0], [2050, 80.0],
];
function deltaT(year) {
  if (year <= DELTA_T[0][0]) return DELTA_T[0][1];
  for (let i = 1; i < DELTA_T.length; i++) {
    if (year <= DELTA_T[i][0]) {
      const [y0, v0] = DELTA_T[i - 1], [y1, v1] = DELTA_T[i];
      return v0 + (v1 - v0) * (year - y0) / (y1 - y0);
    }
  }
  return DELTA_T.at(-1)[1];
}

/* 태양 겉보기 황경(도) — jde는 TT 기준 율리우스일 */
function solarLongitude(jde) {
  const T = (jde - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * RAD;
  return norm360(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
}

const kstMsToJdUt = ms => ms / 86400000 + 2440587.5 - 9 / 24;
const jdUtToKstMs = jd => (jd - 2440587.5 + 9 / 24) * 86400000;

/* yr년 i번째 절의 절입 시각(KST 스칼라, 분 단위 반올림).
   수성공식 날짜를 초기값으로 ±5일 브래킷에서 황경=목표를 이분법으로 푼다(구간 내 단조증가). */
export function astroTermScalar(yr, i) {
  const target = TERM_SUN_LONG[i];
  const guess = kstScalar(yr, TERM_MONTH[i], approxTermDay(yr, i), 12, 0);
  const dtDays = deltaT(yr) / 86400;
  let lo = kstMsToJdUt(guess) + dtDays - 5;
  let hi = lo + 10;
  const f = jde => ((solarLongitude(jde) - target + 540) % 360) - 180;
  if (f(lo) >= 0 || f(hi) <= 0) throw new Error(`절기 브래킷 실패: ${yr} ${TERM_NAMES[i]}`);
  for (let k = 0; k < 45; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return Math.round(jdUtToKstMs((lo + hi) / 2 - dtDays) / 60000) * 60000;
}

const astroYearTerms = yr => TERM_NAMES.map((name, i) => ({
  name, ji: TERM_JI[i], year: yr, scalar: astroTermScalar(yr, i),
}));

/* ── KASI 특일정보 API ── */
let kasiBlocked = null; // 키 미등록류 오류는 프로세스 내 1회만 시도
const kasiYearCache = new Map(); // year → terms[] | null(미제공 연도·일시 오류)

async function kasiYearTerms(year) {
  if (kasiBlocked) return null;
  if (!kasiYearCache.has(year)) {
    try {
      const items = await get24Divisions(year);
      const terms = items
        .filter(it => TERM_NAMES.includes(it.dateName))
        .map(it => {
          const s = String(it.locdate).trim();
          const t = String(it.kst ?? '').trim().padStart(4, '0'); // "1723   " 꼴 — 공백 제거 필수
          return {
            name: it.dateName,
            ji: TERM_JI[TERM_NAMES.indexOf(it.dateName)],
            year: +s.slice(0, 4),
            scalar: kstScalar(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4)),
          };
        });
      /* KASI 레코드가 천문 계산과 30분 이상 어긋나면 데이터 이상치로 보고 천문값 채택.
         (실측: 2000~2028 전수 대조 평균 오차 5분대, 유일한 예외가 2011 입동 09:26 —
          Meeus·sxtwl 둘 다 03:3x로 합의 → KASI 쪽 오류로 판정) */
      for (const tm of terms) {
        const astro = astroTermScalar(tm.year, TERM_NAMES.indexOf(tm.name));
        if (Math.abs(tm.scalar - astro) > 30 * 60000) {
          tm.scalar = astro;
          tm.corrected = true;
        }
      }
      kasiYearCache.set(year, terms.length === 12 ? terms : null);
    } catch (e) {
      if (e instanceof KasiError && ['30', '31', '32', 'NO_KEY'].includes(e.code)) kasiBlocked = e.message;
      kasiYearCache.set(year, null);
    }
  }
  return kasiYearCache.get(year);
}

/* 전년 대설 ~ 익년 소한 노드 14개 + 출처.
   source: 'kasi' | 'astro' | 'astro+kasi' | 'suseong-approx' */
export async function getTermNodes(y, { preferExact = true } = {}) {
  if (!preferExact) return { nodes: approxNodes(y), source: 'suseong-approx', note: null };
  try {
    const used = new Set();
    const pick = async yr => {
      const k = await kasiYearTerms(yr);
      if (k) { used.add('kasi'); return k; }
      used.add('astro');
      return astroYearTerms(yr);
    };
    const [prev, cur, next] = await Promise.all([pick(y - 1), pick(y), pick(y + 1)]);
    const nodes = [prev.find(t => t.name === '대설'), ...cur, next.find(t => t.name === '소한')]
      .sort((a, b) => a.scalar - b.scalar);
    const corrected = nodes.filter(n => n.corrected).map(n => `${n.year} ${n.name}`);
    const note = corrected.length
      ? `KASI 절기 데이터 이상치 감지(${corrected.join(', ')}) → 천문 계산값으로 보정`
      : null;
    return { nodes, source: [...used].sort().join('+'), note };
  } catch (e) {
    return {
      nodes: approxNodes(y),
      source: 'suseong-approx',
      note: `정밀 절기 계산 실패(${e.message}) → 수성공식 근사 대체(경계 ±1일 오차 가능, §3-3)`,
    };
  }
}
