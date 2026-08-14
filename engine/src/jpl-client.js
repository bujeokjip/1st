/* NASA JPL Horizons(DE440/DE441) 클라이언트 — 태양 겉보기 지심 황경(당일 분점 기준, QUANTITIES=31).
   절기 = 황경이 15° 배수에 도달하는 순간. 연 단위 1시간 간격 시계열을 받아 선형 보간으로
   교차 시각을 얻는다(태양 속도 변화가 미미해 보간 오차는 초 단위). 연도별 캐시. */

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const seriesCache = new Map();

export async function sunLongitudeYearSeries(year, { retries = 2 } = {}) {
  if (seriesCache.has(year)) return seriesCache.get(year);
  for (let i = 0; ; i++) {
    try {
      const rows = await fetchYearSeries(year);
      seriesCache.set(year, rows);
      return rows;
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise(r => setTimeout(r, 700 * (i + 1))); // Horizons는 동시·연속 요청에 민감
    }
  }
}

async function fetchYearSeries(year) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: "'10'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    START_TIME: `'${year}-01-01 00:00'`,
    STOP_TIME: `'${year}-12-31 23:59'`,
    STEP_SIZE: "'1h'",
    QUANTITIES: "'31'",
    ANG_FORMAT: "'DEG'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  const text = await res.text();
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`Horizons 응답 파싱 실패(${year}): ${text.slice(0, 200)}`);
  const rows = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})\s+([\d.]+)\s+(-?[\d.]+)/);
    if (m) rows.push({ ut: Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]), lon: +m[6] });
  }
  if (rows.length < 8000) throw new Error(`Horizons 행 수 이상(${year}): ${rows.length}`);
  // 황경 언랩(3월 춘분에서 360→0 한 번 감김)
  let wrap = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i].lon + wrap < rows[i - 1].u - 300) wrap += 360;
    rows[i].u = rows[i].lon + wrap;
  }
  return rows;
}

/* 언랩 급수에서 목표 황경 교차 시각(UT ms) */
export function crossingUt(rows, targetDeg) {
  const t = targetDeg < rows[0].u ? targetDeg + 360 : targetDeg;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].u < t && t <= rows[i].u) {
      const f = (t - rows[i - 1].u) / (rows[i].u - rows[i - 1].u);
      return rows[i - 1].ut + f * (rows[i].ut - rows[i - 1].ut);
    }
  }
  throw new Error(`교차 없음: ${targetDeg}°`);
}
