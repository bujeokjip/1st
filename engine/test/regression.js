/* 회귀 검증(명세서 §9) + 경계·폴백 케이스. 실행: npm test (KASI API 호출 발생) */
import assert from 'node:assert/strict';
import { computeSajuPalja } from '../src/manse.js';
import { computeYongsin, catOf } from '../src/yongsin.js';
import { WX_KO, GAN_WX } from '../src/constants.js';
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

t('§9 회귀 2단계: 강약 +1(strong)·조후 −2(need 화)·용신 火 both·희신 木·기신 水', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45, useKasiIljin: false, termsProvider: 'astro' });
  const y = computeYongsin(r.pillars);
  assert.equal(y.strength.total, 1);
  assert.equal(y.strength.band, 'strong');
  assert.equal(y.climate.net, -2);
  assert.equal(y.climate.need, 1);
  assert.deepEqual(
    [y.yongsin.U, y.yongsin.both, y.yongsin.hee, y.yongsin.gi],
    [1, true, 0, 4],
  );
});

/* §6 결합 규칙 5분기 — 2026-08-14 기획 확정(SAZU 대조 검토 후 현행 유지 결정).
   ①억부 방향 ②억부 후보 순위(신강=관>재>식) ③조후 결합(both면 조후 오행 채택) 모두 이 테스트가 지킨다. */
t('§6-2 결합 규칙 5분기 고정 (기획 확정 정책)', async () => {
  const at = async (date, time) => {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const r = await computeSajuPalja({ year, month, day, hour, minute, useKasiIljin: false, termsProvider: 'astro' });
    const y = computeYongsin(r.pillars);
    return { U: WX_KO[y.yongsin.U], abu0: WX_KO[y.yongsin.abuList[0]], both: y.yongsin.both, method: y.yongsin.method };
  };

  // ① 억부·조후가 같은 오행을 지목 → 그 오행(=억부 1순위)
  assert.deepEqual(await at('1979-02-02', '16:45'), { U: '화', abu0: '화', both: true, method: 'eokbu' });

  // ② 조후 오행이 억부 후보 안에 있되 1순위가 아님 → 조후 쪽 채택(순위 재배열). ★③ 조후 결합 정책★
  assert.deepEqual(await at('1978-09-16', '12:20'), { U: '수', abu0: '화', both: true, method: 'eokbu' });

  // ③ 조후는 뚜렷하나 억부 후보 밖 → 억부 1순위 고수(억부 우선)
  assert.deepEqual(await at('1970-11-16', '06:26'), { U: '토', abu0: '토', both: false, method: 'eokbu' });

  // ④ 중화(억부 후보 없음) + 조후 뚜렷 → 조후가 용신
  assert.deepEqual((await at('1995-09-28', '06:48')).method, 'johu');
  assert.equal((await at('1995-09-28', '06:48')).U, '화');

  // ⑤ 중화 + 평 → 원국에서 가장 부족한 오행
  assert.deepEqual((await at('1994-11-01', '15:32')).method, 'balance');
  assert.equal((await at('1994-11-01', '15:32')).U, '수');
});

t('§6-1 억부 후보 순위 고정: 신강=관>재>식 · 신약=인>비 (기획 확정)', async () => {
  const abu = async (date, time) => {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const r = await computeSajuPalja({ year, month, day, hour, minute, useKasiIljin: false, termsProvider: 'astro' });
    const y = computeYongsin(r.pillars);
    const D = r.pillars.day.stem;
    return y.yongsin.abuList.map(w => catOf(w, GAN_WX[D]));
  };
  assert.deepEqual(await abu('1979-02-02', '16:45'), ['관성', '재성', '식상']); // 신강 계열
  assert.deepEqual(await abu('1970-11-16', '06:26'), ['인성', '비겁']);          // 신약 계열
});

t('astro 프로바이더(네트워크 0, 브라우저 배포 모드): 회귀 동일 + terms=astro', async () => {
  const r = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45, useKasiIljin: false, termsProvider: 'astro' });
  assert.equal(r.palja.ko, '무오 을축 경자 갑신');
  assert.equal(r.meta.sources.terms, 'astro');
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

t('자시 경계 23:00(§3-6): 시지·일주 경계가 같아 야자시 구간이 없다', async () => {
  // ① 진태양시 22:58 (KST 23:30) → 아직 해시, 일주 당일(경자) → 정해시
  const hae = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 23, minute: 30 });
  assert.equal(hae.solarTime.earlyZi, false);
  assert.deepEqual(hae.pillars.day, { stem: 6, branch: 0 });
  assert.deepEqual(hae.pillars.hour, { stem: 3, branch: 11 });

  // ② 진태양시 23:13 (KST 23:45) → 자시 진입 = 일주도 다음 날(신축) → 무자시
  const zi = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 23, minute: 45 });
  assert.equal(zi.solarTime.earlyZi, true);
  assert.deepEqual(zi.pillars.day, { stem: 7, branch: 1 });
  assert.deepEqual(zi.pillars.hour, { stem: 4, branch: 0 });

  // ③ 자시는 자정을 걸치므로(23:00~01:00) 전반·후반이 같은 일주·시주여야 한다.
  //    전반(23:00~23:59)은 날짜를 넘기고, 후반(00:00~00:59)은 이미 다음 날이라 그대로 둔다.
  for (const [d, h, m] of [[2, 23, 0], [2, 23, 59], [3, 0, 0], [3, 0, 30], [3, 0, 59]]) {
    const r = await computeSajuPalja({ year: 1979, month: 2, day: d, hour: h, minute: m, applyLongitude: false });
    assert.deepEqual(r.pillars.hour, { stem: 4, branch: 0 }, `2/${d} ${h}:${m} 시주가 무자가 아님`);
    assert.deepEqual(r.pillars.day, { stem: 7, branch: 1 }, `2/${d} ${h}:${m} 일주가 신축이 아님`);
  }
  // 자시 직전·직후는 다른 기둥
  const hae2 = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 22, minute: 59, applyLongitude: false });
  assert.deepEqual([hae2.pillars.day, hae2.pillars.hour], [{ stem: 6, branch: 0 }, { stem: 3, branch: 11 }]);
  const chuk = await computeSajuPalja({ year: 1979, month: 2, day: 3, hour: 1, minute: 0, applyLongitude: false });
  assert.deepEqual(chuk.pillars.hour, { stem: 5, branch: 1 }); // 기축
});

t('시지 경계 표준(§3-6): 자 23:00~01:00 · 축 01:00~03:00', async () => {
  const at = async (h, m) => (await computeSajuPalja({
    year: 1979, month: 2, day: 3, hour: h, minute: m, applyLongitude: false,
  })).pillars.hour.branch;
  assert.equal(await at(22, 59), 11); // 해
  assert.equal(await at(23, 0), 0);   // 자 시작
  assert.equal(await at(0, 59), 0);   // 아직 자
  assert.equal(await at(1, 0), 1);    // 축 시작
  assert.equal(await at(2, 59), 1);
  assert.equal(await at(3, 0), 2);    // 인
});

t('경도 보정 이중 적용 방지(§3-6): 자시 시작이 서울 KST 23:32', async () => {
  // 관습("자시 23:30")과 2분 이내로 맞아야 한다 — 경계를 23:30으로 두면 KST 00:02로 밀린다
  const before = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 23, minute: 31 });
  const after = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 23, minute: 32 });
  assert.equal(before.solarTime.earlyZi, false);
  assert.equal(after.solarTime.earlyZi, true);
});

t('경도 보정 ON 기본(§3-6): 서울 기준 −32분, 끄면 보정 0', async () => {
  const on = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45 });
  assert.equal(on.meta.time.longitudeCorrection, -32);
  assert.equal(on.solarTime.hh, 16);
  assert.equal(on.solarTime.mi, 13);
  const off = await computeSajuPalja({ year: 1979, month: 2, day: 2, hour: 16, minute: 45, applyLongitude: false });
  assert.equal(off.meta.time.longitudeCorrection, 0);
});

t('서머타임(§3-6): 1988-08-15 12:00은 KDT — 표준시 11:00로 되돌려 사시', async () => {
  const r = await computeSajuPalja({ year: 1988, month: 8, day: 15, hour: 12, minute: 0 });
  assert.equal(r.meta.time.dstMinutes, 60);
  assert.equal(r.pillars.hour.branch, 5); // 진태양시 10:28 → 사시 (미보정이면 오시)
  assert.match(r.meta.warnings.join(' '), /서머타임/);
});

t('표준시 이력(§3-6): 1955-11-15는 UTC+8:30 시행기', async () => {
  const r = await computeSajuPalja({ year: 1955, month: 11, day: 15, hour: 12, minute: 0 });
  assert.equal(r.meta.time.stdOffsetMinutes, 510);
  assert.equal(r.meta.time.dstMinutes, 0);
  assert.equal(r.kst.hh, 12); // KST 벽시계로는 12:30
  assert.equal(r.kst.mi, 30);
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

t('locale 정규화: 상하이(UTC+8, 경도 121.47) 1979-02-01 23:40 → KST 02-02 00:40, 일주 경자', async () => {
  const r = await computeSajuPalja({
    year: 1979, month: 2, day: 1, hour: 23, minute: 40,
    tzOffsetMinutes: 480, longitudeDeg: 121.4737,
  });
  assert.deepEqual([r.kst.d, r.kst.hh, r.kst.mi], [2, 0, 40]);
  assert.equal(r.solarTime.earlyZi, true); // 진태양시 02-01 23:46 → 조자시 → 다음 날 일주
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
