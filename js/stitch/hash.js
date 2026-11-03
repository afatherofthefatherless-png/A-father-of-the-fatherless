// sha256 via WebCrypto (browser and node >= 19), md5 in plain JS (Drive returns md5Checksum).
export async function sha256Hex(buf) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', buf instanceof ArrayBuffer ? buf : new Uint8Array(buf));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
export function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const len = bytes.length, total = (((len + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(total - 8, (len * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(len / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476; const W = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, Cc = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & Cc) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & Cc); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ Cc ^ D; g = (3 * i + 5) % 16; }
      else { F = Cc ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + W[g]) >>> 0; A = D; D = Cc; Cc = B;
      B = (B + ((F << R[i]) | (F >>> (32 - R[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + Cc) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
