/* ============================================================
   camera.js  カメラ映像の取得と1枚の切り出し
   出力（例 1280×960）より大きめの映像を頼み、中央を 4:3 で切って縮める。
   「静止画モード」では ImageCapture.takePhoto で
   センサー本来の画素から切り出す（対応端末のみ。失敗したら映像から）。
   ============================================================ */
const Camera = (() => {
  let stream = null, track = null, imageCapture = null;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async function start(video, longSide) {
    stop();
    const want = Math.max(1920, longSide || 1280);
    const tries = [
      { facingMode: { ideal: 'environment' }, width: { ideal: want }, height: { ideal: Math.round(want * 3 / 4) }, aspectRatio: { ideal: 4 / 3 } },
      { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: { ideal: 'environment' } },
      true
    ];
    let err = null;
    for (const c of tries) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
        break;
      } catch (e) {
        err = e;
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      }
    }
    if (!stream) throw err || new Error('カメラを開けませんでした');
    track = stream.getVideoTracks()[0];
    imageCapture = ('ImageCapture' in window) ? (() => { try { return new ImageCapture(track); } catch (e) { return null; } })() : null;
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play().catch(() => {});
    if (!video.videoWidth) {
      await new Promise(r => { video.onloadedmetadata = () => r(); setTimeout(r, 3000); });
    }
    return info(video);
  }

  function info(video) {
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    const st = track && track.getSettings ? track.getSettings() : {};
    return {
      w: video.videoWidth, h: video.videoHeight,
      torch: !!caps.torch,
      zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: st.zoom || caps.zoom.min } : null,
      still: !!imageCapture
    };
  }

  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; track = null; imageCapture = null;
  }

  function alive() { return !!(track && track.readyState === 'live'); }

  async function setTorch(on) {
    if (!track) return false;
    try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch (e) { return false; }
  }
  async function setZoom(z) {
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (e) {}
  }

  /** 撮影元（映像そのもの or 静止画）を返す */
  async function grabSource(video, useStill) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (useStill && imageCapture) {
      try {
        const blob = await imageCapture.takePhoto();
        const bmp = await createImageBitmap(blob);
        // 向きが映像と食い違う端末では使わない（回転方向が端末ごとに違うため）
        if ((bmp.width >= bmp.height) === (vw >= vh) && bmp.width >= vw) {
          return { src: bmp, w: bmp.width, h: bmp.height, still: true };
        }
        bmp.close && bmp.close();
      } catch (e) { /* 映像から切り出す */ }
    }
    return { src: video, w: vw, h: vh, still: false };
  }

  /** 中央を outW:outH の比で切り出して outW×outH の canvas に描く */
  function cropTo(source, outW, outH) {
    const ar = outW / outH;
    let cw = source.w, ch = cw / ar;
    if (ch > source.h) { ch = source.h; cw = ch * ar; }
    const cx = (source.w - cw) / 2, cy = (source.h - ch) / 2;

    // 大きく縮めるときは半分ずつ縮めて画質を保つ
    let img = source.src, sx = cx, sy = cy, sw = cw, sh = ch;
    while (sw / 2 >= outW * 1.0 && sh / 2 >= outH * 1.0) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      img = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return { canvas: out, ctx, srcCropW: Math.round(cw), srcCropH: Math.round(ch) };
  }

  return { supported, start, stop, alive, info: v => info(v), setTorch, setZoom, grabSource, cropTo };
})();
