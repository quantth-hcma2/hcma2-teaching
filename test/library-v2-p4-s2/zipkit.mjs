// Test helper: a minimal ZIP reader/writer with deliberate knobs for crafting hostile or malformed archives (never used by production code).
import { deflateRawSync, inflateRawSync, crc32 } from "node:zlib";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// entries: [{ name, data: Uint8Array|Buffer|string, method: 8|0, flags, declaredUncompressed, declaredCompressed, localName, localSizes: "zero"|"match", extra: Buffer, localExtra: Buffer, rawCompressed: Buffer }]
// opts: { comment: Buffer, trailing: Buffer, prefix: Buffer, eocdTotal, eocdCdSize, eocdCdOffset, diskNumber }
export function writeZip(entries, opts = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (buffer) => { chunks.push(buffer); offset += buffer.length; };
  if (opts.prefix) push(opts.prefix);
  const base = opts.prefix ? opts.prefix.length : 0;
  for (const entry of entries) {
    const data = Buffer.from(typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data || Buffer.alloc(0));
    const method = entry.method ?? 8;
    const compressed = entry.rawCompressed ?? (method === 8 ? deflateRawSync(data) : data);
    const crc = crc32(data);
    const flags = entry.flags ?? 0;
    const name = Buffer.from(entry.name, "latin1");
    const localName = Buffer.from(entry.localName ?? entry.name, "latin1");
    const declaredUncompressed = entry.declaredUncompressed ?? data.length;
    const declaredCompressed = entry.declaredCompressed ?? compressed.length;
    const localAt = offset - base + (entry.localOffsetDelta || 0);
    const localExtra = entry.localExtra || Buffer.alloc(0);
    const zero = entry.localSizes === "zero";
    push(Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(zero ? 0 : crc), u32(zero ? 0 : declaredCompressed), u32(zero ? 0 : declaredUncompressed), u16(localName.length), u16(localExtra.length), localName, localExtra]));
    push(compressed);
    central.push({ entry, name, flags, method, crc, declaredCompressed, declaredUncompressed, localAt, extra: entry.extra || Buffer.alloc(0) });
  }
  const cdStart = offset;
  for (const c of central) {
    push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(c.flags), u16(c.method), u16(0), u16(0), u32(c.crc), u32(c.declaredCompressed), u32(c.declaredUncompressed), u16(c.name.length), u16(c.extra.length), u16(0), u16(opts.diskNumber ?? 0), u16(0), u32(0), u32(c.localAt), c.name, c.extra]));
  }
  const cdSize = offset - cdStart;
  const comment = opts.comment || Buffer.alloc(0);
  push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(opts.eocdTotal ?? entries.length), u16(opts.eocdTotal ?? entries.length), u32(opts.eocdCdSize ?? cdSize), u32(opts.eocdCdOffset ?? cdStart - base), u16(comment.length), comment]));
  if (opts.trailing) push(opts.trailing);
  return new Uint8Array(Buffer.concat(chunks));
}

// Reads an archive produced by SheetJS/Excel: { name -> Buffer } (uses the central directory; fine for well-formed fixtures).
export function readZip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < total; i++) {
    const method = buf.readUInt16LE(pos + 10), csz = buf.readUInt32LE(pos + 20), nameLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), commentLen = buf.readUInt16LE(pos + 32), local = buf.readUInt32LE(pos + 42);
    const name = buf.toString("latin1", pos + 46, pos + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csz);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
export const rebuildZip = (entries, opts) => writeZip(entries.map((e) => ({ name: e.name, data: e.data })), opts);
