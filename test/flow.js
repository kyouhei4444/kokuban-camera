/* 通しテスト：index.html に差し込んで、本物のボタンを順に押す。
   結果は /result に POST する（run_test.py が受け取る） */
(async () => {
  const log = [];
  const ok = (name, cond, info) => log.push({ name, ok: !!cond, info: info === undefined ? '' : String(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (fn()) return true; await wait(100); } return false; };
  const $ = id => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: 'POST', body });
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

  try {
    // 純粋な関数
    ok('測点 No.5→No.6', __kc.stepNo('No.5', 1) === 'No.6', __kc.stepNo('No.5', 1));
    ok('測点 No.5+10.0→No.6+10.0', __kc.stepNo('No.5+10.0', 1) === 'No.6+10.0', __kc.stepNo('No.5+10.0', 1));
    ok('測点 BP+20→BP+21', __kc.stepNo('BP+20', 1) === 'BP+21');
    ok('測点 No.0 から戻さない', __kc.stepNo('No.0', -1) === 'No.0');
    ok('測点 空→No.1', __kc.stepNo('', 1) === 'No.1');
    ok('和暦', Board.formatDate(new Date(2026, 9, 19), 'wareki') === '令和8年10月19日', Board.formatDate(new Date(2026, 9, 19), 'wareki'));
    ok('令和元年', Board.formatDate(new Date(2019, 4, 1), 'wareki') === '令和元年5月1日');
    ok('既定の画素数', __kc.set.res === '1280x960');

    // 現場登録
    $('btn-site-add').click();
    await wait(100);
    type($('d-name'), 'テスト道路改良工事');
    type($('d-contractor'), 'テスト建設株式会社');
    $('d-save').click();
    await wait(200);
    ok('黒板入力画面へ', $('view-board').classList.contains('active'));
    ok('タイトルに工事名', $('tb-title').textContent === 'テスト道路改良工事');

    type($('f-kousyu'), '擁壁工');
    type($('f-shubetsu'), '床掘り');
    type($('f-sokuten'), 'No.5');
    type($('f-naiyou'), '床掘り完了\n項目|設計|実測\n幅 W|1.20|1.22\n深さ H|0.80|0.81');
    document.querySelector('[data-step="1"]').click();
    ok('測点▶で No.6', $('f-sokuten').value === 'No.6', $('f-sokuten').value);
    const rows = __kc.boardRows(new Date(2026, 9, 19));
    ok('黒板の行', rows.map(r => r.label || 'body').join(',') === '工事名,工　種,種　別,測　点,body,撮影日,受注者', rows.map(r => r.label || 'body').join(','));
    // 黒板プレビュー画像
    await post('/file/preview.png', await new Promise(r => $('board-preview').toBlob(r, 'image/png')));

    // カメラ
    $('btn-camera').click();
    const ready = await until(() => $('cam-video').videoWidth > 0, 10000);
    ok('カメラ起動', ready, $('cam-video').videoWidth + 'x' + $('cam-video').videoHeight);
    await wait(500);
    ok('出力サイズ', __kc.outSize().join('x') === '1280x960', __kc.outSize().join('x'));
    const f = $('cam-frame');
    ok('プレビュー枠 4:3', Math.abs(f.clientWidth / f.clientHeight - 4 / 3) < 0.02, f.clientWidth + 'x' + f.clientHeight);
    ok('黒板が枠内', $('cam-board').offsetTop + $('cam-board').offsetHeight <= f.clientHeight + 1);

    await __kc.shoot();
    const site = Store.sites()[0];
    let photos = await Store.listPhotos(site.id);
    ok('写真1枚保存', photos.length === 1, photos.length);
    const p = photos[0];
    ok('保存サイズ 1280×960', p.w === 1280 && p.h === 960, p.w + 'x' + p.h);
    ok('SHA-256 あり', /^[0-9a-f]{64}$/.test(p.sha256), p.sha256);
    ok('ファイル名', /^\d{8}_\d{6}_擁壁工_No\.6\.jpg$/.test(p.name), p.name);
    const hist = Store.site(site.id).hist;
    ok('履歴に工種', hist.kousyu[0] === '擁壁工');
    await post('/file/photo.jpg', p.blob);
    await post('/meta/photo.json', JSON.stringify({ sha256: p.sha256, takenAt: p.takenAt, name: p.name }));

    // 縦向き・別画素数
    __kc.set.orient = 'portrait'; __kc.set.res = '2048x1536';
    ok('縦 2048', __kc.outSize().join('x') === '1536x2048');
    await __kc.shoot();
    photos = await Store.listPhotos(site.id);
    ok('2枚目 1536×2048', photos[0].w === 1536 && photos[0].h === 2048, photos[0].w + 'x' + photos[0].h);
    await post('/file/photo2.jpg', photos[0].blob);
    __kc.set.orient = 'auto'; __kc.set.res = '1280x960';

    // 写真一覧 → ZIP
    __kc.go('gallery');
    await until(() => document.querySelectorAll('.gal-item').length === 2, 4000);
    ok('一覧に2枚', document.querySelectorAll('.gal-item').length === 2);
    const files = [];
    for (const q of photos) files.push({ name: q.name, data: new Uint8Array(await q.blob.arrayBuffer()), date: new Date(q.takenAt) });
    files.push({ name: '撮影台帳.csv', data: new TextEncoder().encode('﻿a,b\r\n'), date: new Date() });
    await post('/file/test.zip', Zip.make(files));
  } catch (e) {
    ok('例外', false, e && e.stack || e);
  }
  ok('JSエラーなし', !(window.__errs || []).length, (window.__errs || []).join(' | '));
  await post('/done', JSON.stringify(log));
})();
