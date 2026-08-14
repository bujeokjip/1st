#!/usr/bin/env python3
"""기획자가 채운 결과 문구 엑셀 → web/src/phrases.js 자동 반영.

사용:  python3 tools/apply-phrases.py [엑셀경로] [--dry-run]
기본 엑셀:  docs/용신_결과문구_작성양식.xlsx

외부 패키지를 쓰지 않는다(표준 라이브러리 zipfile + ElementTree로 xlsx를 직접 읽음).
친구 PC에서 pip install 없이 바로 돌아가야 하기 때문.

검증을 통과하지 못하면 아무것도 쓰지 않고 무엇을 채워야 하는지 알려준다.
"""
import sys
import re
import zipfile
import platform
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import date

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "docs" / "용신_결과문구_작성양식.xlsx"
NUMBERS = ROOT / "docs" / "용신_결과문구_작성양식.numbers"
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
    out = Path(tempfile.mkdtemp()) / (src.stem + ".xlsx")
    script = (
        'on run argv\n'
        '  set src to POSIX file (item 1 of argv)\n'
        '  set dst to POSIX file (item 2 of argv)\n'
        '  tell application "Numbers"\n'
        '    set d to open src\n'
        '    delay 1\n'
        '    export d to dst as Microsoft Excel\n'
        '    close d saving no\n'
        '  end tell\n'
        'end run\n')
    r = subprocess.run(["osascript", "-", str(src), str(out)],
                       input=script, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError(
            "Numbers 변환에 실패했습니다: " + (r.stderr.strip() or "알 수 없는 오류") + "\n"
            "   Numbers 앱이 설치돼 있는지, 처음이라면 자동화 권한 허용 창에서 '확인'을 눌렀는지 확인하세요.")
    return out


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

    errors, warns = [], []
    blocks = {}

    # A — 용신 오행 5종 (§11-2). 행 순서 목·화·토·금·수
    got = {}
    rows_a = col_rows(book["A_용신선언"], end=10)
    for i, (row, key, val) in enumerate(rows_a[:5]):
        if not val:
            errors.append(f"A_용신선언 시트 D{row}칸 (용신: {key}) 이 비어 있습니다")
        else:
            got[i] = val
    if len(rows_a) != 5:
        errors.append(
            f"A_용신선언 시트는 용신 오행 5행이어야 하는데 {len(rows_a)}행입니다. "
            "강약 기준이던 옛 양식이라면 새 양식 파일로 다시 작성해주세요")
    blocks["A"] = got

    # B — §4 판정표 강약 5단계 키
    got, seen = {}, set()
    for row, key, val in col_rows(book["B_강약진단"]):
        if key not in LEVELS:
            continue
        seen.add(key)
        if not val:
            errors.append(f"B_강약진단 시트 D{row}칸 ({LEVEL_LABEL[key]}) 이 비어 있습니다")
        else:
            got[key] = val
    # '행 자체가 없는' 경우만 구조 문제로 본다 (비어 있는 건 위에서 이미 잡음)
    absent = [k for k in LEVELS if k not in seen]
    if absent:
        errors.append(
            f"B_강약진단 시트에 강약 5단계 행이 없습니다 (빠진 것: {', '.join(LEVEL_LABEL[k] for k in absent)}). "
            "옛 3단계 양식이라면 새 양식 파일로 다시 작성해주세요")
    blocks["B"] = got

    # C — 키 cold/hot
    C_LABEL = {"cold": "사주가 차가울 때", "hot": "사주가 뜨거울 때"}
    got = {}
    for row, key, val in col_rows(book["C_조후보정"]):
        if key not in C_LABEL:
            continue
        if not val:
            errors.append(f"C_조후보정 시트 D{row}칸 ({C_LABEL[key]}) 이 비어 있습니다")
        else:
            got[key] = val
    blocks["C"] = got

    # D — 오행 5행(순서 기반)
    got = {}
    rows_d = col_rows(book["D_부적처방"], end=10)
    for i, (row, key, val) in enumerate(rows_d[:5]):
        if not val:
            errors.append(f"D_부적처방 시트 D{row}칸 (용신: {key}) 이 비어 있습니다")
        else:
            got[i] = val
    if len(rows_d) < 5:
        errors.append("D_부적처방 시트에 오행 5행이 모두 있어야 합니다")
    blocks["D"] = got

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
                    "keywords": [k.strip() for k in re.split(r"[,·]", kw) if k.strip()],
                }
        if not info:
            warns.append("E_용신설명 시트가 비어 있어 용신 설명 영역은 화면에 표시되지 않습니다")
        elif len(info) < 5:
            warns.append(f"E_용신설명이 5개 중 {len(info)}개만 채워졌습니다 — 나머지 오행은 설명이 안 나옵니다")

    if errors:
        print(f"❌ 아직 안 채워진 칸이 {len(errors)}개 있습니다. 반영하지 않았습니다.\n")
        for e in errors:
            print("   ·", e)
        print("\n   노란색 칸을 모두 채운 뒤 다시 실행해주세요.")
        return 1

    # ─────────────────────────── phrases.js 생성
    def block(d, keys, comment):
        lines = [f"  {k}: {{ // {comment}" if False else ""]
        body = "\n".join(f"    {k}: {js(d[k])}," for k in keys if k in d)
        return body

    out = [
        "/* 결과 문구 블록 (명세서 §11) — 조립 순서는 피그마 기준 B→A→C→D.",
        f"   ★ 이 파일은 자동 생성됩니다. 직접 고치지 마세요.",
        f"   원본: docs/{path.name}  ·  반영 명령: 메타반영  ·  생성일: {date.today().isoformat()}",
        "   {용신}·{기신}·{희신}은 치환 변수입니다. */",
        "export const PHRASES = {",
        "  B: { // 강약 진단 (§4 판정표 5단계)",
        block(blocks["B"], LEVELS, ""),
        "  },",
        "  A: { // 용신 선언 (용신 오행 5종)",
        "\n".join(f"    {i}: {js(blocks['A'][i])}," for i in range(5)),
        "  },",
        "  C: { // 조후 보정 (한/열 뚜렷할 때만, 평이면 생략)",
        block(blocks["C"], ["cold", "hot"], ""),
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

    text = "\n".join(l for l in out if l is not None) + ""
    text = re.sub(r"\n{3,}", "\n\n", text)

    prev = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if dry:
        print("— dry-run: 아래 내용으로 쓸 예정입니다 —\n")
        print(text)
        return 0

    OUT.write_text(text, encoding="utf-8")

    print(f"✅ 반영 완료 → {OUT.relative_to(ROOT)}")
    print(f"   문구 블록 17개 (A 용신5 · B 강약5 · C 조후2 · D 용신5)" + (f" + 용신 설명 {len(info)}개" if info else ""))
    if prev == text:
        print("   (내용 변화 없음)")
    for w in warns:
        print("   ⚠", w)
    print("\n   다음: cd web && npm run build  →  dist/index.html 갱신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
