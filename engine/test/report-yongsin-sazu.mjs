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
        <td class="cause c-${r.B.cause === '일치' ? 'ok' : r.B.cause === '정책 차이' ? 'pol' : 'etc'}">${r.B.cause}</td>
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
    <div class="tile"><div class="k">용신</div><div class="v ju">${stat.onPaljaYongsin}<span style="font-size:15px">/${stat.onPalja}</span></div><div class="n">팔자 일치 행 한정</div></div>
    <div class="tile"><div class="k">용신 불일치 사유</div><div class="v" style="font-size:19px">정책 ${stat.policy} · 기타 ${stat.etc}</div><div class="n">조후 우선 vs 억부 우선</div></div>
  </div>

  <h2>발견 1 — 시각 경계가 30분 어긋나 있었다</h2>
  <div class="find">
    <h3>현행 설정(자시 23:30)으로는 사주팔자가 ${stat.paljaA}/${N}만 일치</h3>
    <p>같은 표본을 <b>자시 경계 23:00</b>으로 바꿔 계산하면 <b>${stat.paljaB}/${N}</b>로 올라간다.</p>
    <p>원인은 <b>보정 이중 적용</b>이다. 우리는 경도 보정 <code>−32분</code>을 적용한 위에 경계를 다시
      <code>+30분</code> 옮겨서, 자시가 KST <b>00:02</b>에 시작한다.
      SAZU의 한국 관습 모드는 경도 보정을 <code>−2분</code>만 적용하고 경계를 23:30에 두어 자시가 KST <b>23:32</b>에 시작한다.
      "자시 23:30"이라는 관습 자체가 경도 보정을 대신하는 근사치이므로, 둘을 함께 적용하면 30분이 밀린다.</p>
    <p>고치는 법: <code>engine/src/manse.js</code>의 <code>ZI_BOUNDARY</code>를 <code>23*60</code>으로.
      그러면 자시 시작이 KST 23:32가 되어 관습·진태양시 양쪽과 2분 이내로 맞는다.</p>
  </div>

  <h2>발견 2 — 용신 판정 정책이 서로 반대다</h2>
  <div class="find">
    <h3>억부와 조후가 다른 오행을 가리킬 때</h3>
    <p>우리 명세서 <b>§6-2는 조후 우선</b>("극한 한열은 생존 문제")이고,
      SAZU는 <b>억부 우선</b>이다. API 응답의 <code>reasoning</code>에 그대로 적혀 있다 —
      <i>"조후용신(화)과 불일치 → 억부 우선 채택"</i>.</p>
    <p>팔자가 일치하는 ${stat.onPalja}건 중 용신 불일치 ${stat.onPalja - stat.onPaljaYongsin}건을 뜯어보면
      <b>${stat.policy}건이 이 정책 차이</b>로 설명되고, 나머지 <b>${stat.etc}건</b>은 배점·임계값 차이 등 별도 원인이다.</p>
    <p>어느 쪽이 옳다기보다 <b>유파 선택의 문제</b>다. 다만 우리 결과가 시중 서비스와 다르게 나오는 이유가
      여기 있으므로, 기획이 §6-2를 유지할지 결정할 근거가 된다.</p>
  </div>

  <h2>전체 비교표</h2>
  <p class="sub">우리 값은 <b>경계 23:00</b> 설정 기준(발견 1 반영). 신강약 옆 작은 숫자는 점수(우리 −N~+N, SAZU 0~100).</p>
  <div class="table-scroll">
    <table>
      <thead><tr>
        <th>#</th><th>생년월일시</th><th>사주팔자 (우리)</th><th>사주팔자 (SAZU)</th><th>팔자</th>
        <th>신강 (우리)</th><th>신강 (SAZU)</th><th>용신 (우리)</th><th>용신 (SAZU)</th><th>용신 판정</th>
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
