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
    type($('d-name'), '（主）韮崎昇仙峡線　道路工事２工区（一部債務）（余フ）');
    type($('d-contractor'), 'テスト建設株式会社');
    $('d-save').click();
    await wait(200);
    ok('黒板入力画面へ', $('view-board').classList.contains('active'));
    ok('タイトルに工事名', $('tb-title').textContent.startsWith('（主）韮崎'));

    type($('f-kousyu'), '擁壁工');
    type($('f-shubetsu'), '床掘り');
    type($('f-sokuten'), 'No.5');
    type($('f-naiyou'), '床掘り完了\n項目|設計|実測\n幅 W|1.20|1.22\n深さ H|0.80|0.81');
    document.querySelector('[data-step="1"]').click();
    ok('測点▶で No.6', $('f-sokuten').value === 'No.6', $('f-sokuten').value);
    const rows = __kc.boardRows(new Date(2026, 9, 19));
    ok('黒板の見出し', rows.heads.map(r => r.label).join(',') === '工事名,工　種,種　別,測　点', rows.heads.map(r => r.label).join(','));
    ok('黒板の内容4行', rows.body.length === 4);
    ok('黒板の既定の大きさ', Math.abs(__kc.set.boardScale - 0.231) < 1e-9);

    // 回転の向き：映像フレームの右半分を赤にした縦長の元画像
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#00f'; g.fillRect(0, 0, w, h); g.fillStyle = '#f00'; g.fillRect(w / 2, 0, w / 2, h); return c; };
    const px = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3));
    const src = { src: mk(300, 400), w: 300, h: 400 };
    let o = Camera.cropTo(src, 400, 300, 90).canvas;   // 左に倒した：映像の右 → 上
    ok('rot90 右→上', px(o, 200, 10)[0] > 200 && px(o, 200, 290)[2] > 200, JSON.stringify([px(o, 200, 10), px(o, 200, 290)]));
    o = Camera.cropTo(src, 400, 300, 270).canvas;      // 右に倒した：映像の右 → 下
    ok('rot270 右→下', px(o, 200, 290)[0] > 200 && px(o, 200, 10)[2] > 200);
    o = Camera.cropTo(src, 300, 400, 180).canvas;      // 逆さ：右 → 左
    ok('rot180 右→左', px(o, 10, 200)[0] > 200 && px(o, 290, 200)[2] > 200);
    o = Camera.cropTo(src, 300, 400, 0).canvas;
    ok('rot0 そのまま', px(o, 290, 200)[0] > 200);
    // 黒板プレビュー画像（元写真と同じ内容でも1枚）
    type($('f-naiyou'), '伐採状況'); type($('f-kousyu'), '伐採工'); const sk = $('f-sokuten').value; type($('f-sokuten'), '');
    await post('/file/preview_bassai.png', await new Promise(r => $('board-preview').toBlob(r, 'image/png')));
    type($('f-naiyou'), '床掘り完了\n項目|設計|実測\n幅 W|1.20|1.22\n深さ H|0.80|0.81'); type($('f-kousyu'), '擁壁工'); type($('f-sokuten'), sk);
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

    // 横に倒した（映像は横長のまま回転 90）→ 正立で縦長になる。プレビュー枠は映像上の形（横長）
    __kc.setDevAngle(90);
    ok('回転90の出力', __kc.curRot() === 90 && __kc.outSize().join('x') === '960x1280', __kc.curRot() + ' ' + __kc.outSize().join('x'));
    ok('回転90の枠', f.clientWidth > f.clientHeight, f.clientWidth + 'x' + f.clientHeight);
    await post('/file/preview_rot90.png', await new Promise(r => $('cam-board').toBlob(r, 'image/png')));
    await __kc.shoot();
    await post('/file/photo_rot90.jpg', (await Store.listPhotos(site.id))[0].blob);
    __kc.setDevAngle(0);
    photos = await Store.listPhotos(site.id);

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
    await until(() => document.querySelectorAll('.gal-item').length === 3, 4000);
    ok('一覧に3枚', document.querySelectorAll('.gal-item').length === 3);
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
