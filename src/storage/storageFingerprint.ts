const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function fingerprintBody(body: string): string {
  const byteLength = body.length * 2;
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  for (let index = 0; index < body.length; index++) {
    const codeUnit = body.charCodeAt(index);
    bytes[index * 2] = codeUnit & 0xff;
    bytes[index * 2 + 1] = codeUnit >>> 8;
  }
  bytes[byteLength] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = byteLength * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) schedule[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const earlier = schedule[index - 15];
      const later = schedule[index - 2];
      const sigma0 = rotateRight(earlier, 7) ^ rotateRight(earlier, 18) ^ (earlier >>> 3);
      const sigma1 = rotateRight(later, 17) ^ rotateRight(later, 19) ^ (later >>> 10);
      schedule[index] = schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1;
    }
    const working = Array.from(state);
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(working[4], 6) ^ rotateRight(working[4], 11) ^ rotateRight(working[4], 25);
      const choice = (working[4] & working[5]) ^ (~working[4] & working[6]);
      const temporary1 = (working[7] + sum1 + choice + ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(working[0], 2) ^ rotateRight(working[0], 13) ^ rotateRight(working[0], 22);
      const majority = (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
      const temporary2 = (sum0 + majority) >>> 0;
      working.unshift((temporary1 + temporary2) >>> 0);
      working[4] = (working[4] + temporary1) >>> 0;
      working.pop();
    }
    for (let index = 0; index < 8; index++) state[index] += working[index];
  }
  return Array.from(state, value => value.toString(16).padStart(8, "0")).join("");
}
