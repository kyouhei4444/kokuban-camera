/* ============================================================
   store.js  保存
   現場・設定 … localStorage（小さいので）
   写真       … IndexedDB（JPEG 本体とサムネイル）
   ============================================================ */
const Store = (() => {
  const K_SITES = 'kc.sites', K_SET = 'kc.settings';

  const LAYOUT_VER = 2;
  const DEFAULTS = {
    layoutVer: LAYOUT_VER,
    res: '1280x960',
    quality: 0.92,
    orient: 'auto',
    boardScale: 0.231,   // 黒板の幅 / 写真の長辺（1280 に対して 296px）
    boardFx: 0,
    boardFy: 1,
    boardShow: true,
    theme: 'green',
    dateFmt: 'wareki',
    rows: { koji: true, kousyu: true, shubetsu: true, sokuten: true, naiyou: true, date: false, contractor: false },
    autoDownload: true,
    gps: false,
    stillMode: false,
    sound: true
  };

  function read(k, d) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function settings() {
    const s = Object.assign({}, DEFAULTS, read(K_SET, {}));
    s.rows = Object.assign({}, DEFAULTS.rows, s.rows || {});
    if ((s.layoutVer || 1) < LAYOUT_VER) {
      // 黒板の形を現場の様式に合わせた版。大きさ・位置・項目を新しい既定に戻す
      ['boardScale', 'boardFx', 'boardFy', 'theme', 'layoutVer'].forEach(k => { s[k] = DEFAULTS[k]; });
      s.rows = Object.assign({}, DEFAULTS.rows);
      write(K_SET, s);
    }
    return s;
  }
  function saveSettings(s) { return write(K_SET, s); }

  function sites() { return read(K_SITES, []); }
  function saveSites(list) { return write(K_SITES, list); }
  function site(id) { return sites().find(s => s.id === id) || null; }
  function putSite(s) {
    const list = sites();
    const i = list.findIndex(x => x.id === s.id);
    if (i >= 0) list[i] = s; else list.push(s);
    saveSites(list);
  }
  function removeSite(id) { saveSites(sites().filter(s => s.id !== id)); }

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('kokuban-camera', 1);
        r.onupgradeneeded = () => {
          const s = r.result.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('site', 'siteId');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); }); }

  async function putPhoto(rec) {
    const t = (await db()).transaction('photos', 'readwrite');
    t.objectStore('photos').put(rec);
    return done(t);
  }
  async function getPhoto(id) {
    return req((await db()).transaction('photos').objectStore('photos').get(id));
  }
  async function listPhotos(siteId) {
    const all = await req((await db()).transaction('photos').objectStore('photos').index('site').getAll(siteId));
    return all.sort((a, b) => b.takenAt - a.takenAt);
  }
  async function countPhotos(siteId) {
    return req((await db()).transaction('photos').objectStore('photos').index('site').count(siteId));
  }
  async function deletePhotos(ids) {
    const t = (await db()).transaction('photos', 'readwrite');
    const s = t.objectStore('photos');
    ids.forEach(id => s.delete(id));
    return done(t);
  }
  async function deleteSitePhotos(siteId) {
    const t = (await db()).transaction('photos', 'readwrite');
    const idx = t.objectStore('photos').index('site');
    const keys = await req(idx.getAllKeys(siteId));
    keys.forEach(k => t.objectStore('photos').delete(k));
    return done(t);
  }

  return {
    DEFAULTS, settings, saveSettings,
    sites, saveSites, site, putSite, removeSite,
    putPhoto, getPhoto, listPhotos, countPhotos, deletePhotos, deleteSitePhotos
  };
})();
