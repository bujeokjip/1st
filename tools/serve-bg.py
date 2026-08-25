#!/usr/bin/env python3
"""로컬 확인용 서버를 세션에서 완전히 분리해 띄운다.

왜 이 스크립트가 필요한가: `nohup node web/serve.mjs &` 로 띄우면 부모는 끊기지만
프로세스 그룹(pgid)이 호출한 셸 그대로 남는다. Claude Code가 셸을 정리할 때
그룹째 종료하면 서버도 같이 죽는다(실제로 두 번 그렇게 내려갔다).
os.setsid() 로 자기 세션·자기 그룹을 갖게 하면 그룹 정리에 휩쓸리지 않는다.

실행:  python3 tools/serve-bg.py [--stop]
표준 라이브러리만 사용 — 친구 PC에서 pip 설치 없이 돌아야 한다.
"""
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8017
URL = f"http://127.0.0.1:{PORT}/"
LOG = Path("/tmp/bujeokjip-server.log")


def listeners():
    """8017을 잡고 있는 프로세스 [(pid, 명령줄)]."""
    r = subprocess.run(["lsof", "-nP", f"-iTCP:{PORT}", "-sTCP:LISTEN", "-t"],
                       capture_output=True, text=True)
    out = []
    for pid in filter(None, r.stdout.split()):
        cmd = subprocess.run(["ps", "-o", "command=", "-p", pid],
                             capture_output=True, text=True).stdout.strip()
        out.append((int(pid), cmd))
    return out


def stop():
    """우리 서버만 종료. 남의 프로세스는 건드리지 않는다."""
    stopped = False
    for pid, cmd in listeners():
        if "serve.mjs" not in cmd:
            print(f"⚠ 포트 {PORT}을 다른 프로그램이 쓰고 있습니다 (pid {pid}): {cmd}")
            print("   임의로 끄지 않았습니다. 그 프로그램을 먼저 정리해주세요.")
            return False
        os.kill(pid, 15)
        stopped = True
    if stopped:
        for _ in range(20):
            if not listeners():
                break
            time.sleep(0.1)
    return True


def alive():
    try:
        with urllib.request.urlopen(URL, timeout=1) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def start():
    log = LOG.open("ab")
    # start_new_session=True → os.setsid(). 자기 세션·그룹이라 셸 정리에 안 휩쓸린다.
    p = subprocess.Popen(["node", "web/serve.mjs"],
                         cwd=ROOT, stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    for _ in range(50):  # 최대 10초
        if alive():
            return p.pid
        if p.poll() is not None:
            break
        time.sleep(0.2)
    return None


if __name__ == "__main__":
    if "--stop" in sys.argv:
        sys.exit(0 if stop() else 1)

    if not stop():
        sys.exit(1)
    pid = start()
    if pid is None:
        print(f"❌ 서버가 뜨지 않았습니다. 로그: {LOG}")
        print(LOG.read_text(encoding="utf8", errors="replace")[-800:] if LOG.exists() else "")
        sys.exit(1)
    print(f"✅ 서버 실행 중 (pid {pid}) → http://localhost:{PORT}")
