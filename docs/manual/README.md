# DocSuree 소개 자료

| 파일 | 무엇 |
|---|---|
| `DocSuree-소개영상.webp` | README "한눈에 보기"의 소개 영상 (40초 · 1600px · 15fps · 소리 없음). GIF 는 256색 한계로 글씨가 거칠어져 움직이는 WebP 를 쓴다 |
| `film/index.html` | 영상 원본. 브라우저로 열면 아래 막대로 재생 · 탐색할 수 있다. 주소 뒤 `?t=12` 는 그 시점 정지 화면 |
| `film/sound.js` | 사운드트랙(120 BPM). 브라우저 안에서 합성한다 |
| `film/render.cjs` | MP4 · WebP · 정지 화면 렌더러 |
| `screens/*.png` | README "시스템 구동 화면"의 그림(홈 · 업로드 · 검토 결과 · DoSuree 대화). 영상과 같은 화면을 카메라 · 돋보기 없이 원래 크기로 찍은 것 |

영상은 캡처가 아니다. 실제 화면(`web/public/screenshots/`)의 구성을 벡터로 다시 그렸고,
글꼴 · 마스코트 · 로고는 `web/public/` 의 것을 그대로 쓴다. 하나의 돋보기가 처음부터 끝까지 이어진다 —
"근거"를 확대하고, 업로드 아이콘이 되고, 결과 화면을 열고, 인용을 원문과 대조하고, DoSuree 답의 인용을
확인한 뒤 마스코트의 돋보기로 들어간다.

## 다시 만들기

```bash
PLAYWRIGHT=<node_modules/playwright 경로> \
  node docs/manual/film/render.cjs video    # → docs/manual/build/DocSuree-소개영상.mp4 (git 제외)
PLAYWRIGHT=… node docs/manual/film/render.cjs webp  # → docs/manual/DocSuree-소개영상.webp (페이지에서 바로 15fps 로 찍는다)
node docs/manual/film/render.cjs shots      # → docs/manual/screens/*.png
node docs/manual/film/render.cjs stills     # → 박자(0.5초)마다 한 장, 확인용
```

ffmpeg 가 필요하다. 이 저장소는 node_modules 를 두지 않으므로 Playwright 는 다른 곳에 설치된 것을 가리킨다.

## 공개 자료에 넣지 않는 것

이 폴더는 공개 저장소에 올라간다. 화면에 **사내 문서 내용 · 문서명 · 사람 이름 · 서버 주소**가 보이면 안 된다.

- 영상 속 문서는 가상의 "한빛 도서관 대출 관리 시스템" 요구사항명세서(LIB-SRS-001)다.
- 사용자 · 팀은 "홍길동 · 예시팀", 대화 기록도 예시 문장이다.
- 사용자 매뉴얼은 공개해도 되는 샘플 문서로 화면을 다시 캡처한 뒤 추가한다.
