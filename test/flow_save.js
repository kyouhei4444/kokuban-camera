/* 保存先フォルダーのテスト
   Android のフォルダー選択画面は自動では操作できないので、ブラウザ内の非公開フォルダー（OPFS）を
   「選んだフォルダー」の代わりにして、書き込み・現場ごとのフォルダー・失敗時の Download 退避を確かめる */
(async () => {
  const log = [];
  const ok = (name, cond, info) => log.push({ name, ok: !!cond, info: info === undefined ? '' : String(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (fn()) return true; await wait(100); } return false; };
  const $ = id => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: 'POST', body });

  try {
    const root = await navigator.storage.getDirectory();
    for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });

    $('btn-site-add').click(); await wait(100);
    $('d-name').value = 'R8神戸 道路工事'; $('d-save').click(); await wait(200);
    $('f-kousyu').value = '伐採工'; $('f-kousyu').dispatchEvent(new Event('input'));

    // 設定画面：保存先の表示
    $('tb-set').click(); await wait(100);
    ok('設定に保存先の選択', !!$('s-savemode') && !$('s-savemode').disabled, 'supported=' + SaveDir.supported());
    $('dlg-x').click();

    __kc.set.autoDownload = true;
    __kc.set.saveMode = 'folder';
    __kc.set.saveSubdir = true;
    __kc.set.sound = false;
    SaveDir.setHandle(root);

    $('btn-camera').click();
    ok('カメラ起動', await until(() => $('cam-video').videoWidth > 0, 10000));
    await wait(300);
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    await wait(300);
    ok('トーストに保存先', /→/.test($('toast').textContent), $('toast').textContent);

    const photos = await Store.listPhotos(Store.sites()[0].id);
    let sub = null, file = null;
    try { sub = await root.getDirectoryHandle('R8神戸_道路工事'); file = await (await sub.getFileHandle(photos[0].name)).getFile(); } catch (e) {}
    ok('現場フォルダーに保存', !!file, photos[0] && photos[0].name);
    ok('中身が同じ', file && file.size === photos[0].blob.size, file && file.size + ' / ' + photos[0].blob.size);

    // 現場フォルダーを作らない設定
    __kc.set.saveSubdir = false;
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    await wait(300);
    const p2 = (await Store.listPhotos(Store.sites()[0].id))[0];
    let f2 = null; try { f2 = await (await root.getFileHandle(p2.name)).getFile(); } catch (e) {}
    ok('フォルダー直下に保存', !!f2, p2.name);

    // 書き込みに失敗する保存先 → Download に退避
    SaveDir.setHandle({ name: '壊れたフォルダー', queryPermission: async () => 'granted', getFileHandle: async () => { throw new DOMException('x', 'InvalidStateError'); }, getDirectoryHandle: async () => { throw new DOMException('x', 'InvalidStateError'); } });
    let dl = 0;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) dl++; return origClick.call(this); };
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    await wait(300);
    ok('失敗時は Download に退避', dl === 1 && /Download/.test($('toast').textContent), dl + ' ' + $('toast').textContent);

    // 許可が無い保存先 → Download
    SaveDir.setHandle({ name: '許可なし', queryPermission: async () => 'prompt', requestPermission: async () => 'denied' });
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    await wait(300);
    ok('許可なしは Download', dl === 2, dl);
    HTMLAnchorElement.prototype.click = origClick;

    // 一覧の「保存」も保存先フォルダーへ
    SaveDir.setHandle(root);
    __kc.set.saveSubdir = true;
    for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });
    __kc.go('gallery');
    await until(() => document.querySelectorAll('.gal-item').length === 4, 4000);
    $('gal-selall').click();
    $('gal-dl').click();
    await wait(1500);
    let n = 0;
    try { const d = await root.getDirectoryHandle('R8神戸_道路工事'); for await (const k of d.keys()) n++; } catch (e) {}
    ok('一覧の保存でフォルダーへ4枚', n === 4, n);
    // IndexedDB にハンドルを覚えられるか（v2 の kv ストア）
    await Store.setKV('saveDir', root);
    const back = await Store.getKV('saveDir');
    ok('保存先を覚える', back && back.kind === 'directory', back && back.kind);
  } catch (e) {
    ok('例外', false, e && e.stack || e);
  }
  ok('JSエラーなし', !(window.__errs || []).length, (window.__errs || []).join(' | '));
  await post('/done', JSON.stringify(log));
})();
