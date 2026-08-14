/* 용신 불일치를 어느 단계에서 갈리는지 분류하는 공유 로직.
   analyze-yongsin-gap.mjs(콘솔 드릴다운)와 report-yongsin-sazu.mjs(HTML)가 함께 쓴다.

   분류 순서(먼저 갈리는 단계가 원인):
   ① 억부 방향  — 생조(인성·비겁) vs 억제(식상·재성·관성). 강약 판정이 갈린 것.
   ② 억부 후보  — 방향은 같은데 고른 오행이 다름. 후보 우선순위 산식 차이.
   ③ 조후 결합  — 억부용신은 같은데 최종 용신이 다름. 조후 개입 방식 차이.
   사주팔자가 다르면 그 아래는 전부 무의미하므로 별도 분류(0)로 뺀다. */
import { computeSajuPalja } from '../../src/manse.js';
import { computeYongsin, catOf } from '../../src/yongsin.js';
import { GAN_WX, WX_KO } from '../../src/constants.js';

export const STAGES = ['일치', '① 억부 방향 (강약 판정)', '② 억부 후보 순위', '③ 조후 결합', '0. 사주팔자 불일치'];

const dirOf = cat => (cat === '비겁' || cat === '인성') ? '생조' : cat ? '억제' : '—';
const wxIdx = ko => WX_KO.indexOf(ko);

/* 비교 JSON의 rows → 단계 분류가 붙은 rows */
export async function classify(rows) {
  const out = [];
  for (const r of rows) {
    const [year, month, day] = r.date.split('-').map(Number);
    const [hour, minute] = r.time.split(':').map(Number);
    const m = await computeSajuPalja({
      year, month, day, hour, minute, isFemale: r.gender === '여',
      useKasiIljin: false, termsProvider: 'astro',
    });
    const paljaMatch = m.palja.ko === r.palja.api;
    const { strength: st, climate: cl, yongsin: yg } = computeYongsin(m.pillars);
    const D = GAN_WX[m.pillars.day.stem];

    const ourEokbu = yg.abuList.length ? WX_KO[yg.abuList[0]] : null;
    const ourDir = yg.abuList.length ? dirOf(catOf(yg.abuList[0], D)) : '—(중화)';
    const apiDir = dirOf(catOf(wxIdx(r.yongsin.apiEokbu), D));
    const ourU = WX_KO[yg.U];

    let stage;
    if (!paljaMatch) stage = '0. 사주팔자 불일치';
    else if (ourU === r.yongsin.api) stage = '일치';
    else if (ourDir !== apiDir) stage = '① 억부 방향 (강약 판정)';
    else if (ourEokbu !== r.yongsin.apiEokbu) stage = '② 억부 후보 순위';
    else stage = '③ 조후 결합';

    out.push({
      no: r.no, date: r.date, time: r.time, gender: r.gender, paljaMatch, stage,
      ours: {
        palja: m.palja.ko, total: st.total, verdict: st.verdict, dir: ourDir,
        eokbu: ourEokbu, eokbuCat: ourEokbu ? catOf(wxIdx(ourEokbu), D) : null,
        johu: cl.need === 1 ? '화' : cl.need === 4 ? '수' : '평',
        U: ourU, method: yg.method, both: yg.both,
      },
      api: {
        palja: r.palja.api, score: r.strength.apiScore, strength: r.strength.api, dir: apiDir,
        eokbu: r.yongsin.apiEokbu, eokbuCat: catOf(wxIdx(r.yongsin.apiEokbu), D),
        johu: r.yongsin.apiJohu, U: r.yongsin.api, method: r.yongsin.apiMethod,
      },
      prevCause: r.yongsin.cause, // 정책 변경(조후 우선 → 억부 우선) 전 분류
    });
  }
  return out;
}

/* 분류 결과 요약 통계 */
export function summarize(rows) {
  const ok = rows.filter(r => r.paljaMatch);
  const tally = {};
  for (const r of ok) tally[r.stage] = (tally[r.stage] || 0) + 1;

  // ② 케이스에서 우리/SAZU가 고른 십신 대분류 패턴
  const catPattern = {};
  for (const r of ok.filter(x => x.stage === '② 억부 후보 순위')) {
    const k = `${r.ours.dir}|${r.ours.eokbuCat}|${r.api.eokbuCat}`;
    catPattern[k] = (catPattern[k] || 0) + 1;
  }
  // SAZU 점수 구간별 방향 (임계값 추정용)
  const bins = {};
  for (const r of ok) {
    const b = r.api.score < 45 ? '~44' : r.api.score < 50 ? '45~49' : r.api.score < 55 ? '50~54' : '55~';
    bins[b] ??= { 생조: 0, 억제: 0 };
    bins[b][r.api.dir]++;
  }
  // 우리가 중화로 억부를 비운 행
  const midOurs = ok.filter(r => r.ours.dir === '—(중화)');

  return {
    total: rows.length, onPalja: ok.length, tally,
    matched: tally['일치'] ?? 0,
    catPattern, bins,
    midOurs: { count: midOurs.length, matched: midOurs.filter(r => r.stage === '일치').length },
    prevPolicy: rows.filter(r => r.prevCause?.startsWith('정책 차이')),
  };
}
