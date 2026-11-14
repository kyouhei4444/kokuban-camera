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

  /** 書き込みの許可。ask=true は利用者の操作（タップ）の中から呼ぶこと */
  async function permission(ask) {
    if (!handle) return false;
    try {
      const o = { mode: 'readwrite' };
      if (typeof handle.queryPermission !== 'function') return true;
      let p = await handle.queryPermission(o);
      if (p === 'granted') return true;
      if (ask && typeof handle.requestPermission === 'function') p = await handle.requestPermission(o);
      return p === 'granted';
    } catch (e) { return false; }
  }

  /** blob を name で書く。sub があればその名前のフォルダーを作ってその中へ */
  async function write(blob, name, sub) {
    let dir = handle;
    if (sub) dir = await dir.getDirectoryHandle(sub, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (e2) {}
      throw e;
    }
  }

  return {
    supported, load, pick, clear, permission, write,
    get handle() { return handle; },
    get name() { return handle ? handle.name : ''; },
    setHandle(h) { handle = h; } // テスト用
  };
})();
