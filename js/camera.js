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

  // ---------- 明るさ（露出） ----------
  // カメラ本体が露出補正に対応していればそれを使い（hw）、
  // 対応していなければ画像の明るさを掛け算で変える（sw：プレビューは CSS、保存画像は canvas で同じ倍率）
  function exposureCaps() {
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    const ec = caps.exposureCompensation;
    if (!ec || !(ec.max > ec.min)) return null;
    const sup = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
    return {
      min: ec.min, max: ec.max, step: ec.step || 0.1,
      poi: !!sup.pointsOfInterest,                         // 画面の位置を指定して測光できる
      continuous: (caps.exposureMode || []).includes('continuous'),
      focus: (caps.focusMode || []).filter(m => m === 'single-shot' || m === 'continuous')
    };
  }
  async function setExposure(ev) {
    if (!track) return false;
    try { await track.applyConstraints({ advanced: [{ exposureCompensation: ev }] }); return true; } catch (e) { return false; }
  }
  /** (x,y)（映像の 0〜1）を基準に測光・ピント合わせをやり直す（対応機種のみ） */
  async function meterAt(x, y) {
    if (!track) return false;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const sup = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
    const c = {};
    if (sup.pointsOfInterest) c.pointsOfInterest = [{ x, y }];
    if ((caps.exposureMode || []).includes('continuous')) c.exposureMode = 'continuous';
    const fm = caps.focusMode || [];
    if (fm.includes('single-shot')) c.focusMode = 'single-shot';
    else if (fm.includes('continuous')) c.focusMode = 'continuous';
    if (!Object.keys(c).length) return false;
    try { await track.applyConstraints({ advanced: [c] }); return true; } catch (e) { return false; }
  }

  /** 映像の (x,y)（0〜1）まわりの平均の明るさ（0〜255）。タップで自動に合わせるのに使う */
  let meterCanvas = null;
  function lumaAt(video, x, y) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const r = Math.min(vw, vh) * 0.12; // タップ位置のまわり（短辺の 24% 四方）
    const sx = Math.min(Math.max(0, x * vw - r), vw - 2 * r), sy = Math.min(Math.max(0, y * vh - r), vh - 2 * r);
    meterCanvas = meterCanvas || document.createElement('canvas');
    meterCanvas.width = 24; meterCanvas.height = 24;
    const g = meterCanvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, sx, sy, 2 * r, 2 * r, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
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

  /** 回転 rot（0/90/180/270）で正立させたときに outW×outH になるよう、
      映像の中央を切り出す。返す cw,ch は映像上（回転前）の切り出し寸法 */
  function cropRect(sw0, sh0, outW, outH, rot) {
    const odd = rot === 90 || rot === 270;
    const tw = odd ? outH : outW, th = odd ? outW : outH; // 映像上での縦横
    const ar = tw / th;
    let cw = sw0, ch = cw / ar;
    if (ch > sh0) { ch = sh0; cw = ch * ar; }
    return { cx: (sw0 - cw) / 2, cy: (sh0 - ch) / 2, cw, ch, tw, th };
  }

  /** 映像を正立させ、中央を切り出して outW×outH の canvas に描く。
      rot=90 は「スマホを左に倒した（上端が左）」とき：映像の右側が上になるよう左へ回す */
  function cropTo(source, outW, outH, rot, gain) {
    rot = rot || 0;
    gain = gain || 1; // 明るさの倍率（sw のときだけ 1 以外）
    const { cx, cy, cw, ch, tw, th } = cropRect(source.w, source.h, outW, outH, rot);

    // 大きく縮めるときは半分ずつ縮めて画質を保つ
    let img = source.src, sx = cx, sy = cy, sw = cw, sh = ch;
    while (sw / 2 >= tw && sh / 2 >= th) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      if (img !== source.src) release(img);
      img = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    if (rot === 90) { ctx.translate(0, outH); ctx.rotate(-Math.PI / 2); }
    else if (rot === 270) { ctx.translate(outW, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(outW, outH); ctx.rotate(Math.PI); }
    const useFilter = gain !== 1 && 'filter' in ctx;
    if (useFilter) ctx.filter = 'brightness(' + gain.toFixed(3) + ')';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    ctx.restore();
    if (img !== source.src) release(img);
    if (gain !== 1 && !useFilter) {
      // canvas の filter が無いブラウザ（古い Safari など）は画素ごとに掛ける
      const im = ctx.getImageData(0, 0, outW, outH), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, d[i] * gain); d[i + 1] = Math.min(255, d[i + 1] * gain); d[i + 2] = Math.min(255, d[i + 2] * gain);
      }
      ctx.putImageData(im, 0, 0);
    }
    // 拡大になっているかの判定用に、正立後の向きでの切り出し幅を返す
    const odd = rot === 90 || rot === 270;
    return { canvas: out, ctx, srcCropW: Math.round(odd ? ch : cw), srcCropH: Math.round(odd ? cw : ch) };
  }

  /** 作業用 canvas のメモリをすぐ返す。
      低性能の Android では GC を待つ間にカメラ映像と合わせてメモリが尽き、画面が固まることがある */
  function release(c) {
    if (c && 'width' in c) { c.width = 0; c.height = 0; }
  }

  return {
    supported, start, stop, alive, info: v => info(v), setTorch, setZoom, grabSource, cropTo, cropRect, release,
    exposureCaps, setExposure, meterAt, lumaAt
  };
})();
