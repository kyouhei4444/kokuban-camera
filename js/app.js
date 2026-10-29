/* ============================================================
   app.js  画面の動き
   ホーム（現場の選択）→ 黒板の入力 → カメラ → 写真一覧
   ============================================================ */
(() => {
  const VERSION = '1.1.1';
  const RES_LIST = ['640x480', '1280x960', '1600x1200', '2048x1536', '2592x1944'];
  const THEME_NAME = { green: '緑', black: '黒', white: '白' };
  const KOUSYU_DEFAULT = [
    '着手前', '完成', '施工状況', '安全管理', '使用材料', '品質管理', '出来形管理',
    '準備工', '仮設工', '掘削工', '盛土工', '法面工', '擁壁工', '基礎工', '型枠工', '鉄筋工',
    'コンクリート工', '排水構造物工', '側溝工', '舗装工', '区画線工', '防護柵工', '構造物撤去工',
    '管布設工', '土留工', '植生工', '後片付け'
  ];

  const $ = id => document.getElementById(id);
  let set = Store.settings();
  let curSiteId = null;
  let pending = null; // 入力途中でまだ保存していない現場（curSite() はこちらを優先して返す）
  let camOpen = false, camInfo = null, busy = false;
  let gpsWatch = null, gpsLast = null;
  let wakeLock = null;
  let lastName = '';
  let gallery = [], gallerySel = new Set(), galleryUrls = [];

  // ---------- 共通 ----------
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function stamp(d) { return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()); }
  function fmtDateTime(d) { return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); }
  function resWH(r) { const [w, h] = r.split('x').map(Number); return [w, h]; }
  function saveSet() { Store.saveSettings(set); }
  function curSite() {
    if (pending && pending.id === curSiteId) return pending;
    return curSiteId ? Store.site(curSiteId) : null;
  }
  function ensureSite(s) {
    s.board = Object.assign({ kousyu: '', shubetsu: '', sokuten: '', naiyou: '' }, s.board || {});
    s.hist = Object.assign({ kousyu: [], shubetsu: [], sokuten: [], naiyou: [] }, s.hist || {});
    return s;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\s　]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

  // ---------- 画面の切り替え（Android の戻るボタンに対応） ----------
  function go(v) { history.pushState({ v }, ''); render(v); }
  window.addEventListener('popstate', e => {
    if (!$('dlg').classList.contains('hidden')) closeDlg();
    if (!$('viewer').classList.contains('hidden')) closeViewer();
    render((e.state && e.state.v) || 'home');
  });

  function render(v) {
    flushSite();
    if ((v === 'board' || v === 'gallery' || v === 'camera') && !curSite()) v = 'home';
    if (v !== 'camera' && camOpen) closeCamera();
    ['home', 'board', 'gallery'].forEach(n => $('view-' + n).classList.toggle('active', n === v));
    $('tb-back').classList.toggle('hidden', v === 'home');
    const s = curSite();
    if (v === 'home') {
      $('tb-title').textContent = '黒板カメラ';
      $('tb-sub').textContent = '現場を選んでください';
      renderHome();
    } else if (v === 'board') {
      $('tb-title').textContent = s.name;
      $('tb-sub').textContent = '黒板の入力';
      renderBoard();
    } else if (v === 'gallery') {
      $('tb-title').textContent = s.name;
      $('tb-sub').textContent = '写真一覧';
      renderGallery();
    } else if (v === 'camera') {
      openCamera();
    }
    window.scrollTo(0, 0);
  }

  // ---------- ホーム ----------
  function renderHome() {
    const list = Store.sites().map(ensureSite).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    const box = $('site-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty-site">まだ現場がありません。<br>下のボタンから登録してください。</div>';
    } else {
      box.innerHTML = list.map(s => `
        <div class="site${s.id === curSiteId ? ' cur' : ''}" data-id="${esc(s.id)}">
          <button class="site-main" data-act="open">
            <div class="site-name">${esc(s.name)}</div>
            <div class="site-sub">${esc(s.contractor || '受注者未入力')} ・ 写真 <span data-cnt>…</span> 枚</div>
          </button>
          <button class="site-edit" data-act="edit" title="編集">✎</button>
        </div>`).join('');
      list.forEach(s => {
        Store.countPhotos(s.id).then(n => {
          const el = box.querySelector(`[data-id="${CSS.escape(s.id)}"] [data-cnt]`);
          if (el) el.textContent = n;
        }).catch(() => {});
      });
    }
    renderInstall();
    $('home-res').textContent = set.res.replace('x', '×');
    $('home-theme').textContent = THEME_NAME[set.theme] || set.theme;
  }

  $('site-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.site').dataset.id;
    if (btn.dataset.act === 'open') openSite(id);
    else siteDialog(Store.site(id));
  });
  $('btn-site-add').onclick = () => siteDialog(null);

  function openSite(id) {
    const s = ensureSite(Store.site(id));
    s.lastUsed = Date.now();
    Store.putSite(s);
    curSiteId = id;
    go('board');
  }

  function siteDialog(s) {
    flushSite();
    const isNew = !s;
    const last = Store.sites().slice(-1)[0];
    s = ensureSite(s ? JSON.parse(JSON.stringify(s)) : { id: uid(), name: '', contractor: last ? last.contractor : '', createdAt: Date.now() });
    openDlg(isNew ? '新しい現場' : '現場の編集', `
      <label class="fld"><span>工事名（黒板に載ります）</span>
        <input id="d-name" value="${esc(s.name)}" placeholder="例：〇〇線 道路改良工事"></label>
      <label class="fld"><span>受注者名（黒板に載ります）</span>
        <input id="d-contractor" value="${esc(s.contractor)}" placeholder="例：〇〇建設株式会社"></label>
      <label class="fld"><span>メモ（任意・黒板には載りません）</span>
        <input id="d-memo" value="${esc(s.memo || '')}" placeholder="例：工期 R8.10〜R9.3"></label>
      <button id="d-save" class="btn primary big mt">${isNew ? '登録して開く' : '保存'}</button>
      ${isNew ? '' : '<button id="d-del" class="btn danger mt">この現場を削除（写真も消えます）</button>'}
    `);
    setTimeout(() => $('d-name').focus(), 50);
    $('d-save').onclick = () => {
      const name = $('d-name').value.trim();
      if (!name) { toast('工事名を入れてください'); return; }
      s.name = name;
      s.contractor = $('d-contractor').value.trim();
      s.memo = $('d-memo').value.trim();
      Store.putSite(s);
      closeDlg();
      if (isNew) openSite(s.id); else render(history.state && history.state.v || 'home');
    };
    if (!isNew) {
      $('d-del').onclick = async () => {
        const n = await Store.countPhotos(s.id).catch(() => 0);
        if (!confirm(`「${s.name}」を削除します。\nこの現場の写真 ${n} 枚もアプリから消えます。よろしいですか？`)) return;
        await Store.deleteSitePhotos(s.id).catch(() => {});
        Store.removeSite(s.id);
        if (curSiteId === s.id) curSiteId = null;
        closeDlg();
        renderHome();
      };
    }
  }

  // ---------- 黒板の入力 ----------
  const FIELDS = ['kousyu', 'shubetsu', 'sokuten', 'naiyou'];

  function renderBoard() {
    const s = ensureSite(curSite());
    FIELDS.forEach(k => { $('f-' + k).value = s.board[k] || ''; });
    fillLists(s);
    drawPreview();
    Store.countPhotos(s.id).then(n => { $('cnt-photos').textContent = n; }).catch(() => {});
  }

  // 入力の候補は下のチップで出す（<datalist> は Android の Chrome で入力が固まることがあるので使わない）
  function chipLists(s) {
    const kous = [...s.hist.kousyu, ...KOUSYU_DEFAULT.filter(k => !s.hist.kousyu.includes(k))];
    return {
      kousyu: kous.slice(0, 14),
      shubetsu: s.hist.shubetsu.slice(0, 10),
      sokuten: s.hist.sokuten.slice(0, 10),
      naiyou: s.hist.naiyou.slice(0, 8)
    };
  }
  function fillLists(s) {
    const L = chipLists(s);
    FIELDS.forEach(k => chips('chips-' + k, L[k], k, 'f-'));
  }
  function chips(boxId, arr, field, prefix) {
    const box = $(boxId);
    if (!box) return;
    box.innerHTML = arr.map((v, i) => `<button type="button" class="chip" data-i="${i}">${esc(v.split('\n')[0] || v)}${v.includes('\n') ? '…' : ''}</button>`).join('');
    box.onclick = e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const v = arr[+b.dataset.i];
      setField(field, v);
      const inp = $(prefix + field);
      if (inp) inp.value = v;
      if (prefix === 'q-') updateCamLabel();
    };
  }

  // 1文字ごとの処理は軽くする：描き直しは次の描画フレームに1回、保存は入力が止まってから
  let saveTimer = null, drawQueued = false;
  function setField(k, v) {
    const s = ensureSite(curSite());
    s.board[k] = v;
    pending = s;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSite, 400);
    if (!drawQueued) {
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        if ($('view-board').classList.contains('active') && !camOpen) drawPreview();
        if (camOpen) layoutBoard();
      });
    }
  }
  function flushSite() {
    clearTimeout(saveTimer);
    if (pending) { Store.putSite(pending); pending = null; }
  }
  window.addEventListener('pagehide', flushSite);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSite(); });
  FIELDS.forEach(k => $('f-' + k).addEventListener('input', e => setField(k, e.target.value)));

  function stepNo(s, d) {
    s = s || '';
    let m = s.match(/^(.*?No\.?\s*)(\d+)(.*)$/i) || s.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return d > 0 && !s ? 'No.1' : s;
    const n = Math.max(0, parseInt(m[2], 10) + d);
    const num = m[2].length > 1 && m[2][0] === '0' ? String(n).padStart(m[2].length, '0') : String(n);
    return m[1] + num + m[3];
  }
  function stepSokuten(d) {
    const s = curSite();
    const v = stepNo(s.board.sokuten, d);
    setField('sokuten', v);
    $('f-sokuten').value = v;
    updateCamLabel();
  }
  document.querySelectorAll('[data-step]').forEach(b => { b.onclick = e => { e.preventDefault(); stepSokuten(+b.dataset.step); }; });

  function boardRows(date) {
    const s = ensureSite(curSite());
    return Board.rows(s, s.board, set, date || new Date());
  }

  // 高精細画面（DuraForce PRO 2 は約3倍）でも 2 倍までに抑える。canvas の作り直しは大きさが変わったときだけ
  function pixelRatio() { return Math.min(2, window.devicePixelRatio || 1); }
  function sizeCanvas(c, cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }
  function dlgOpen() { return !$('dlg').classList.contains('hidden'); }

  function drawPreview() {
    const c = $('board-preview');
    const wrap = c.parentElement;
    if (!wrap.clientWidth) return; // 画面が隠れているとき
    const cssW = Math.max(120, Math.min(wrap.clientWidth - 20, 520));
    const dpr = pixelRatio();
    const list = boardRows();
    const cssH = Board.measure(list, cssW);
    const g = sizeCanvas(c, cssW, cssH, dpr);
    Board.draw(g, 0, 0, cssW, list, set.theme);
  }

  $('btn-camera').onclick = () => { askMotion(); prepareSound(); go('camera'); };
  $('btn-gallery').onclick = () => go('gallery');

  function remember(s) {
    FIELDS.forEach(k => {
      const v = (s.board[k] || '').trim();
      if (!v) return;
      const h = s.hist[k].filter(x => x !== v);
      h.unshift(v);
      s.hist[k] = h.slice(0, 30);
    });
  }

  // ---------- カメラ ----------
  // スマホの持ち方（縦・横）は傾きセンサーで判定する。
  // 画面の自動回転がオフでも、横に倒して撮れば横の写真になるよう、映像を回して保存する。
  //   devAngle … 端末の向き（0=縦, 90=左に倒す〈上端が左〉, 270=右に倒す, 180=逆さ）
  //   rot      … 映像を正立させるのに要る回転（devAngle − 画面の回転角）
  let devAngle = 0;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  function screenAngle() {
    const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0);
    return ((a % 360) + 360) % 360;
  }
  function curRot() { return ((devAngle - screenAngle()) % 360 + 360) % 360; }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    let x = g.x, y = g.y;
    if (isIOS) { x = -x; y = -y; } // iOS は符号が逆
    if (Math.hypot(x, y) < 4.5) return; // 地面に向けて平らに持っているときは今の向きのまま
    const deg = ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
    const snap = (Math.round(deg / 90) * 90) % 360;
    let diff = Math.abs(deg - snap); if (diff > 180) diff = 360 - diff;
    if (diff > 30 || snap === devAngle) return; // 斜めのときは切り替えない
    devAngle = snap;
    if (camOpen && !dlgOpen()) layoutFrame();
  }
  window.addEventListener('devicemotion', onMotion);
  // iPhone は利用者の操作の中で許可を取る必要がある
  function askMotion() {
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().catch(() => {});
    }
  }
  window.addEventListener('orientationchange', () => { if (camOpen) setTimeout(layoutFrame, 300); });

  /** 正立した保存画像の寸法 [W,H] */
  function outSize() {
    const [w, h] = resWH(set.res);
    const v = $('cam-video');
    let portrait;
    if (set.orient === 'portrait') portrait = true;
    else if (set.orient === 'landscape') portrait = false;
    else {
      const vw = v.videoWidth || window.innerWidth, vh = v.videoHeight || window.innerHeight;
      const odd = curRot() % 180 !== 0;
      portrait = odd ? vw > vh : vh > vw;
    }
    return portrait ? [h, w] : [w, h];
  }
  function boardWidth(W, H) { return Math.min(set.boardScale * Math.max(W, H), W * 0.98); }

  async function openCamera() {
    camOpen = true;
    $('view-camera').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    updateCamLabel();
    $('cam-res').textContent = set.res.replace('x', '×');
    $('cam-bshow').classList.toggle('on', set.boardShow);
    setLastThumb();
    msg('カメラを起動しています…');
    if (!Camera.supported()) { msg('このブラウザではカメラを使えません。<br>HTTPS のページを Chrome / Safari で開いてください。'); return; }
    try {
      camInfo = await Camera.start($('cam-video'), Math.max(...resWH(set.res)));
      if (!camOpen) { Camera.stop(); return; }
      msg(null);
      $('cam-torch').classList.toggle('hidden', !camInfo.torch);
      $('cam-torch').classList.remove('on');
      const z = $('cam-zoom');
      if (camInfo.zoom && camInfo.zoom.max > camInfo.zoom.min) {
        z.min = camInfo.zoom.min; z.max = Math.min(camInfo.zoom.max, 10); z.step = camInfo.zoom.step; z.value = camInfo.zoom.value;
        z.classList.remove('hidden');
      } else z.classList.add('hidden');
      layoutFrame();
      requestWake();
      if (set.gps) gpsStart();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      msg(denied
        ? 'カメラの使用が許可されていません。<br>アドレスバーの鍵マーク →「権限」からカメラを許可してください。'
        : 'カメラを開けませんでした。<br>' + esc(e && e.message || e));
    }
  }

  function closeCamera() {
    camOpen = false;
    Camera.stop();
    gpsStop();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $('view-camera').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function msg(html) {
    const m = $('cam-msg');
    if (!html) { m.classList.add('hidden'); return; }
    m.innerHTML = html; m.classList.remove('hidden');
  }

  function updateCamLabel() {
    const s = curSite();
    if (!s) return;
    const b = s.board || {};
    $('cam-sk').textContent = [b.kousyu, b.sokuten].filter(Boolean).join(' ／ ') || '黒板を編集';
  }

  // 画面上の枠は「映像上の切り出し範囲」の形。横持ちで画面が縦のままなら縦長の枠になる
  let view = { rot: 0, fw: 0, fh: 0, W: 0, H: 0 }; // W,H は正立後のプレビュー寸法
  function layoutFrame() {
    if (!camOpen) return;
    const area = $('cam-area');
    const [W, H] = outSize();
    const rot = curRot();
    const odd = rot % 180 !== 0;
    const sw = odd ? H : W, sh = odd ? W : H; // 画面上での縦横比
    const aw = area.clientWidth, ah = area.clientHeight;
    let fw = aw, fh = aw * sh / sw;
    if (fh > ah) { fh = ah; fw = ah * sw / sh; }
    fw = Math.floor(fw); fh = Math.floor(fh);
    const f = $('cam-frame');
    f.style.width = fw + 'px';
    f.style.height = fh + 'px';
    view = { rot, fw, fh, W: odd ? fh : fw, H: odd ? fw : fh };
    $('cam-res').textContent = W + '×' + H + (W > H ? ' 横' : ' 縦');
    const v = $('cam-video');
    if (v.videoWidth) {
      const r = Camera.cropRect(v.videoWidth, v.videoHeight, W, H, rot);
      const up = (odd ? r.ch : r.cw) < W - 1;
      $('cam-src').textContent = '映像 ' + v.videoWidth + '×' + v.videoHeight + (up ? '（拡大）' : '');
    }
    layoutBoard();
  }

  // 正立座標 (u,v) → 画面の枠内座標 の変換（canvas の setTransform 用の係数）
  function uprightToScreen() {
    const { rot, W, H } = view;
    if (rot === 90) return [0, 1, -1, 0, H, 0];
    if (rot === 270) return [0, -1, 1, 0, 0, W];
    if (rot === 180) return [-1, 0, 0, -1, W, H];
    return [1, 0, 0, 1, 0, 0];
  }
  // 画面の枠内座標 → 正立座標
  function screenToUpright(x, y) {
    const { rot, W, H } = view;
    if (rot === 90) return [y, H - x];
    if (rot === 270) return [W - y, x];
    if (rot === 180) return [W - x, H - y];
    return [x, y];
  }
  function boardRect() {
    const bw = boardWidth(view.W, view.H);
    const bh = Board.measure(boardRows(), bw);
    return { x: Math.max(0, set.boardFx * (view.W - bw)), y: Math.max(0, set.boardFy * (view.H - bh)), w: bw, h: bh };
  }

  function layoutBoard() {
    const c = $('cam-board');
    if (!camOpen) return;
    c.classList.toggle('hidden', !set.boardShow);
    if (!set.boardShow || !view.fw) return;
    const dpr = pixelRatio();
    const g = sizeCanvas(c, view.fw, view.fh, dpr);
    const [a, b, cc, d, e, f] = uprightToScreen();
    g.setTransform(a * dpr, b * dpr, cc * dpr, d * dpr, e * dpr, f * dpr);
    const r = boardRect();
    Board.draw(g, r.x, r.y, r.w, boardRows(), set.theme);
    if (dragging) {
      g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // 黒板の移動（1本指でドラッグ）と大きさ（2本指でつまむ）
  let dragging = false;
  (() => {
    const c = $('cam-board');
    const pts = new Map();
    let drag = null, pinch = null;
    const local = e => {
      const r = c.getBoundingClientRect();
      return screenToUpright(e.clientX - r.left, e.clientY - r.top);
    };
    const dist = () => { const [p, q] = [...pts.values()]; return Math.hypot(p.x - q.x, p.y - q.y); };
    c.addEventListener('pointerdown', e => {
      e.preventDefault();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      if (pts.size === 2) {
        drag = null;
        pinch = { d: dist(), scale: set.boardScale };
        dragging = true;
        layoutBoard();
      } else if (pts.size === 1) {
        const [u, v] = local(e);
        const r = boardRect();
        if (u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h) {
          drag = { u, v, x: r.x, y: r.y };
          dragging = true;
          layoutBoard();
        }
      }
    });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const k = dist() / (pinch.d || 1);
        set.boardScale = Math.min(0.9, Math.max(0.1, pinch.scale * k));
        layoutBoard();
      } else if (drag) {
        const [u, v] = local(e);
        const r = boardRect();
        const x = Math.min(Math.max(0, drag.x + u - drag.u), Math.max(0, view.W - r.w));
        const y = Math.min(Math.max(0, drag.y + v - drag.v), Math.max(0, view.H - r.h));
        set.boardFx = view.W > r.w ? x / (view.W - r.w) : 0;
        set.boardFy = view.H > r.h ? y / (view.H - r.h) : 0;
        layoutBoard();
      }
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size && dragging) { dragging = false; drag = null; saveSet(); layoutBoard(); }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();

  function scaleBoard(k) {
    set.boardScale = Math.min(0.9, Math.max(0.1, set.boardScale * k));
    saveSet();
    layoutBoard();
  }
  $('cam-bbig').onclick = () => scaleBoard(1.1);
  $('cam-bsmall').onclick = () => scaleBoard(1 / 1.1);
  $('cam-bshow').onclick = () => {
    set.boardShow = !set.boardShow; saveSet();
    $('cam-bshow').classList.toggle('on', set.boardShow);
    layoutBoard();
    toast(set.boardShow ? '黒板を表示' : '黒板なしで撮影します');
  };
  $('cam-back').onclick = () => history.back();
  $('cam-set').onclick = () => settingsDialog();
  $('cam-res').onclick = () => {
    const i = RES_LIST.indexOf(set.res);
    set.res = RES_LIST[(i + 1) % RES_LIST.length];
    saveSet();
    toast('画素数 ' + set.res.replace('x', '×'));
    restartIfNeeded();
  };
  $('cam-torch').onclick = async () => {
    const on = !$('cam-torch').classList.contains('on');
    if (await Camera.setTorch(on)) $('cam-torch').classList.toggle('on', on);
  };
  $('cam-zoom').addEventListener('input', e => Camera.setZoom(+e.target.value));
  $('cam-sk-prev').onclick = () => stepSokuten(-1);
  $('cam-sk-next').onclick = () => stepSokuten(1);
  $('cam-edit').onclick = () => quickEdit();
  $('cam-thumb').onclick = () => go('gallery');
  $('cam-shutter').onclick = shoot;
  $('cam-video').addEventListener('resize', () => { if (!dlgOpen()) layoutFrame(); });
  // ダイアログで入力中はキーボードで画面の高さが変わるが、カメラ画面は組み直さない（閉じたときに1回だけ）
  window.addEventListener('resize', () => { if (camOpen && !dlgOpen()) layoutFrame(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (camOpen && !dlgOpen()) layoutFrame(); }).observe($('cam-area'));

  // 画素数を変えたら、それに見合う大きさの映像を頼み直す
  function restartIfNeeded() {
    if (!camOpen) return;
    Camera.stop();
    openCamera();
  }

  function quickEdit() {
    const s = ensureSite(curSite());
    openDlg('黒板の編集', `
      <label class="fld"><span>工種</span><input id="q-kousyu" autocomplete="off" value="${esc(s.board.kousyu)}"></label>
      <div class="chips" id="qc-kousyu"></div>
      <label class="fld"><span>種別・細別</span><input id="q-shubetsu" autocomplete="off" value="${esc(s.board.shubetsu)}"></label>
      <div class="chips" id="qc-shubetsu"></div>
      <label class="fld"><span>測点</span><input id="q-sokuten" autocomplete="off" value="${esc(s.board.sokuten)}"></label>
      <div class="chips" id="qc-sokuten"></div>
      <label class="fld"><span>黒板内容（| で区切ると表）</span><textarea id="q-naiyou" rows="4">${esc(s.board.naiyou)}</textarea></label>
      <div class="chips" id="qc-naiyou"></div>
      <button id="q-ok" class="btn primary big">撮影に戻る</button>`);
    const L = chipLists(s);
    FIELDS.forEach(k => {
      chips('qc-' + k, L[k], k, 'q-');
      $('q-' + k).addEventListener('input', e => { setField(k, e.target.value); updateCamLabel(); });
    });
    $('q-ok').onclick = closeDlg;
    // 入力中はカメラ映像の描画を止める（キーボードを出す余力を残す）
    $('cam-video').pause();
  }

  // ---------- 撮影 ----------
  async function shoot() {
    if (busy || !camOpen) return;
    const v = $('cam-video');
    if (!v.videoWidth) { toast('カメラの準備ができていません'); return; }
    busy = true;
    $('cam-shutter').disabled = true;
    flushSite();
    let canvas = null;
    try {
      const now = new Date();
      flash();
      if (set.sound) click();
      const [W, H] = outSize();
      const src = await Camera.grabSource(v, set.stillMode);
      const crop = Camera.cropTo(src, W, H, curRot());
      canvas = crop.canvas;
      const ctx = crop.ctx, srcCropW = crop.srcCropW;
      if (src.still && src.src.close) src.src.close();

      const s = ensureSite(curSite());
      if (set.boardShow) {
        const bw = boardWidth(W, H);
        const list = boardRows(now);
        const bh = Board.measure(list, bw);
        Board.draw(ctx, Math.max(0, set.boardFx * (W - bw)), Math.max(0, set.boardFy * (H - bh)), bw, list, set.theme);
      }
      const jpg = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('JPEG を作れませんでした')), 'image/jpeg', set.quality));
      const gps = gpsFix();
      const app1 = Exif.build({ date: now, width: W, height: H, gps, software: 'KokubanCamera ' + VERSION });
      const bytes = Exif.insert(await jpg.arrayBuffer(), app1);
      const sha = await sha256(bytes);
      const thumb = await makeThumb(canvas);
      Camera.release(canvas); canvas = null;

      let name = [stamp(now), safeName(s.board.kousyu), safeName(s.board.sokuten)].filter(Boolean).join('_');
      if (name === lastName || name.startsWith(lastName + '-')) name += '-' + now.getMilliseconds();
      lastName = name;
      name += '.jpg';

      const rec = {
        id: uid(), siteId: s.id, siteName: s.name, contractor: s.contractor,
        takenAt: now.getTime(), name, w: W, h: H,
        blob: new Blob([bytes], { type: 'image/jpeg' }), thumb,
        board: Object.assign({}, s.board), boardShown: set.boardShow,
        sha256: sha, gps, upscaled: srcCropW < W - 1, still: !!src.still
      };
      await Store.putPhoto(rec);
      // 保存中に黒板が書き換えられていても消さないよう、最新を読み直して履歴だけ足す
      const latest = ensureSite(curSite());
      const shot = { board: rec.board, hist: latest.hist };
      remember(shot);
      latest.hist = shot.hist;
      Store.putSite(latest);
      setLastThumb(thumb);
      toast(`保存しました ${W}×${H}` + (rec.upscaled ? '（映像から拡大）' : ''));
      if (set.autoDownload) download(rec.blob, name);
    } catch (e) {
      console.error(e);
      toast('撮影に失敗しました：' + (e && e.message || e), 4000);
    } finally {
      if (canvas) Camera.release(canvas);
      busy = false;
      $('cam-shutter').disabled = false;
    }
  }

  function flash() {
    const f = $('cam-flash');
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }
  // シャッター音。音の装置の準備は重い（初回の撮影で画面が止まる）ので、カメラを開くときに済ませておく
  let actx = null, clickBuf = null;
  function prepareSound() {
    if (!set.sound || actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const len = Math.floor(actx.sampleRate * 0.06);
      clickBuf = actx.createBuffer(1, len, actx.sampleRate);
      const d = clickBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    } catch (e) { actx = null; }
  }
  function click() {
    try {
      if (!actx) prepareSound();
      if (!actx) return;
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      const src = actx.createBufferSource();
      const g = actx.createGain(); g.gain.value = 0.5;
      src.buffer = clickBuf; src.connect(g); g.connect(actx.destination); src.start();
    } catch (e) {}
  }
  async function sha256(bytes) {
    if (!(window.crypto && crypto.subtle)) return '';
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function makeThumb(canvas) {
    const t = document.createElement('canvas');
    const k = 320 / Math.max(canvas.width, canvas.height);
    t.width = Math.round(canvas.width * k); t.height = Math.round(canvas.height * k);
    const g = t.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, t.width, t.height);
    return new Promise(r => t.toBlob(b => { Camera.release(t); r(b); }, 'image/jpeg', 0.75));
  }
  let thumbUrl = null;
  async function setLastThumb(blob) {
    if (!blob) {
      const s = curSite();
      const list = s ? await Store.listPhotos(s.id).catch(() => []) : [];
      blob = list[0] && list[0].thumb;
    }
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = blob ? URL.createObjectURL(blob) : null;
    $('cam-thumb').style.backgroundImage = thumbUrl ? `url(${thumbUrl})` : '';
  }

  // ---------- 位置・画面の点灯 ----------
  function gpsStart() {
    if (gpsWatch !== null || !navigator.geolocation) return;
    gpsWatch = navigator.geolocation.watchPosition(p => {
      gpsLast = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, t: Date.now() };
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
  }
  function gpsStop() {
    if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null;
  }
  function gpsFix() {
    return set.gps && gpsLast && Date.now() - gpsLast.t < 60000 ? Object.assign({}, gpsLast) : null;
  }
  async function requestWake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && camOpen) {
      requestWake();
      if (!Camera.alive()) openCamera();
    }
  });

  // ---------- 写真一覧 ----------
  async function renderGallery() {
    const s = curSite();
    galleryUrls.forEach(u => URL.revokeObjectURL(u));
    galleryUrls = [];
    gallerySel.clear();
    gallery = await Store.listPhotos(s.id).catch(() => []);
    const grid = $('gal-grid');
    grid.innerHTML = gallery.map((p, i) => {
      const u = URL.createObjectURL(p.thumb || p.blob);
      galleryUrls.push(u);
      const cap = [p.board.kousyu, p.board.sokuten].filter(Boolean).join(' ') || fmtDateTime(new Date(p.takenAt));
      return `<button class="gal-item" data-i="${i}"><img src="${u}" alt="" loading="lazy"><span class="cap">${esc(cap)}</span><span class="ck"></span></button>`;
    }).join('');
    $('gal-empty').classList.toggle('hidden', gallery.length > 0);
    $('gal-actions').classList.toggle('hidden', gallery.length === 0);
    updateSel();
  }
  function updateSel() {
    document.querySelectorAll('.gal-item').forEach(el => el.classList.toggle('sel', gallerySel.has(gallery[+el.dataset.i].id)));
    $('gal-info').textContent = gallerySel.size ? `${gallerySel.size} 枚選択中` : `${gallery.length} 枚（○で選択）`;
    $('gal-selall').textContent = gallerySel.size && gallerySel.size === gallery.length ? '選択解除' : '全選択';
  }
  $('gal-grid').addEventListener('click', e => {
    const it = e.target.closest('.gal-item');
    if (!it) return;
    const p = gallery[+it.dataset.i];
    if (e.target.classList.contains('ck') || gallerySel.size) {
      gallerySel.has(p.id) ? gallerySel.delete(p.id) : gallerySel.add(p.id);
      updateSel();
    } else openViewer(p);
  });
  $('gal-selall').onclick = () => {
    if (gallerySel.size === gallery.length) gallerySel.clear();
    else gallery.forEach(p => gallerySel.add(p.id));
    updateSel();
  };
  function selected() {
    const list = gallery.filter(p => gallerySel.has(p.id));
    if (!list.length) toast('写真の右上の ○ を押して選んでください');
    return list;
  }
  async function shareFiles(list) {
    const files = list.map(p => new File([p.blob], p.name, { type: 'image/jpeg' }));
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); } catch (e) { if (e.name !== 'AbortError') toast('共有できませんでした'); }
    } else {
      toast('この端末は共有に対応していないため保存します');
      dlFiles(list);
    }
  }
  async function dlFiles(list) {
    for (const p of list) { download(p.blob, p.name); await new Promise(r => setTimeout(r, 350)); }
  }
  $('gal-share').onclick = () => { const l = selected(); if (l.length) shareFiles(l); };
  $('gal-dl').onclick = () => { const l = selected(); if (l.length) dlFiles(l); };
  $('gal-zip').onclick = async () => {
    let l = gallery.filter(p => gallerySel.has(p.id));
    if (!l.length) l = gallery;
    if (!l.length) return;
    toast(`ZIP を作っています（${l.length} 枚）…`);
    const s = curSite();
    const used = new Set();
    const files = [];
    const csv = [['ファイル名', '撮影日時', '画素数', '工事名', '工種', '種別', '測点', '黒板内容', '黒板', '緯度', '経度', 'SHA-256']];
    for (const p of l.slice().sort((a, b) => a.takenAt - b.takenAt)) {
      let n = p.name, k = 2;
      while (used.has(n)) n = p.name.replace(/\.jpg$/, '') + '-' + (k++) + '.jpg';
      used.add(n);
      files.push({ name: n, data: new Uint8Array(await p.blob.arrayBuffer()), date: new Date(p.takenAt) });
      csv.push([n, fmtDateTime(new Date(p.takenAt)), p.w + '×' + p.h, p.siteName, p.board.kousyu, p.board.shubetsu, p.board.sokuten,
        (p.board.naiyou || '').replace(/\n/g, ' / '), p.boardShown === false ? 'なし' : 'あり',
        p.gps ? p.gps.lat.toFixed(7) : '', p.gps ? p.gps.lon.toFixed(7) : '', p.sha256 || '']);
    }
    const text = '﻿' + csv.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    files.push({ name: '撮影台帳.csv', data: new TextEncoder().encode(text), date: new Date() });
    download(Zip.make(files), safeName(s.name) + '_' + stamp(new Date()).slice(0, 8) + '.zip');
  };
  $('gal-del').onclick = async () => {
    const l = selected();
    if (!l.length) return;
    if (!confirm(`${l.length} 枚をアプリから削除します。よろしいですか？\n（端末の「ダウンロード」に保存済みの分は残ります）`)) return;
    await Store.deletePhotos(l.map(p => p.id));
    renderGallery();
  };

  // 拡大表示
  let viewing = null, viewUrl = null;
  function openViewer(p) {
    viewing = p;
    viewUrl = URL.createObjectURL(p.blob);
    $('viewer-img').src = viewUrl;
    const b = p.board || {};
    $('viewer-info').textContent = [
      p.name,
      '撮影 ' + fmtDateTime(new Date(p.takenAt)) + '　' + p.w + '×' + p.h + (p.upscaled ? '（映像から拡大）' : '') + '　' + Math.round(p.blob.size / 1024) + 'KB',
      [b.kousyu, b.shubetsu, b.sokuten].filter(Boolean).join(' ／ '),
      b.naiyou ? b.naiyou.replace(/\n/g, ' / ') : '',
      p.gps ? `位置 ${p.gps.lat.toFixed(6)}, ${p.gps.lon.toFixed(6)}（±${Math.round(p.gps.acc)}m）` : '',
      p.sha256 ? 'SHA-256 ' + p.sha256 : ''
    ].filter(Boolean).join('\n');
    $('viewer').classList.remove('hidden');
  }
  function closeViewer() {
    $('viewer').classList.add('hidden');
    $('viewer-img').src = '';
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = null; viewing = null;
  }
  $('vw-close').onclick = closeViewer;
  $('vw-share').onclick = () => viewing && shareFiles([viewing]);
  $('vw-dl').onclick = () => viewing && download(viewing.blob, viewing.name);
  $('vw-del').onclick = async () => {
    if (!viewing || !confirm('この写真をアプリから削除しますか？')) return;
    await Store.deletePhotos([viewing.id]);
    closeViewer();
    renderGallery();
  };

  // ---------- ダイアログ ----------
  function openDlg(title, html) {
    $('dlg-title').textContent = title;
    const body = $('dlg-body');
    if (typeof html === 'string') body.innerHTML = html;
    else { body.innerHTML = ''; body.appendChild(html); }
    $('dlg').classList.remove('hidden');
  }
  function closeDlg() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $('dlg').classList.add('hidden');
    $('dlg-body').innerHTML = '';
    flushSite();
    if (camOpen) {
      $('cam-video').play().catch(() => {});
      layoutFrame();
    }
  }
  $('dlg-x').onclick = closeDlg;
  $('dlg').addEventListener('click', e => { if (e.target === $('dlg')) closeDlg(); });

  function settingsDialog() {
    openDlg('設定', $('tpl-settings').content.cloneNode(true));
    const bind = (id, key, conv) => {
      const el = $(id);
      el.value = String(set[key]);
      el.onchange = () => { set[key] = conv ? conv(el.value) : el.value; saveSet(); applySettings(key); };
    };
    bind('s-res', 'res');
    bind('s-orient', 'orient');
    bind('s-quality', 'quality', Number);
    bind('s-theme', 'theme');
    bind('s-date', 'dateFmt');
    const chk = (id, key) => {
      const el = $(id);
      el.checked = !!set[key];
      el.onchange = () => { set[key] = el.checked; saveSet(); applySettings(key); };
    };
    chk('s-auto', 'autoDownload');
    chk('s-gps', 'gps');
    chk('s-still', 'stillMode');
    chk('s-sound', 'sound');
    document.querySelectorAll('#dlg-body [data-row]').forEach(el => {
      el.checked = set.rows[el.dataset.row] !== false;
      el.onchange = () => { set.rows[el.dataset.row] = el.checked; saveSet(); applySettings('rows'); };
    });
    $('s-reset-pos').onclick = () => {
      set.boardScale = Store.DEFAULTS.boardScale; set.boardFx = Store.DEFAULTS.boardFx; set.boardFy = Store.DEFAULTS.boardFy;
      saveSet(); applySettings('pos'); toast('黒板を左下・標準の大きさに戻しました');
    };
  }
  function applySettings(key) {
    if (key === 'res') { $('cam-res').textContent = set.res.replace('x', '×'); restartIfNeeded(); }
    if (key === 'orient') layoutFrame();
    if (key === 'gps') { if (set.gps && camOpen) gpsStart(); else gpsStop(); }
    if ($('view-board').classList.contains('active')) drawPreview();
    if ($('view-home').classList.contains('active')) renderHome();
    if (camOpen) layoutBoard();
  }
  $('tb-set').onclick = settingsDialog;
  $('btn-home-set').onclick = settingsDialog;
  $('tb-back').onclick = () => history.back();
  $('btn-help').onclick = () => openDlg('使い方・電子納品の注意', $('tpl-help').content.cloneNode(true));

  // ---------- バックアップ ----------
  $('btn-export').onclick = () => {
    flushSite();
    const data = { app: 'kokuban-camera', version: VERSION, exportedAt: new Date().toISOString(), settings: set, sites: Store.sites() };
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), '黒板カメラ_現場データ_' + stamp(new Date()).slice(0, 8) + '.json');
  };
  $('btn-import').onclick = () => $('file-import').click();
  $('file-import').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'kokuban-camera' || !Array.isArray(data.sites)) throw new Error('このアプリの書き出しファイルではありません');
      if (!confirm(`${data.sites.length} 件の現場を読み込みます（同じ現場は上書き）。よろしいですか？`)) return;
      const list = Store.sites();
      data.sites.forEach(s => {
        const i = list.findIndex(x => x.id === s.id);
        if (i >= 0) list[i] = s; else list.push(s);
      });
      Store.saveSites(list);
      if (data.settings) { set = Object.assign(Store.settings(), data.settings); saveSet(); }
      renderHome();
      toast('読み込みました');
    } catch (err) {
      alert('読み込めませんでした：' + err.message);
    }
  };

  // ---------- ホーム画面に追加（PWA） ----------
  // Android の Chrome はボタン1つで追加できる。iPhone は手順を案内する。
  // 「すでにインストールされています」と出る端末は、アイコンがアプリ一覧にあるので開き方を案内する。
  let deferredPrompt = null, installedApp = false;
  function isStandalone() {
    try {
      return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches ||
        matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;
    } catch (e) { return false; }
  }
  function browserInfo() {
    const ua = navigator.userAgent;
    if (/Line\//i.test(ua)) return { inapp: 'LINE' };
    if (/FBAN|FBAV|FB_IAB|Instagram/i.test(ua)) return { inapp: 'SNS アプリ' };
    if (/; wv\)/.test(ua)) return { inapp: 'ほかのアプリ' };
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return { ios: true, notSafari: /CriOS|FxiOS|EdgiOS/.test(ua) };
    if (/Android/.test(ua)) return { android: true };
    return { pc: true };
  }
  function renderInstall() {
    const box = $('install-box');
    if (!box) return;
    if (isStandalone() || !/^https?:$/.test(location.protocol)) { box.innerHTML = ''; return; }
    let later = 0;
    try { later = +localStorage.getItem('kc.installLater') || 0; } catch (e) {}
    if (later && Date.now() - later < 3 * 86400000) { box.innerHTML = ''; return; }
    const b = browserInfo();
    let title = 'ホーム画面に追加しましょう', msg = '', btn = '';
    if (deferredPrompt) {
      msg = 'ボタンを押すと、ホーム画面のアイコンから全画面のカメラとしてすぐ起動できます。圏外でも使えます。';
      btn = '<button class="btn primary" id="btn-install">ホーム画面に追加</button>';
    } else if (installedApp) {
      title = 'この端末にはインストール済みです';
      msg = 'ホーム画面を<b>上にスワイプしてアプリ一覧</b>を開き、<b>「黒板カメラ」</b>をタップしてください。' +
        'アイコンを長押ししてホーム画面へドラッグすると、次からはホーム画面から開けます。' +
        'Chrome の <b>⋮</b> メニューに<b>「アプリで開く」</b>が出ていれば、そこからも開けます。';
    } else if (b.inapp) {
      title = b.inapp + 'の中で開いています';
      msg = 'このままでは追加できません。<b>⋮</b> や <b>…</b> から<b>「ブラウザで開く」</b>を選び、Chrome（iPhone は Safari）で開き直してください。';
    } else if (b.ios) {
      msg = b.notSafari
        ? 'iPhone では <b>Safari</b> で開いてください。共有ボタン（□に↑）→<b>「ホーム画面に追加」</b>を選びます。'
        : '画面下の<b>共有ボタン（□に↑）</b>を押し、<b>「ホーム画面に追加」</b>を選んでください。';
    } else if (b.android) {
      msg = 'Chrome の <b>⋮</b> メニューから<b>「ホーム画面に追加」</b>（または「アプリをインストール」）を選んでください。' +
        '「すでにインストールされています」と出たときは、ホーム画面を上にスワイプした<b>アプリ一覧</b>に「黒板カメラ」があります。';
    } else {
      title = 'スマホで使うアプリです';
      msg = 'スマホのブラウザでこのページを開き、ホーム画面に追加してください。';
    }
    box.innerHTML = `<section class="install">
      <div class="install-top"><img src="icons/icon-192.png" alt=""><div><b>${title}</b><p>${msg}</p></div></div>
      <div class="row">${btn}<button class="btn" id="btn-copyurl">URLをコピー</button><button class="btn ghost" id="btn-later">あとで</button></div>
    </section>`;
    if ($('btn-install')) $('btn-install').onclick = doInstall;
    $('btn-copyurl').onclick = () => {
      const url = location.href.split('#')[0];
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('URLをコピーしました')).catch(() => toast(url, 5000));
    };
    $('btn-later').onclick = () => { try { localStorage.setItem('kc.installLater', String(Date.now())); } catch (e) {} renderInstall(); };
  }
  async function doInstall() {
    const p = deferredPrompt;
    deferredPrompt = null;
    if (!p) { renderInstall(); return; }
    try {
      p.prompt();
      const r = await p.userChoice;
      if (r && r.outcome === 'accepted') toast('ホーム画面に追加しました。アイコンから開いてください', 4000);
    } catch (e) {}
    renderInstall();
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; installedApp = false; renderInstall(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; installedApp = true; renderInstall(); });
  if (navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps().then(list => { if (list && list.length) { installedApp = true; renderInstall(); } }).catch(() => {});
  }

  // 実機で何か起きたときに画面で分かるようにする
  window.addEventListener('error', e => toast('エラー：' + (e.message || '不明'), 5000));
  window.addEventListener('unhandledrejection', e => toast('エラー：' + (e.reason && e.reason.message || e.reason), 5000));

  // ---------- 起動 ----------
  $('ver').textContent = '黒板カメラ v' + VERSION;
  history.replaceState({ v: 'home' }, '');
  render('home');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('resize', () => { if ($('view-board').classList.contains('active')) drawPreview(); });

  // テスト用に一部を公開
  window.__kc = { stepNo, outSize, boardRows, shoot, go, openSite, curRot, get set() { return set; }, setDevAngle(a) { devAngle = a; layoutFrame(); } };
})();
