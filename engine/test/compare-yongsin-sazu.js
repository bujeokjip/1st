/* 용신·신강약 교차 검증: 우리 엔진 vs SAZU 만세력 API(https://api.sazu.app/v1/sazu/calculate)
   실행: node test/compare-yongsin-sazu.js [결과JSON경로] [표본수=50]
   키: 환경변수 SAZU_API_KEY 또는 engine/.sazu-key 파일(한 줄).

   비교 조건을 맞추는 게 핵심:
   - trueSolarTime:false = "한국 관습(자시 23:30, 경도차만)" → 우리 §3-6 정책과 동일 기준
   - birthCity:'서울' → 우리 기본 경도(126.9784)와 동일
   우리 엔진은 KASI 없이 계산(useKasiIljin:false, termsProvider:'astro') — 일진은 전수 일치가 검증돼 있다. */
import { readFileSync, writeFileSync } from 'node:fs';
import { computeSajuPalja } from '../src/manse.js';
import { computeYongsin } from '../src/yongsin.js';
import { WX_KO, ganjiKo } from '../src/constants.js';

const OUT = process.argv[2];
const N = +(process.argv[3] || 50);

let KEY = process.env.SAZU_API_KEY;
if (!KEY) {
  try { KEY = readFileSync(new URL('../.sazu-key', import.meta.url), 'utf8').trim(); } catch { /* 없음 */ }
}
if (!KEY) { console.error('SAZU 키 없음 — SAZU_API_KEY 환경변수 또는 engine/.sazu-key 파일'); process.exit(2); }

/* 한국 서머타임 시행 구간(§3-6) — 이 구간 표본은 별도 표시(양쪽 처리 정책이 다를 수 있어서) */
const DST = [[1948, 6, 1, 9, 13], [1949, 4, 3, 9, 11], [1950, 4, 1, 9, 10], [1951, 5, 6, 9, 9],
  [1955, 5, 5, 9, 9], [1956, 5, 20, 9, 30], [1957, 5, 5, 9, 22], [1958, 5, 4, 9, 21],
  [1959, 5, 3, 9, 20], [1960, 5, 1, 9, 18], [1987, 5, 10, 10, 11], [1988, 5, 8, 10, 9]];
const inDst = (y, m, d) => DST.some(([yy, m1, d1, m2, d2]) =>
  yy === y && (m * 100 + d) >= (m1 * 100 + d1) && (m * 100 + d) < (m2 * 100 + d2));

/* 결정적 의사난수(LCG) — 같은 표본을 언제든 재현 */
let seed = 20260814;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function samples(n) {
  const list = [{ year: 1979, month: 2, day: 2, hour: 16, minute: 45, isFemale: true, note: '§9 회귀' }];
  while (list.length < n) {
    const year = pick(1930, 2010), month = pick(1, 12);
    const day = pick(1, new Date(Date.UTC(year, month, 0)).getUTCDate());
    list.push({ year, month, day, hour: pick(0, 23), minute: pick(0, 59), isFemale: rnd() < 0.5, note: '' });
  }
  return list;
}

async function sazu(s, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch('https://api.sazu.app/v1/sazu/calculate', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthYear: s.year, birthMonth: s.month, birthDay: s.day,
          birthHour: s.hour, birthMinute: s.minute,
          isFemale: s.isFemale, isLunar: false, birthCity: '서울',
          trueSolarTime: false, locale: 'ko', detail: 'standard',
          modules: ['fourPillars', 'sinStrength', 'yongsin'],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) throw new Error('rate limit');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      if (!j.success) throw new Error(JSON.stringify(j).slice(0, 160));
      return j.data.modules;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 4000 * (i + 1)));
    }
  }
}

/* 시지·일주 경계를 두 설정으로 각각 계산해 API와 대조한다.
   A = 현행(23:30) · B = 23:00. 경도 보정(−32분)을 적용한 위에 경계를 다시 +30분 옮기면
   이중 적용이 되므로, 어느 쪽이 외부 만세력과 맞는지 수치로 확인하는 게 목적. */
const CONFIGS = { A: 23 * 60 + 30, B: 23 * 60 };

const rows = [];
for (const [i, s] of samples(N).entries()) {
  const calc = {};
  for (const [k, zb] of Object.entries(CONFIGS)) {
    const m = await computeSajuPalja({ ...s, useKasiIljin: false, termsProvider: 'astro', ziBoundaryMinutes: zb });
    calc[k] = { palja: m.palja.ko, ...computeYongsin(m.pillars) };
  }
  const mine = { palja: calc.A.palja };
  const y = calc.A;
  const api = await sazu(s);

  const apiPalja = ['year', 'month', 'day', 'hour'].map(k => api.fourPillars[k].full).join(' ');
  const ourPalja = mine.palja;
  const ourYong = WX_KO[y.yongsin.U];
  const apiYong = api.yongsin.yongsin.ko;
  const apiJohu = api.yongsin.johu?.ko ?? null;
  const apiEokbu = api.yongsin.eokbu?.ko ?? null;

  // 용신 불일치 원인 분류: 조후 우선(우리 §6-2) vs 억부 우선(API)이면 정책 차이로 설명 가능
  let cause = '일치';
  if (ourYong !== apiYong) {
    cause = (api.yongsin.method === 'eokbu' && apiJohu && apiEokbu && apiJohu !== apiEokbu
      && ourYong === apiJohu && apiYong === apiEokbu)
      ? '정책 차이 (조후 우선 vs 억부 우선)'
      : '기타 불일치';
  }

  rows.push({
    no: i + 1,
    date: `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`,
    time: `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`,
    gender: s.isFemale ? '여' : '남',
    note: s.note || (inDst(s.year, s.month, s.day) ? '서머타임 기간' : ''),
    palja: { ours: ourPalja, api: apiPalja, match: ourPalja === apiPalja },
    strength: { ours: y.strength.verdict3, oursScore: y.strength.total, api: api.sinStrength.strength, apiScore: api.sinStrength.score, match: y.strength.verdict3 === api.sinStrength.strength },
    yongsin: { ours: ourYong, api: apiYong, apiJohu, apiEokbu, apiMethod: api.yongsin.method, match: ourYong === apiYong, cause },
    // 경계 설정 A(23:30, 현행) / B(23:00) 별 API 일치 여부
    boundary: {
      A: { palja: calc.A.palja, match: calc.A.palja === apiPalja },
      B: { palja: calc.B.palja, match: calc.B.palja === apiPalja },
      differs: calc.A.palja !== calc.B.palja,
    },
  });

  const mark = r => r ? '✓' : '✗';
  console.log(`[${String(i + 1).padStart(2)}] ${rows.at(-1).date} ${rows.at(-1).time} ${rows.at(-1).gender} | 팔자 ${mark(rows.at(-1).palja.match)} | 신강 ${mark(rows.at(-1).strength.match)} ${y.strength.verdict3}/${api.sinStrength.strength} | 용신 ${mark(rows.at(-1).yongsin.match)} ${ourYong}/${apiYong}`);
  await new Promise(r => setTimeout(r, 2200)); // 30 req/min 제한
}

const sum = k => rows.filter(r => r[k].match).length;
const policy = rows.filter(r => r.yongsin.cause === '정책 차이 (조후 우선 vs 억부 우선)').length;
const other = rows.filter(r => r.yongsin.cause === '기타 불일치').length;
const bA = rows.filter(r => r.boundary.A.match).length;
const bB = rows.filter(r => r.boundary.B.match).length;
console.log(`\n표본 ${rows.length}건`);
console.log(`  사주팔자 일치 ${sum('palja')}/${rows.length}  (경계 23:30 현행 ${bA} · 23:00 ${bB})`);
console.log(`  신강약   일치 ${sum('strength')}/${rows.length}`);
console.log(`  용신     일치 ${sum('yongsin')}/${rows.length} · 정책 차이 ${policy}건 · 기타 불일치 ${other}건`);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ rows, total: rows.length,
    matched: { palja: sum('palja'), strength: sum('strength'), yongsin: sum('yongsin') },
    boundary: { A: bA, B: bB }, yongsinCause: { policy, other } }, null, 2) + '\n');
  console.log('JSON 저장:', OUT);
}
