/* NASA JPL Horizons(DE441)에서 절기 시각을 받아 engine/src/nasa-terms-data.js 로 굽는다.

   왜 굽나: 브라우저는 Horizons를 CORS로 호출할 수 없고(제품은 서버 없는 단일 HTML),
   런타임 호출은 오프라인·QR 배포 전제와도 어긋난다. 그래서 빌드 시점에 한 번 받아 내장한다.

   실행: node engine/tools/fetch-nasa-terms.mjs [시작연도] [끝연도]
   Horizons는 동시·연속 요청에 민감해 순차 호출한다(1년치 약 2.6초, 전체 6~15분).
*/
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sunLongitudeYearSeries, crossingUt } from '../src/jpl-client.js';
import { TERM_NAMES, TERM_SUN_LONG, astroTermScalar } from '../src/solar-terms.js';

const OUT = fileURLToPath(new URL('../src/nasa-terms-data.js', import.meta.url));
const FROM = +(process.argv[2] ?? 1899);
const TO = +(process.argv[3] ?? 2030);

const B36 = n => n.toString(36);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* yr년 12절의 절입 시각(KST 스칼라, 분 단위 반올림) — jplYearTerms 와 같은 산식 */
async function nasaYearScalars(yr) {
  const rows = await sunLongitudeYearSeries(yr);
  return TERM_SUN_LONG.map(deg =>
    Math.round((crossingUt(rows, deg) + 9 * 3_600_000) / 60000) * 60000);
}

const years = [];
for (let y = FROM; y <= TO; y++) years.push(y);

const table = new Map();
let worst = { diff: 0, at: null };

for (const [i, yr] of years.entries()) {
  let scalars;
  for (let attempt = 1; ; attempt++) {
    try {
      scalars = await nasaYearScalars(yr);
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${yr}년 수집 실패: ${e.message}`);
      process.stdout.write(` (재시도 ${attempt})`);
      await sleep(2000 * attempt);
    }
  }
  table.set(yr, scalars);

  // 기존 천문 계산(Meeus)과 대조 — 벌어지면 데이터 이상이므로 즉시 드러나게 한다
  for (let t = 0; t < 12; t++) {
    const diff = Math.abs(scalars[t] - astroTermScalar(yr, t)) / 60000;
    if (diff > worst.diff) worst = { diff, at: `${yr} ${TERM_NAMES[t]}` };
  }

  if ((i + 1) % 10 === 0 || i === years.length - 1) {
    console.log(`  ${yr} 까지 ${i + 1}/${years.length} — Meeus 최대 편차 ${worst.diff}분 (${worst.at})`);
  }
  await sleep(300);
}

/* 인코딩: 전체를 한 줄로 편 뒤 차분 → base36. 절 간격은 약 30일(43,000분대)이라
   차분만 담으면 절대값(8자리)보다 훨씬 짧다. 첫 값만 절대값. */
const flat = years.flatMap(y => table.get(y).map(s => s / 60000));
for (let i = 1; i < flat.length; i++) {
  if (flat[i] <= flat[i - 1]) throw new Error(`시각 역전 감지: index ${i}`);
}
const deltas = flat.slice(1).map((v, i) => v - flat[i]);
const encoded = [B36(flat[0]), ...deltas.map(B36)].join(',');

const text = `/* NASA JPL Horizons(DE441) 절기 시각표 — ${FROM}~${TO}년, 연 12절.
   ★ 자동 생성 파일. 직접 고치지 마세요.
   재생성: node engine/tools/fetch-nasa-terms.mjs ${FROM} ${TO}
   생성일: ${new Date().toISOString().slice(0, 10)}  ·  Meeus 대조 최대 편차 ${worst.diff}분 (${worst.at})

   값은 절입 시각(KST 벽시계)을 분 단위로 편 뒤 차분해 base36으로 적은 것.
   첫 항목만 절대값이고 나머지는 직전 절과의 간격(분)이다. */
export const NASA_TERMS_FROM = ${FROM};
export const NASA_TERMS_TO = ${TO};
export const NASA_TERMS_B36 = '${encoded}';
`;

writeFileSync(OUT, text, 'utf8');
console.log(`\n✅ ${OUT}`);
console.log(`   ${years.length}개 연도 × 12절 = ${flat.length}개 · ${(encoded.length / 1024).toFixed(1)}KB`);
console.log(`   Meeus 대조 최대 편차 ${worst.diff}분 (${worst.at})`);
