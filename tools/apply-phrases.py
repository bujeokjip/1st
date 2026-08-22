#!/usr/bin/env python3
"""기획자가 채운 결과 문구 엑셀 → web/src/phrases.js 자동 반영.

사용:  python3 tools/apply-phrases.py [엑셀경로] [--dry-run]
기본 엑셀:  policy/용신_결과문구_작성양식.xlsx

외부 패키지를 쓰지 않는다(표준 라이브러리 zipfile + ElementTree로 xlsx를 직접 읽음).
친구 PC에서 pip install 없이 바로 돌아가야 하기 때문.

안 채운 칸이 있어도 그 칸만 빈 문구로 두고 반영한다 — 작성 중간에도 화면을 확인할 수 있어야 하므로.
어느 칸이 비었는지는 반영 후 알려준다. 양식 자체가 다른 경우(시트·행 누락)만 중단한다.
"""
import sys
import re
import zipfile
import platform
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import date

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "policy" / "용신_결과문구_작성양식.xlsx"
NUMBERS = ROOT / "policy" / "용신_결과문구_작성양식.numbers"
OUT = ROOT / "web" / "src" / "phrases.js"

WX_KO = ["목", "화", "토", "금", "수"]
WX_NAME = ["나무", "불", "땅", "쇠", "물"]
# §4 판정표 5단계 — A·B 블록의 키 (engine/src/yongsin.js 의 LEVELS 와 같아야 함)
LEVELS = ["strong", "midStrong", "neutral", "midWeak", "weak"]
LEVEL_LABEL = {"strong": "신강", "midStrong": "중화(신강 쪽)", "neutral": "중화",
               "midWeak": "중화(신약 쪽)", "weak": "신약"}
# E_용신설명 시트에 형식 안내용으로 넣어둔 예시 — 그대로면 아직 안 쓴 것으로 본다
SAMPLE_TITLE = "밝히고 데우는 불"


# ─────────────────────────── Numbers → xlsx 변환 (macOS)
def numbers_to_xlsx(src):
    """애플 Numbers 앱을 시켜 .numbers 를 .xlsx 로 내보낸다. 변환된 임시파일 경로 반환.
    기획자가 맥에서 Numbers로 작업하므로, xlsx로 직접 내보내지 않아도 되게 자동 처리한다."""
    if platform.system() != "Darwin":
        raise RuntimeError(
            ".numbers 는 macOS의 Numbers 앱에서만 변환됩니다.\n"
            "   Numbers에서 '파일 > 다음으로 내보내기 > Excel'로 xlsx를 만든 뒤 그 파일로 다시 실행하세요.")
    # Numbers는 실행 직후나 연속 호출 때 open이 missing value를 돌려주는 일이 있다(-1700).
    # 스크립트 안에서 한 번, 바깥에서 한 번 재시도한다.
    # 기획자가 표를 열어둔 채 실행하는 경우가 많으므로, 우리가 연 게 아니면 닫지 않는다.
    script = (
        'on run argv\n'
        '  set srcPath to item 1 of argv\n'
        '  set src to POSIX file srcPath\n'
        '  set dst to POSIX file (item 2 of argv)\n'
        '  tell application "Numbers"\n'
        '    launch\n'
        '    set wasOpen to false\n'
        '    try\n'
        '      repeat with dd in documents\n'
        '        try\n'
        '          set p to POSIX path of ((file of dd) as alias)\n'
        '          if p ends with "/" then set p to text 1 thru -2 of p\n'
        '          if p is srcPath then set wasOpen to true\n'
        '        end try\n'
        '      end repeat\n'
        '    end try\n'
        '    set d to missing value\n'
        '    repeat 20 times\n'
        '      try\n'
        '        set d to open src\n'
        '      end try\n'
        '      if d is not missing value then exit repeat\n'
        '      delay 0.5\n'
        '    end repeat\n'
        '    if d is missing value then error "Numbers가 파일을 열지 못했습니다"\n'
        '    export d to dst as Microsoft Excel\n'
        '    if not wasOpen then close d saving no\n'
        '  end tell\n'
        'end run\n')

    last = ""
    for attempt in range(1, 4):
        out = Path(tempfile.mkdtemp()) / (src.stem + ".xlsx")
        r = subprocess.run(["osascript", "-", str(src), str(out)],
                           input=script, capture_output=True, text=True)
        if r.returncode == 0 and out.exists():
            return out
        last = r.stderr.strip() or "알 수 없는 오류"
        if attempt < 3:
            print(f"   … 변환 실패, 다시 시도합니다 ({attempt}/3)")
            time.sleep(2)

    raise RuntimeError(
        "Numbers 변환에 3번 시도했지만 실패했습니다: " + last + "\n"
        "   Numbers 앱이 설치돼 있는지, 처음이라면 자동화 권한 허용 창에서 '확인'을 눌렀는지 확인하세요.\n"
        "   계속 안 되면 Numbers에서 '파일 > 다음으로 내보내기 > Excel'로 저장한 뒤 그 xlsx로 다시 실행하세요.")


# ─────────────────────────── xlsx 최소 리더
def read_xlsx(path):
    """{시트명: {'A1': '값', ...}} 형태로 반환."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

        rels = {}
        for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall(f"{PKG}Relationship"):
            rels[rel.get("Id")] = rel.get("Target").lstrip("/").replace("xl/", "", 1)

        sheets = {}
        for sh in ET.fromstring(z.read("xl/workbook.xml")).find(f"{NS}sheets"):
            target = rels.get(sh.get(f"{RNS}id"))
            if not target:
                continue
            data = {}
            for c in ET.fromstring(z.read(f"xl/{target}")).iter(f"{NS}c"):
                ref, typ = c.get("r"), c.get("t")
                if typ == "inlineStr":
                    is_el = c.find(f"{NS}is")
                    val = "".join(t.text or "" for t in is_el.iter(f"{NS}t")) if is_el is not None else ""
                else:
                    v = c.find(f"{NS}v")
                    if v is None or v.text is None:
                        continue
                    val = shared[int(v.text)] if typ == "s" else v.text
                val = (val or "").strip()
                if val:
                    data[ref] = val
            sheets[sh.get("name")] = data
        return sheets


def col_rows(sheet, key_col="A", val_col="D", start=6, end=40):
    """키 열과 값 열을 짝지어 [(행번호, 키, 값)] 로."""
    out = []
    for r in range(start, end + 1):
        key = sheet.get(f"{key_col}{r}")
        if not key:
            continue
        out.append((r, key, sheet.get(f"{val_col}{r}")))
    return out


def js(s):
    """JS 작은따옴표 문자열로 이스케이프."""
    return "'" + (s or "").replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if args:
        path = Path(args[0]).expanduser()
    else:
        # 기본: 기획자가 Numbers로 편집하므로 .numbers 를 우선, 없으면 .xlsx
        path = NUMBERS if NUMBERS.exists() else XLSX
    if not path.exists():
        print(f"❌ 문구 파일을 찾을 수 없습니다: {path}")
        return 2

    # .numbers 면 먼저 xlsx 로 변환
    read_path = path
    if path.suffix.lower() == ".numbers":
        print(f"→ Numbers 파일 감지: {path.name} — xlsx로 변환 중 (Numbers 앱이 잠깐 떴다 닫힙니다) …")
        try:
            read_path = numbers_to_xlsx(path)
        except RuntimeError as e:
            print(f"❌ {e}")
            return 2

    try:
        book = read_xlsx(read_path)
    except Exception as e:
        print(f"❌ 파일을 읽지 못했습니다: {e}")
        return 2

    need = ["A_용신선언", "B_강약진단", "C_조후보정", "D_부적처방"]
    missing_sheets = [s for s in need if s not in book]
    if missing_sheets:
        print("❌ 시트가 없습니다:", ", ".join(missing_sheets))
        print("   양식 파일이 맞는지 확인해주세요.")
        return 2

    # errors = 양식 자체가 다름(중단) · blanks = 안 채운 칸(빈 문구로 반영하고 알림)
    errors, warns, blanks = [], [], []
    blocks = {}

    # A — 용신 오행 5종 (§11-2). 키 열(A)의 오행 글자(목/화/토/금/수)로 인식.
    # ★ 같은 오행 행이 여러 개면 전부 후보로 모은다 → 화면에서 랜덤 1개 출력 (기획 결정)
    got = {i: [] for i in range(5)}
    for row, key, val in col_rows(book["A_용신선언"], end=60):
        wx = next((i for i, k in enumerate(WX_KO) if key.startswith(k)), None)
        if wx is None:
            continue
        if val:
            got[wx].append(val)
    for i in range(5):
        if not got[i]:
            blanks.append(f"A_용신선언 시트 (용신: {WX_KO[i]}) 문구가 하나도 없습니다")
    blocks["A"] = got

    # B — §4 판정표 강약 5단계 키. ★ 같은 키 행이 여러 개면 전부 후보 → 랜덤 1개
    got, seen = {k: [] for k in LEVELS}, set()
    for row, key, val in col_rows(book["B_강약진단"], end=60):
        if key not in LEVELS:
            continue
        seen.add(key)
        if val:
            got[key].append(val)
    for k in LEVELS:
        if k in seen and not got[k]:
            blanks.append(f"B_강약진단 시트 ({LEVEL_LABEL[k]}) 문구가 하나도 없습니다")
    # '행 자체가 없는' 경우만 구조 문제로 본다 (비어 있는 건 위에서 이미 잡음)
    absent = [k for k in LEVELS if k not in seen]
    if absent:
        errors.append(
            f"B_강약진단 시트에 강약 5단계 행이 없습니다 (빠진 것: {', '.join(LEVEL_LABEL[k] for k in absent)}). "
            "옛 3단계 양식이라면 새 양식 파일로 다시 작성해주세요")
    blocks["B"] = got

    # C — 키 cold/hot/mild. ★ 같은 키 행이 여러 개면 전부 후보 → 랜덤 1개
    # mild(평)는 선택 — 행이 없거나 비어 있으면 예전처럼 평일 때 C를 생략한다
    C_LABEL = {"cold": "사주가 차가울 때", "hot": "사주가 뜨거울 때", "mild": "치우치지 않을 때(평)"}
    got, seen = {k: [] for k in C_LABEL}, set()
    for row, key, val in col_rows(book["C_조후보정"], end=60):
        if key not in C_LABEL:
            continue
        seen.add(key)
        if val:
            got[key].append(val)
    for k in ("cold", "hot"):
        if not got[k]:
            blanks.append(f"C_조후보정 시트 ({C_LABEL[k]}) 문구가 하나도 없습니다")
    if "mild" not in seen:
        warns.append("C_조후보정에 mild(평) 행이 없어 조후가 평인 사람에겐 조후 문장이 안 나옵니다 — 원하면 A열에 'mild' 행을 추가하세요")
    blocks["C"] = got

    # D — 오행 5행(순서 기반)
    got = {}
    rows_d = col_rows(book["D_부적처방"], end=10)
    for i, (row, key, val) in enumerate(rows_d[:5]):
        got[i] = val or ""
        if not val:
            blanks.append(f"D_부적처방 시트 D{row}칸 (용신: {key})")
    if len(rows_d) < 5:
        errors.append("D_부적처방 시트에 오행 5행이 모두 있어야 합니다")
    blocks["D"] = got

    # 행이 아예 없어 못 읽은 칸도 빈 문구로 채워 생성이 끊기지 않게 한다
    for i in range(5):
        blocks["A"].setdefault(i, "")
        blocks["D"].setdefault(i, "")
    for k in LEVELS:
        blocks["B"].setdefault(k, "")
    for k in ("cold", "hot"):
        blocks["C"].setdefault(k, "")

    # E — 신규 용신 설명 (선택). 일부만 채워져도 통과시키되 알려준다
    info = {}
    if "E_용신설명" in book:
        sheet = book["E_용신설명"]
        for i in range(5):
            r = 6 + i
            title, desc = sheet.get(f"D{r}"), sheet.get(f"E{r}")
            kw = sheet.get(f"F{r}") or ""
            if title == SAMPLE_TITLE:
                warns.append(f"E_용신설명 {r}행({WX_KO[i]})이 예시 문구 그대로입니다 — 실제 문구로 바꿔주세요")
            if title or desc:
                info[i] = {
                    "title": title or "",
                    "desc": desc or "",
                    # 구분자는 쉼표(,)만 — 문구 안에 '·'를 자유롭게 쓸 수 있게. 화면에선 랜덤 3개만 표시
                    "keywords": [k.strip() for k in kw.split(",") if k.strip()],
                }
        if not info:
            warns.append("E_용신설명 시트가 비어 있어 용신 설명 영역은 화면에 표시되지 않습니다")
        elif len(info) < 5:
            warns.append(f"E_용신설명이 5개 중 {len(info)}개만 채워졌습니다 — 나머지 오행은 설명이 안 나옵니다")

    # F — 한 줄 소개 (선택). 문장 틀 + 계절(월지 12) + 색동물(일주 60갑자)
    intro = None
    if "F_한줄소개" in book:
        sheet = book["F_한줄소개"]
        kv = {}  # 키(A열) → 값(D열). 시트 어느 행에 있든 키로 찾는다.
        for r in range(1, 130):
            k = sheet.get(f"A{r}")
            if k and sheet.get(f"D{r}"):
                kv[k] = sheet.get(f"D{r}")
        template = kv.get("template")
        season = [kv.get(f"s{i}") for i in range(12)]
        ganzhi = [kv.get(f"g{i}") for i in range(60)]
        if template:
            intro = {"template": template, "season": season, "ganzhi": ganzhi}
            miss_s, miss_g = sum(not s for s in season), sum(not g for g in ganzhi)
            if miss_s:
                warns.append(f"F_한줄소개 계절 {miss_s}칸이 비었습니다 — 그 달 태생은 소개 문장이 안 나옵니다")
            if miss_g:
                warns.append(f"F_한줄소개 색동물 {miss_g}칸이 비었습니다 — 그 일주는 소개 문장이 안 나옵니다")
        elif any(season) or any(ganzhi):
            warns.append("F_한줄소개 문장 틀(template, D7칸)이 비어 소개 문장은 표시되지 않습니다")

    if errors:
        print("❌ 양식이 맞지 않아 반영하지 않았습니다.\n")
        for e in errors:
            print("   ·", e)
        return 1

    # ─────────────────────────── phrases.js 생성
    def block(d, keys, comment):
        lines = [f"  {k}: {{ // {comment}" if False else ""]
        body = "\n".join(f"    {k}: {js(d[k])}," for k in keys if k in d)
        return body

    def block_list(d, keys):
        """A·B처럼 키마다 문구 여러 개(배열). 화면에서 랜덤 1개 선택."""
        return "\n".join(f"    {k}: [{', '.join(js(v) for v in d[k])}]," for k in keys)

    n_a = sum(len(v) for v in blocks["A"].values())
    n_b = sum(len(v) for v in blocks["B"].values())
    out = [
        "/* 결과 문구 블록 (명세서 §11) — 조립 순서는 피그마 기준 B→A→C→D.",
        f"   ★ 이 파일은 자동 생성됩니다. 직접 고치지 마세요.",
        f"   원본: policy/{path.name}  ·  반영 명령: 메타반영  ·  생성일: {date.today().isoformat()}",
        ("   {용신}·{기신}·{희신}은 치환 변수입니다."
         + "\n   A·B는 키마다 문구 배열 — 화면에서 매번 랜덤으로 1개를 뽑는다(같은 키 행을 여러 개 적으면 후보가 늘어남)."
         + (f"\n   ⚠ 아직 안 채운 칸 {len(blanks)}개 — 빈 문구는 화면에서 그 줄이 통째로 빠집니다." if blanks else "")
         + " */"),
        "export const PHRASES = {",
        f"  B: {{ // 강약 진단 (§4 판정표 5단계) — 후보 {n_b}개",
        block_list(blocks["B"], LEVELS),
        "  },",
        f"  A: {{ // 용신 선언 (용신 오행 5종) — 후보 {n_a}개",
        block_list(blocks["A"], list(range(5))),
        "  },",
        f"  C: {{ // 조후 보정 — cold(한)/hot(열)/mild(평). 후보 {sum(len(v) for v in blocks['C'].values())}개. mild가 비면 평일 때 생략",
        block_list(blocks["C"], ["cold", "hot", "mild"]),
        "  },",
        "  D: { // 부적 처방 (용신 오행 5종)",
        "\n".join(f"    {i}: {js(blocks['D'][i])}," for i in range(5)),
        "  },",
        "};",
        "",
        "/* 치환용 오행 구어 명칭 */",
        f"export const WX_NAME = [{', '.join(js(n) for n in WX_NAME)}];",
        "",
    ]
    if info:
        out += ["/* 용신 오행별 설명 — 결과 화면의 용신 한자 아래 영역 */", "export const YONGSIN_INFO = {"]
        for i in range(5):
            if i not in info:
                continue
            v = info[i]
            kws = ", ".join(js(k) for k in v["keywords"])
            out.append(f"  {i}: {{ title: {js(v['title'])}, desc: {js(v['desc'])}, keywords: [{kws}] }}, // {WX_KO[i]}")
        out += ["};", ""]
    else:
        out += ["/* 용신 설명 미작성 — 엑셀 E_용신설명 시트를 채우면 결과 화면에 표시됩니다 */",
                "export const YONGSIN_INFO = {};", ""]

    if intro:
        out += ["/* 한 줄 소개 — 결과 문구 맨 위. season=월지(지지) 0~11, ganzhi=일주 60갑자 0~59 */",
                "export const INTRO = {",
                f"  template: {js(intro['template'])},",
                f"  season: [{', '.join(js(s or '') for s in intro['season'])}],",
                f"  ganzhi: [{', '.join(js(g or '') for g in intro['ganzhi'])}],",
                "};", ""]
    else:
        out += ["/* 한 줄 소개 미작성 — 엑셀 F_한줄소개 시트를 채우면 결과 맨 위에 표시됩니다 */",
                "export const INTRO = null;", ""]

    text = "\n".join(l for l in out if l is not None) + ""
    text = re.sub(r"\n{3,}", "\n\n", text)

    prev = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if dry:
        print("— dry-run: 아래 내용으로 쓸 예정입니다 —\n")
        print(text)
        return 0

    OUT.write_text(text, encoding="utf-8")

    total = 17  # A 용신5 · B 강약5 · C 조후2 · D 용신5 (키 기준)
    filled = total - len(blanks)
    print(f"✅ 반영 완료 → {OUT.relative_to(ROOT)}")
    print(f"   문구 블록 {total}개 중 {filled}개 채워짐 (A 용신5 · B 강약5 · C 조후2 · D 용신5)"
          + (f" + 용신 설명 {len(info)}개" if info else "")
          + (" + 한 줄 소개(계절12·색동물60)" if intro else ""))
    n_c = sum(len(v) for v in blocks["C"].values())
    print(f"   랜덤 후보: A {n_a}개 · B {n_b}개 · C {n_c}개(cold {len(blocks['C']['cold'])}/hot {len(blocks['C']['hot'])}/mild {len(blocks['C']['mild'])})  (같은 키 행을 더 적으면 늘어남)")
    if prev == text:
        print("   (내용 변화 없음)")
    if blanks:
        print(f"\n   ⚠ 아직 안 채운 칸 {len(blanks)}개 — 지금 화면에선 그 줄이 빠진 채로 나옵니다:")
        for b in blanks:
            print("      ·", b)
        print("   나중에 채우고 다시 실행하면 그대로 반영됩니다.")
    for w in warns:
        print("   ⚠", w)
    print("\n   다음: cd web && npm run build  →  dist/index.html 갱신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
