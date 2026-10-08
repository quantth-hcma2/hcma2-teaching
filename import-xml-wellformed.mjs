// Library V2 P4-S2 - strict, bounded XML 1.0 WELL-FORMEDNESS check for the OOXML parts the reader tolerates silently (pure, inert; no DOM, no DOMParser,
// no network, no clock; works inside a Worker). SheetJS reads xl/styles.xml with a forgiving regular-expression scanner, so a garbled styles part would be
// accepted; the container gate therefore verifies it here. Scope is deliberately narrow: well-formedness + the root element, not schema validation.
//
//   checkWellFormedXml(bytes, { rootName?, maxDepth?, maxBytes? }) -> { ok, detail }
//
// Accepted: UTF-8 (with or without BOM) or UTF-16 with BOM; an optional XML declaration at offset 0 whose encoding agrees with the bytes; comments, processing
// instructions, CDATA; elements/attributes with correctly quoted values, unique attribute names, balanced and matching tags, exactly one root; the five predefined
// entities and numeric character references to legal XML characters. Rejected: DOCTYPE/ENTITY (no DTD at all), invalid UTF-8, characters illegal in XML 1.0,
// text outside the root, a second root, `--` inside comments, `]]>` in text, a bare `&` or `<`, nesting deeper than maxDepth.
const MAX_DEPTH = 64;
const MAX_ATTRIBUTES = 256;

// XML 1.0 (5th edition) NameStartChar / NameChar by code point.
function isNameStart(cp) {
  return cp === 0x3a || (cp >= 0x41 && cp <= 0x5a) || cp === 0x5f || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0xd6) || (cp >= 0xd8 && cp <= 0xf6) || (cp >= 0xf8 && cp <= 0x2ff) ||
    (cp >= 0x370 && cp <= 0x37d) || (cp >= 0x37f && cp <= 0x1fff) || (cp >= 0x200c && cp <= 0x200d) || (cp >= 0x2070 && cp <= 0x218f) || (cp >= 0x2c00 && cp <= 0x2fef) ||
    (cp >= 0x3001 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfdcf) || (cp >= 0xfdf0 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0xeffff);
}
const isNameChar = (cp) => isNameStart(cp) || cp === 0x2d || cp === 0x2e || (cp >= 0x30 && cp <= 0x39) || cp === 0xb7 || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x203f && cp <= 0x2040);
const isSpace = (cu) => cu === 0x20 || cu === 0x09 || cu === 0x0a || cu === 0x0d;
const isXmlChar = (cp) => cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);

function decode(bytes) {
  let encoding = "utf-8", start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; start = 2; }
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; start = 2; }
  try { return { text: new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start)), encoding }; } catch (error) { return null; }
}

export function checkWellFormedXml(bytes, { rootName = null, maxDepth = MAX_DEPTH, maxBytes = 4 * 1024 * 1024 } = {}) {
  const bad = (detail, at) => ({ ok: false, detail: detail + (typeof at === "number" ? " (vị trí " + at + ")" : "") });
  if (!bytes || bytes.length === 0) return bad("tệp rỗng");
  if (bytes.length > maxBytes) return bad("tệp quá lớn");
  const decoded = decode(bytes);
  if (!decoded) return bad("mã hóa ký tự không hợp lệ");
  const text = decoded.text, n = text.length;
  let i = 0;
  // ---- characters: every code point must be a legal XML 1.0 character
  for (const ch of text) if (!isXmlChar(ch.codePointAt(0))) return bad("ký tự không hợp lệ trong XML");
  const skipSpace = () => { while (i < n && isSpace(text.charCodeAt(i))) i++; };
  const readName = () => {
    const begin = i;
    while (i < n) {
      const cp = text.codePointAt(i);
      if (!(i === begin ? isNameStart(cp) : isNameChar(cp))) break;
      i += cp > 0xffff ? 2 : 1;
    }
    return i === begin ? null : text.slice(begin, i);
  };
  const entityOk = (from) => {                                       // text[from] === "&"; returns index after ";" or -1
    const semi = text.indexOf(";", from + 1);
    if (semi < 0 || semi - from > 12) return -1;
    const body = text.slice(from + 1, semi);
    if (body === "amp" || body === "lt" || body === "gt" || body === "quot" || body === "apos") return semi + 1;
    if (body.charCodeAt(0) === 0x23) {
      const hex = body.charCodeAt(1) === 0x78;
      const digits = hex ? body.slice(2) : body.slice(1);
      if (!(hex ? /^[0-9a-fA-F]{1,6}$/ : /^[0-9]{1,7}$/).test(digits)) return -1;
      const cp = parseInt(digits, hex ? 16 : 10);
      return isXmlChar(cp) ? semi + 1 : -1;
    }
    return -1;
  };
  const reservedTarget = (from) => { let j = from; while (j < n && !isSpace(text.charCodeAt(j)) && text.charCodeAt(j) !== 0x3f) j++; return text.slice(from, j).toLowerCase() === "xml"; };   // the target "xml" is reserved for the declaration
  // ---- XML declaration (only at offset 0)
  if (text.startsWith("<?xml") && (isSpace(text.charCodeAt(5)) || text.charCodeAt(5) === 0x3f)) {
    const end = text.indexOf("?>");
    if (end < 0) return bad("khai báo XML không đóng");
    const declaration = text.slice(5, end);
    const enc = /encoding\s*=\s*["']([A-Za-z][A-Za-z0-9._-]*)["']/.exec(declaration);
    if (enc) {
      const declared = enc[1].toLowerCase();
      const family = decoded.encoding.startsWith("utf-16") ? declared.startsWith("utf-16") : declared === "utf-8";
      if (!family) return bad("mã hóa khai báo không khớp dữ liệu");
    } else if (decoded.encoding.startsWith("utf-16")) return bad("UTF-16 phải khai báo mã hóa");
    if (!/^\s+version\s*=\s*["']1\.[0-9]+["']/.test(declaration)) return bad("khai báo XML thiếu version");
    i = end + 2;
  }
  // ---- prolog / epilog helpers
  const miscellany = (allowDoctype) => {                              // whitespace, comments, processing instructions
    for (;;) {
      skipSpace();
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) return "chú thích không đóng";
        const body = text.slice(i + 4, end);
        if (body.includes("--") || body.endsWith("-")) return "chú thích không hợp lệ";
        i = end + 3;
      } else if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i + 2);
        if (end < 0) return "chỉ thị xử lý không đóng";
        if (reservedTarget(i + 2)) return "chỉ thị xử lý mang tên xml bị cấm";
        i = end + 2;
      } else if (text.startsWith("<!DOCTYPE", i) || text.startsWith("<!ENTITY", i)) {
        return "DOCTYPE/ENTITY không được phép";
      } else return null;
    }
  };
  const prologError = miscellany();
  if (prologError) return bad(prologError, i);
  if (i >= n || text.charCodeAt(i) !== 0x3c) return bad("thiếu phần tử gốc", i);

  // ---- the single root element and its content (iterative: no recursion on hostile nesting)
  const stack = [];
  let rootSeen = false, rootActual = null;
  for (;;) {
    if (stack.length === 0 && rootSeen) break;
    if (i >= n) return bad("tài liệu kết thúc đột ngột");
    if (text.charCodeAt(i) !== 0x3c) {                                // character data
      if (stack.length === 0) return bad("văn bản ngoài phần tử gốc", i);
      while (i < n && text.charCodeAt(i) !== 0x3c) {
        const cu = text.charCodeAt(i);
        if (cu === 0x26) { const after = entityOk(i); if (after < 0) return bad("tham chiếu thực thể không hợp lệ", i); i = after; }
        else if (cu === 0x5d && text.startsWith("]]>", i)) return bad("chuỗi ]]> không hợp lệ trong văn bản", i);
        else i++;
      }
      continue;
    }
    if (text.startsWith("<!--", i)) { const end = text.indexOf("-->", i + 4); if (end < 0) return bad("chú thích không đóng", i); const body = text.slice(i + 4, end); if (body.includes("--") || body.endsWith("-")) return bad("chú thích không hợp lệ", i); i = end + 3; continue; }
    if (text.startsWith("<![CDATA[", i)) { if (stack.length === 0) return bad("CDATA ngoài phần tử gốc", i); const end = text.indexOf("]]>", i + 9); if (end < 0) return bad("CDATA không đóng", i); i = end + 3; continue; }
    if (text.startsWith("<?", i)) { const end = text.indexOf("?>", i + 2); if (end < 0) return bad("chỉ thị xử lý không đóng", i); if (reservedTarget(i + 2)) return bad("chỉ thị xử lý mang tên xml bị cấm", i); i = end + 2; continue; }
    if (text.startsWith("<!", i)) return bad("khai báo không được phép", i);
    if (text.charCodeAt(i + 1) === 0x2f) {                            // end tag
      i += 2;
      const name = readName();
      if (name === null || stack.length === 0 || stack[stack.length - 1] !== name) return bad("thẻ đóng không khớp", i);
      skipSpace();
      if (text.charCodeAt(i) !== 0x3e) return bad("thẻ đóng không hợp lệ", i);
      i++; stack.pop();
      continue;
    }
    // start tag
    i++;
    const tag = readName();
    if (tag === null) return bad("tên phần tử không hợp lệ", i);
    if (!rootSeen) { rootSeen = true; rootActual = tag; if (rootName !== null && tag !== rootName && !tag.endsWith(":" + rootName)) return bad("phần tử gốc phải là " + rootName + " nhưng là " + tag); }
    else if (stack.length === 0) return bad("có hơn một phần tử gốc", i);
    const names = new Set();
    for (;;) {
      const before = i;
      skipSpace();
      const cu = text.charCodeAt(i);
      if (cu === 0x3e) { i++; stack.push(tag); if (stack.length > maxDepth) return bad("lồng nhau quá sâu"); break; }
      if (cu === 0x2f) { if (text.charCodeAt(i + 1) !== 0x3e) return bad("thẻ tự đóng không hợp lệ", i); i += 2; break; }
      if (i === before) return bad("thiếu khoảng trắng giữa các thuộc tính", i);
      const attr = readName();
      if (attr === null) return bad("tên thuộc tính không hợp lệ", i);
      if (names.has(attr)) return bad("thuộc tính bị lặp: " + attr, i);
      names.add(attr);
      if (names.size > MAX_ATTRIBUTES) return bad("quá nhiều thuộc tính");
      skipSpace();
      if (text.charCodeAt(i) !== 0x3d) return bad("thuộc tính thiếu dấu =", i);
      i++; skipSpace();
      const quote = text.charCodeAt(i);
      if (quote !== 0x22 && quote !== 0x27) return bad("giá trị thuộc tính phải đặt trong dấu nháy", i);
      i++;
      for (;;) {
        if (i >= n) return bad("giá trị thuộc tính không đóng");
        const c = text.charCodeAt(i);
        if (c === quote) { i++; break; }
        if (c === 0x3c) return bad("ký tự < trong giá trị thuộc tính", i);
        if (c === 0x26) { const after = entityOk(i); if (after < 0) return bad("tham chiếu thực thể không hợp lệ", i); i = after; } else i++;
      }
    }
  }
  const epilogError = miscellany();
  if (epilogError) return bad(epilogError, i);
  if (i < n) return bad("dữ liệu thừa sau phần tử gốc", i);
  return { ok: true, detail: null, root: rootActual, head: text.slice(0, 2048) };
}
