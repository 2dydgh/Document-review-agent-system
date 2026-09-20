#!/usr/bin/env bash
# rhwp-python 0.8.1 linux 휠 고치기 — `uv sync` 뒤에 한 번 돌린다.
#
# 왜 필요한가: 휠이 번들한 freetype 은 FT_Palette_Data_Get 을 갖고 있지 않은데
# _rhwp.abi3.so 는 그 심볼을 요구한다(FreeType >= 2.10). 번들 lib 이 RPATH 우선이라
# 멀쩡한 시스템 freetype 이 안 쓰이고 `import rhwp` 가 ImportError 로 죽는다.
# 번들본을 시스템 freetype 으로 덮어쓰면 끝난다.
#
# 상류가 휠을 고치면 이 스크립트도 이 호출도 지운다.
set -euo pipefail

VENV="${1:-.venv}"
PYTHON="$VENV/bin/python"

if [ ! -x "$PYTHON" ]; then
    echo "가상환경 Python 없음: $PYTHON — 먼저 uv sync를 실행하세요" >&2
    exit 1
fi

# 이미 정상인 환경·상류에서 고친 휠은 아무것도 건드리지 않는다. 이 검사가 먼저라
# 스크립트를 여러 번 실행하거나 Docker layer를 다시 빌드해도 안전하다.
if "$PYTHON" -c "import rhwp" 2>/dev/null; then
    echo "rhwp import 정상 — 보정 불필요"
    exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
    echo "rhwp import 실패. 이 보정은 Linux 휠의 FreeType 문제에만 적용됩니다." >&2
    exit 1
fi

shopt -s nullglob
libs=("$VENV"/lib/python*/site-packages/rhwp_python.libs)
if [ "${#libs[@]}" -ne 1 ]; then
    echo "rhwp_python.libs를 하나로 찾지 못했습니다 — rhwp-python 설치 상태를 확인하세요" >&2
    exit 1
fi
LIBS="${libs[0]}"

bundled=("$LIBS"/libfreetype-*.so.6)
if [ "${#bundled[@]}" -eq 0 ]; then
    echo "번들 FreeType이 없는데 rhwp import도 실패했습니다 — 위 오류를 직접 확인하세요:" >&2
    "$PYTHON" -c "import rhwp"
    exit 1
fi

if ! command -v ldconfig >/dev/null 2>&1; then
    echo "ldconfig 없음 — 시스템 libfreetype6 위치를 확인할 수 없습니다" >&2
    exit 1
fi

# awk에서 일찍 exit하면 ldconfig가 SIGPIPE로 죽어 pipefail에 걸린다. 끝까지 읽고
# 첫 경로만 출력한다.
SYS_FT=$(ldconfig -p | awk '/libfreetype\.so\.6/ && first == "" {first=$NF} END {print first}')
if [ -z "$SYS_FT" ]; then
    echo "시스템 freetype 없음. 설치: sudo apt install libfreetype6" >&2
    exit 1
fi

# 번들 파일명에 붙은 해시는 릴리스마다 바뀐다 — glob 로 찾는다.
for bundled in "${bundled[@]}"; do
    cp "$SYS_FT" "$bundled"
    echo "교체: $(basename "$bundled") <- $SYS_FT"
done

"$PYTHON" -c "import rhwp; print('import rhwp OK — core', rhwp.rhwp_core_version())"
