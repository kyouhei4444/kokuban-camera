/* 保存先フォルダーが応答しないときも撮影を続けられること（撮影ボタンがグレーのままになる不具合） */
(async () => {
  const log = [];
  const ok = (name, cond, info) => log.push({ name, ok: !!cond, info: info === undefined ? '' : String(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (await fn()) return true; await wait(50); } return false; };
  const $ = id => document.getElementById(id);
  const never = () => new Promise(() => {});
  const count = async () => (await Store.listPhotos(Store.sites()[0].id)).length;
  const shot = async () => { const n = await count(); $('cam-shutter').click(); const t = Date.now(); const back = await until(async () => !$('cam-shutter').disabled && (await count()) === n + 1, 3000); return { back, ms: Date.now() - t }; };
  let dl = 0;
  const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) dl++; };
  try {
    if (SaveDir.setTimeouts) SaveDir.setTimeouts({ query: 400, ask: 900, write: 900 });
    Object.assign(__kc.set, { sound: false, autoDownload: true, saveMode: 'folder' });
    $('btn-site-add').click(); await wait(100);
    $('d-name').value = '応答なし'; $('d-save').click(); await wait(200);
    $('btn-camera').click();
    await until(() => $('cam-video').videoWidth > 0, 10000); await wait(400);
    const cases = {
      '許可の要求が返らない': { name: 'A', queryPermission: async () => 'prompt', requestPermission: never },
      '許可の確認が返らない': { name: 'B', queryPermission: never, requestPermission: never },
      '書き込みが返らない': { name: 'C', queryPermission: async () => 'granted', getDirectoryHandle: never, getFileHandle: never },
      '書き込みの確定が返らない': { name: 'D', queryPermission: async () => 'granted', getDirectoryHandle: async function () { return this; }, getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: never, abort: never }) }) }
    };
    for (const [n, h] of Object.entries(cases)) {
      SaveDir.setHandle(h); if (__kc.resetFolder) __kc.resetFolder();
      dl = 0;
      const a = await shot(); ok(n + '：1枚目後に撮れる状態', a.back, a.ms + 'ms');
      const b = await shot(); ok(n + '：2枚目も撮れる', b.back, b.ms + 'ms');
      await until(() => dl >= 2, 5000);
      ok(n + '：2枚とも Download に退避', dl === 2, dl);
      const c = await shot(); ok(n + '：3枚目も撮れる', c.back, c.ms + 'ms');
      await wait(300);
      ok(n + '：保存先の警告が出る', !!$('cam-folder') && !$('cam-folder').classList.contains('hidden'));
    }
    if ($('cam-folder')) {
      // 警告のボタンから許可を取り直すと、次の撮影から保存先フォルダーに戻る
      const root = await navigator.storage.getDirectory();
      for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });
      SaveDir.setHandle(root); dl = 0;
      $('cam-folder').click(); await wait(100); $('fd-ask').click(); await wait(500);
      ok('取り直すと警告が消える', $('cam-folder').classList.contains('hidden'));
      await shot(); await shot();
      const num = async () => { let n = 0; try { for await (const k of (await root.getDirectoryHandle('応答なし')).keys()) if (/\.jpg$/.test(k)) n++; } catch (e) {} return n; };
      await until(async () => (await num()) === 2, 4000);
      ok('以後はフォルダーに保存', (await num()) === 2 && dl === 0, (await num()) + '枚 / dl ' + dl);
      // 一覧の「保存」：応答しなくても退避する
      SaveDir.setHandle(cases['許可の要求が返らない']);
      __kc.go('gallery');
      await until(() => document.querySelectorAll('.gal-item').length > 0, 4000);
      document.querySelector('.gal-item .ck').click(); dl = 0;
      $('gal-dl').click(); await until(() => dl === 1, 4000);
      ok('一覧の保存も退避', dl === 1, dl);
    }
  } catch (e) { ok('例外', false, e && e.stack || e); }
  HTMLAnchorElement.prototype.click = oc;
  ok('JSエラーなし', !(window.__errs || []).length, (window.__errs || []).join(' | '));
  await fetch('/done', { method: 'POST', body: JSON.stringify(log) });
})();
