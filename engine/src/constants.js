/* 용신산출_정책명세서 §1 — 인덱스 체계.
   모든 산식이 이 순서를 전제한 모듈러 연산이므로 순서 변경 금지. */
export const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
export const GAN_KO = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
export const JI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
export const JI_KO = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
export const GAN_WX = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
export const JI_WX = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
export const WX_KO = ['목', '화', '토', '금', '수'];
export const WX_HAN = ['木', '火', '土', '金', '水'];

export const ganjiHan = p => GAN[p.stem] + JI[p.branch];
export const ganjiKo = p => GAN_KO[p.stem] + JI_KO[p.branch];

/* "경자(庚子)" | "庚子" | "경자" → {stem, branch}
   괄호 안 한자가 있으면 우선 사용(한자는 干·支 문자가 겹치지 않아 안전).
   한글은 신(辛/申)처럼 간·지 명칭이 겹치므로 위치 기준(첫 자=천간, 둘째 자=지지)으로 해석. */
export function parseGanji(text) {
  const m = String(text).match(/[(（]\s*([一-鿿])\s*([一-鿿])\s*[)）]/);
  const pair = m ? [m[1], m[2]] : [...String(text).trim()].slice(0, 2);
  const stem = GAN.indexOf(pair[0]) !== -1 ? GAN.indexOf(pair[0]) : GAN_KO.indexOf(pair[0]);
  const branch = JI.indexOf(pair[1]) !== -1 ? JI.indexOf(pair[1]) : JI_KO.indexOf(pair[1]);
  if (stem < 0 || branch < 0) throw new Error(`간지 해석 실패: "${text}"`);
  return { stem, branch };
}
