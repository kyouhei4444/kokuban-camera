/* ============================================================
   savedir.js  写真を端末の「選んだフォルダー」に直接保存する
   File System Access API（showDirectoryPicker）を使う。Android の Chrome では
   M132 から使え、Android 標準のフォルダー選択画面で内部ストレージ／SDカードの
   任意のフォルダー（例 DCIM/kokuban）を選べる。
   選んだフォルダーの「鍵」（ハンドル）は IndexedDB に覚えておき、次回からは
   書き込みの許可だけを取り直す。使えない端末・失敗したときは呼び出し側で
   従来どおりダウンロード（Download フォルダー）に回す。
   ============================================================ */
const SaveDir = (() => {
  let handle = null;

  function supported() { return typeof window.showDirectoryPicker === 'function'; }

  async function load() {
    try { handle = (await Store.getKV('saveDir')) || null; } catch (e) { handle = null; }
    return handle;
  }

  async function pick() {
    let h;
    try {
      h = await window.showDirectoryPicker({ id: 'kokuban', mode: 'readwrite', startIn: 'pictures' });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      h = await window.showDirectoryPicker(); // オプションに対応していない版
    }
    handle = h;
    try { await Store.setKV('saveDir', h); } catch (e) {}
    return h;
  }

  async function clear() {
    handle = null;
    try { await Store.setKV('saveDir', null); } catch (e) {}
  }

  // 端末によっては許可の画面が出ないまま応答が返らないことがある。
  // 待ち続けないよう、どの処理にも時間制限を付ける（ミリ秒）
  const T = { query: 3000, ask: 15000, write: 15000 };
  function limit(promise, ms, what) {
    let timer;
    const late = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new DOMException(what + 'の応答がありません', 'TimeoutError')), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  let asking = null; // 許可の要求中（続けて撮っても要求は1つにまとめる）
  /** 書き込みの許可。ask=true は利用者の操作（タップ）の中から呼ぶこと */
  function permission(ask) {
    if (!handle) return Promise.resolve(false);
    if (asking && asking.h === handle) return asking.p;
    const h = handle;
    const p = check(h, ask);
    if (ask) {
      const mine = { h, p };
      asking = mine;
      p.then(() => { if (asking === mine) asking = null; });
    }
    return p;
  }
  async function check(h, ask) {
    try {
      const o = { mode: 'readwrite' };
      if (typeof h.queryPermission !== 'function') return true;
      let p = await limit(h.queryPermission(o), T.query, '許可の確認');
      if (p === 'granted') return true;
      if (ask && typeof h.requestPermission === 'function') p = await limit(h.requestPermission(o), T.ask, '許可の要求');
      return p === 'granted';
    } catch (e) { return false; }
  }

  /** blob を name で書く。sub があればその名前のフォルダーを作ってその中へ */
  async function write(blob, name, sub) {
    let w = null, expired = false;
    const job = async () => {
      let dir = handle;
      if (sub) dir = await dir.getDirectoryHandle(sub, { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      if (expired) return;
      w = await fh.createWritable();
      if (expired) { w.abort().catch(() => {}); return; }
      await w.write(blob);
      await w.close();
    };
    const j = job();
    j.catch(() => {}); // 時間切れのあとの失敗を未処理エラーにしない
    try {
      await limit(j, T.write, '書き込み');
    } catch (e) {
      expired = true;
      if (w) { try { Promise.resolve(w.abort()).catch(() => {}); } catch (e2) {} } // 待たない
      throw e;
    }
  }

  return {
    supported, load, pick, clear, permission, write,
    get handle() { return handle; },
    get name() { return handle ? handle.name : ''; },
    setHandle(h) { handle = h; },            // テスト用
    setTimeouts(t) { Object.assign(T, t); }  // テスト用
  };
})();
