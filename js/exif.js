/* ============================================================
   exif.js  JPEG に Exif（撮影日時・画素数・位置）を書き込む
   canvas.toBlob で作った JPEG には Exif が無いので、
   電子納品ソフトが撮影日を読めるよう APP1 を自前で組み立てて差し込む。
   ============================================================ */
const Exif = (() => {
  // 型: 1=BYTE 2=ASCII 3=SHORT 4=LONG 5=RATIONAL 7=UNDEFINED
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

  function ascii(tag, s) {
    const b = [];
    for (const ch of String(s)) { const c = ch.charCodeAt(0); b.push(c < 128 ? c : 63); }
    b.push(0);
    return { tag, type: 2, count: b.length, bytes: b };
  }
  function short(tag, v) { return { tag, type: 3, count: 1, nums: [v] }; }
  function long(tag, v) { return { tag, type: 4, count: 1, nums: [v] }; }
  function rational(tag, pairs) { return { tag, type: 5, count: pairs.length, nums: pairs.flat() }; }
  function raw(tag, type, bytes) { return { tag, type, count: bytes.length, bytes }; }

  function entryBytes(e) {
    if (e.bytes) return e.bytes;
    const out = [];
    const sz = e.type === 5 ? 4 : SIZE[e.type];
    for (const n of e.nums) {
      for (let i = sz - 1; i >= 0; i--) out.push((n >>> (8 * i)) & 0xff);
    }
    return out;
  }

  function ifdSize(entries) {
    let data = 0;
    for (const e of entries) {
      const len = entryBytes(e).length;
      if (len > 4) data += len + (len & 1);
    }
    return 2 + entries.length * 12 + 4 + data;
  }

  // TIFF 先頭からの offset に IFD を書く（ビッグエンディアン）
  function writeIfd(view, offset, entries) {
    entries.sort((a, b) => a.tag - b.tag);
    let p = offset;
    view.setUint16(p, entries.length); p += 2;
    let dataPos = offset + 2 + entries.length * 12 + 4;
    for (const e of entries) {
      const bytes = entryBytes(e);
      view.setUint16(p, e.tag); view.setUint16(p + 2, e.type); view.setUint32(p + 4, e.count);
      if (bytes.length <= 4) {
        for (let i = 0; i < 4; i++) view.setUint8(p + 8 + i, i < bytes.length ? bytes[i] : 0);
      } else {
        view.setUint32(p + 8, dataPos);
        for (let i = 0; i < bytes.length; i++) view.setUint8(dataPos + i, bytes[i]);
        dataPos += bytes.length + (bytes.length & 1);
      }
      p += 12;
    }
    view.setUint32(p, 0); // 次の IFD なし
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function exifDate(d) {
    return d.getFullYear() + ':' + pad(d.getMonth() + 1) + ':' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function tzOffset(d) {
    const m = -d.getTimezoneOffset();
    const s = m >= 0 ? '+' : '-';
    return s + pad(Math.floor(Math.abs(m) / 60)) + ':' + pad(Math.abs(m) % 60);
  }
  function dms(deg) {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const mf = (a - d) * 60;
    const m = Math.floor(mf);
    const s = Math.round((mf - m) * 60 * 1000);
    return [[d, 1], [m, 1], [s, 1000]];
  }

  /** APP1 セグメント（FFE1 から）を作る */
  function build(o) {
    const date = o.date || new Date();
    const ifd0 = [
      short(0x0112, 1),                 // Orientation
      rational(0x011A, [[72, 1]]),      // XResolution
      rational(0x011B, [[72, 1]]),      // YResolution
      short(0x0128, 2),                 // ResolutionUnit = inch
      ascii(0x0131, o.software || 'KokubanCamera'),
      ascii(0x0132, exifDate(date)),
      long(0x8769, 0)                   // Exif IFD へのポインタ（後で埋める）
    ];
    if (o.make) ifd0.push(ascii(0x010F, o.make));
    if (o.model) ifd0.push(ascii(0x0110, o.model));
    const exif = [
      raw(0x9000, 7, [0x30, 0x32, 0x33, 0x32]), // ExifVersion 0232
      ascii(0x9003, exifDate(date)),            // DateTimeOriginal
      ascii(0x9004, exifDate(date)),            // DateTimeDigitized
      ascii(0x9010, tzOffset(date)),            // OffsetTime
      ascii(0x9011, tzOffset(date)),            // OffsetTimeOriginal
      short(0xA001, 1),                         // ColorSpace sRGB
      long(0xA002, o.width),
      long(0xA003, o.height)
    ];
    let gps = null;
    if (o.gps && isFinite(o.gps.lat) && isFinite(o.gps.lon)) {
      gps = [
        raw(0x0000, 1, [2, 3, 0, 0]),
        ascii(0x0001, o.gps.lat >= 0 ? 'N' : 'S'),
        rational(0x0002, dms(o.gps.lat)),
        ascii(0x0003, o.gps.lon >= 0 ? 'E' : 'W'),
        rational(0x0004, dms(o.gps.lon)),
        ascii(0x0012, 'WGS-84')
      ];
      if (isFinite(o.gps.alt) && o.gps.alt !== null) {
        gps.push(raw(0x0005, 1, [o.gps.alt < 0 ? 1 : 0]));
        gps.push(rational(0x0006, [[Math.round(Math.abs(o.gps.alt) * 100), 100]]));
      }
      ifd0.push(long(0x8825, 0));
    }

    const off0 = 8;
    const offExif = off0 + ifdSize(ifd0);
    const offGps = offExif + ifdSize(exif);
    ifd0.find(e => e.tag === 0x8769).nums = [offExif];
    if (gps) ifd0.find(e => e.tag === 0x8825).nums = [offGps];
    const tiffLen = offGps + (gps ? ifdSize(gps) : 0);

    const seg = new Uint8Array(4 + 6 + tiffLen);
    const v = new DataView(seg.buffer);
    v.setUint16(0, 0xFFE1);
    v.setUint16(2, seg.length - 2);
    seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
    const t = new DataView(seg.buffer, 10);
    t.setUint16(0, 0x4D4D); t.setUint16(2, 42); t.setUint32(4, off0);
    writeIfd(t, off0, ifd0);
    writeIfd(t, offExif, exif);
    if (gps) writeIfd(t, offGps, gps);
    return seg;
  }

  /** JPEG（ArrayBuffer）の SOI 直後に APP1 を入れ、既存の APP0/APP1 は外す */
  function insert(jpeg, app1) {
    const src = new Uint8Array(jpeg);
    if (src[0] !== 0xFF || src[1] !== 0xD8) throw new Error('JPEG ではありません');
    let p = 2;
    while (p + 4 <= src.length && src[p] === 0xFF && (src[p + 1] === 0xE0 || src[p + 1] === 0xE1)) {
      p += 2 + ((src[p + 2] << 8) | src[p + 3]);
    }
    const out = new Uint8Array(2 + app1.length + (src.length - p));
    out.set([0xFF, 0xD8], 0);
    out.set(app1, 2);
    out.set(src.subarray(p), 2 + app1.length);
    return out;
  }

  return { build, insert, exifDate };
})();
