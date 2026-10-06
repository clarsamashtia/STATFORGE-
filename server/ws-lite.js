/* Minimal dependency-free RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation).
   Used instead of Socket.IO so the server needs NO `npm install` and can be tested anywhere. */
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
class Conn {
  constructor(s) { this.s = s; this.buf = Buffer.alloc(0); this.alive = true; this.frag = []; this.fop = 1; this.onmessage = null; this.onclose = null;
    s.on('data', d => { this.buf = Buffer.concat([this.buf, d]); if (this.buf.length > (1 << 20)) return this.close(1009); this.parse(); });
    s.on('close', () => this._closed()); s.on('error', () => this._closed()); }
  _closed() { if (this.done) return; this.done = true; this.alive = false; if (this.onclose) this.onclose(); }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 128, op = b[0] & 15, masked = b[1] & 128; let len = b[1] & 127, o = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); o = 10; }
      if (!masked) return this.close(1002);
      if (len > 262144) return this.close(1009);
      if (b.length < o + 4 + len) return;
      const mask = b.subarray(o, o + 4), data = Buffer.from(b.subarray(o + 4, o + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(o + 4 + len);
      if (op === 8) return this.close(1000);
      if (op === 9) { this.frame(10, data); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) this.fop = op;
      if (op === 0 || op === 1 || op === 2) { this.frag.push(data); if (fin) { const m = Buffer.concat(this.frag); this.frag = []; if (this.fop === 1 && this.onmessage) this.onmessage(m.toString('utf8')); } }
    }
  }
  frame(op, data) {
    if (!this.alive) return; const len = data.length; let h;
    if (len < 126) h = Buffer.from([128 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    try { this.s.write(Buffer.concat([h, data])); } catch (e) {}
  }
  send(o) { this.frame(1, Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))); }
  ping() { this.frame(9, Buffer.alloc(0)); }
  close(code = 1000) { if (!this.alive) return; try { const b = Buffer.alloc(2); b.writeUInt16BE(code); this.frame(8, b); this.s.end(); } catch (e) {} this.alive = false; this._closed(); }
}
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const h = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + h + '\r\n\r\n');
  socket.setNoDelay(true);
  return new Conn(socket);
}
module.exports = { accept };
