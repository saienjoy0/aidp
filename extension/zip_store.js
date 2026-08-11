(() => {
  'use strict';

  const encoder = new TextEncoder();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: day };
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function concat(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function createStoreZip(inputFiles) {
    const files = inputFiles.map(file => {
      const nameBytes = encoder.encode(file.name);
      const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
      return {
        name: file.name,
        nameBytes,
        data,
        crc: crc32(data),
        modified: file.modified || new Date()
      };
    });

    const localChunks = [];
    const centralChunks = [];
    let localOffset = 0;
    let localTotal = 0;
    let centralTotal = 0;

    for (const file of files) {
      if (file.data.length > 0xffffffff) throw new Error(`ZIP内ファイルが4GBを超えています: ${file.name}`);
      const stamp = dosDateTime(file.modified);
      const local = new Uint8Array(30 + file.nameBytes.length);
      const lv = new DataView(local.buffer);
      writeU32(lv, 0, 0x04034b50);
      writeU16(lv, 4, 20);
      writeU16(lv, 6, 0x0800); // UTF-8
      writeU16(lv, 8, 0); // store
      writeU16(lv, 10, stamp.time);
      writeU16(lv, 12, stamp.date);
      writeU32(lv, 14, file.crc);
      writeU32(lv, 18, file.data.length);
      writeU32(lv, 22, file.data.length);
      writeU16(lv, 26, file.nameBytes.length);
      writeU16(lv, 28, 0);
      local.set(file.nameBytes, 30);
      localChunks.push(local, file.data);
      localTotal += local.length + file.data.length;

      const central = new Uint8Array(46 + file.nameBytes.length);
      const cv = new DataView(central.buffer);
      writeU32(cv, 0, 0x02014b50);
      writeU16(cv, 4, 20);
      writeU16(cv, 6, 20);
      writeU16(cv, 8, 0x0800);
      writeU16(cv, 10, 0);
      writeU16(cv, 12, stamp.time);
      writeU16(cv, 14, stamp.date);
      writeU32(cv, 16, file.crc);
      writeU32(cv, 20, file.data.length);
      writeU32(cv, 24, file.data.length);
      writeU16(cv, 28, file.nameBytes.length);
      writeU16(cv, 30, 0);
      writeU16(cv, 32, 0);
      writeU16(cv, 34, 0);
      writeU16(cv, 36, 0);
      writeU32(cv, 38, 0);
      writeU32(cv, 42, localOffset);
      central.set(file.nameBytes, 46);
      centralChunks.push(central);
      centralTotal += central.length;
      localOffset += local.length + file.data.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    writeU32(ev, 0, 0x06054b50);
    writeU16(ev, 4, 0);
    writeU16(ev, 6, 0);
    writeU16(ev, 8, files.length);
    writeU16(ev, 10, files.length);
    writeU32(ev, 12, centralTotal);
    writeU32(ev, 16, localTotal);
    writeU16(ev, 20, 0);

    return concat([...localChunks, ...centralChunks, eocd], localTotal + centralTotal + eocd.length);
  }

  globalThis.AIDPZipStore = { createStoreZip, crc32 };
})();
