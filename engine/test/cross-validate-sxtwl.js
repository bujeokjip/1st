/* sxtwl(寿星천문력) 덤프와 교차 검증.
   사용: node test/cross-validate-sxtwl.js <sxtwl-cross.json>
   - 기둥(연·월·일주): 절기 경계 ±1일 정오 표본 — 완전 일치해야 함
   - 절기 시각: 우리 절기 제공자(getTermNodes) vs sxtwl(±로 분 단위 오차 분포)
   일진은 오프라인(JDN+49)으로 계산해 API 호출을 줄인다(별도 표본에서 KASI와 일치 확인됨). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computeSajuPalja } from '../src/manse.js';
import { getTermNodes, kstScalar } from '../src/solar-terms.js';

const path = process.argv[2];
if (!path) { console.error('사용: node test/cross-validate-sxtwl.js <sxtwl-cross.json>'); process.exit(2); }
const { pillars, terms } = JSON.parse(readFileSync(path, 'utf8'));

/* ── 1) 기둥 비교 ── */
const DAY_MS = 86_400_000;

/* sxtwl은 월주·연주를 일 단위로 전환해서, 절입이 UTC+8 자정 직후(±90분)면
   하루 이른 전환이 생긴다(예: 1917 대설 00:00, 1927 백로 00:05). 규약 차이로 분류. */
async function isDayRoundingArtifact(y, m, d) {
  const { nodes } = await getTermNodes(y);
  const sample = kstScalar(y, m, d, 12, 0);
  const near = [...nodes].sort((a, b) => Math.abs(a.scalar - sample) - Math.abs(b.scalar - sample))[0];
  if (!near || Math.abs(near.scalar - sample) > 2 * DAY_MS) return false;
  const cstOff = (((near.scalar - 3_600_000) % DAY_MS) + DAY_MS) % DAY_MS;
  return cstOff <= 90 * 60000 || cstOff >= DAY_MS - 90 * 60000;
}

let n = 0, bad = [], artifacts = [];
for (const row of pillars) {
  const [y, m, d] = row.date;
  const r = await computeSajuPalja({ year: y, month: m, day: d, hour: 12, useKasiIljin: false });
  const pairs = [['연주', r.pillars.year, row.yGZ], ['월주', r.pillars.month, row.mGZ], ['일주', r.pillars.day, row.dGZ]];
  for (const [nm, ours, sx] of pairs) {
    n++;
    if (ours.stem !== sx[0] || ours.branch !== sx[1]) {
      const msg = `${y}-${m}-${d} ${nm}: ours=[${ours.stem},${ours.branch}] sxtwl=[${sx}] (terms=${r.meta.sources.terms})`;
      if (nm !== '일주' && await isDayRoundingArtifact(y, m, d)) artifacts.push(msg);
      else bad.push(msg);
    }
  }
}
console.log(`기둥 비교: ${pillars.length}일 × 3주 = ${n}건 — 실질 불일치 ${bad.length}건 · sxtwl 일계 반올림 규약 차이 ${artifacts.length}건`);
for (const a of artifacts.slice(0, 10)) console.log('  (규약 차이)', a);
for (const b of bad.slice(0, 20)) console.log('  ✗', b);

/* ── 2) 절기 시각 비교 (sxtwl cst=UTC+8 → KST +60분) ── */
const sxScalars = terms.map(t => ({ y: t.y, scalar: kstScalar(t.cst[0], t.cst[1], t.cst[2], t.cst[3], t.cst[4]) + 3_600_000 }));
let tn = 0, tSum = 0, tMax = 0, tWorst = '', over30 = [];
const DAY = 86_400_000;
for (let y = 1900; y <= 2028; y++) {
  const { nodes, source } = await getTermNodes(y);
  for (const node of nodes.filter(nd => nd.year === y)) {
    const near = sxScalars.filter(s => Math.abs(s.scalar - node.scalar) < 2 * DAY)
      .sort((a, b) => Math.abs(a.scalar - node.scalar) - Math.abs(b.scalar - node.scalar))[0];
    if (!near) continue;
    const diff = Math.abs(near.scalar - node.scalar) / 60000;
    tn++; tSum += diff;
    if (diff > tMax) { tMax = diff; tWorst = `${y} ${node.name} (source=${source})`; }
    if (diff > 30) over30.push(`${y} ${node.name} ${diff.toFixed(0)}분 (source=${source}, ours=${new Date(node.scalar).toISOString().slice(0, 16)})`);
  }
}
console.log(`절기 시각 비교: ${tn}건 — 평균 ${(tSum / tn).toFixed(1)}분 · 최대 ${tMax.toFixed(1)}분 (${tWorst}) · 30분 초과 ${over30.length}건`);
for (const o of over30.slice(0, 20)) console.log('  ⚠', o);

assert.equal(bad.length, 0, '기둥 불일치 발생');
console.log('\n교차 검증 통과 (기둥 100% 일치)');
