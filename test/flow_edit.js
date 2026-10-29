/* 再現テスト：撮影したあとに黒板を書き換えられるか（DuraForce PRO 2 の不具合報告）
   自動保存（ダウンロード）・シャッター音は実機の初期設定どおりオンにして流す */
(async () => {
  const log = [];
  const ok = (name, cond, info) => log.push({ name, ok: !!cond, info: info === undefined ? '' : String(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (fn()) return true; await wait(100); } return false; };
  const $ = id => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: 'POST', body });
  const longs = [];
  let step = 'start';
  const mark = s => { step = s; };
  try { new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(Math.round(e.duration) + '@' + step))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  // 文字を1文字ずつ打つ（実機のキーボード入力に近づける）
  const typeSlow = async (el, text) => {
    el.focus();
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(30);
    }
  };
  const sig = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; };

  try {
    __kc.set.autoDownload = true;
    __kc.set.sound = true;
    $('btn-site-add').click(); await wait(100);
    $('d-name').value = 'テスト工事'; $('d-save').click(); await wait(200);
    await typeSlow($('f-kousyu'), '伐採工');
    await typeSlow($('f-naiyou'), '伐採状況');
    mark('camera-open');
    $('btn-camera').click();
    ok('カメラ起動', await until(() => $('cam-video').videoWidth > 0, 10000));
    await wait(400);

    for (let n = 1; n <= 3; n++) {
      mark('shoot' + n);
      $('cam-shutter').click();
      await until(() => !$('cam-shutter').disabled, 8000);
      await wait(300);
      mark('after-shoot' + n);
      const cnt = (await Store.listPhotos(Store.sites()[0].id)).length;
      ok(n + '枚目 撮影', cnt === n, cnt);

      // 撮影画面のまま黒板を編集
      mark('edit' + n);
      $('cam-edit').click(); await wait(150);
      ok(n + '枚目後 編集ダイアログ', !$('dlg').classList.contains('hidden') && !!$('q-naiyou'));
      const before = sig($('cam-board'));
      const t0 = performance.now();
      $('q-naiyou').value = '';
      await typeSlow($('q-naiyou'), '伐採状況その' + n);
      await typeSlow($('q-sokuten'), 'No.' + n);
      const dt = performance.now() - t0;
      await wait(600); // 保存は入力が止まって 0.4 秒後
      ok(n + '枚目後 入力が黒板に反映', sig($('cam-board')) !== before && Store.site(Store.sites()[0].id).board.naiyou === '伐採状況その' + n);
      ok(n + '枚目後 入力の速さ', dt < 3000, Math.round(dt) + 'ms');
      $('q-ok').click(); await wait(150);
    }

    // 黒板入力画面へ戻って入力
    mark('back');
    history.back();
    await until(() => $('view-board').classList.contains('active') && $('view-camera').classList.contains('hidden'), 3000);
    ok('入力画面に戻る', $('view-board').classList.contains('active'));
    const b0 = sig($('board-preview'));
    mark('board-type');
    $('f-naiyou').value = '';
    await typeSlow($('f-naiyou'), '抜根状況');
    ok('入力画面で反映', sig($('board-preview')) !== b0 && $('f-naiyou').value === '抜根状況');
    // もう一度カメラ → 撮影 → 編集
    $('btn-camera').click();
    ok('カメラ再起動', await until(() => $('cam-video').videoWidth > 0, 10000));
    await wait(300);
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    $('cam-edit').click(); await wait(150);
    await typeSlow($('q-kousyu'), 'A');
    await wait(600);
    ok('再起動後も編集できる', Store.site(Store.sites()[0].id).board.kousyu.endsWith('A'));
    $('q-ok').click();
  } catch (e) {
    ok('例外', false, e && e.stack || e);
  }
  ok('長い処理（200ms超）', !longs.filter(x => parseInt(x) > 200).length, longs.join(', '));
  ok('JSエラーなし', !(window.__errs || []).length, (window.__errs || []).join(' | '));
  await post('/done', JSON.stringify(log));
})();
