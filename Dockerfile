# DocSuree 배포 이미지 — **폐쇄망에 그대로 반입할 수 있게 전부 말아 넣는다.**
#
# 빌드는 인터넷이 되는 기계에서 한 번 하고, 결과 이미지를 USB 로 옮긴다:
#   docker build -t docsuree:latest .
#   docker save docsuree:latest | gzip > docsuree.tar.gz     # 반입
#   docker load < docsuree.tar.gz                            # 사내 서버에서
#   docker compose up -d
#
# 이미지가 크다(약 8~9GB). 대신 사내 서버에서 인터넷을 한 번도 안 쓴다 —
# PyPI(파이썬 패키지)도, HuggingFace(Docling 모델)도 빌드 때 다 받아 둔다.
# 폐쇄망에서 그 둘에 닿으려다 실패하면 표 구조를 못 읽는 채로 조용히 도는데,
# 이 프로젝트에서 제일 피해야 할 실패다.
FROM python:3.12-slim-bookworm

# uv 는 공식 이미지에서 바이너리만 가져온다(설치 스크립트보다 재현성이 높다).
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /usr/local/bin/

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# ── 시스템 의존성 ────────────────────────────────────────────────────────────
#   libfreetype6  : rhwp 휠이 번들한 낡은 freetype 을 이걸로 덮는다(아래 보정 스크립트)
#   libreoffice   : hwp/hwpx/docx → PDF 변환. **뷰어 전용** — 검토 자체는 이것 없이도 돈다
#   default-jre   : H2Orestart 확장이 Java 로 만들어져 필요
#   libreoffice-java-common : LibreOffice 와 JVM 을 잇는 다리. **JRE 만 깔면 부족하다** —
#                   없으면 unopkg 가 "An unexpected error occurred while searching for
#                   a Java" 로 죽어서 확장 설치 자체가 안 된다
#   fonts-nanum   : **없으면 LibreOffice 가 한글을 네모로 렌더링한다.** 변환은 "성공"
#   fonts-noto-cjk  하는데 결과 PDF 만 깨져서, 빠뜨리면 알아채기 어렵다
#                 : 깔기만 해서는 부족하다 — 아래 fontconfig 매핑이 함께 있어야
#                   문서가 요구하는 이름(한컴바탕·굴림·휴먼명조…)이 이 폰트들로 간다
#   libgl1/libglib: PyMuPDF·Docling 이 여는 네이티브 라이브러리
RUN apt-get update && apt-get install -y --no-install-recommends \
        libfreetype6 \
        libreoffice-writer libreoffice-calc libreoffice-java-common \
        default-jre-headless \
        fonts-nanum fonts-noto-cjk \
        libgl1 libglib2.0-0 \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── H2Orestart (LibreOffice 한글 확장) ───────────────────────────────────────
# `--shared` 가 핵심이다. 서버는 변환마다 격리된 LibreOffice 프로필을 쓰므로,
# 사용자 프로필에만 설치하면 변환이 "source file could not be loaded" 로 실패한다.
#
# **빌드 중에 내려받지 않는다.** GitHub 릴리스는 objects.githubusercontent.com 으로
# 리다이렉트되는데 사내망에서 그 호스트가 막혀 빌드가 죽었다(deb.debian.org 는 되는데
# 이쪽만 안 됐다). 호스트가 미리 받아 두고 여기서는 복사만 한다 —
# `scripts/build-image.sh` 가 없으면 알아서 받는다.
# ── 한글 폰트 대체 규칙 ──────────────────────────────────────────────────────
# fonts-nanum 을 깔아도 문서가 요구하는 이름(한컴바탕·함초롬돋움·굴림·휴먼명조…)은
# 시스템에 없다. 규칙이 없으면 fontconfig 가 전부 기본값 하나로 떨어뜨린다 —
# 실측에서 명조든 고딕이든 죄다 **Noto Sans CJK JP(일본어 자형)** 로 그려졌다.
# 자폭이 달라 줄바꿈이 밀리고 쪽 수까지 바뀐다 — 실측 64쪽이 규칙 적용 후 61쪽이
# 됐고, 그 61쪽이 한글에서 연 원본과 일치했다(2026-09-03).
# 자세한 내용은 파일 머리말.
# 목적지 이름의 `99-` 는 fontconfig 의 읽는 순서다(늦게 읽혀야 이긴다).
COPY config/korean-fonts.conf /etc/fonts/conf.d/99-docsuree-korean.conf
RUN fc-cache -f \
    && fc-match "한컴바탕:lang=ko" | grep -qi "myeongjo\|serif" \
    && fc-match "굴림:lang=ko"     | grep -qi "nanumgothic\|sans"

COPY vendor/H2Orestart.oxt /tmp/H2Orestart.oxt
# JAVA_HOME 을 박아 둔다 — libreoffice-java-common 이 있어도 컨테이너에는 데스크톱
# 설정이 없어 JVM 탐색이 빗나갈 수 있다. 실행 시에도 변환이 이 값을 쓴다.
ENV JAVA_HOME=/usr/lib/jvm/default-java
RUN unopkg add --shared /tmp/H2Orestart.oxt \
    && rm /tmp/H2Orestart.oxt \
    && unopkg list --shared | grep -q H2Orestart

WORKDIR /app

# ── 파이썬 의존성 ────────────────────────────────────────────────────────────
# 잠금 파일만 먼저 복사해 레이어를 캐시한다 — 소스만 고칠 때 torch 를 다시 안 받는다.
# `--locked` 로 uv.lock 과 다른 버전으로 몰래 재해석하지 못하게 막는다.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-install-project

# ── rhwp freetype 보정 ──────────────────────────────────────────────────────
# 0.8.1 Linux 휠이 낡은 FreeType 을 번들해 `import rhwp` 가 깨진다. 스크립트는
# 먼저 import 를 검사하므로 상류가 고친 뒤에는 아무것도 하지 않는다.
COPY scripts/fix-rhwp-freetype.sh ./scripts/
RUN ./scripts/fix-rhwp-freetype.sh

# ── Docling 모델 미리 받기 ──────────────────────────────────────────────────
# 이게 빠지면 폐쇄망에서 **첫 PDF 검토 때** HuggingFace 에 못 닿아 표 구조·머리말
# 분리가 통째로 빠진다. 죽지는 않고 INFO 로 알려주지만, 그 상태로 계속 돈다.
#
# **`docling-tools models download` 를 쓰지 않는다.** 그 명령은 docling 자기 캐시
# (`settings.cache_dir`)에 받는데, 우리 런타임은 `artifacts_path` 를 주지 않아
# HuggingFace 캐시를 본다 — 서로 다른 자리라 받아 놓고도 못 찾는다. 실제로 빌드가
# 32초 만에 "성공"하고 이미지에 모델이 없었다(2026-08-25).
#
# 그래서 런타임이 읽는 그 형식 그대로, 쓰는 저장소만 받는다.
# 실측 용량: layout-heron 164MB · docling-models 342MB · CodeFormulaV2 611MB.
ENV HF_HOME=/opt/hf
RUN uv run --no-sync python -c "\
from huggingface_hub import snapshot_download; \
[snapshot_download(r) for r in ('docling-project/docling-layout-heron', \
                                'docling-project/docling-models', \
                                'docling-project/CodeFormulaV2')]" \
    && chmod -R a+rX /opt/hf

# ── 앱 ──────────────────────────────────────────────────────────────────────
COPY . .
# **`--no-editable` 을 쓰지 않는다.** server.py 는 저장소 루트를
# `Path(__file__).parents[2]` 로 찾아 거기서 web/ 과 presets/ 를 읽는다. no-editable
# 로 깔면 파일이 site-packages 안으로 들어가 그 계산이 /app/.venv/lib/python3.12 를
# 가리키고, web/ 을 못 찾아 화면이 통째로 404 가 된다(실측 2026-08-25). editable 이면
# /app/src/app/server.py → parents[2] = /app 로 맞는다.
RUN uv sync --locked

# 영속 데이터는 이 한 곳으로 모은다 — compose 가 볼륨 하나만 붙이면 된다.
# (검토 이력 · 최근 원본 · 업로드 기준)
ENV DOCSUREE_DATA_DIR=/data

# 문서를 다루는 서버라 root 로 돌리지 않는다.
# **`/app` 을 chown 하지 않는다.** 안에 수 GB 짜리 venv 가 있는데, 소유권만 바꿔도
# Docker 는 레이어에 그 파일들을 통째로 다시 쓴다 — venv 가 이미지에 두 번 들어가
# 19.2GB 가 됐다(실측 2026-08-25). 앱은 /app 에 쓸 일이 없고 읽기·실행만 하며,
# 그 권한은 기본값으로 이미 있다. 쓰기가 필요한 곳은 /data 하나뿐이다.
RUN useradd --system --create-home --uid 10001 docsuree \
    && mkdir -p /data && chown docsuree:docsuree /data
USER docsuree

EXPOSE 8000

# 컨테이너 안에서는 0.0.0.0 이어야 포트 매핑이 닿는다. **밖으로 여는 범위는
# compose 의 포트 매핑이 정한다** — 인증이 없으므로 기본값은 127.0.0.1 로 묶여 있다.
CMD ["uv", "run", "--no-sync", "docsuree", "serve", "--host", "0.0.0.0", "--port", "8000"]
