/* DocSuree 소개 영상 사운드트랙 — 120 BPM(1박 0.5초). OfflineAudioContext로 합성해 WAV로 만든다.
   index.html의 시간표와 같은 시각에 소리가 나도록 맞춰져 있다. 장면 경계(2·10·18·26·34초)에 히트,
   28초(근거 없는 지적이 접힘)에 가장 큰 히트. 그 직전 1.5초는 드럼을 빼서 비워 둔다.
   사용: const b64 = await renderSoundtrack(40); (WAV, base64) */
async function renderSoundtrack(duration = 40, rate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const master = ctx.createGain();
  master.gain.setValueAtTime(1.2, 0);
  master.gain.setValueAtTime(1.2, duration - 1.6);
  master.gain.linearRampToValueAtTime(0.0001, duration - 0.05);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  const BEAT = 0.5;
  const env = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  function tone(t, f0, f1, dur, type = "sine", peak = 0.2, attack = 0.004, out = master) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, attack, peak, dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, rate * 2, rate), d = b.getChannelData(0);
    let s = 11;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return b;
  })();
  function noise(t, dur, freq, q, peak, type = "bandpass", sweepTo = null, attack = 0.01) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t); src.stop(t + attack + dur + 0.1);
  }
  const drumsOff = (t) => (t >= 26.5 && t < 28) || t >= 38;

  // ── 리듬: 킥은 매 박, 하이햇은 엇박, 2박·4박에 가벼운 스냅 ──
  for (let b = 4; b < duration / BEAT; b++) {
    const t = b * BEAT;
    if (drumsOff(t)) continue;
    const level = t >= 34 ? 0.6 : 1;
    tone(t, 120, 46, 0.18, "sine", 0.42 * level);
    noise(t + BEAT / 2, 0.04, 8000, 0.8, 0.035 * level, "highpass");
    if (b % 2 === 1) noise(t, 0.09, 1900, 1.2, 0.07 * level);
  }
  // 훅 동안은 심장박동처럼 두 번씩만
  [0.0, 0.25, 1.0, 1.25].forEach((t, i) => tone(t, 90, 42, 0.2, "sine", i % 2 ? 0.22 : 0.34));

  // ── 화음: 2마디(4초)마다 바뀌는 패드 + 베이스 ──
  const pad = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1800;
  pad.gain.value = 0.045;
  lp.frequency.setValueAtTime(1800, 26.4);
  lp.frequency.exponentialRampToValueAtTime(500, 26.9);             // 페이오프: 먹먹하게
  lp.frequency.setValueAtTime(500, 27.95);
  lp.frequency.exponentialRampToValueAtTime(2400, 28.1);            // 28초에 활짝
  pad.connect(lp).connect(master);
  const D = [146.8, 293.7, 370.0, 440.0, 554.4], Bm = [123.5, 246.9, 293.7, 370.0, 440.0];
  const G = [98.0, 196.0, 246.9, 293.7, 370.0], A = [110.0, 220.0, 277.2, 329.6, 440.0];
  const CHORDS = [[0, Bm], [2, D], [6, Bm], [10, G], [14, A], [18, D], [22, Bm], [26, G], [28, A], [30, D], [34, G], [36, D]];
  CHORDS.forEach(([start, notes], i) => {
    const end = i + 1 < CHORDS.length ? CHORDS[i + 1][0] : duration;
    notes.slice(1).forEach((f) => {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator(), gg = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f; o.detune.value = det;
        gg.gain.setValueAtTime(0.0001, start);
        gg.gain.exponentialRampToValueAtTime(0.25, start + 0.15);
        gg.gain.setValueAtTime(0.25, Math.max(start + 0.15, end - 0.08));
        gg.gain.exponentialRampToValueAtTime(0.0001, end + 0.02);
        o.connect(gg).connect(pad);
        o.start(start); o.stop(end + 0.1);
      }
    });
    // 베이스: 근음을 8분음표로
    if (start >= 2) for (let t = start; t < end - 0.01; t += BEAT / 2) {
      if (drumsOff(t)) continue;
      tone(t, notes[0], notes[0], 0.2, "sawtooth", t % BEAT === 0 ? 0.05 : 0.03, 0.006);
    }
  });

  // ── 장면 경계 히트 ──
  function hit(t, big = false) {
    tone(t, big ? 160 : 140, 38, big ? 0.7 : 0.4, "sine", big ? 0.75 : 0.5);
    noise(t, big ? 1.4 : 0.6, 6000, 0.6, big ? 0.12 : 0.07, "highpass", null, 0.003);
    noise(t, big ? 0.25 : 0.15, 1200, 0.8, big ? 0.2 : 0.12);
    if (big) [587.3, 740.0, 880.0, 1174.7].forEach((f, i) => tone(t + i * 0.02, f, f, 1.6, "triangle", 0.05));
  }
  [2, 10, 18, 26, 34].forEach((t) => hit(t));
  hit(28, true);
  // 앞으로 당기는 라이저
  noise(26.9, 1.05, 400, 2, 0.12, "bandpass", 5000, 0.9);
  tone(27.0, 220, 880, 0.95, "sine", 0.04, 0.9);

  // ── UI 효과음 ──
  const click = (t) => { tone(t, 2400, 1800, 0.03, "square", 0.05); noise(t, 0.02, 3500, 2, 0.08); };
  const whoosh = (t, d = 0.45, up = true) => noise(t, d, up ? 500 : 4000, 1.2, 0.09, "bandpass", up ? 4000 : 500, d * 0.6);
  const ping = (t, f = 1318.5) => { tone(t, f, f, 0.35, "sine", 0.08); tone(t + 0.06, f * 1.5, f * 1.5, 0.3, "sine", 0.05); };
  // 훅: 돋보기가 굴러와 "근거"를 확대 → 검색 아이콘으로
  whoosh(0.85, 0.5); tone(1.4, 660, 660, 0.25, "sine", 0.07); whoosh(1.55, 0.45, false);
  [3.5, 8.5, 31.45].forEach(click);
  whoosh(4.0, 0.5); whoosh(4.5, 0.45, false);
  noise(4.9, 0.12, 2500, 1, 0.05); tone(5.86, 180, 90, 0.12, "sine", 0.25);   // 파일 들어 올림 · 떨어뜨림
  ping(6.0, 1046.5); ping(6.5, 1318.5);                                        // 첨부 완료
  noise(8.7, 0.9, 300, 1, 0.05, "bandpass", 3000, 0.7);                        // 진행 막대
  whoosh(9.0, 0.4, false); whoosh(9.5, 0.55);
  // 스캔: 줄마다 짧은 틱
  for (let j = 0; j < 10; j++) tone(10.8 + j * 0.45, j % 2 ? 1600 : 1400, 1400, 0.04, "sine", 0.05);
  whoosh(15.5, 0.3); whoosh(16.0, 0.3); whoosh(23.0, 0.3);                    // 카드 펼침
  // 원문 대조: 글자마다 타자 소리처럼
  for (let k = 0; k < 14; k++) noise(18.6 + k * 0.057, 0.015, 4500, 3, 0.05, "bandpass", null, 0.002);
  for (let k = 0; k < 16; k++) noise(21.6 + k * 0.044, 0.015, 4500, 3, 0.05, "bandpass", null, 0.002);
  ping(19.45, 1318.5); ping(22.35, 1318.5);                                    // 근거 확인
  // 찾아도 없음
  for (let k = 0; k < 8; k++) tone(24.6 + k * 0.15, 900 - k * 40, 900 - k * 40, 0.03, "sine", 0.035);
  tone(25.9, 330, 220, 0.4, "triangle", 0.06);
  whoosh(26.5, 0.4); whoosh(28.5, 0.35, false); whoosh(29.0, 0.4, false);     // 흰 판 · 칩으로 접힘
  // DoSuree 대화: 돋보기가 대화 화면을 열고 → 마스코트 돋보기에 들어갔다가 → 답의 인용 위로
  whoosh(29.75, 0.55); tone(30.75, 880, 880, 0.18, "sine", 0.05);
  for (let k = 0; k < 16; k++) noise(30.6 + k * 0.044, 0.015, 3800, 3, 0.045, "bandpass", null, 0.002);
  whoosh(31.5, 0.35, false);
  for (let k = 0; k < 6; k++) tone(31.95 + k * 0.12, 1200, 1200, 0.03, "sine", 0.025);
  tone(32.6, 520, 520, 0.12, "sine", 0.06);
  ping(33.15, 1318.5); ping(33.45, 1568.0);
  // 엔드: 화면이 돋보기 안으로 → 마스코트
  noise(34.0, 0.9, 5000, 1, 0.1, "bandpass", 300, 0.6);
  whoosh(35.1, 0.6); tone(35.7, 220, 440, 0.5, "sine", 0.06);
  [[36.5, 587.3], [37.0, 740.0], [37.5, 880.0]].forEach(([t, f]) => tone(t, f, f, 1.2, "triangle", 0.07));
  [293.7, 440.0, 587.3, 740.0].forEach((f) => tone(38.0, f, f, 1.9, "triangle", 0.045, 0.02));

  const buf = await ctx.startRendering();
  return toWavBase64(buf);
}

function toWavBase64(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE");
  str(12, "fmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, "data"); data.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  const bytes = new Uint8Array(data.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
window.renderSoundtrack = renderSoundtrack;
