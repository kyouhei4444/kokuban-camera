/* 明るさのテスト：タップで自動、バーで手動、保存画像にも効くこと、黒板のドラッグはタップ扱いしないこと */
(async () => {
  const log = [];
  const ok = (name, cond, info) => log.push({ name, ok: !!cond, info: info === undefined ? '' : String(info) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (fn()) return true; await wait(100); } return false; };
  const $ = id => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: 'POST', body });
  const pe = (type, x, y, id) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: id || 1, bubbles: true, isPrimary: true, pointerType: 'touch' });
  // 枠の中の相対位置 (fx,fy: 0〜1) をタップ
  const tapAt = async (fx, fy) => {
    const r = $('cam-board').getBoundingClientRect();
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    $('cam-board').dispatchEvent(pe('pointerdown', x, y));
    await wait(50);
    $('cam-board').dispatchEvent(pe('pointerup', x, y));
    await wait(200);
  };
  // 保存した写真の (fx,fy) まわりの明るさ
  const lumaOf = async (blob, fx, fy) => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = 20; c.height = 20;
    const g = c.getContext('2d');
    g.drawImage(bmp, bmp.width * fx - 40, bmp.height * fy - 40, 80, 80, 0, 0, 20, 20);
    const d = g.getImageData(0, 0, 20, 20).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / 400;
  };
  const shoot = async () => {
    $('cam-shutter').click();
    await until(() => !$('cam-shutter').disabled, 8000);
    await wait(200);
    return (await Store.listPhotos(Store.sites()[0].id))[0];
  };

  try {
    __kc.set.sound = false;
    $('btn-site-add').click(); await wait(100);
    $('d-name').value = '明るさテスト'; $('d-save').click(); await wait(200);
    $('btn-camera').click();
    ok('カメラ起動', await until(() => $('cam-video').videoWidth > 0, 10000));
    await wait(500);
    ok('明るさの方式', !!__kc.expo.mode, __kc.expo.mode + ' / 範囲 ' + $('cam-exp').min + '〜' + $('cam-exp').max);
    ok('初期は自動', $('cam-exp-auto').textContent === '自動' && __kc.expo.ev === 0);

    const p0 = await shoot();
    const base = await lumaOf(p0.blob, 0.9, 0.1);

    // 暗い所（右上の背景）をタップ → 明るくなる
    await tapAt(0.9, 0.1);
    ok('暗い所をタップ → 明るく', __kc.expo.ev > 0.2 && __kc.expo.auto, 'ev=' + __kc.expo.ev + ' 表示=' + $('cam-exp-auto').textContent);
    ok('タップの印', !$('cam-focus').classList.contains('hidden'));
    ok('プレビューに反映', __kc.expo.mode !== 'sw' || /brightness/.test($('cam-video').style.filter), $('cam-video').style.filter);
    const p1 = await shoot();
    const bright = await lumaOf(p1.blob, 0.9, 0.1);
    ok('保存画像も明るい', bright > base * 1.2, base.toFixed(0) + ' → ' + bright.toFixed(0));
    ok('ちょうどよい明るさに近い', Math.abs(bright - 118) < 30, bright.toFixed(0));

    // 明るい所（中央の円）をタップ → 暗くなる
    await tapAt(0.5, 0.5);
    ok('明るい所をタップ → 暗く', __kc.expo.ev < 0, 'ev=' + __kc.expo.ev);

    // バーで手動
    const bar = $('cam-exp');
    bar.value = '1.5'; bar.dispatchEvent(new Event('input', { bubbles: true }));
    ok('バーで手動', __kc.expo.ev === 1.5 && !__kc.expo.auto && $('cam-exp-auto').textContent === '+1.5', $('cam-exp-auto').textContent);
    const p2 = await shoot();
    ok('手動 +1.5 の保存画像（自動より明るい）', (await lumaOf(p2.blob, 0.9, 0.1)) > bright + 20, (await lumaOf(p2.blob, 0.9, 0.1)).toFixed(0));

    // 黒板の上でドラッグ → 明るさは変わらない
    const br = $('cam-board').getBoundingClientRect();
    const bx = br.left + 30, by = br.bottom - 30;
    $('cam-board').dispatchEvent(pe('pointerdown', bx, by));
    $('cam-board').dispatchEvent(pe('pointermove', bx + 40, by - 40));
    $('cam-board').dispatchEvent(pe('pointerup', bx + 40, by - 40));
    await wait(200);
    ok('黒板のドラッグはタップ扱いしない', __kc.expo.ev === 1.5);
    // 黒板の外でも指を動かしたらタップ扱いしない
    const fr = $('cam-board').getBoundingClientRect();
    $('cam-board').dispatchEvent(pe('pointerdown', fr.left + fr.width * 0.8, fr.top + 20));
    $('cam-board').dispatchEvent(pe('pointermove', fr.left + fr.width * 0.8 - 60, fr.top + 20));
    $('cam-board').dispatchEvent(pe('pointerup', fr.left + fr.width * 0.8 - 60, fr.top + 20));
    await wait(200);
    ok('なぞってもタップ扱いしない', __kc.expo.ev === 1.5);

    // 自動に戻す
    $('cam-exp-auto').click(); await wait(100);
    ok('自動に戻す', __kc.expo.ev === 0 && __kc.expo.auto && $('cam-video').style.filter === '' && $('cam-exp-auto').textContent === '自動');
    await post('/file/expo_bright.jpg', p1.blob);
  } catch (e) {
    ok('例外', false, e && e.stack || e);
  }
  ok('JSエラーなし', !(window.__errs || []).length, (window.__errs || []).join(' | '));
  await post('/done', JSON.stringify(log));
})();
