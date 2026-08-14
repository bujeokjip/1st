/* 1단계 — 만세력: 생년월일시(+locale) → 사주팔자 8글자 (명세서 §3)

   데이터 소스 정책:
   - 일주: KASI 음양력 API의 일진(공인 데이터) 우선, 실패 시 JDN+49 자체 계산(§3-1) 폴백.
     둘은 항상 같아야 하며, 다르면 경고를 남기고 KASI를 채택한다.
   - 연주·월주: 절기 경계로 직접 계산(§3-2·§3-4). KASI의 lunSecha(세차)·lunWolgeon(월건)은
     '음력 달력(설날·삭일)' 기준이라 사주 기준(입춘·절입)과 경계 구간에서 어긋나므로 쓰지 않는다.
     (검증 예: 1979-02-02 → API 세차 기미·월건 병인 vs 사주 연주 무오·월주 을축)
   - 시주: 오서둔(§3-5). 자시는 자정 기준 일 변경 정책(§3-6) — KST 달력 날짜를 그대로 쓴다. */
import { GAN_KO, JI_KO, ganjiHan, ganjiKo, parseGanji } from './constants.js';
import { getLunCalInfo } from './kasi-client.js';
import { getTermNodes, kstScalar } from './solar-terms.js';

const jdn = (y, m, d) => {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
};

function validate({ year, month, day, hour, minute = 0 }) {
  const ranges = [
    ['year', year, 1900, 2050], // 음양력 API(~2050)와 수성공식(1900~)의 교집합
    ['month', month, 1, 12],
    ['day', day, 1, 31],
    ['hour', hour, 0, 23], // 출생 시각은 필수 입력 (§10-A)
    ['minute', minute, 0, 59],
  ];
  for (const [k, v, lo, hi] of ranges) {
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new RangeError(`${k}=${v} — 정수 ${lo}~${hi} 범위 필요`);
    }
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) {
    throw new RangeError(`존재하지 않는 날짜: ${year}-${month}-${day}`);
  }
}

/* 출생 시각을 KST 벽시계로 정규화. tzOffsetMinutes = 출생지 UTC 오프셋(분), 한국 = +540.
   경도 보정(진태양시, §3-6 옵션)은 정책 기본값 OFF라 적용하지 않는다. */
function toKst({ year, month, day, hour, minute = 0, tzOffsetMinutes = 540 }) {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - tzOffsetMinutes * 60_000;
  const k = new Date(utcMs + 540 * 60_000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), hh: k.getUTCHours(), mi: k.getUTCMinutes() };
}

export async function computeSajuPalja(input) {
  validate(input);
  // NASA-only 모드(KASI 무호출): { useKasiIljin: false, termsProvider: 'jpl' } — 이때 lunar 메타는 null
  const { useKasiIljin = true, preferExactTerms = true, termsProvider = 'kasi' } = input;
  const kst = toKst(input);
  const birth = kstScalar(kst.y, kst.m, kst.d, kst.hh, kst.mi);
  const warnings = [];
  const sources = { iljin: 'local-jdn', terms: null };

  // ── 일주 (§3-1)
  const localIdx = ((jdn(kst.y, kst.m, kst.d) + 49) % 60 + 60) % 60;
  let day = { stem: localIdx % 10, branch: localIdx % 12 };
  let lunar = null;
  if (useKasiIljin) {
    try {
      const it = await getLunCalInfo(kst.y, kst.m, kst.d);
      const api = parseGanji(it.lunIljin);
      if (api.stem !== day.stem || api.branch !== day.branch) {
        warnings.push(`일진 불일치: KASI=${it.lunIljin} vs 자체계산=${ganjiKo(day)} → KASI 채택`);
      }
      day = api;
      sources.iljin = 'kasi';
      lunar = {
        year: +it.lunYear, month: +it.lunMonth, day: +it.lunDay,
        leapMonth: it.lunLeapmonth === '윤',
        secha: it.lunSecha, wolgeon: it.lunWolgeon || null, iljin: it.lunIljin,
        solJd: +it.solJd,
      };
    } catch (e) {
      warnings.push(`KASI 음양력 API 실패(${e.message}) → 일진 자체계산(JDN+49) 사용`);
    }
  }

  // ── 절기 노드 (연·월 경계)
  const { nodes, source, note } = await getTermNodes(kst.y, { preferExact: preferExactTerms, provider: termsProvider });
  sources.terms = source;
  if (note) warnings.push(note);

  // ── 연주 (§3-2) — 입춘 기준
  const ipchun = nodes.find(n => n.name === '입춘' && n.year === kst.y);
  const sajuYear = birth < ipchun.scalar ? kst.y - 1 : kst.y;
  const year = { stem: ((sajuYear - 4) % 10 + 10) % 10, branch: ((sajuYear - 4) % 12 + 12) % 12 };

  // ── 월주 (§3-4) — 절입 경계 + 오호둔
  let mBranch = 0;
  for (const n of nodes) { if (n.scalar <= birth) mBranch = n.ji; else break; }
  const huDun = [2, 4, 6, 8, 0];
  const month = { stem: (huDun[year.stem % 5] + ((mBranch - 2) % 12 + 12) % 12) % 10, branch: mBranch };

  // ── 시주 (§3-5) — 오서둔
  const hBranch = Math.floor(((kst.hh + 1) % 24) / 2);
  const shuDun = [0, 2, 4, 6, 8];
  const hour = { stem: (shuDun[day.stem % 5] + hBranch) % 10, branch: hBranch };

  if (source === 'suseong-approx') {
    const DAY = 86_400_000;
    const nearest = Math.min(...nodes.map(n => Math.abs(n.scalar - birth)));
    if (nearest <= DAY * 1.5) {
      warnings.push('출생일이 절기 경계 ±1일 이내 — 근사 절기라 연주·월주가 실제와 다를 수 있음(정밀 절기 권장, §10-C)');
    }
  }

  const pillars = { year, month, day, hour };
  return {
    input: { ...input },
    kst,
    sajuYear,
    pillars,
    palja: {
      han: [year, month, day, hour].map(ganjiHan).join(' '),
      ko: [year, month, day, hour].map(ganjiKo).join(' '),
    },
    dayMaster: { stem: day.stem, ko: GAN_KO[day.stem], branchKo: JI_KO[day.branch] },
    lunar,
    meta: { sources, warnings },
  };
}
