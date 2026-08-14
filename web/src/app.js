/* 부적집 — 용신찾기 계산 화면 (engine 모듈 사용)
   브라우저 배포 모드: 일진 JDN 산술 + 절기 천문 계산(astro) — 네트워크 호출 없음.
   (KASI API는 브라우저 CORS 차단. 절입 오차 ±8분은 허용 정책, §3-3) */
import { computeSajuPalja } from '../../engine/src/manse.js';
import { computeYongsin } from '../../engine/src/yongsin.js';
import { LONGITUDE } from '../../engine/src/korea-time.js';
import { GAN, JI, GAN_KO, JI_KO, GAN_WX, JI_WX, WX_HAN, WX_KO } from '../../engine/src/constants.js';
import { PHRASES, WX_NAME } from './phrases.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* 태어난 도시 → 경도(§3-6). 이전 프로토타입에선 UI만 있고 계산에 반영되지 않았으나,
   경도 보정이 기본 ON이 되면서 실제로 결과에 반영된다. */
const CITIES = [
  ['서울', LONGITUDE.서울], ['인천', LONGITUDE.인천], ['경기(수원)', LONGITUDE.수원],
  ['강원(춘천)', LONGITUDE.춘천], ['대전·충청', LONGITUDE.대전], ['광주·전라', LONGITUDE.광주],
  ['대구·경북', LONGITUDE.대구], ['부산·울산·경남', LONGITUDE.부산], ['제주', LONGITUDE.제주],
];

/* ── 입력 폼 (§10-B: 드롭다운 제약으로 잘못된 값 원천 차단) ── */
function fillSelect(sel, items, selected) {
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.v; o.textContent = it.t;
    if (String(selected) === String(it.v)) o.selected = true;
    sel.appendChild(o);
  }
}
const selY = $('#selY'), selM = $('#selM'), selD = $('#selD');
const selH = $('#selH'), selMin = $('#selMin'), selCity = $('#selCity');
const NOW_Y = new Date().getFullYear();

fillSelect(selY, Array.from({ length: NOW_Y - 1900 + 1 }, (_, i) => ({ v: NOW_Y - i, t: (NOW_Y - i) + '년' })), NOW_Y);
fillSelect(selM, Array.from({ length: 12 }, (_, i) => ({ v: i + 1, t: (i + 1) + '월' })), 1);
fillSelect(selH, Array.from({ length: 24 }, (_, i) => ({ v: i, t: String(i).padStart(2, '0') + '시' })));
fillSelect(selMin, Array.from({ length: 60 }, (_, i) => ({ v: i, t: String(i).padStart(2, '0') + '분' })), 0);
fillSelect(selCity, CITIES.map(([t, v]) => ({ v, t })), LONGITUDE.서울);

function refreshDays() {
  const last = new Date(+selY.value, +selM.value, 0).getDate();
  const keep = Math.min(+selD.value || 1, last);
  selD.innerHTML = '';
  fillSelect(selD, Array.from({ length: last }, (_, i) => ({ v: i + 1, t: (i + 1) + '일' })), keep);
}
selY.addEventListener('change', refreshDays);
selM.addEventListener('change', refreshDays);
refreshDays();

/* ── 계산 → 렌더 ── */
const fill = (tpl, r) => tpl
  .replaceAll('{용신}', WX_NAME[r.U]).replaceAll('{기신}', WX_NAME[r.gi]).replaceAll('{희신}', WX_NAME[r.hee]);

$('#btnFind').addEventListener('click', async () => {
  if (selH.value === '') { $('#ovTime').classList.add('on'); return; } // §10-A 시각 필수
  const btn = $('#btnFind');
  btn.disabled = true;
  try {
    const saju = await computeSajuPalja({
      year: +selY.value, month: +selM.value, day: +selD.value,
      hour: +selH.value, minute: +selMin.value,
      longitudeDeg: +selCity.value,
      useKasiIljin: false, termsProvider: 'astro',
    });
    const { strength, climate, yongsin } = computeYongsin(saju.pillars);
    renderResult(saju, strength, climate, yongsin);
    $('#result').hidden = false;
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    showError(); // §10-E 폴백
  } finally {
    btn.disabled = false;
  }
});

const pad = n => String(n).padStart(2, '0');

function renderResult(saju, st, cl, yg) {
  const P = saju.pillars;

  // 사주팔자 4기둥
  const order = [['year', '년주'], ['month', '월주'], ['day', '일주'], ['hour', '시주']];
  $('#pillars').innerHTML = order.map(([k, tag]) => {
    const p = P[k];
    return `<div class="pillar${k === 'day' ? ' me' : ''}">
      <div class="ptag">${tag}</div>
      <div class="pglyph">${GAN[p.stem]}<br>${JI[p.branch]}</div>
      <div class="pko">${GAN_KO[p.stem]}${JI_KO[p.branch]}</div>
      <div class="pwx">${WX_KO[GAN_WX[p.stem]]}·${WX_KO[JI_WX[p.branch]]}</div>
    </div>`;
  }).join('');
  $('#paljaLine').textContent = `${saju.palja.ko} · ${saju.sajuYear}년주 기준 (일간 ${saju.dayMaster.ko})`;

  // 결과 문구 (§11 — 조립 순서 B→A→C→D)
  const lines = [fill(PHRASES.B[st.band], yg), fill(PHRASES.A[st.band], yg)];
  if (cl.need === 1) lines.push(PHRASES.C.cold);
  else if (cl.need === 4) lines.push(PHRASES.C.hot);
  lines.push(fill(PHRASES.D[yg.U], yg));
  $('#rCopy').innerHTML = lines.join('<br>');
  $('#rSoft').hidden = st.band !== 'mid'; // §10-D 중화 소프트 안내
  $('#yongGlyph').textContent = WX_HAN[yg.U];

  // 5신
  const gods = [['용신', yg.U, true], ['희신', yg.hee], ['기신', yg.gi], ['한신', yg.han], ['구신', yg.gu]];
  $('#gods').innerHTML = gods.map(([nm, w, main]) =>
    `<div class="god${main ? ' main' : ''}"><span class="g-nm">${nm}</span><span class="g-wx">${WX_KO[w]} ${WX_HAN[w]}</span></div>`,
  ).join('');

  // 계산 근거 (§3-6 보정 내역 — 값이 어떻게 나왔는지 확인 가능하게)
  const t = saju.meta.time, s = saju.solarTime;
  const rows = [
    ['입력 시각', `${saju.input.year}-${pad(saju.input.month)}-${pad(saju.input.day)} ${pad(saju.input.hour)}:${pad(saju.input.minute)}`],
    ['진태양시', `${pad(s.hh)}:${pad(s.mi)} — 경도 보정 ${t.longitudeCorrection}분${t.dstMinutes ? ` + 서머타임 −${t.dstMinutes}분` : ''}`],
    ['일주 경계', s.earlyZi ? '조자시(23:30 이후) — 다음 날 일주 적용' : s.lateZi ? '야자시(23:00~23:29) — 시지만 자시, 일주는 당일' : '해당일 일주'],
    ['서머타임', t.dstMinutes ? '시행 기간 — 1시간 되돌림' : '해당 없음'],
    ['강약 / 조후', `${st.total > 0 ? '+' : ''}${st.total} (${{ strong: '신강쪽', mid: '중화', weak: '신약쪽' }[st.band]}) / ${cl.net > 0 ? '+' : ''}${cl.net} (${cl.need === 1 ? '한' : cl.need === 4 ? '열' : '평'})`],
    ['절기 데이터', '천문 계산 (허용 오차 ±8분)'],
  ];
  $('#calcRows').innerHTML = rows.map(([k, v]) => `<div class="c-k">${k}</div><div class="c-v">${v}</div>`).join('');
}

/* ── 모달·폴백 ── */
$$('.overlay').forEach(ov => ov.addEventListener('click', e => {
  if (e.target === ov || e.target.closest('[data-close]')) ov.classList.remove('on');
}));
function showError() {
  $('#scr-main').hidden = true;
  $('#scr-error').hidden = false;
}
$('#btnErrHome').addEventListener('click', () => {
  $('#scr-error').hidden = true;
  $('#scr-main').hidden = false;
  $('#result').hidden = true;
});
window.addEventListener('error', () => { try { showError(); } catch { /* noop */ } });
