/* 2단계 — 용신 산출 (명세서 §2 십신 대분류 · §4 강약 · §5 조후 · §6 결합 판정)
   입력은 1단계 pillars({year,month,day,hour} 각 {stem,branch}), 출력은 용신 오행 1개 + 파생 4신.
   배점·임계값·우선순위는 명리 휴리스틱 — 수치 변경은 기획 승인 하에만(§4~6). */
import { GAN_WX, JI_WX, SAMHAP, GANHAP } from './constants.js';

const gen = (a, b) => (a + 1) % 5 === b;  // a생b
const ctrl = (a, b) => (a + 2) % 5 === b; // a극b

/* §4 판정표 5단계. 문구 블록(A·B)의 키이자 화면 표시 라벨. */
export const LEVELS = ['strong', 'midStrong', 'neutral', 'midWeak', 'weak'];
export const LEVEL_LABEL = {
  strong: '신강',
  midStrong: '중화 (신강 쪽)',
  neutral: '중화',
  midWeak: '중화 (신약 쪽)',
  weak: '신약',
};
export const LEVEL_RANGE = {
  strong: '총점 3 이상',
  midStrong: '총점 1 ~ 2.9',
  neutral: '총점 −0.9 ~ 0.9',
  midWeak: '총점 −2.9 ~ −1',
  weak: '총점 −3 이하',
};

/* 오행 X가 일간 D에 대해 갖는 십신 대분류 (§2) */
export function catOf(X, D) {
  if (X === D) return '비겁';
  if (gen(X, D)) return '인성';
  if (gen(D, X)) return '식상';
  if (ctrl(D, X)) return '재성';
  if (ctrl(X, D)) return '관성';
  return '';
}

/* §4 강약(억부) 점수.

   판정이 두 갈래로 쓰이니 헷갈리지 말 것:
   - level(5단계): §4 판정표 그대로. **결과 문구 분기**에만 쓴다.
   - 억부 후보 방향(§6-1): yongsin()이 total을 직접 보고 3갈래(≥1 / −0.9~0.9 / ≤−1)로 나눈다.
     5단계가 3방향으로 접히는 것이라 모순이 아니다 — 신강·중화(신강 쪽)은 둘 다 설기·극,
     신약·중화(신약 쪽)은 둘 다 인성·비겁으로 같은 방향이기 때문. */
export function strength(P) {
  const D = GAN_WX[P.day.stem];
  let total = 0, s;
  const mw = JI_WX[P.month.branch]; // 득령
  if (mw === D) s = 3; else if (gen(mw, D)) s = 2; else if (gen(D, mw)) s = -1; else if (ctrl(D, mw)) s = -2; else s = -3;
  total += s;
  const jw = JI_WX[P.day.branch]; // 득지
  if (jw === D) s = 2; else if (gen(jw, D)) s = 1.5; else s = -1;
  total += s;
  for (const st of [P.year.stem, P.month.stem, P.hour.stem]) { // 득세
    const c = catOf(GAN_WX[st], D);
    total += (c === '비겁' || c === '인성') ? 1 : -0.5;
  }
  const branches = [P.year.branch, P.month.branch, P.day.branch, P.hour.branch];
  for (const h of SAMHAP) { // 삼합·반합
    const cnt = h.set.filter(x => branches.includes(x)).length;
    if (cnt >= 2) {
      const full = cnt === 3;
      const c = catOf(h.wx, D);
      total += (c === '비겁' || c === '인성') ? (full ? 1 : 0.5) : (full ? -1 : -0.5);
    }
  }
  const stems = [P.year.stem, P.month.stem, P.hour.stem];
  for (const gh of GANHAP) { // 천간합(일간 포함, 합화=일간 오행이면 강화)
    if ((gh[0] === P.day.stem && stems.includes(gh[1])) || (gh[1] === P.day.stem && stems.includes(gh[0]))) {
      if (gh[2] === D) total += 0.5;
    }
  }
  total = Math.round(total * 10) / 10;
  // §4 판정표 5단계 — 문구 분기 키(level)와 화면 표시 라벨(verdict)
  const level = total >= 3 ? 'strong' : total >= 1 ? 'midStrong'
    : total > -1 ? 'neutral' : total > -3 ? 'midWeak' : 'weak';
  const verdict = LEVEL_LABEL[level];
  // verdict3은 외부 만세력과 대조할 때만 쓰는 3분류(신강/중화/신약)
  const verdict3 = total >= 3 ? '신강' : total <= -3 ? '신약' : '중화';
  return { total, level, verdict, verdict3 };
}

/* §5 한난조습(조후) — need: 1(화, 한) / 4(수, 열) / −1(평) */
export function climate(P) {
  let net = 0;
  for (const p of [P.year, P.month, P.day, P.hour]) {
    const gw = GAN_WX[p.stem], jw = JI_WX[p.branch];
    if (gw === 1) net += 1; if (gw === 4) net -= 1;
    if (jw === 1) net += 1; if (jw === 4) net -= 1;
  }
  const mb = P.month.branch;
  if ([11, 0, 1].includes(mb)) net -= 2;       // 해자축 겨울
  else if ([5, 6, 7].includes(mb)) net += 2;   // 사오미 여름
  else if ([2, 3, 4].includes(mb)) net += 0.5; // 인묘진 봄
  else net -= 0.5;                             // 신유술 가을
  net = Math.round(net * 10) / 10;
  const need = net <= -2 ? 1 : net >= 2 ? 4 : -1;
  return { net, need };
}

/* §6 결합 판정 — 억부 우선 원칙(2026-08-14 개정): 억부 후보가 있으면 억부가 용신.
   단 조후가 지목한 오행이 억부 후보 안에 있으면 그것을 골라(both) 두 축이 함께 지지하게 한다.
   억부 후보가 없을 때(중화)만 조후가 용신이 된다. */
export function yongsin(P, st, cl) {
  const D = GAN_WX[P.day.stem];
  let abu = [];
  if (st.total >= 1) { const gwan = ((D - 2) % 5 + 5) % 5, jae = (D + 2) % 5, sik = (D + 1) % 5; abu = [gwan, jae, sik]; }
  else if (st.total <= -1) { const ins = ((D - 1) % 5 + 5) % 5; abu = [ins, D]; }
  const both = cl.need >= 0 && abu.includes(cl.need);

  let U, method;
  if (abu.length) {
    U = both ? cl.need : abu[0];  // 억부 우선. 조후와 겹치면 그 후보를 채택 (§6-2)
    method = 'eokbu';
  } else if (cl.need >= 0) {
    U = cl.need;                  // 중화 → 조후로 잡는다
    method = 'johu';
  } else {                        // 중화+평 → 가장 부족한 오행 보충
    const cnt = [0, 0, 0, 0, 0];
    for (const p of [P.year, P.month, P.day, P.hour]) { cnt[GAN_WX[p.stem]]++; cnt[JI_WX[p.branch]]++; }
    U = cnt.indexOf(Math.min(...cnt));
    method = 'balance';
  }
  const hee = ((U - 1) % 5 + 5) % 5;
  const gi = (U + 3) % 5;
  const gu = ((gi - 1) % 5 + 5) % 5;
  const han = [0, 1, 2, 3, 4].find(w => ![U, hee, gi, gu].includes(w));
  return { U, hee, gi, gu, han, both, method, abuList: abu };
}

/* 1단계 pillars → 2단계 전체 산출 */
export function computeYongsin(pillars) {
  const st = strength(pillars);
  const cl = climate(pillars);
  return { strength: st, climate: cl, yongsin: yongsin(pillars, st, cl) };
}
