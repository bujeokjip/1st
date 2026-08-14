/* 수동 확인용 CLI. 사용법: node src/cli.js YYYY-MM-DD HH:MM [tzOffsetMinutes=540] */
import { computeSajuPalja } from './manse.js';

const [date, time, tz] = process.argv.slice(2);
if (!date || !time) {
  console.error('사용법: node src/cli.js YYYY-MM-DD HH:MM [tzOffsetMinutes]');
  process.exit(2);
}
const [year, month, day] = date.split('-').map(Number);
const [hour, minute] = time.split(':').map(Number);

const r = await computeSajuPalja({ year, month, day, hour, minute, tzOffsetMinutes: tz ? +tz : 540 });
console.log(`사주팔자: ${r.palja.ko} (${r.palja.han})  · 사주년 ${r.sajuYear}`);
console.log(JSON.stringify(r, null, 2));
