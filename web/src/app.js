/* 부적집 — 용신찾기 계산 화면 (engine 모듈 사용)
   브라우저 배포 모드: 일진 JDN 산술 + NASA JPL Horizons 절기 시각표(nasa) — 네트워크 호출 없음.
   (KASI·Horizons 둘 다 브라우저 CORS 차단이라, 절기는 빌드 시점에 받아 번들에 내장한다) */
import { computeSajuPalja } from '../../engine/src/manse.js';
import { computeYongsin } from '../../engine/src/yongsin.js';
import { LONGITUDE } from '../../engine/src/korea-time.js';
import { GAN, JI, GAN_KO, JI_KO, WX_HAN } from '../../engine/src/constants.js';
import { PHRASES, WX_NAME, YONGSIN_INFO, INTRO } from './phrases.js';
import KoreanLunarCalendar from 'korean-lunar-calendar'; // 음력→양력 변환 (KASI 데이터 기반, 오프라인)

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
  // 음력 달은 29~30일 — 체크 시 30일까지 열고, 실재 여부는 찾기 시점에 변환으로 검증한다
  const last = chkLunar.checked ? 30 : new Date(+selY.value, +selM.value, 0).getDate();
  const keep = Math.min(+selD.value || 1, last);
  selD.innerHTML = '';
  fillSelect(selD, Array.from({ length: last }, (_, i) => ({ v: i + 1, t: (i + 1) + '일' })), keep);
}
selY.addEventListener('change', refreshDays);
selM.addEventListener('change', refreshDays);

/* ── 음력 입력 (체크 시 음력→양력 변환 후 만세력 계산) ── */
const chkLunar = $('#chkLunar'), chkLeap = $('#chkLeap');
chkLunar.addEventListener('change', () => {
  $('#leapWrap').hidden = !chkLunar.checked;
  if (!chkLunar.checked) chkLeap.checked = false;
  refreshDays();
});
refreshDays();

/* 음력→양력. 성공 시 {year, month, day}, 실패(없는 날짜·없는 윤달) 시 null */
function lunarToSolar(y, m, d, leap) {
  const cal = new KoreanLunarCalendar();
  return cal.setLunarDate(y, m, d, leap) ? cal.getSolarCalendar() : null;
}

/* ── 계산 → 렌더 ── */
const fill = (tpl, r) => tpl
  .replaceAll('{용신}', WX_NAME[r.U]).replaceAll('{기신}', WX_NAME[r.gi]).replaceAll('{희신}', WX_NAME[r.hee]);

$('#btnFind').addEventListener('click', async () => {
  if (selH.value === '') { $('#ovTime').classList.add('on'); return; } // §10-A 시각 필수

  // 음력 입력이면 양력으로 변환해 계산한다. 표시용 원본 입력은 따로 보관.
  let y = +selY.value, m = +selM.value, d = +selD.value;
  let lunarInput = null; // {year, month, day, leap} — 음력 체크 시에만
  if (chkLunar.checked) {
    const solar = lunarToSolar(y, m, d, chkLeap.checked);
    if (!solar) {
      $('#lunarErrBody').innerHTML = chkLeap.checked
        ? `음력 ${y}년 ${m}월은 윤달이 없거나, 그 윤달에 없는 날짜예요.<br>날짜나 윤달 체크를 다시 확인해주세요.`
        : `음력 ${y}년 ${m}월 ${d}일은 없는 날짜예요.<br>날짜를 다시 확인해주세요.`;
      $('#ovLunar').classList.add('on');
      return;
    }
    lunarInput = { year: y, month: m, day: d, leap: chkLeap.checked };
    ({ year: y, month: m, day: d } = solar);
  }

  const btn = $('#btnFind');
  btn.disabled = true;
  try {
    const saju = await computeSajuPalja({
      year: y, month: m, day: d,
      hour: +selH.value, minute: +selMin.value,
      longitudeDeg: +selCity.value,
      useKasiIljin: false, termsProvider: 'nasa',
    });
    const { strength, climate, yongsin } = computeYongsin(saju.pillars);
    renderResult(saju, strength, climate, yongsin, lunarInput);
    $('#revealWrap').classList.add('hidden'); // 결과 본문은 가려둔 채 시작 → [결과보기]로 공개
    goResult();
    // 버튼이 큰 용신 한자 정중앙에 오도록, 결과 화면이 그려진 뒤(다음 프레임) 글자 중심 위치를 재서 CSS 변수로 전달
    requestAnimationFrame(() => {
      const wrapTop = $('#revealWrap').getBoundingClientRect().top;
      const g = $('#yongGlyph').getBoundingClientRect();
      $('#revealWrap').style.setProperty('--glyph-center', `${Math.round(g.top - wrapTop + g.height / 2)}px`);
    });
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

function renderResult(saju, st, cl, yg, lunarInput = null) {
  const P = saju.pillars;

  // 사주팔자 4기둥
  const order = [['hour', '시주'], ['day', '일주'], ['month', '월주'], ['year', '년주']];
  $('#pillars').innerHTML = order.map(([k, tag]) => {
    const p = P[k];
    return `<div class="pillar${k === 'day' ? ' me' : ''}">
      <div class="ptag">${tag}</div>
      <div class="pglyph">${GAN[p.stem]}<br>${JI[p.branch]}</div>
      <div class="pko">${GAN_KO[p.stem]}${JI_KO[p.branch]}</div>
    </div>`;
  }).join('');
  // 앞 페이지에서 입력한 값을 그대로 표시 (예: 1979년 2월 2일 오후 4시 45분 | 서울)
  // 음력으로 입력했다면 입력한 음력 날짜에 '음력' 표기를 붙인다 (계산은 변환된 양력 기준)
  const inp = saju.input;
  const ampm = inp.hour < 12 ? '오전' : '오후';
  const h12 = inp.hour % 12 === 0 ? 12 : inp.hour % 12;
  const timeStr = `${ampm} ${h12}시${inp.minute ? ` ${inp.minute}분` : ''}`;
  const cityName = selCity.selectedOptions[0]?.textContent ?? '';
  const dateStr = lunarInput
    ? `음력 ${lunarInput.year}년 ${lunarInput.leap ? '윤' : ''}${lunarInput.month}월 ${lunarInput.day}일`
    : `${inp.year}년 ${inp.month}월 ${inp.day}일`;
  $('#paljaLine').textContent = `${dateStr} ${timeStr} | ${cityName}`;

  // 한 줄 소개 (F_한줄소개) — 제목 영역 "찾았어요!" 아래에 표시. 계절=월지(지지), 색동물=일주 60갑자
  let intro = '';
  if (INTRO?.template) {
    let g60 = -1;
    for (let n = 0; n < 60; n++) if (n % 10 === P.day.stem && n % 12 === P.day.branch) { g60 = n; break; }
    const season = INTRO.season?.[P.month.branch] || '';
    const animal = g60 >= 0 ? (INTRO.ganzhi?.[g60] || '') : '';
    if (season && animal) {
      const daeju = ` - ${GAN[P.day.stem]}${JI[P.day.branch]}(${GAN_KO[P.day.stem]}${JI_KO[P.day.branch]})일주`;
      // 색동물 앞에 모바일 전용 줄바꿈: 폰에선 [계절] / [색동물 - 일주] 두 줄, 태블릿 이상은 한 줄
      intro = INTRO.template
        .replaceAll('{계절}', season)
        .replaceAll('{색동물}', `<br class="br-intro-m">${animal}`) + daeju;
    }
  }
  $('#rIntro').innerHTML = intro; // INTRO는 넘버스(기획 소유) 콘텐츠 — 줄바꿈 태그 삽입 위해 innerHTML

  // 결과 문구 (§11) — 네 섹션: POWER(용신 A) · BALANCE(강약 B) · CLIMATE(조후 D) · RITUAL(조후 E)
  // ※ A·B·C 후보 배열에서 매번 랜덤 1개. 빈 블록(작성 중/조후 생략)은 그 섹션 통째로 뺀다.
  // ※ D(부적처방)는 결과 화면에서 제외 (기획 결정). PHRASES.D는 유지되나 렌더하지 않음.
  const pick = arr => Array.isArray(arr) ? (arr.length ? arr[Math.floor(Math.random() * arr.length)] : '') : arr;
  const cKey = cl.need === 1 ? 'cold' : cl.need === 4 ? 'hot' : 'mild'; // 한/열/평
  // C는 [CLIMATE(D열), RITUAL(E열)] 한 쌍 — 같은 행을 골라 CLIMATE·RITUAL에 나눠 쓴다
  const cPair = pick(PHRASES.C[cKey]) || ['', ''];
  const sections = [
    ['YOUR POWER', pick(PHRASES.A[yg.U])],
    ['YOUR BALANCE', pick(PHRASES.B[st.level])],
    ['YOUR CLIMATE', cPair[0]],
    ['YOUR RITUAL', cPair[1]],
  ];
  $('#rCopy').innerHTML = sections
    .filter(([, body]) => body)
    .map(([title, body]) => `<div class="r-sec"><p class="r-sec-t">${title}</p><p class="r-sec-b">${fill(body, yg)}</p></div>`)
    .join('');
  // §10-D 중화 소프트 안내는 별도 하드코딩 없이 B_강약진단 neutral 문구(넘버스)가 담당한다 (2026-08-18 기획 결정)
  $('#yongGlyph').textContent = WX_HAN[yg.U];

  // 용신 설명 — 키워드 칩만 표시 (제목·설명은 결과 화면에서 제외, 기획 결정 · 엑셀 E_용신설명 시트)
  const info = YONGSIN_INFO[yg.U];
  const box = $('#yongInfo');
  box.hidden = !info?.keywords?.length;
  if (info?.keywords?.length) renderKeywords(info.keywords);

  // 5신(용신·희신·기신·한신·구신) 칩 — 결과 화면에서 제외 (기획 결정)
  $('#gods').hidden = true;

  // 계산 근거 (§3-6 보정 내역 — 값이 어떻게 나왔는지 확인 가능하게)
  const t = saju.meta.time, s = saju.solarTime;
  const rows = [
    ...(lunarInput ? [['음력 입력', `음력 ${lunarInput.year}-${pad(lunarInput.month)}-${pad(lunarInput.day)}${lunarInput.leap ? ' (윤달)' : ''} → 양력 ${saju.input.year}-${pad(saju.input.month)}-${pad(saju.input.day)} 변환 (KASI 음양력 데이터)`]] : []),
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

/* 키워드 칩 — 후보 개수와 상관없이 매번 랜덤 7개 (기획 결정 · 후보는 쉼표로 넣음).
   맨 오른쪽 ↻ 버튼을 누르면 다른 건 그대로 두고 키워드만 다시 뽑는다. */
function renderKeywords(all) {
  const cleaned = all.map(k => k.trim()).filter(Boolean);
  // 첫 칩은 항상 E시트 키워드열의 맨 앞 값으로 고정 (예: "행운의 컬러 : OO"), 나머지 6개만 랜덤
  const first = cleaned[0];
  const rest = [...new Set(cleaned.slice(1))].filter(k => k !== first);
  const restShown = rest.sort(() => Math.random() - 0.5).slice(0, 6);
  const shown = first ? [first, ...restShown] : restShown;
  // 칩은 폭에 맞춰 자연스럽게 줄바꿈, 각 줄 가운데 정렬 (CSS .yi-kw flex-wrap)
  // 마지막 칩과 ↻를 한 덩어리(.yi-last)로 묶어 ↻가 혼자 다음 줄로 떨어지지 않게 한다
  const chips = shown.map(k => `<span>${k}</span>`);
  const last = chips.pop() ?? '';
  $('#yongInfo').innerHTML = `<div class="yi-kw">${chips.join('')}` +
    `<span class="yi-last">${last}<button class="yi-refresh" type="button" aria-label="키워드 다시 뽑기" title="다른 키워드 보기">↻</button></span></div>`;
  $('#yongInfo .yi-refresh').addEventListener('click', e => {
    e.currentTarget.classList.add('spin');
    setTimeout(() => renderKeywords(all), 180); // 살짝 돌고 나서 교체
  });
  fitKeywordsOneLine();
}

/* 태블릿 이상(>600px)에선 7개 + ↻가 반드시 한 줄. 넘치면 칩 크기를 한 단계씩 줄여 맞춘다 (모바일은 줄바꿈 허용) */
function fitKeywordsOneLine() {
  const kw = $('#yongInfo .yi-kw');
  if (!kw || matchMedia('(max-width: 600px)').matches) return;
  const steps = ['tight', 'tighter', 'tightest'];
  kw.classList.remove(...steps);
  const fits = () => kw.scrollWidth <= kw.parentElement.clientWidth;
  for (const cls of steps) {
    if (fits()) return;
    kw.classList.remove(...steps);
    kw.classList.add(cls);
  }
}
window.addEventListener('resize', fitKeywordsOneLine);

/* ── 공개 연출: [결과보기]를 누르면 블러가 걷히며 본문이 드러난다 ── */
$('#btnReveal').addEventListener('click', () => {
  $('#revealWrap').classList.remove('hidden');
  // 드러나는 본문 상단(용신 글자)으로 시선 이동
  setTimeout(() => $('#yongGlyph')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
});

/* ── 모달·폴백 ── */
$$('.overlay').forEach(ov => ov.addEventListener('click', e => {
  if (e.target === ov || e.target.closest('[data-close]')) ov.classList.remove('on');
}));
const showError = () => showScreen('error'); // §10-E
window.addEventListener('error', () => { try { showError(); } catch { /* noop */ } });
