/* 수동 확인용 CLI.
   사용법: node src/cli.js YYYY-MM-DD HH:MM [tzOffsetMinutes=540] [--nasa]
   --nasa: KASI 무호출 모드(절기 JPL Horizons + 일진 JDN 산술) */
import { computeSajuPalja } from './manse.js';

const args = process.argv.slice(2);
const nasa = args.includes('--nasa');
const [date, time, tz] = args.filter(a => !a.startsWith('--'));
if (!date || !time) {
  console.error('사용법: node src/cli.js YYYY-MM-DD HH:MM [tzOffsetMinutes] [--nasa]');
  process.exit(2);
}
const [year, month, day] = date.split('-').map(Number);
const [hour, minute] = time.split(':').map(Number);

const r = await computeSajuPalja({
  year, month, day, hour, minute,
  tzOffsetMinutes: tz ? +tz : 540,
  ...(nasa ? { useKasiIljin: false, termsProvider: 'jpl' } : {}),
});
console.log(`사주팔자: ${r.palja.ko} (${r.palja.han})  · 사주년 ${r.sajuYear}`);
console.log(JSON.stringify(r, null, 2));
