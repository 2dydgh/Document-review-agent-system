// DocSuree 소개 영상 렌더러
//   node docs/manual/film/render.cjs stills [t1 t2 ...]   → docs/manual/build/stills/*.png (박자별 확인용)
//   node docs/manual/film/render.cjs audio                → docs/manual/build/soundtrack.wav
//   node docs/manual/film/render.cjs video                → docs/manual/build/DocSuree-소개영상.mp4 (60fps, 서브프레임 6장 모션 블러 + 소리)
//   node docs/manual/film/render.cjs gif                  → docs/manual/DocSuree-소개영상.gif (README용, 800px · 12fps · 소리 없음)
// build/ 는 git 에서 빠진다. 이 저장소는 node_modules 를 두지 않으므로 Playwright 위치를 환경변수로 넘긴다.
//   PLAYWRIGHT=/path/to/node_modules/playwright node docs/manual/film/render.cjs video
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");

const ROOT = __dirname;
const MANUAL = path.resolve(ROOT, "..");
const BUILD = path.join(MANUAL, "build");
const MP4 = path.join(BUILD, "DocSuree-소개영상.mp4");
const GIF = path.join(MANUAL, "DocSuree-소개영상.gif");
const FPS = 60, SUB = 6;
const BEATS = Array.from({ length: 80 }, (_, i) => i * 0.5 + 0.25);   // 120 BPM, 박마다 가운데 한 장

function loadPlaywright() {
  const p = process.env.PLAYWRIGHT;
  try { return require(p || "playwright"); }
  catch { throw new Error("Playwright 를 찾을 수 없습니다. PLAYWRIGHT=<node_modules/playwright 경로> 로 지정하세요."); }
}

async function openPage() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  await page.goto("file://" + path.join(ROOT, "index.html") + "?render");
  await page.evaluate(() => window.ready);
  return { browser, page };
}

async function stills(times) {
  const dir = path.join(BUILD, "stills");
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page } = await openPage();
  for (const t of times) {
    await page.evaluate((x) => window.seek(x), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(2).padStart(5, "0")}.png`) });
  }
  await browser.close();
  console.log(`stills: ${times.length} → ${dir}`);
}

async function audio() {
  fs.mkdirSync(BUILD, { recursive: true });
  const { browser, page } = await openPage();
  const b64 = await page.evaluate(() => window.renderSoundtrack(window.DURATION));
  const file = path.join(BUILD, "soundtrack.wav");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  await browser.close();
  console.log("audio →", file);
  return file;
}

async function video() {
  fs.mkdirSync(BUILD, { recursive: true });
  const wav = await audio();
  const { browser, page } = await openPage();
  const duration = await page.evaluate(() => window.DURATION);
  const frames = Math.round(duration * FPS);
  const silent = path.join(BUILD, "video-silent.mp4");
  // 서브프레임 6장씩 → tmix로 평균 → 6장마다 1장 선택 = 60fps 모션 블러
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "mjpeg", "-i", "-",
    "-vf", `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`,
    "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < SUB; k++) {
      await page.evaluate((x) => window.seek(x), (f * SUB + k) / (FPS * SUB));
      const buf = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (f % 120 === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`frame ${f}/${frames}  ${el.toFixed(0)}s elapsed, eta ${((el / Math.max(f, 1)) * (frames - f)).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error("ffmpeg exit " + c)))));
  await browser.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", MP4]);
  console.log("video →", MP4);
}

function gif() {
  const pal = path.join(BUILD, "palette.png");
  const vf = "fps=12,scale=800:-1:flags=lanczos";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", MP4, "-vf", `${vf},palettegen=max_colors=128:stats_mode=diff`, pal]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", MP4, "-i", pal, "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, GIF]);
  console.log("gif →", GIF, (fs.statSync(GIF).size / 1e6).toFixed(1) + "MB");
}

(async () => {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "stills") await stills(rest.length ? rest.map(Number) : BEATS);
  else if (mode === "audio") await audio();
  else if (mode === "video") await video();
  else if (mode === "gif") gif();
  else console.log("usage: render.cjs stills|audio|video|gif");
})().catch((e) => { console.error(e); process.exit(1); });
