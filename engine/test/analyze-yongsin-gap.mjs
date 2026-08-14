/* 용신 불일치 단계 분류 — 콘솔 드릴다운.
   사용: node test/analyze-yongsin-gap.mjs [비교JSON] [출력JSON]
   기본 입력: test/fixtures/sazu-compare-50.json */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify, summarize } from './lib/gap-analysis.mjs';

const IN = process.argv[2] || fileURLToPath(new URL('./fixtures/sazu-compare-50.json', import.meta.url));
const rows = await classify(JSON.parse(readFileSync(IN, 'utf8')).rows);
const s = summarize(rows);

console.log(`팔자 일치 ${s.onPalja}/${s.total}건 기준\n`);
console.log('■ 단계별 분류');
for (const [k, v] of Object.entries(s.tally).sort()) console.log(`   ${k.padEnd(22)} ${v}건`);

console.log(`\n■ 조후 우선 → 억부 우선 변경 효과 (이전 '정책 차이' ${s.prevPolicy.length}건)`);
for (const r of s.prevPolicy) {
  console.log(`   #${String(r.no).padStart(2)} ${r.date} ${r.time} | 우리 ${r.ours.U} / SAZU ${r.api.U} → ${r.stage === '일치' ? '✅ 일치로 전환' : '❌ ' + r.stage}`);
}

console.log('\n■ ② 억부 후보 순위 — 우리/SAZU가 고른 십신 대분류');
for (const [k, v] of Object.entries(s.catPattern).sort((a, b) => b[1] - a[1])) {
  const [dir, ours, api] = k.split('|');
  console.log(`   ${dir} 방향: 우리 ${ours} → SAZU ${api}   ${v}건`);
}

console.log('\n■ SAZU 점수 구간별 억부 방향 (임계값 추정)');
for (const [k, v] of Object.entries(s.bins).sort()) console.log(`   ${k.padEnd(6)} 생조 ${v.생조} · 억제 ${v.억제}`);

console.log(`\n■ 우리 중화 구간 처리: 억부를 비운 행 ${s.midOurs.count}건 중 용신 일치 ${s.midOurs.matched}건`);

console.log('\n■ 남은 불일치 상세');
for (const r of rows.filter(x => x.paljaMatch && x.stage !== '일치')) {
  console.log(`   #${String(r.no).padStart(2)} ${r.date} ${r.time} ${r.gender} | ${r.stage}`);
  console.log(`       강약  우리 ${r.ours.verdict}(${r.ours.total > 0 ? '+' : ''}${r.ours.total}) ${r.ours.dir}  /  SAZU ${r.api.strength}(${r.api.score}) ${r.api.dir}`);
  console.log(`       억부  우리 ${r.ours.eokbu ?? '없음'}${r.ours.eokbuCat ? `(${r.ours.eokbuCat})` : ''}  /  SAZU ${r.api.eokbu}(${r.api.eokbuCat})      조후  우리 ${r.ours.johu}  /  SAZU ${r.api.johu}`);
  console.log(`       용신  우리 ${r.ours.U}(${r.ours.method})  /  SAZU ${r.api.U}(${r.api.method})`);
}

if (process.argv[3]) {
  writeFileSync(process.argv[3], JSON.stringify({ rows, summary: s }, null, 2) + '\n');
  console.log('\nJSON 저장:', process.argv[3]);
}
