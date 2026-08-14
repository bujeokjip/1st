/* 천문 계산 절기를 KASI 특일 API 제공 전 구간(2000~2028)과 전수 대조.
   실행: node test/validate-astro.js (API 29회 호출) */
import { get24Divisions } from '../src/kasi-client.js';
import { astroTermScalar, TERM_NAMES, kstScalar } from '../src/solar-terms.js';

const C20 = [6.11, 4.6295, 6.3826, 5.59, 6.318, 6.5, 7.928, 8.35, 8.44, 9.098, 8.218, 7.9];
const C21 = [5.4055, 3.87, 5.63, 4.81, 5.52, 5.678, 7.108, 7.5, 7.646, 8.318, 7.438, 7.18];
const approxDay = (yr, i) =>
  Math.floor((yr % 100) * 0.2422 + (yr >= 2000 ? C21[i] : C20[i])) - Math.floor((yr % 100) / 4);

let n = 0, maxDiff = 0, sumDiff = 0, dayMiss = 0, worst = null;
let susDayMiss = 0;

for (let y = 2000; y <= 2028; y++) {
  const items = await get24Divisions(y);
  for (const it of items) {
    const i = TERM_NAMES.indexOf(it.dateName);
    if (i === -1) continue;
    const s = String(it.locdate).trim();
    const t = String(it.kst ?? '').trim().padStart(4, '0');
    const kasi = kstScalar(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4));
    const astro = astroTermScalar(y, i);
    const diffMin = Math.abs(astro - kasi) / 60000;
    n++; sumDiff += diffMin;
    if (diffMin > 30) {
      console.log(`  [이상치 ${diffMin.toFixed(0)}분] ${y} ${it.dateName} — KASI raw locdate=${s} kst="${it.kst}" vs astro(KST벽시계) ${new Date(astro).toISOString().slice(0, 16)}`);
    }
    if (diffMin > maxDiff) { maxDiff = diffMin; worst = `${y} ${it.dateName} (KASI ${s} ${t} vs astro ${new Date(astro).toISOString()})`; }
    if (new Date(astro).getUTCDate() !== +s.slice(6, 8)) dayMiss++;
    if (approxDay(y, i) !== +s.slice(6, 8)) susDayMiss++;
  }
}

console.log(`대조 표본: ${n}개 절기 (2000~2028 × 12절)`);
console.log(`천문 계산 vs KASI — 평균 오차 ${(sumDiff / n).toFixed(1)}분 · 최대 오차 ${maxDiff.toFixed(1)}분 · 날짜 불일치 ${dayMiss}건`);
console.log(`  최대 오차 지점: ${worst}`);
console.log(`수성공식 vs KASI — 날짜 불일치 ${susDayMiss}건 / ${n} (${(susDayMiss / n * 100).toFixed(1)}%)`);
console.log('(정보용 리포트 — 30분 초과 이상치는 런타임에서 천문값으로 자동 보정됨)');
