/* KASI(한국천문연구원) data.go.kr OpenAPI 클라이언트 — 의존성 없음(Node 18+ fetch).
   응답이 플랫한 XML이라 정규식 파싱으로 충분하다. */

import { readFileSync } from 'node:fs';

const BASE = 'https://apis.data.go.kr/B090041/openapi/service';

/* data.go.kr 발급 키 — 공개 저장소라 코드에 넣지 않는다.
   우선순위: 환경변수 KASI_SERVICE_KEY → engine/.kasi-key 파일(gitignore, 한 줄).
   인코딩·디코딩 어느 형태든 허용(% 포함 여부로 판별해 정확히 1회만 인코딩).
   키가 없으면 KASI 호출만 실패하고 엔진은 오프라인 폴백(JDN+49·천문 절기)으로 동작한다. */
let fileKey = null;
try {
  fileKey = readFileSync(new URL('../.kasi-key', import.meta.url), 'utf8').trim() || null;
} catch { /* 키 파일 없음 허용 */ }

const keyEnc = () => {
  const k = process.env.KASI_SERVICE_KEY ?? fileKey;
  if (!k) throw new KasiError('NO_KEY', 'KASI 키 없음 — KASI_SERVICE_KEY 환경변수 또는 engine/.kasi-key 파일로 설정');
  return k.includes('%') ? k : encodeURIComponent(k);
};

export class KasiError extends Error {
  constructor(code, msg) {
    super(`KASI ${code}: ${msg}`);
    this.code = String(code);
  }
}

function parseItems(xml) {
  // 인증·등록 오류는 body 밖 cmmMsgHeader로 온다 (예: 30 = 미등록 서비스키)
  const cmm = xml.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/);
  if (cmm) {
    const msg = xml.match(/<returnAuthMsg>([^<]*)</)?.[1] ?? xml.match(/<errMsg>([^<]*)</)?.[1] ?? '';
    throw new KasiError(cmm[1], msg);
  }
  const rc = xml.match(/<resultCode>(\w+)<\/resultCode>/)?.[1];
  if (rc !== '00') {
    throw new KasiError(rc ?? '??', xml.match(/<resultMsg>([^<]*)</)?.[1] ?? 'unknown');
  }
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const o = {};
    for (const [, k, v] of body.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) o[k] = v;
    items.push(o);
  }
  return items;
}

async function request(path, params, { retries = 2 } = {}) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${BASE}/${path}?serviceKey=${keyEnc()}&${qs}`;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new KasiError(`HTTP_${res.status}`, res.statusText);
      return parseItems(await res.text());
    } catch (e) {
      const retryable = !(e instanceof KasiError) || e.code.startsWith('HTTP_5');
      if (!retryable || i >= retries) throw e;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
}

const pad2 = n => String(n).padStart(2, '0');
const lunCache = new Map();

/* 음양력 정보 조회(양력 기준) — 일진·세차·월건·음력 날짜·율리우스적일.
   지원 범위 1391-01-01 ~ 2050-12-31. 같은 날짜는 프로세스 내 캐시. */
export async function getLunCalInfo(y, m, d) {
  const k = `${y}-${m}-${d}`;
  if (!lunCache.has(k)) {
    const items = await request('LrsrCldInfoService/getLunCalInfo', {
      solYear: y,
      solMonth: pad2(m),
      solDay: pad2(d),
    });
    if (!items.length) throw new KasiError('EMPTY', `음양력 정보 없음: ${k} (지원 범위 밖일 수 있음)`);
    lunCache.set(k, items[0]);
  }
  return lunCache.get(k);
}

/* 24절기 조회(특일 정보 서비스) — 같은 키로 쓰려면 data.go.kr에서
   "한국천문연구원_특일 정보"(15012690) 활용신청이 별도로 필요. 미등록 키면 code 30. */
export async function get24Divisions(year) {
  return request('SpcdeInfoService/get24DivisionsInfo', {
    solYear: year,
    numOfRows: 30,
    pageNo: 1,
  });
}
