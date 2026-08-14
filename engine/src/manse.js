/* 1단계 — 만세력: 생년월일시(+지역) → 사주팔자 8글자 (명세서 §3)

   데이터 소스 정책:
   - 일주: KASI 음양력 API의 일진(공인 데이터) 우선, 실패 시 JDN+49 자체 계산(§3-1) 폴백.
     둘은 항상 같아야 하며, 다르면 경고를 남기고 KASI를 채택한다.
   - 연주·월주: 절기 경계로 직접 계산(§3-2·§3-4). KASI의 lunSecha(세차)·lunWolgeon(월건)은
     '음력 달력(설날·삭일) 기준'이라 사주 기준(입춘·절입)과 경계 구간에서 어긋나므로 쓰지 않는다.
     (검증 예: 1979-02-02 → API 세차 기미·월건 병인 vs 사주 연주 무오·월주 을축)

   시각 처리 정책(§3-6):
   - 기록된 벽시계 → 서머타임·표준시 이력을 되돌려 실제 순간(UTC)으로 환산.
   - 절기 비교(연주·월주)는 보정 없는 실제 순간으로 한다. 절입은 물리적 순간이라
     출생지 경도와 무관하기 때문이다.
   - 시주·일주 경계는 진태양시(경도 보정 적용)로 한다. 시진은 그 땅의 해 위치가 기준이다.
   - 일주 경계는 조자시설: 진태양시 23:30부터 다음 날 일주(기획 확정 기준, §3-6). */
import { GAN_KO, JI_KO, ganjiHan, ganjiKo, parseGanji } from './constants.js';
import { getLunCalInfo } from './kasi-client.js';
import { getTermNodes, kstScalar } from './solar-terms.js';
import { koreaTimeLaw, LONGITUDE } from './korea-time.js';

const MIN = 60_000;

/* 자시 시작 시각(진태양시 기준, 분) — 기획 소유 수치(§3-6).
   시지(時支)의 기준점이자 일주가 다음 날로 넘어가는 경계로 함께 쓴다(둘이 같아야 야자시 구간이 안 생긴다).
   표준(23:00) 대비 이동량만큼 시각을 되돌린 뒤 기존 시지 공식을 적용한다.

   23:00인 이유: "자시 23:30"이라는 한국 관습은 경도 보정을 대신하는 근사치(−32분 ≈ −30분)다.
   우리는 경도 보정을 실제로 적용하므로 여기에 30분을 더 얹으면 이중 적용이 된다.
   진태양시 23:00 = 서울 KST 23:32로, 관습(23:30)과 2분 이내로 맞는다. (SAZU 교차 검증 근거) */
export const ZI_BOUNDARY = 23 * 60;

const jdn = (y, m, d) => {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
};

function validate({ year, month, day, hour, minute = 0 }) {
  const ranges = [
    ['year', year, 1900, 2050], // 음양력 API(~2050)와 절기 계산의 교집합
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

/* UTC ms 스칼라 → 벽시계 필드 */
const wall = ms => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mi: t.getUTCMinutes() };
};
const addDays = (w, n) => {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export async function computeSajuPalja(input) {
  validate(input);
  // termsProvider: 'kasi'(기본) | 'jpl'(NASA-only 모드) | 'astro'(네트워크 완전 배제 — 브라우저 배포용)
  const {
    year, month, day, hour, minute = 0,
    useKasiIljin = true, preferExactTerms = true, termsProvider = 'kasi',
    longitudeDeg = LONGITUDE.서울, applyLongitude = true, tzOffsetMinutes,
    ziBoundaryMinutes = ZI_BOUNDARY, // 검증·정책 비교용 오버라이드 (기본은 기획 확정값)
  } = input;
  const ziShift = ziBoundaryMinutes - 23 * 60;
  const warnings = [];
  const sources = { iljin: 'local-jdn', terms: null };

  // ── 기록된 벽시계 → 실제 순간(UTC)
  // tzOffsetMinutes를 주면 그 값을 그대로 쓰고(해외 출생 등), 없으면 한국 표준시 이력으로 판정한다.
  let stdOffset, dst = 0;
  if (tzOffsetMinutes === undefined) {
    const law = koreaTimeLaw(year, month, day, hour, minute);
    stdOffset = law.stdOffset;
    dst = law.dst;
    if (dst) warnings.push(`서머타임 시행 기간 출생 — 표준시로 1시간 되돌려 계산(§3-6)`);
    if (stdOffset !== 540) warnings.push(`당시 한국 표준시는 UTC+8:30 — 그 기준으로 환산(§3-6)`);
  } else {
    stdOffset = tzOffsetMinutes;
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - (stdOffset + dst) * MIN;

  // ── 절기 비교용: 실제 순간을 KST 벽시계로 (경도·서머타임 보정 없음 — 절입은 물리적 순간)
  const kst = wall(utcMs + 540 * MIN);
  const birth = kstScalar(kst.y, kst.m, kst.d, kst.hh, kst.mi);

  // ── 시주·일주 경계용: 진태양시(경도 보정, 균시차는 미적용)
  const lonOffset = applyLongitude ? Math.round(longitudeDeg * 4) : stdOffset + dst;
  const solar = wall(utcMs + lonOffset * MIN);
  const longitudeCorrection = applyLongitude ? lonOffset - stdOffset : 0; // 표준자오선 대비 경도 보정만
  const totalCorrection = lonOffset - (stdOffset + dst);                  // 기록 시각 대비 총 이동(서머타임 포함)

  // ── 일주 (§3-1) — 조자시설: 진태양시 23:30(자시 시작)부터 다음 날 일주 (§3-6)
  const solarMinutes = solar.hh * 60 + solar.mi;
  const early = solarMinutes >= ziBoundaryMinutes;
  const dayDate = early ? addDays(solar, 1) : { y: solar.y, m: solar.m, d: solar.d };
  const localIdx = ((jdn(dayDate.y, dayDate.m, dayDate.d) + 49) % 60 + 60) % 60;
  let day_ = { stem: localIdx % 10, branch: localIdx % 12 };
  let lunar = null;
  if (useKasiIljin) {
    try {
      const it = await getLunCalInfo(dayDate.y, dayDate.m, dayDate.d);
      const api = parseGanji(it.lunIljin);
      if (api.stem !== day_.stem || api.branch !== day_.branch) {
        warnings.push(`일진 불일치: KASI=${it.lunIljin} vs 자체계산=${ganjiKo(day_)} → KASI 채택`);
      }
      day_ = api;
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
  const yearP = { stem: ((sajuYear - 4) % 10 + 10) % 10, branch: ((sajuYear - 4) % 12 + 12) % 12 };

  // ── 월주 (§3-4) — 절입 경계 + 오호둔
  let mBranch = 0;
  for (const n of nodes) { if (n.scalar <= birth) mBranch = n.ji; else break; }
  const huDun = [2, 4, 6, 8, 0];
  const monthP = { stem: (huDun[yearP.stem % 5] + ((mBranch - 2) % 12 + 12) % 12) % 10, branch: mBranch };

  // ── 시주 (§3-5) — 오서둔, 진태양시 기준(자시 시작 시각만큼 되돌려 적용)
  const shiftedHour = Math.floor(((solarMinutes - ziShift + 1440) % 1440) / 60);
  const hBranch = Math.floor(((shiftedHour + 1) % 24) / 2);
  const shuDun = [0, 2, 4, 6, 8];
  const hourP = { stem: (shuDun[day_.stem % 5] + hBranch) % 10, branch: hBranch };

  if (source === 'suseong-approx') {
    const DAY = 86_400_000;
    const nearest = Math.min(...nodes.map(n => Math.abs(n.scalar - birth)));
    if (nearest <= DAY * 1.5) {
      warnings.push('출생일이 절기 경계 ±1일 이내 — 근사 절기라 연주·월주가 실제와 다를 수 있음(정밀 절기 권장, §10-C)');
    }
  }

  const pillars = { year: yearP, month: monthP, day: day_, hour: hourP };
  return {
    input: { ...input },
    kst,
    solarTime: { ...solar, correctionMinutes: totalCorrection, earlyZi: early },
    sajuYear,
    pillars,
    palja: {
      han: [yearP, monthP, day_, hourP].map(ganjiHan).join(' '),
      ko: [yearP, monthP, day_, hourP].map(ganjiKo).join(' '),
    },
    dayMaster: { stem: day_.stem, ko: GAN_KO[day_.stem], branchKo: JI_KO[day_.branch] },
    lunar,
    meta: {
      sources,
      warnings,
      time: {
        stdOffsetMinutes: stdOffset, dstMinutes: dst,
        longitudeDeg: applyLongitude ? longitudeDeg : null, longitudeCorrection,
        ziBoundaryMinutes,
        dayBoundary: `조자시(진태양시 ${String(Math.floor(ziBoundaryMinutes / 60)).padStart(2, '0')}:${String(ziBoundaryMinutes % 60).padStart(2, '0')})`,
      },
    },
  };
}
