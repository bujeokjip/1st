/* NASA JPL Horizons(DE440/DE441) 대조 검증 — 절기 = 태양 겉보기 지심 황경(당일 분점 기준) 15° 배수 순간.
   연도별 1회 호출(1년 전체, 1시간 간격, QUANTITIES=31 ObsEclLon)로 12절 교차 시각을 선형 보간해
   우리 절기 제공자(getTermNodes: KASI+천문 계산+이상치 가드)와 비교한다.
   실행: node test/validate-jpl.js [년도들...] (기본: 쟁점 연도 8개, 호출 8회) */
import assert from 'node:assert/strict';
import { getTermNodes, TERM_NAMES } from '../src/solar-terms.js';

const TERM_SUN_LONG = [285, 315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255];
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const YEARS = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1900, 1917, 1927, 1950, 1979, 2000, 2011, 2026];

async function horizonsYearSeries(year) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: "'10'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    START_TIME: `'${year}-01-01 00:00'`,
    STOP_TIME: `'${year}-12-31 23:59'`,
    STEP_SIZE: "'1h'",
    QUANTITIES: "'31'",
    ANG_FORMAT: "'DEG'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  const text = await res.text();
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`Horizons 응답 파싱 실패(${year}): ${text.slice(0, 200)}`);
  const rows = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})\s+([\d.]+)\s+(-?[\d.]+)/);
    if (m) rows.push({ ut: Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]), lon: +m[6] });
  }
  if (rows.length < 8000) throw new Error(`Horizons 행 수 이상(${year}): ${rows.length}`);
  // 황경 언랩(3월 춘분에서 360→0 한 번 감김)
  let wrap = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i].lon + wrap < rows[i - 1].u - 300) wrap += 360;
    rows[i].u = rows[i].lon + wrap;
  }
  return rows;
}

/* 언랩 급수에서 목표 황경 교차 시각(UT ms) — 1시간 구간 선형 보간(태양 속도 변화가 미미해 초 단위 정밀) */
function crossingUt(rows, targetDeg) {
  const t = targetDeg < rows[0].u ? targetDeg + 360 : targetDeg;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].u < t && t <= rows[i].u) {
      const f = (t - rows[i - 1].u) / (rows[i].u - rows[i - 1].u);
      return rows[i - 1].ut + f * (rows[i].ut - rows[i - 1].ut);
    }
  }
  throw new Error(`교차 없음: ${targetDeg}°`);
}

let n = 0, sum = 0, max = 0, worst = '', over20 = [];
const highlight = [];
for (const y of YEARS) {
  const rows = await horizonsYearSeries(y);
  const { nodes, source } = await getTermNodes(y);
  for (let i = 0; i < 12; i++) {
    const jplKst = crossingUt(rows, TERM_SUN_LONG[i]) + 9 * 3_600_000; // UT → KST 벽시계 스칼라
    const node = nodes.find(nd => nd.year === y && nd.name === TERM_NAMES[i]);
    const diff = Math.abs(node.scalar - jplKst) / 60_000;
    n++; sum += diff;
    const tag = `${y} ${TERM_NAMES[i]}`;
    if (diff > max) { max = diff; worst = `${tag} (source=${source})`; }
    if (diff > 20) over20.push(`${tag} ${diff.toFixed(1)}분 (source=${source})`);
    if (['2011 입동', '1917 대설', '1927 백로', '1979 입춘', '1979 소한'].includes(tag)) {
      highlight.push(`  ${tag}: JPL ${new Date(jplKst).toISOString().slice(0, 16)}(KST) vs ours ${new Date(node.scalar).toISOString().slice(0, 16)} → ${diff.toFixed(1)}분 [${source}]`);
    }
  }
  console.log(`[${y}] 12절 대조 완료 (절기 소스: ${source})`);
  await new Promise(r => setTimeout(r, 300));
}

console.log(`\nJPL DE440/441 대조: ${n}건 — 평균 ${(sum / n).toFixed(1)}분 · 최대 ${max.toFixed(1)}분 (${worst}) · 20분 초과 ${over20.length}건`);
for (const o of over20) console.log('  ⚠', o);
console.log('쟁점 지점:');
for (const h of highlight) console.log(h);

assert.ok(max < 20, `허용 오차(20분) 초과: ${worst} ${max.toFixed(1)}분`);
console.log('\nJPL 대조 통과 (전 표본 20분 이내)');
