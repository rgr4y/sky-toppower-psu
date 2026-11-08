export function encode(msg) { return JSON.stringify(msg); }
export function decode(str) { return JSON.parse(str); }

export function b64FromBytes(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // btoa in browser; Buffer in node
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(u8).toString('base64');
}

export function bytesFromB64(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
