/* compare-yongsin-sazu.js 결과 JSON → 고객용 HTML 리포트 생성.
   사용: node test/report-yongsin-sazu.mjs <비교JSON> [출력경로]
   출력 기본값: docs/우리엔진vsSAZU교차검증.html

   경계 B(23:00) 설정의 사주팔자·용신·신강약은 여기서 로컬 재계산한다(API 재호출 없음).
   비교 JSON에는 A(현행 경계) 기준 결과만 들어 있기 때문. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeSajuPalja } from '../src/manse.js';
import { computeYongsin } from '../src/yongsin.js';
import { WX_KO } from '../src/constants.js';
import { classify, summarize } from './lib/gap-analysis.mjs';

const IN = process.argv[2];
if (!IN) { console.error('사용: node test/report-yongsin-sazu.mjs <비교JSON> [출력경로]'); process.exit(2); }
// 경로에 한글이 있어 URL.pathname은 퍼센트 인코딩된다 — fileURLToPath로 디코딩
const OUT = process.argv[3] ?? fileURLToPath(new URL('../../docs/우리엔진vsSAZU교차검증.html', import.meta.url));

const src = JSON.parse(readFileSync(IN, 'utf8'));
const today = new Date().toISOString().slice(0, 10);

for (const r of src.rows) {
  const [year, month, day] = r.date.split('-').map(Number);
  const [hour, minute] = r.time.split(':').map(Number);
  const m = await computeSajuPalja({
    year, month, day, hour, minute, isFemale: r.gender === '여',
    useKasiIljin: false, termsProvider: 'astro', ziBoundaryMinutes: 23 * 60,
  });
  const y = computeYongsin(m.pillars);
  r.B = {
    palja: m.palja.ko, paljaMatch: m.palja.ko === r.palja.api,
    yongsin: WX_KO[y.yongsin.U], yongsinMatch: WX_KO[y.yongsin.U] === r.yongsin.api,
    strength: y.strength.verdict3, strengthMatch: y.strength.verdict3 === r.strength.api,
    total: y.strength.total,
  };
  // 팔자가 맞는 행에서만 용신 불일치 원인을 재분류 (팔자가 틀리면 용신 비교가 무의미)
  r.B.cause = !r.B.paljaMatch ? '팔자 불일치(비교 불가)'
    : r.B.yongsinMatch ? '일치'
      : (r.yongsin.apiMethod === 'eokbu' && r.yongsin.apiJohu && r.yongsin.apiEokbu
        && r.yongsin.apiJohu !== r.yongsin.apiEokbu && r.B.yongsin === r.yongsin.apiJohu)
        ? '정책 차이' : '기타';
}

/* 불일치 단계 분류 (현행 정책 = 억부 우선, 경계 23:00 기준) */
const gap = await classify(src.rows);
const g = summarize(gap);
const gapByNo = new Map(gap.map(r => [r.no, r]));

const N = src.rows.length;
const cnt = f => src.rows.filter(f).length;
const okB = src.rows.filter(r => r.B.paljaMatch);
const stat = {
  paljaA: cnt(r => r.palja.match), paljaB: cnt(r => r.B.paljaMatch),
  onPalja: okB.length,
  onPaljaYongsin: okB.filter(r => r.B.yongsinMatch).length,
  onPaljaStrength: okB.filter(r => r.B.strengthMatch).length,
  policy: cnt(r => r.B.cause === '정책 차이'),
  etc: cnt(r => r.B.cause === '기타'),
};

const pill = ok => `<span class="pill ${ok ? 'ok' : 'no'}">${ok ? '일치' : '불일치'}</span>`;
const tr = src.rows.map(r => `      <tr>
        <td class="num">${r.no}</td>
        <td class="num">${r.date} ${r.time}<span class="g">${r.gender}</span></td>
        <td class="gz">${r.B.palja}</td>
        <td class="gz">${r.palja.api}</td>
        <td>${pill(r.B.paljaMatch)}</td>
        <td class="wx">${r.B.strength}<span class="s">${r.B.total > 0 ? '+' : ''}${r.B.total}</span></td>
        <td class="wx">${r.strength.api}<span class="s">${r.strength.apiScore}</span></td>
        <td class="wx"><b>${r.B.yongsin}</b></td>
        <td class="wx"><b>${r.yongsin.api}</b></td>
        <td class="cause c-${gapByNo.get(r.no).stage === '일치' ? 'ok' : gapByNo.get(r.no).stage.startsWith('0') ? 'etc' : 'pol'}">${gapByNo.get(r.no).stage}</td>
      </tr>`).join('\n');

const html = `<title>용신 교차 검증 — 우리 엔진 × SAZU API</title>
<style>
  :root{
    --paper:#EAE5D8; --surface:#F2EDE0; --ink:#1D1813; --ink-soft:#5C5347;
    --line:#CBC1AA; --line-soft:#DAD2BE; --gold:#8A6F45; --ju:#A8352B; --ok:#2E6E4E;
    --ok-bg:rgba(46,110,78,.1); --no-bg:rgba(168,53,43,.1); --pol-bg:rgba(138,111,69,.14);
  }
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
    --paper:#241710; --surface:#2B1C12; --ink:#EFDCAE; --ink-soft:#C9A76A;
    --line:#4A3823; --line-soft:#3A2B19; --gold:#C9A76A; --ju:#E08070; --ok:#8FBF9F;
    --ok-bg:rgba(143,191,159,.12); --no-bg:rgba(224,128,112,.12); --pol-bg:rgba(201,167,106,.16);}}
  :root[data-theme="dark"]{
    --paper:#241710; --surface:#2B1C12; --ink:#EFDCAE; --ink-soft:#C9A76A;
    --line:#4A3823; --line-soft:#3A2B19; --gold:#C9A76A; --ju:#E08070; --ok:#8FBF9F;
    --ok-bg:rgba(143,191,159,.12); --no-bg:rgba(224,128,112,.12); --pol-bg:rgba(201,167,106,.16);}
  body{margin:0; background:var(--paper); color:var(--ink);
    font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;
    line-height:1.65; font-size:15px;}
  .wrap{max-width:1000px; margin:0 auto; padding:clamp(28px,6vw,60px) clamp(14px,4vw,30px) 70px;}
  .eyebrow{font-size:12px; letter-spacing:.32em; text-transform:uppercase; color:var(--gold); font-weight:700; margin:0 0 14px;}
  h1{font-family:'Nanum Myeongjo','AppleMyungjo','Batang',Georgia,serif;
     font-size:clamp(25px,5vw,36px); line-height:1.25; margin:0 0 10px; font-weight:700; text-wrap:balance;}
  h1 .ju{color:var(--ju);}
  .meta{color:var(--ink-soft); font-size:13.5px; margin:0 0 32px;}
  .meta b{color:var(--ink); font-weight:600;}
  h2{font-size:17px; margin:34px 0 12px; font-weight:700;}
  .fixed{display:inline-block; vertical-align:middle; margin-left:8px; font-size:11px; font-weight:700;
         letter-spacing:.08em; color:var(--ok); background:var(--ok-bg); border-radius:999px; padding:3px 10px;}
  p{margin:0 0 12px;} .sub{color:var(--ink-soft); font-size:14px;}

  .tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:0 0 8px;}
  .tile{background:var(--surface); border:1px solid var(--line); border-radius:4px; padding:14px 16px 12px;}
  .tile .k{font-size:11px; letter-spacing:.14em; color:var(--gold); font-weight:700;}
  .tile .v{font-family:'Nanum Myeongjo','AppleMyungjo','Batang',Georgia,serif;
           font-size:27px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; margin-top:2px;}
  .tile .v.ok{color:var(--ok);} .tile .v.ju{color:var(--ju);}
  .tile .n{font-size:11.5px; color:var(--ink-soft);}

  .find{background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--ju);
        border-radius:4px; padding:18px 20px; margin:0 0 16px;}
  .find h3{margin:0 0 8px; font-size:15px; font-weight:700;}
  .find p{margin:0 0 8px; font-size:14px; color:var(--ink-soft);}
  .find p:last-child{margin:0;} .find b{color:var(--ink);}
  code{font-family:ui-monospace,'SF Mono','D2Coding',Consolas,monospace; font-size:12.5px;
       background:var(--paper); border:1px solid var(--line-soft); border-radius:3px; padding:1px 5px;}

  .table-scroll{overflow-x:auto; border:1px solid var(--line); border-radius:4px; background:var(--surface);}
  table{border-collapse:collapse; width:100%; min-width:860px; font-size:13px;}
  thead th{position:sticky; top:0; background:var(--surface); color:var(--gold);
           font-size:10.5px; letter-spacing:.12em; text-align:left;
           padding:10px 10px; border-bottom:1px solid var(--line); white-space:nowrap;}
  td{padding:8px 10px; border-bottom:1px solid var(--line-soft); white-space:nowrap;}
  tbody tr:last-child td{border-bottom:0;}
  .num{font-variant-numeric:tabular-nums; color:var(--ink-soft);}
  .num .g{margin-left:6px; font-size:11px; color:var(--gold);}
  .gz{font-family:'Nanum Myeongjo','AppleMyungjo','Batang',Georgia,serif; font-size:14px;}
  .wx .s{margin-left:5px; font-size:11px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
  .pill{display:inline-block; font-size:11.5px; font-weight:700; border-radius:999px; padding:2px 10px;}
  .pill.ok{color:var(--ok); background:var(--ok-bg);} .pill.no{color:var(--ju); background:var(--no-bg);}
  .cause{font-size:11.5px;}
  .c-ok{color:var(--ok);} .c-pol{color:var(--gold); background:var(--pol-bg);} .c-etc{color:var(--ju);}
  footer{margin-top:28px; padding-top:14px; border-top:1px solid var(--line);
         color:var(--ink-soft); font-size:12.5px; line-height:1.8;}
</style>
<div class="wrap">
  <p class="eyebrow">부적집 · 용신 엔진 검증 리포트</p>
  <h1>용신·신강약 교차 검증<br>우리 엔진 × <span class="ju">SAZU 만세력 API</span></h1>
  <p class="meta">수행일 <b>${today}</b> · 표본 <b>${N}건</b>(1930~2010 무작위, 고정 시드) · 비교 기준 <b>trueSolarTime=false</b>(한국 관습) · 서울</p>

  <div class="tiles">
    <div class="tile"><div class="k">사주팔자</div><div class="v ok">${stat.paljaB}<span style="font-size:15px">/${N}</span></div><div class="n">경계 23:00 기준</div></div>
    <div class="tile"><div class="k">신강약</div><div class="v">${stat.onPaljaStrength}<span style="font-size:15px">/${stat.onPalja}</span></div><div class="n">팔자 일치 행 한정</div></div>
    <div class="tile"><div class="k">용신</div><div class="v ju">${g.matched}<span style="font-size:15px">/${g.onPalja}</span></div><div class="n">억부 우선 정책 적용 후</div></div>
    <div class="tile"><div class="k">불일치 단계</div><div class="v" style="font-size:18px">①${g.tally['① 억부 방향 (강약 판정)'] ?? 0} ②${g.tally['② 억부 후보 순위'] ?? 0} ③${g.tally['③ 조후 결합'] ?? 0}</div><div class="n">방향 · 후보순위 · 조후결합</div></div>
  </div>

  <h2>발견 1 — 시각 경계가 30분 어긋나 있었다 <span class="fixed">수정 완료</span></h2>
  <div class="find">
    <h3>검증 당시 설정(자시 23:30)으로는 사주팔자가 ${stat.paljaA}/${N}만 일치</h3>
    <p>같은 표본을 <b>자시 경계 23:00</b>으로 바꿔 계산하면 <b>${stat.paljaB}/${N}</b>로 올라간다.</p>
    <p>원인은 <b>보정 이중 적용</b>이었다. 경도 보정 <code>−32분</code>을 적용한 위에 경계를 다시
      <code>+30분</code> 옮겨서, 자시가 KST <b>00:02</b>에 시작하고 있었다.
      SAZU의 한국 관습 모드는 경도 보정을 <code>−2분</code>만 적용하고 경계를 23:30에 두어 자시가 KST <b>23:32</b>에 시작한다.
      "자시 23:30"이라는 관습 자체가 경도 보정을 대신하는 근사치이므로, 둘을 함께 적용하면 30분이 밀린다.</p>
    <p><b>조치</b>: <code>engine/src/manse.js</code>의 <code>ZI_BOUNDARY</code>를 <code>23*60</code>으로 되돌렸다.
      자시 시작이 KST 23:32가 되어 관습·진태양시 양쪽과 2분 이내로 맞는다.
      아래 표의 "우리" 열은 이미 이 수정이 반영된 값이다.</p>
  </div>

  <h2>발견 2 — 용신 판정 정책이 서로 반대였다 <span class="fixed">억부 우선으로 변경</span></h2>
  <div class="find">
    <h3>억부와 조후가 다른 오행을 가리킬 때</h3>
    <p>초판 명세서 <b>§6-2는 조후 우선</b>("극한 한열은 생존 문제")이었고,
      SAZU는 <b>억부 우선</b>이다. API 응답의 <code>reasoning</code>에 그대로 적혀 있다 —
      <i>"조후용신(화)과 불일치 → 억부 우선 채택"</i>.</p>
    <p><b>조치</b>: 기획 결정으로 §6-2를 <b>억부 우선</b>으로 뒤집었다. 억부 후보가 없을 때(중화)만 조후가 용신이 된다.</p>
    <p>다만 이 변경만으로 일치율이 크게 오르진 않았다. 변경 전 "정책 차이"로 분류됐던 ${g.prevPolicy.length}건 중
      <b>${g.prevPolicy.filter(r => r.stage === '일치').length}건만 일치로 전환</b>됐고, 나머지는 아래 발견 3의 다른 단계에서 갈렸다.
      용신 일치는 ${stat.onPaljaYongsin} → <b>${g.matched}</b>/${g.onPalja}건.</p>
  </div>

  <h2>발견 3 — 남은 불일치는 어느 단계에서 갈리나</h2>
  <p class="sub">억부 우선으로 바꾼 뒤에도 남는 차이를, 파이프라인에서 <b>먼저 갈리는 단계</b> 기준으로 분류했다(팔자 일치 ${g.onPalja}건).</p>
  <div class="table-scroll" style="margin-bottom:16px">
    <table style="min-width:auto">
      <thead><tr><th>단계</th><th>건수</th><th>무엇이 다른가</th></tr></thead>
      <tbody>
        <tr><td><b>일치</b></td><td class="num">${g.tally['일치'] ?? 0}</td><td>—</td></tr>
        <tr><td><b>① 억부 방향</b></td><td class="num">${g.tally['① 억부 방향 (강약 판정)'] ?? 0}</td><td>생조냐 억제냐가 갈린다 — 강약 판정 차이</td></tr>
        <tr><td><b>② 억부 후보 순위</b></td><td class="num">${g.tally['② 억부 후보 순위'] ?? 0}</td><td>방향은 같은데 고른 오행이 다르다</td></tr>
        <tr><td><b>③ 조후 결합</b></td><td class="num">${g.tally['③ 조후 결합'] ?? 0}</td><td>억부용신은 같은데 조후 개입 방식이 다르다</td></tr>
      </tbody>
    </table>
  </div>

  <div class="find">
    <h3>② 억부 후보 순위 ${g.tally['② 억부 후보 순위'] ?? 0}건 — 원인이 하나로 수렴한다</h3>
    <p>해당 케이스가 <b>전부 같은 패턴</b>이다: 신강(억제) 방향에서
      <b>우리는 관성(극)</b>, <b>SAZU는 식상(설기)</b>을 1순위로 고른다.</p>
    <p>명세서 §6-1의 신강 계열 후보 배열이 <code>[관성, 재성, 식상]</code>이기 때문이다.
      신강한 일간을 극으로 누를지 설기로 흘릴지는 <b>유파 차이</b>라 어느 쪽이 틀렸다고 할 수 없다.
      바꾸려면 배열 순서만 <code>[식상, 재성, 관성]</code>으로 조정하면 되지만 기획 승인 사항이다.</p>
  </div>

  <div class="find">
    <h3>① 억부 방향 ${g.tally['① 억부 방향 (강약 판정)'] ?? 0}건 — 중화 구간 처리가 통째로 다르다</h3>
    <p>SAZU의 강약 점수는 0~100이고 <b>50점을 경계로 생조/억제가 깔끔하게 갈린다</b>:</p>
    <p>${Object.entries(g.bins).sort().map(([k, v]) => `<code>${k}점</code> 생조 ${v.생조} · 억제 ${v.억제}`).join(' &nbsp;/&nbsp; ')}</p>
    <p>우리는 −0.9~0.9를 <b>중화로 보고 억부 후보를 아예 비운다</b>(${g.midOurs.count}건).
      그 ${g.midOurs.count}건 중 용신이 일치한 건 ${g.midOurs.matched}건뿐이다.
      SAZU는 같은 행에서 모두 억부용신을 낸다 — 중화를 "판단 보류"로 볼지 "50점 기준 이분"으로 볼지의 차이다.</p>
  </div>

  <h2>전체 비교표</h2>
  <p class="sub">우리 값은 <b>경계 23:00</b>(발견 1 수정 반영) 기준. 신강약 옆 작은 숫자는 점수(우리 −N~+N, SAZU 0~100).</p>
  <div class="table-scroll">
    <table>
      <thead><tr>
        <th>#</th><th>생년월일시</th><th>사주팔자 (우리)</th><th>사주팔자 (SAZU)</th><th>팔자</th>
        <th>신강 (우리)</th><th>신강 (SAZU)</th><th>용신 (우리)</th><th>용신 (SAZU)</th><th>불일치 단계</th>
      </tr></thead>
      <tbody>
${tr}
      </tbody>
    </table>
  </div>

  <footer>
    표본: 고정 시드 LCG로 생성한 1930~2010년 무작위 ${N}건(1번은 §9 회귀 케이스). 전 표본 서울·양력.<br>
    재현: <code>cd engine &amp;&amp; node test/compare-yongsin-sazu.js out.json ${N} &amp;&amp; node test/report-yongsin-sazu.mjs out.json</code>
  </footer>
</div>
`;

writeFileSync(OUT, html);
console.log(JSON.stringify(stat, null, 1));
console.log('생성:', OUT);
