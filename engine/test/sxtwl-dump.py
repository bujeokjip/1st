# sxtwl(寿星천문력)로 1900~2028 기준 데이터를 덤프 — engine 교차 검증용
# 절기 시각은 라이브러리 기준시(UTC+8, 北京时间) 그대로 저장하고 비교 측에서 KST(+1h) 변환
import sxtwl, json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'sxtwl-cross.json'
pillars, terms = [], []

for y in range(1900, 2029):
    term_days = []
    d = sxtwl.fromSolar(y, 1, 1)
    while d.getSolarYear() == y:
        if d.hasJieQi():
            t = sxtwl.JD2DD(d.getJieQiJD())
            terms.append({
                "y": y, "onDate": [d.getSolarYear(), d.getSolarMonth(), d.getSolarDay()],
                "cst": [t.Y, t.M, t.D, int(t.h), int(t.m)],
            })
            term_days.append((d.getSolarMonth(), d.getSolarDay()))
        d = d.after(1)

    # 사주 기둥 표본: 각 절기일 전후 ±1일(경계 스트레스) + 5/15(베이스라인)
    dates = set()
    for (m, dd) in term_days:
        base = sxtwl.fromSolar(y, m, dd)
        for day in (base.before(1), base.after(1)):
            dates.add((day.getSolarYear(), day.getSolarMonth(), day.getSolarDay()))
    dates.add((y, 5, 15))
    for (yy, mm, dd) in sorted(dates):
        day = sxtwl.fromSolar(yy, mm, dd)
        yg, mg, dg = day.getYearGZ(), day.getMonthGZ(), day.getDayGZ()  # 연주는 입춘 경계(기본값)
        pillars.append({"date": [yy, mm, dd],
                        "yGZ": [yg.tg, yg.dz], "mGZ": [mg.tg, mg.dz], "dGZ": [dg.tg, dg.dz]})

json.dump({"pillars": pillars, "terms": terms}, open(OUT, 'w'))
print(f"pillars={len(pillars)} terms={len(terms)} -> {OUT}")
