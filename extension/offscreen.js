(() => {
  'use strict';

  const VERSION = '0.7.9-beta.18';
  const encoder = new TextEncoder();
  const objectUrls = new Set();
  const preparedMedia = new Map();
  const PREPARED_TTL_MS = 5 * 60 * 1000;

  function jsonBytes(value) {
    return encoder.encode(JSON.stringify(value, null, 2));
  }

  async function sha256Bytes(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const digest = await crypto.subtle.digest('SHA-256', source);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function cleanupPrepared() {
    const now = Date.now();
    for (const [token, entry] of preparedMedia) {
      if (now - entry.createdAt > PREPARED_TTL_MS) preparedMedia.delete(token);
    }
  }

  setInterval(cleanupPrepared, 30000);

  function downsampleMono(audioBuffer, targetRate = 16000) {
    const sourceLength = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;
    const mono = new Float32Array(sourceLength);
    for (let ch = 0; ch < channels; ch += 1) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < sourceLength; i += 1) mono[i] += data[i] / channels;
    }
    if (audioBuffer.sampleRate === targetRate) return mono;

    const ratio = audioBuffer.sampleRate / targetRate;
    const targetLength = Math.max(1, Math.round(sourceLength / ratio));
    const output = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i += 1) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.min(sourceLength, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = from; j < to; j += 1) sum += mono[j];
      output[i] = sum / (to - from);
    }
    return output;
  }

  function encodeWav(samples, sampleRate = 16000) {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
    return bytes;
  }

  async function fetchMedia(url) {
    // AIDPが認証付き媒体URLを返す場合も同じ取得条件で一度だけ実行する。
    // 失敗時にcredentials条件を切り替えて自動再試行すると、原因と検証条件が
    // 変わってしまうため、このBridgeでは行わない。
    const credentials = 'include';
    try {
      const response = await fetch(url, { credentials, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || '',
        contentLength: Number(response.headers.get('content-length')) || null,
        credentials
      };
    } catch (error) {
      throw new Error(`元メディアを取得できません（credentials=${credentials}、自動再試行なし）: ${error?.message || error || 'unknown error'}`);
    }
  }

  async function decodeMedia(mediaBytes) {
    const context = new AudioContext();
    try {
      const buffer = mediaBytes.buffer.slice(mediaBytes.byteOffset, mediaBytes.byteOffset + mediaBytes.byteLength);
      const decoded = await context.decodeAudioData(buffer);
      return {
        samples: downsampleMono(decoded, 16000),
        decodedDuration: decoded.duration,
        sourceSampleRate: decoded.sampleRate,
        sourceChannels: decoded.numberOfChannels
      };
    } finally {
      try { await context.close(); } catch (_) {}
    }
  }

  function drawWaveform(samples, sampleRate, regions, duration) {
    const width = 3000;
    const height = 820;
    const top = 70;
    const bottom = 730;
    const center = (top + bottom) / 2;
    const amplitude = (bottom - top) * 0.45;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111827';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('AIDP waveform (16kHz mono)', 24, 34);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.fillText(`decoded duration ${duration.toFixed(3)}s / regions ${regions.length}`, 24, 58);

    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();

    const secondsPerMajor = duration > 900 ? 60 : duration > 300 ? 30 : 10;
    for (let t = 0; t <= duration + 1e-6; t += secondsPerMajor) {
      const x = duration > 0 ? t / duration * width : 0;
      ctx.strokeStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.moveTo(x, top - 12);
      ctx.lineTo(x, bottom + 18);
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(`${Math.round(t)}s`, Math.min(width - 45, x + 3), height - 18);
    }

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const samplesPerPixel = Math.max(1, samples.length / width);
    for (let x = 0; x < width; x += 1) {
      const from = Math.floor(x * samplesPerPixel);
      const to = Math.min(samples.length, Math.max(from + 1, Math.floor((x + 1) * samplesPerPixel)));
      let min = 1;
      let max = -1;
      for (let i = from; i < to; i += 1) {
        const value = samples[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      ctx.moveTo(x + 0.5, center - max * amplitude);
      ctx.lineTo(x + 0.5, center - min * amplitude);
    }
    ctx.stroke();

    const ordered = [...regions].sort((a, b) => a.start - b.start || a.end - b.end);
    ordered.forEach((region, index) => {
      const rawX1 = duration > 0 ? region.start / duration * width : 0;
      const rawX2 = duration > 0 ? region.end / duration * width : 0;
      const x1 = Math.max(0, Math.min(width, rawX1));
      const x2 = Math.max(0, Math.min(width, rawX2));
      const row = index % 4;
      ctx.fillStyle = region.keep === '丢弃' ? 'rgba(220,38,38,.08)' : 'rgba(37,99,235,.07)';
      ctx.fillRect(x1, top, Math.max(1, x2 - x1), bottom - top);
      ctx.strokeStyle = region.keep === '丢弃' ? '#dc2626' : '#2563eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, top);
      ctx.lineTo(x1, bottom);
      ctx.moveTo(x2, top);
      ctx.lineTo(x2, bottom);
      ctx.stroke();
      if (rawX2 > width) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#dc2626';
        ctx.beginPath();
        ctx.moveTo(width - 2 - row * 3, top);
        ctx.lineTo(width - 2 - row * 3, bottom);
        ctx.stroke();
        ctx.restore();
      }
      if (x2 - x1 >= 14) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 2, top + 4 + row * 18, Math.max(0, x2 - x1 - 4), 17);
        ctx.clip();
        ctx.fillStyle = '#1f2937';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(region.region_id, x1 + 4, top + 17 + row * 18);
        ctx.restore();
      }
    });

    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) return reject(new Error('波形PNGを生成できませんでした'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
  }

  function compactTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  async function prepareMedia(payload) {
    cleanupPrepared();
    const token = randomToken();
    const files = [];
    const options = payload.options || {};
    const diagnostics = {
      schema: 'aidp-media-diagnostics/v2',
      generated_at: new Date().toISOString(),
      requested_audio: Boolean(options.includeAudio),
      requested_waveform: Boolean(options.includeWaveform),
      extraction_ok: false,
      error: '',
      raw_media_url_included: false
    };
    let partial = false;
    const needDecode = Boolean(options.includeAudio || options.includeWaveform);

    if (needDecode) {
      try {
        if (!payload.mediaUrl) throw new Error('元動画URLが見つかりません');
        const fetched = await fetchMedia(payload.mediaUrl);
        const decoded = await decodeMedia(fetched.bytes);
        diagnostics.extraction_ok = true;
        diagnostics.content_type = fetched.contentType;
        diagnostics.source_bytes = fetched.bytes.length;
        diagnostics.fetch_credentials = fetched.credentials;
        diagnostics.decoded_duration = decoded.decodedDuration;
        diagnostics.source_sample_rate = decoded.sourceSampleRate;
        diagnostics.source_channels = decoded.sourceChannels;
        diagnostics.output_sample_rate = 16000;
        diagnostics.output_channels = 1;
        diagnostics.output_format = 'PCM16 WAV';
        diagnostics.platform_duration = Number(payload.platformDuration) || null;
        diagnostics.duration_delta_sec = Number.isFinite(Number(payload.platformDuration))
          ? Number((decoded.decodedDuration - Number(payload.platformDuration)).toFixed(6))
          : null;

        if (options.includeAudio) {
          files.push({ name: 'audio.wav', bytes: encodeWav(decoded.samples, 16000) });
        }
        if (options.includeWaveform) {
          const duration = decoded.samples.length / 16000;
          files.push({
            name: 'waveform.png',
            bytes: await drawWaveform(decoded.samples, 16000, payload.regions || [], duration)
          });
        }
      } catch (error) {
        diagnostics.error = error?.message || String(error);
        if (!options.allowJsonFallback) throw error;
        partial = true;
      }
    } else {
      diagnostics.extraction_ok = true;
      diagnostics.skipped = true;
    }

    preparedMedia.set(token, {
      createdAt: Date.now(),
      files,
      mediaDiagnostics: diagnostics,
      partial
    });
    return {
      token,
      partial,
      mediaDiagnostics: diagnostics,
      preparedFileCount: files.length
    };
  }

  async function buildPreparedZip(payload) {
    cleanupPrepared();
    const entry = preparedMedia.get(payload.token);
    if (!entry) throw new Error('準備済み音声データが見つからないか、有効期限が切れました');
    preparedMedia.delete(payload.token);

    const files = entry.files.map(file => ({ name: file.name, bytes: file.bytes }));
    files.push({ name: 'case.json', bytes: jsonBytes(payload.caseData) });
    files.push({ name: 'regions.json', bytes: jsonBytes(payload.regionsData) });
    files.push({ name: 'diagnostics/ruleset.json', bytes: jsonBytes(payload.ruleset) });
    files.push({ name: 'diagnostics/capabilities.json', bytes: jsonBytes(payload.capabilities) });
    files.push({ name: 'diagnostics/validation.json', bytes: jsonBytes(payload.capabilities?.validation || {}) });
    files.push({ name: 'diagnostics/media.json', bytes: jsonBytes(entry.mediaDiagnostics) });
    files.push({ name: 'diagnostics/media_range_validation.json', bytes: jsonBytes(payload.mediaRangeValidation) });
    files.push({ name: 'diagnostics/snapshot_diff.json', bytes: jsonBytes(payload.snapshotDiff) });
    files.push({ name: 'diagnostics/export_guard.json', bytes: jsonBytes(payload.exportGuard) });

    if (entry.mediaDiagnostics.error) {
      files.push({
        name: 'diagnostics/media_error.json',
        bytes: jsonBytes({
          schema: 'aidp-media-export-error/v2',
          generated_at: new Date().toISOString(),
          error: entry.mediaDiagnostics.error,
          fallback_zip_created: true,
          raw_media_url_included: false
        })
      });
    }

    const manifestFiles = [];
    for (const file of files) {
      manifestFiles.push({
        path: file.name,
        bytes: file.bytes.length,
        sha256: await sha256Bytes(file.bytes)
      });
    }
    const manifest = {
      schema: 'aidp-chatgpt-export-manifest/v3',
      export_version: VERSION,
      generated_at: new Date().toISOString(),
      case_hash: payload.caseData.case_hash,
      snapshot_id: payload.caseData.snapshot_id,
      fingerprint: payload.caseData.source_fingerprint,
      source_fingerprint: payload.caseData.source_fingerprint,
      ruleset_version: payload.ruleset?.ruleset_version || '',
      export_guard_stable: payload.exportGuard?.stable === true,
      partial: entry.partial,
      raw_media_url_included: false,
      raw_media_path_included: false,
      files: manifestFiles
    };
    files.unshift({ name: 'manifest.json', bytes: jsonBytes(manifest) });

    const zipBytes = globalThis.AIDPZipStore.createStoreZip(files);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const blobUrl = URL.createObjectURL(blob);
    objectUrls.add(blobUrl);
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      objectUrls.delete(blobUrl);
    }, 120000);

    const filename = `AIDP_case_${payload.caseData.case_hash}_${compactTimestamp()}.zip`;
    return {
      blobUrl,
      filename,
      zipBytes: zipBytes.length,
      partial: entry.partial,
      fileCount: files.length,
      mediaDiagnostics: entry.mediaDiagnostics
    };
  }



  async function createJsonFile(payload) {
    const filename = String(payload?.filename || 'aidp_report.json');
    const bytes = jsonBytes(payload?.value ?? null);
    const blob = new Blob([bytes], { type: 'application/json;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    objectUrls.add(blobUrl);
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      objectUrls.delete(blobUrl);
    }, 120000);
    return { filename, blobUrl, bytes: bytes.length, sha256: await sha256Bytes(bytes) };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'offscreen') return;

    if (message.type === 'AIDP_PREPARE_MEDIA') {
      (async () => {
        try {
          sendResponse({ ok: true, result: await prepareMedia(message.payload || {}) });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }

    if (message.type === 'AIDP_BUILD_PREPARED_EXPORT_ZIP') {
      (async () => {
        try {
          sendResponse({ ok: true, result: await buildPreparedZip(message.payload || {}) });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }

    if (message.type === 'AIDP_CANCEL_PREPARED_MEDIA') {
      preparedMedia.delete(message.token);
      sendResponse({ ok: true });
    }


    if (message.type === 'AIDP_CREATE_JSON_FILE') {
      (async () => {
        try {
          sendResponse({ ok: true, result: await createJsonFile(message.payload || {}) });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true;
    }
  });
})();
