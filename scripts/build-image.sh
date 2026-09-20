#!/usr/bin/env bash
# DocSuree 배포 이미지를 만들고, 폐쇄망에 반입할 파일 하나로 묶는다.
#
#   ./scripts/build-image.sh            이미지 빌드 + docsuree-<날짜>.tar.gz 생성
#   ./scripts/build-image.sh --no-save  빌드만 (이 기계에서 바로 띄울 때)
#
# **인터넷이 되는 기계에서 돌린다.** PyPI 와 HuggingFace 에서 받을 것을 여기서
# 다 받아 이미지에 넣기 때문에, 결과물은 사내 서버에서 인터넷 없이 뜬다.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-docsuree:latest}"
SAVE=1
[ "${1:-}" = "--no-save" ] && SAVE=0

command -v docker >/dev/null || { echo "docker 가 없습니다." >&2; exit 1; }

# 사내 문서가 이미지에 들어가지 않게 하는 것이 .dockerignore 의 첫 목적이다.
# 이미지는 USB 로 오갈 물건이라 한 번 들어가면 회수할 방법이 없다.
[ -f .dockerignore ] || { echo ".dockerignore 가 없습니다 — 중단합니다." >&2; exit 1; }
grep -qx 'data/' .dockerignore || { echo ".dockerignore 에 data/ 가 없습니다 — 중단합니다." >&2; exit 1; }

# ── H2Orestart 준비 ─────────────────────────────────────────────────────────
# 빌드 컨테이너 안에서 받지 않는다 — GitHub 릴리스가 objects.githubusercontent.com
# 으로 리다이렉트되는데 사내망에서 그 호스트가 막혀 빌드가 죽었다. 호스트가 받아
# 두면 그 뒤로는 네트워크 없이 빌드된다.
H2O_VERSION="${H2O_VERSION:-0.7.13}"
H2O_URL="https://github.com/ebandal/H2Orestart/releases/download/v${H2O_VERSION}/H2Orestart.oxt"
if [ ! -s vendor/H2Orestart.oxt ]; then
    echo "==> H2Orestart ${H2O_VERSION} 내려받기 (LibreOffice 한글 확장)"
    mkdir -p vendor
    curl -fSL -o vendor/H2Orestart.oxt "$H2O_URL" || {
        echo >&2
        echo "받지 못했습니다. 인터넷이 되는 다른 기계에서 아래를 받아" >&2
        echo "  $H2O_URL" >&2
        echo "이 저장소의 vendor/H2Orestart.oxt 로 두고 다시 실행하세요." >&2
        exit 1
    }
fi
echo "==> H2Orestart 준비됨 ($(du -h vendor/H2Orestart.oxt | cut -f1))"

echo "==> 이미지 빌드 ($IMAGE)"
echo "    처음이면 오래 걸립니다 — torch·LibreOffice·Docling 모델을 전부 받습니다."
docker build -t "$IMAGE" .

echo
echo "==> 반입 전 자체 점검"
# 이미지가 실제로 뜨고, 폐쇄망에서 필요한 것이 다 들어 있는지 확인한다.
# 여기서 걸러야 USB 로 옮긴 뒤에 발견하는 일이 없다.
# 반드시 앱이 실제로 쓰는 인터프리터로 검사한다 — 시스템 python 에는 아무것도 없다
# (uv 가 /app/.venv 에 깐다). 시스템 python 으로 재면 멀쩡한 이미지를 불합격시킨다.
docker run --rm "$IMAGE" /app/.venv/bin/python -c "
import importlib.util as u, pathlib, sys
missing = [m for m in ('docling','torch','fitz','pdf_inspector','docx','hwpx','olefile','fastapi')
           if not u.find_spec(m)]
if missing:
    sys.exit('파이썬 패키지 누락: ' + ', '.join(missing))
import rhwp                                     # freetype 보정이 먹었는지
print('파이썬 패키지 OK · rhwp import OK')
"

# 개수만 세면 껍데기 파일로도 통과한다. **런타임과 똑같이 오프라인으로 열어 본다** —
# HF_HUB_OFFLINE=1 이라 캐시에 없으면 여기서 실패한다. 폐쇄망 첫 검토와 같은 조건이다.
docker run --rm -e HF_HUB_OFFLINE=1 "$IMAGE" /app/.venv/bin/python -c "
import pathlib, sys
size = sum(f.stat().st_size for f in pathlib.Path('/opt/hf').rglob('*') if f.is_file()) / 1e6
if size < 800:
    sys.exit(f'Docling 모델이 부족합니다({size:.0f}MB, 1.1GB 예상) — 폐쇄망에서 표 구조를 못 읽습니다.')
from docling.document_converter import DocumentConverter
DocumentConverter()          # 모델을 실제로 연다. 캐시에 없으면 오프라인이라 여기서 죽는다
print(f'Docling 오프라인 기동 OK ({size:.0f}MB)')
"
docker run --rm "$IMAGE" soffice --version
docker run --rm "$IMAGE" sh -c 'fc-list :lang=ko | wc -l | xargs -I{} echo "한글 폰트 {}종"'

# **화면 자산이 실제로 얹히는지 본다.** server.py 는 저장소 루트를 __file__ 기준으로
# 찾아 web/ 을 마운트하는데, 설치 방식에 따라 그 경로가 어긋난다 — 실제로
# `--no-editable` 로 깔았더니 API 는 멀쩡하고 화면만 통째로 404 였다(2026-08-25).
# 컨테이너는 뜨고 포트도 열려서 띄워 보기 전에는 모른다.
docker run --rm "$IMAGE" /app/.venv/bin/python -c "
import pathlib, sys
from app.server import _REPO_ROOT
for name in ('web/index.html', 'presets/criteria/common.yaml'):
    p = _REPO_ROOT / name
    if not p.exists():
        sys.exit(f'화면·기준 자산을 못 찾습니다: {p} — 설치 방식이 경로를 어긋나게 했습니다.')
print(f'화면·기준 자산 OK (루트 {_REPO_ROOT})')
"

if [ "$SAVE" -eq 1 ]; then
    OUT="docsuree-$(date +%Y%m%d).tar.gz"
    echo
    echo "==> 반입 파일로 묶는 중 ($OUT) — 수 분 걸립니다"
    docker save "$IMAGE" | gzip > "$OUT"
    echo "완료: $OUT ($(du -h "$OUT" | cut -f1))"
    echo
    echo "사내 서버에서:"
    echo "  docker load < $OUT"
    echo "  docker compose up -d"
fi
