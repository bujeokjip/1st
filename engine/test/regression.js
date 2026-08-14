/* 회귀 검증(명세서 §9) + 경계·폴백 케이스. 실행: npm test (KASI API 호출 발생) */
import assert from 'node:assert/strict';
import { computeSajuPalja } from '../src/manse.js';
import { getTermNodes } from '../src/solar-terms.js';

const CASES = [];
const t = (name, fn) => CASES.push([name, fn]);

t('§9 회귀: 1979-02-02 16:45 → 무오 을축 경자 갑신', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45 });
  assert.equal(r.sajuYear, 1978);
  assert.equal(r.palja.ko, '무오 을축 경자 갑신');
  assert.equal(r.palja.han, '戊午 乙丑 庚子 甲申');
  assert.deepEqual(r.pillars.day, { stem: 6, branch: 0 });
  assert.equal(r.meta.sources.iljin, 'kasi');
  // KASI 음력 기준(세차·월건)과 사주 기준이 다른 구간임을 명시적으로 고정
  assert.match(r.lunar.secha, /기미/);
  assert.match(r.lunar.wolgeon, /병인/);
  console.log('   sources:', JSON.stringify(r.meta.sources), '| warnings:', r.meta.warnings.length);
});

t('절기 소스 선택: 2010=KASI · 1979=천문 계산, 절입 시각 분 단위 보유', async () => {
  const a = await getTermNodes(2010);
  assert.equal(a.source, 'kasi');
  const ip10 = a.nodes.find(n => n.name === '입춘' && n.year === 2010);
  assert.notEqual(ip10.scalar % 86400000, 0, '입춘이 자정 정각 — 시각 파싱 실패 의심');
  const b = await getTermNodes(1979);
  assert.equal(b.source, 'astro');
  const ip79 = b.nodes.find(n => n.name === '입춘' && n.year === 1979);
  assert.notEqual(ip79.scalar % 86400000, 0);
});

t('NASA-only 모드(KASI 무호출): 1979 회귀 동일 + 절기 소스 jpl', async () => {
  const r = await computeSajuPalja({
    year: 1979, month: 2, day: 2, hour: 16, minute: 45,
    useKasiIljin: false, termsProvider: 'jpl',
  });
  assert.equal(r.palja.ko, '무오 을축 경자 갑신');
  assert.equal(r.meta.sources.iljin, 'local-jdn');
  assert.equal(r.meta.sources.terms, 'jpl');
  assert.equal(r.lunar, null);
});

t('KASI 이상치 가드: 2011 입동(잘못된 09:26) → 천문값(03:3x) 보정 + 경고', async () => {
  const { nodes, note } = await getTermNodes(2011);
  const ipdong = nodes.find(n => n.name === '입동' && n.year === 2011);
  assert.ok(new Date(ipdong.scalar).getUTCHours() <= 4, `보정 안 됨: ${new Date(ipdong.scalar).toISOString()}`);
  assert.match(note ?? '', /2011 입동/);
});

t('자시 경계(§3-6 자정 기준): 1979-02-02 23:30 → 일주 유지(경자) + 병자시', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 23, minute: 30 });
  assert.deepEqual(r.pillars.day, { stem: 6, branch: 0 }); // 날짜 그대로 = 조자시 정책
  assert.deepEqual(r.pillars.hour, { stem: 2, branch: 0 }); // 경일 자시 → 병자
});

t('절기 근사 폴백 강제: 동일 회귀 결과', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45, preferExactTerms: false });
  assert.equal(r.palja.ko, '무오 을축 경자 갑신');
  assert.equal(r.meta.sources.terms, 'suseong-approx');
});

t('완전 오프라인 폴백(일진 자체계산): 동일 회귀 결과', async () => {
  const r = await computeSajuPalja({
    year: 1979, month: 2, day: 2, hour: 16, minute: 45,
    useKasiIljin: false, preferExactTerms: false,
  });
  assert.equal(r.palja.ko, '무오 을축 경자 갑신');
  assert.equal(r.meta.sources.iljin, 'local-jdn');
});

t('일진 교차검증: KASI vs JDN+49 일치 (1900~2026 표본)', async () => {
  const dates = [[1900, 1, 31], [1954, 6, 10], [1987, 10, 9], [2005, 2, 4], [2026, 8, 14]];
  for (const [y, m, d] of dates) {
    const api = await computeSajuPalja({ year: y, month: m, day: d, hour: 12, preferExactTerms: false });
    const loc = await computeSajuPalja({ year: y, month: m, day: d, hour: 12, useKasiIljin: false, preferExactTerms: false });
    assert.equal(api.meta.sources.iljin, 'kasi', `${y}-${m}-${d} API 미사용`);
    assert.deepEqual(api.pillars.day, loc.pillars.day, `${y}-${m}-${d} 일진 불일치`);
  }
});

t('locale 정규화: 상하이(UTC+8) 1979-02-01 23:40 → KST 02-02 00:40, 일주 경자', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 1, hour: 23, minute: 40, tzOffsetMinutes: 480 });
  assert.deepEqual([r.kst.d, r.kst.hh, r.kst.mi], [2, 0, 40]);
  assert.deepEqual(r.pillars.day, { stem: 6, branch: 0 });
  assert.equal(r.pillars.hour.branch, 0); // 자시
});

t('입력 검증: 시각 누락·불가능 날짜 거부 (§10-A·B)', async () => {
  await assert.rejects(() => computeSajuPalja({ year: 1979, month: 2, day: 2 }), RangeError);
  await assert.rejects(() => computeSajuPalja({ year: 1979, month: 2, day: 30, hour: 12 }), RangeError);
});

let fail = 0;
for (const [name, fn] of CASES) {
  try {
    await fn();
    console.log('✅', name);
  } catch (e) {
    fail++;
    console.error('❌', name, '\n   ', e.message);
  }
}
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
