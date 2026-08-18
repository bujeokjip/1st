/* 부적집 — 용신찾기 계산 화면 (engine 모듈 사용)
   브라우저 배포 모드: 일진 JDN 산술 + NASA JPL Horizons 절기 시각표(nasa) — 네트워크 호출 없음.
   (KASI·Horizons 둘 다 브라우저 CORS 차단이라, 절기는 빌드 시점에 받아 번들에 내장한다) */
import { computeSajuPalja } from '../../engine/src/manse.js';
import { computeYongsin } from '../../engine/src/yongsin.js';
import { LONGITUDE } from '../../engine/src/korea-time.js';
import { GAN, JI, GAN_KO, JI_KO, GAN_WX, JI_WX, WX_HAN, WX_KO } from '../../engine/src/constants.js';
import { PHRASES, WX_NAME, YONGSIN_INFO, INTRO } from './phrases.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ── 화면 네비게이션 ──
   입력·결과·오류를 별도 화면으로 두고, 브라우저 뒤로가기가 결과→입력으로 동작하도록
   history에 상태를 쌓는다(다시하기 버튼도 같은 경로를 탄다). */
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === `scr-${name}`));
  window.scrollTo(0, 0);
}
function goResult() {
  history.pushState({ screen: 'result' }, '', '#result');
  showScreen('result');
}
function goFind() {
  // 결과에서 넘어온 경우 뒤로가기로 되돌려 history가 쌓이지 않게 한다
  if (history.state?.screen === 'result') history.back();
  else { history.replaceState({ screen: 'find' }, '', '#'); showScreen('find'); }
}
window.addEventListener('popstate', e => showScreen(e.state?.screen === 'result' ? 'result' : 'find'));
history.replaceState({ screen: 'find' }, '', location.hash || '#');
$$('[data-go="find"]').forEach(b => b.addEventListener('click', goFind));

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
      useKasiIljin: false, termsProvider: 'nasa',
    });
    const { strength, climate, yongsin } = computeYongsin(saju.pillars);
    renderResult(saju, strength, climate, yongsin);
    goResult();
  } catch (err) {
    console.error(err);
    showError(); // §10-E 폴백
  } finally {
    btn.disabled = false;
  }
});

const pad = n => String(n).padStart(2, '0');

/* 계산 근거에 표시할 절기 출처 — 실제로 쓴 데이터만 적는다(engine 의 sources.terms) */
const TERMS_LABEL = {
  nasa: 'NASA JPL Horizons api 활용 (DE441)',
  'astro+nasa': 'NASA JPL Horizons api 활용 (DE441) · 일부 연도는 천문 계산',
  astro: '천문 계산 (Meeus)',
  'suseong-approx': '수성공식 근사 (경계 ±1일 오차 가능)',
};

function renderResult(saju, st, cl, yg) {
  const P = saju.pillars;

  // 사주팔자 4기둥
  const order = [['hour', '시주'], ['day', '일주'], ['month', '월주'], ['year', '년주']];
  $('#pillars').innerHTML = order.map(([k, tag]) => {
    const p = P[k];
    return `<div class="pillar${k === 'day' ? ' me' : ''}">
      <div class="ptag">${tag}</div>
      <div class="pglyph">${GAN[p.stem]}<br>${JI[p.branch]}</div>
      <div class="pko">${GAN_KO[p.stem]}${JI_KO[p.branch]}</div>
      <div class="pwx">${WX_KO[GAN_WX[p.stem]]}·${WX_KO[JI_WX[p.branch]]}</div>
    </div>`;
  }).join('');
  // 앞 페이지에서 입력한 값을 그대로 표시 (예: 1979년 2월 2일 오후 4시 45분 | 서울)
  const inp = saju.input;
  const ampm = inp.hour < 12 ? '오전' : '오후';
  const h12 = inp.hour % 12 === 0 ? 12 : inp.hour % 12;
  const timeStr = `${ampm} ${h12}시${inp.minute ? ` ${inp.minute}분` : ''}`;
  const cityName = selCity.selectedOptions[0]?.textContent ?? '';
  $('#paljaLine').textContent = `${inp.year}년 ${inp.month}월 ${inp.day}일 ${timeStr} | ${cityName}`;

  // 결과 문구 (§11) — 조립 순서: 한줄소개(F) → B(강약) → A(용신) → C(조후, 조건부)
  // ※ D(부적처방)는 결과 화면에서 제외 (기획 결정). PHRASES.D는 유지되나 렌더하지 않음.
  // ※ 빈 블록(작성 중)은 그 줄만 빼고 조립한다.
  const lines = [];
  // 한 줄 소개 (F_한줄소개): 계절=월지(지지), 색동물=일주 60갑자
  if (INTRO?.template) {
    let g60 = -1;
    for (let n = 0; n < 60; n++) if (n % 10 === P.day.stem && n % 12 === P.day.branch) { g60 = n; break; }
    const season = INTRO.season?.[P.month.branch] || '';
    const animal = g60 >= 0 ? (INTRO.ganzhi?.[g60] || '') : '';
    if (season && animal) lines.push(INTRO.template.replaceAll('{계절}', season).replaceAll('{색동물}', animal));
  }
  lines.push(PHRASES.B[st.level], PHRASES.A[yg.U]);
  if (cl.need === 1) lines.push(PHRASES.C.cold);
  else if (cl.need === 4) lines.push(PHRASES.C.hot);
  $('#rCopy').innerHTML = lines.filter(Boolean).map(t => fill(t, yg)).join('<br>');
  $('#rSoft').hidden = st.level !== 'neutral'; // §10-D 중화(−0.9~0.9)에만 붙는 안내
  $('#yongGlyph').textContent = WX_HAN[yg.U];

  // 용신 설명 — 키워드 칩만 표시 (제목·설명은 결과 화면에서 제외, 기획 결정 · 엑셀 E_용신설명 시트)
  const info = YONGSIN_INFO[yg.U];
  const box = $('#yongInfo');
  box.hidden = !info?.keywords?.length;
  if (info?.keywords?.length) {
    // 키워드 칩은 한 줄에 최대 3개씩 (3개 단위로 줄을 끊어 각 줄 가운데 정렬)
    const rows = [];
    for (let i = 0; i < info.keywords.length; i += 3) rows.push(info.keywords.slice(i, i + 3));
    box.innerHTML = `<div class="yi-kw">${rows.map(row =>
      `<div class="yi-kw-row">${row.map(k => `<span>${k}</span>`).join('')}</div>`).join('')}</div>`;
  }

  // 5신(용신·희신·기신·한신·구신) 칩 — 결과 화면에서 제외 (기획 결정)
  $('#gods').hidden = true;

  // 계산 근거 (§3-6 보정 내역 — 값이 어떻게 나왔는지 확인 가능하게)
  const t = saju.meta.time, s = saju.solarTime;
  const rows = [
    ['입력 시각', `${saju.input.year}-${pad(saju.input.month)}-${pad(saju.input.day)} ${pad(saju.input.hour)}:${pad(saju.input.minute)}`],
    ['진태양시', `${pad(s.hh)}:${pad(s.mi)} — 경도 보정 ${t.longitudeCorrection}분${t.dstMinutes ? ` + 서머타임 −${t.dstMinutes}분` : ''}`],
    ['일주 경계', s.earlyZi ? `자시(진태양시 ${pad(Math.floor(t.ziBoundaryMinutes / 60))}:${pad(t.ziBoundaryMinutes % 60)} 이후) — 다음 날 일주 적용` : '해당일 일주'],
    ['서머타임', t.dstMinutes ? '시행 기간 — 1시간 되돌림' : '해당 없음'],
    ['강약', `${st.total > 0 ? '+' : ''}${st.total} · ${st.verdict}`],
    ['조후', `${cl.net > 0 ? '+' : ''}${cl.net} · ${cl.need === 1 ? '한(寒)' : cl.need === 4 ? '열(熱)' : '평(平)'}`],
    ['절기 데이터', TERMS_LABEL[saju.meta.sources.terms] ?? saju.meta.sources.terms],
  ];
  $('#calcRows').innerHTML = rows.map(([k, v]) => `<div class="c-k">${k}</div><div class="c-v">${v}</div>`).join('');
}

/* ── 모달·폴백 ── */
$$('.overlay').forEach(ov => ov.addEventListener('click', e => {
  if (e.target === ov || e.target.closest('[data-close]')) ov.classList.remove('on');
}));
const showError = () => showScreen('error'); // §10-E
window.addEventListener('error', () => { try { showError(); } catch { /* noop */ } });
