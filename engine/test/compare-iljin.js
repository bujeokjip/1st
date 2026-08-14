/* 일주(日柱) 교차 비교: NASA 모드(일진 = JDN+49 산술, KASI 무호출)와 KASI 음양력 API 일진 대조.
   실행: node test/compare-iljin.js [결과JSON경로]  (날짜당 KASI 호출 1회) */
import { writeFileSync } from 'node:fs';
import { computeSajuPalja } from '../src/manse.js';
import { getLunCalInfo } from '../src/kasi-client.js';
import { parseGanji, ganjiKo, ganjiHan } from '../src/constants.js';

/* 표본: 경계·윤일·검증 이력이 있는 랜드마크 + 1900~2050 균등 분포(1801일 간격, 결정적) */
const LANDMARKS = [
  [1900, 1, 1], [1912, 2, 18], [1945, 8, 15], [1954, 6, 10], [1979, 2, 2],
  [1987, 10, 9], [1999, 12, 31], [2000, 1, 1], [2000, 2, 29], [2011, 11, 8],
  [2024, 2, 29], [2026, 8, 14], [2050, 12, 31],
];
const dates = [...LANDMARKS];
for (let ms = Date.UTC(1902, 2, 5); ms < Date.UTC(2050, 0, 1); ms += 1801 * 86_400_000) {
  const d = new Date(ms);
  dates.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
}
dates.sort((a, b) => Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2]));

const rows = [];
for (const [y, m, d] of dates) {
  const nasa = (await computeSajuPalja({
    year: y, month: m, day: d, hour: 12,
    useKasiIljin: false, preferExactTerms: false, // 일주 비교 목적 — 절기·KASI 경로 배제
  })).pillars.day;
  const kasi = parseGanji((await getLunCalInfo(y, m, d)).lunIljin);
  rows.push({
    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    nasa: { ko: ganjiKo(nasa), han: ganjiHan(nasa) },
    kasi: { ko: ganjiKo(kasi), han: ganjiHan(kasi) },
    match: nasa.stem === kasi.stem && nasa.branch === kasi.branch,
  });
}

const ok = rows.filter(r => r.match).length;
console.log('날짜         | NASA 모드   | KASI       | 일치');
for (const r of rows) {
  console.log(`${r.date}   | ${r.nasa.ko}(${r.nasa.han}) | ${r.kasi.ko}(${r.kasi.han}) | ${r.match ? '✓' : '✗ 불일치'}`);
}
console.log(`\n${rows.length}건 중 일치 ${ok}건 (${(ok / rows.length * 100).toFixed(1)}%)`);

if (process.argv[2]) {
  writeFileSync(process.argv[2], JSON.stringify({ rows, total: rows.length, matched: ok }, null, 2) + '\n');
  console.log('JSON 저장:', process.argv[2]);
}
process.exit(ok === rows.length ? 0 : 1);
