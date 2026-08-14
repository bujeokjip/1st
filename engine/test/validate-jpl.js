/* NASA JPL Horizons(DE440/DE441) 대조 검증 — 운영 절기 체인(KASI+천문 계산+가드)을 JPL과 비교.
   실행: node test/validate-jpl.js [년도들...] (기본: 쟁점 연도 8개, 호출 연도당 1회) */
import assert from 'node:assert/strict';
import { getTermNodes, TERM_NAMES, TERM_SUN_LONG } from '../src/solar-terms.js';
import { sunLongitudeYearSeries, crossingUt } from '../src/jpl-client.js';

const YEARS = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1900, 1917, 1927, 1950, 1979, 2000, 2011, 2026];

let n = 0, sum = 0, max = 0, worst = '', over20 = [];
const highlight = [];
for (const y of YEARS) {
  const rows = await sunLongitudeYearSeries(y);
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
