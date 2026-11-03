// WAV encode/decode. Per-verse files are RIFF PCM 16-bit mono 48 kHz.

/** Float32 [-1,1] mono -> ArrayBuffer (RIFF WAVE, PCM16). */
export function encodeWav(samples, sampleRate) {
  const n = samples.length, dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, dataBytes, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) {
    let s = samples[i]; s = s > 1 ? 1 : s < -1 ? -1 : s;
    dv.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return buf;
}

/** ArrayBuffer -> { sampleRate, channels, bitsPerSample, formatTag, samples (Float32, channel 0) }. Throws on non-WAV. */
export function decodeWav(input) {
  const buf = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const dv = new DataView(buf);
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { formatTag: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), sampleRate: dv.getUint32(o + 12, true), bitsPerSample: dv.getUint16(o + 22, true) };
    else if (id === 'data') data = { offset: o + 8, size: Math.min(size, buf.byteLength - o - 8) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV missing fmt or data chunk');
  const out = { ...fmt, samples: null };
  if (fmt.formatTag === 1 && fmt.bitsPerSample === 16) {
    const frames = Math.floor(data.size / (2 * fmt.channels)); const s = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { const v = dv.getInt16(data.offset + i * 2 * fmt.channels, true); s[i] = v < 0 ? v / 32768 : v / 32767; }
    out.samples = s;
  }
  return out;
}
