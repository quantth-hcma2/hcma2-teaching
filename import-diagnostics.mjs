// Library V2 P4-S2 - structured Vietnamese diagnostics for the XLSX import pipeline (pure, inert).
// A diagnostic is { severity: "error"|"warning", code, stage (1-10), sheet, row, column, field, message, hint, refs:[{sheet,row}], value, data }.
//   - `data` is an optional machine-readable payload (null when unused); BROWSER_UNSUPPORTED carries { missing: [capability ids] } so the UI can react to the code, not to text;
//   - `sheet`/`row` are the worksheet name and the EXCEL row number (1-based); `column` is the header text; `field` is the stable field key;
//   - `code` is a stable machine-readable identifier (the catalog below); `message` is plain Vietnamese and already contains the location;
//   - `value` is a short, bounded excerpt of the offending cell (never the whole cell), `refs` the other rows involved (e.g. the first duplicate).
// Messages never contain Firestore ids. Nothing here touches the DOM, the network or the clock.
const freeze = Object.freeze;

export const STAGES = freeze({
  1: "Tệp", 2: "Sổ làm việc và mẫu", 3: "Cấu trúc bảng", 4: "Chuẩn hóa dòng", 5: "Quan hệ môn - bài",
  6: "Quy tắc chương trình (P3)", 7: "Mã trùng", 8: "Giới hạn an toàn", 9: "Sẵn sàng xem trước", 10: "Kiểm tra lại trước khi ghi"
});
export const MAX_VALUE_EXCERPT = 60;

const q = (text) => "“" + text + "”";
const excerpt = (value) => {
  if (value === undefined || value === null) return null;
  const text = Array.from(String(value), (ch) => { const cp = ch.codePointAt(0); return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : ch; }).join("");
  return text.length > MAX_VALUE_EXCERPT ? text.slice(0, MAX_VALUE_EXCERPT) + "…" : text;
};
const n = (value) => (typeof value === "number" ? value.toLocaleString("en-US") : String(value));

// code -> { severity, stage, text(details) => body, hint?(details) => string }
const C = {
  // ---- stage 1: file / container
  FILE_EXTENSION: { severity: "error", stage: 1, text: () => "Chỉ nhận tệp Excel có đuôi .xlsx.", hint: () => "Không nhận .xls, .xlsm, .xlsb, .csv hoặc .ods. Hãy lưu tệp dưới dạng Excel Workbook (.xlsx)." },
  FILE_EMPTY: { severity: "error", stage: 1, text: () => "Tệp rỗng." },
  FILE_INFO_INVALID: { severity: "error", stage: 1, text: () => "Thiếu thông tin tệp (tên 1-200 ký tự, kích thước, mã SHA-256)." },
  FILE_TOO_LARGE: { severity: "error", stage: 1, text: (d) => "Tệp lớn " + n(d.size) + " byte, vượt giới hạn " + n(d.max) + " byte (5 MiB).", hint: () => "Chia nhỏ tệp hoặc xóa dữ liệu thừa." },
  FILE_NOT_ZIP: { severity: "error", stage: 1, text: () => "Tệp không phải sổ làm việc .xlsx hợp lệ (không có cấu trúc gói ZIP).", hint: () => "Mở tệp bằng Excel rồi lưu lại dưới dạng .xlsx." },
  FILE_LEGACY_OR_ENCRYPTED: { severity: "error", stage: 1, text: () => "Đây là tệp Excel cũ (.xls) hoặc tệp được đặt mật khẩu/mã hóa; hệ thống không đọc loại tệp này.", hint: () => "Bỏ mật khẩu và lưu lại dưới dạng .xlsx." },
  ZIP_BROKEN: { severity: "error", stage: 1, text: (d) => "Gói .xlsx bị hỏng hoặc không đầy đủ" + (d.detail ? " (" + d.detail + ")" : "") + ".", hint: () => "Tải lại tệp gốc hoặc lưu lại từ Excel." },
  ZIP_TOO_MANY_ENTRIES: { severity: "error", stage: 1, text: (d) => "Gói .xlsx có " + n(d.count) + " thành phần, vượt giới hạn " + n(d.max) + "." },
  ZIP_ENTRY_NAME_INVALID: { severity: "error", stage: 1, text: (d) => "Gói .xlsx chứa tên thành phần không hợp lệ " + q(excerpt(d.name)) + "." },
  ZIP_DUPLICATE_ENTRY: { severity: "error", stage: 1, text: (d) => "Gói .xlsx chứa hai thành phần trùng tên " + q(excerpt(d.name)) + "." },
  ZIP_ENCRYPTED_ENTRY: { severity: "error", stage: 1, text: () => "Gói .xlsx có thành phần được mã hóa.", hint: () => "Bỏ mật khẩu và lưu lại dưới dạng .xlsx." },
  ZIP64_UNSUPPORTED: { severity: "error", stage: 1, text: () => "Gói .xlsx dùng định dạng ZIP64, không được hỗ trợ." },
  ZIP_METHOD_UNSUPPORTED: { severity: "error", stage: 1, text: (d) => "Thành phần " + q(excerpt(d.name)) + " dùng kiểu nén không được hỗ trợ (" + d.method + ")." },
  ZIP_LOCAL_HEADER_INVALID: { severity: "error", stage: 1, text: (d) => "Cấu trúc bên trong gói .xlsx không nhất quán" + (d.name ? " (thành phần " + q(excerpt(d.name)) + ")" : "") + "." },
  ZIP_OVERLAP: { severity: "error", stage: 1, text: () => "Các thành phần trong gói .xlsx chồng lên nhau (cấu trúc đáng ngờ)." },
  ZIP_TRAILING_DATA: { severity: "error", stage: 1, text: () => "Gói .xlsx có dữ liệu thừa trước hoặc sau cấu trúc ZIP." },
  ZIP_ENTRY_TOO_LARGE: { severity: "error", stage: 1, text: (d) => "Thành phần " + q(excerpt(d.name)) + " giải nén ra " + n(d.size) + " byte, vượt giới hạn " + n(d.max) + "." },
  ZIP_TOTAL_TOO_LARGE: { severity: "error", stage: 1, text: (d) => "Tổng dung lượng giải nén " + n(d.size) + " byte vượt giới hạn " + n(d.max) + "." },
  ZIP_RATIO_TOO_HIGH: { severity: "error", stage: 1, text: (d) => "Tỷ lệ nén bất thường" + (d.name ? " ở thành phần " + q(excerpt(d.name)) : "") + " (vượt " + d.max + ":1)." },
  ZIP_SIZE_MISMATCH: { severity: "error", stage: 1, text: (d) => "Kích thước thực của thành phần " + q(excerpt(d.name)) + " không khớp khai báo (khai báo " + n(d.declared) + ", thực tế vượt quá)." },
  ZIP_INFLATE_FAILED: { severity: "error", stage: 1, text: (d) => "Không giải nén được thành phần " + q(excerpt(d.name)) + "." },
  NOT_XLSX: { severity: "error", stage: 1, text: (d) => "Gói ZIP này không phải sổ làm việc Excel (thiếu " + excerpt(d.part) + ")." },
  XLSX_MACROS: { severity: "error", stage: 1, text: () => "Sổ làm việc có macro (VBA). Hệ thống từ chối tệp có macro.", hint: () => "Lưu lại dưới dạng .xlsx (không macro)." },
  XLSX_EXTERNAL_LINKS: { severity: "error", stage: 1, text: () => "Sổ làm việc có liên kết ngoài hoặc kết nối dữ liệu. Hệ thống từ chối.", hint: () => "Chuyển công thức thành giá trị và xóa liên kết ngoài." },
  XLSX_UNSUPPORTED_PART: { severity: "error", stage: 1, text: (d) => "Sổ làm việc có thành phần không được hỗ trợ: " + q(excerpt(d.name)) + "." },
  XML_DTD_FORBIDDEN: { severity: "error", stage: 1, text: (d) => "Thành phần " + q(excerpt(d.name)) + " chứa khai báo DOCTYPE/ENTITY, không được phép." },
  XLSX_SHARED_STRINGS_LIMIT: { severity: "error", stage: 1, text: (d) => "Sổ làm việc có quá nhiều chuỗi văn bản (" + n(d.count) + " > " + n(d.max) + ")." },
  SHEET_TOO_LARGE: { severity: "error", stage: 1, text: (d) => "Một sheet vượt giới hạn " + d.what + " (" + n(d.count) + " > " + n(d.max) + ")" + (d.name ? " ở " + q(excerpt(d.name)) : "") + "." },
  PARSE_EXCEPTION: { severity: "error", stage: 1, text: () => "Tệp không đọc được hoặc không đúng mẫu.", hint: () => "Hãy tải lại tệp mẫu và nhập dữ liệu vào đó." },
  PARSE_TIMEOUT: { severity: "error", stage: 1, text: (d) => "Đọc tệp quá lâu (hơn " + n(d.seconds) + " giây) nên đã bị dừng.", hint: () => "Tệp có thể quá phức tạp hoặc bị hỏng. Hãy dùng tệp mẫu." },
  BROWSER_UNSUPPORTED: { severity: "error", stage: 1, text: (d) => "Trình duyệt này chưa hỗ trợ đọc tệp Excel một cách an toàn" + (d.data && d.data.missing && d.data.missing.length ? " (thiếu: " + d.data.missing.join(", ") + ")" : "") + ".", hint: () => "Hãy dùng phiên bản mới của Chrome, Edge, Firefox hoặc Safari. Hệ thống không đọc tệp bằng cách kém an toàn hơn." },
  STYLES_INVALID: { severity: "error", stage: 1, text: (d) => "Phần định dạng ô (xl/styles.xml) của sổ làm việc bị hỏng hoặc không hợp lệ" + (d.detail ? " (" + excerpt(d.detail) + ")" : "") + ".", hint: () => "Mở tệp bằng Excel rồi lưu lại dưới dạng .xlsx, hoặc dùng tệp mẫu." },
  PARSE_NO_SHEETS: { severity: "error", stage: 1, text: () => "Sổ làm việc không có sheet nào." },
  // ---- stage 2: workbook / template
  SHEET_MISSING: { severity: "error", stage: 2, text: (d) => "Thiếu sheet " + q(d.sheet) + ".", hint: () => "Hãy dùng tệp mẫu và không xóa hoặc đổi tên sheet." },
  SHEET_UNEXPECTED: { severity: "error", stage: 2, text: (d) => "Sheet " + q(excerpt(d.sheet)) + " không thuộc mẫu.", hint: () => "Xóa sheet này. Mẫu chỉ gồm: HƯỚNG DẪN, KHUNG, MÔN, BÀI, _meta." },
  SHEET_DUPLICATE: { severity: "error", stage: 2, text: (d) => "Tên sheet " + q(excerpt(d.sheet)) + " bị lặp." },
  SHEET_NAME_CASE: { severity: "error", stage: 2, text: (d) => "Tên sheet " + q(excerpt(d.sheet)) + " sai chữ hoa/thường hoặc dấu so với mẫu " + q(d.expected) + "." },
  META_MISSING_KEY: { severity: "error", stage: 2, sheetFrom: "_meta", text: (d) => "Sheet _meta thiếu mục " + q(d.key) + ".", hint: () => "Không sửa sheet _meta. Hãy tải lại tệp mẫu." },
  META_DUPLICATE_KEY: { severity: "error", stage: 2, text: (d) => "Sheet _meta có mục " + q(excerpt(d.key)) + " bị lặp." },
  META_UNKNOWN_KEY: { severity: "warning", stage: 2, text: (d) => "Sheet _meta có mục lạ " + q(excerpt(d.key)) + " (bỏ qua)." },
  TEMPLATE_ID_MISMATCH: { severity: "error", stage: 2, text: (d) => "Tệp không phải mẫu chương trình HCMA2 (templateId " + q(excerpt(d.found)) + ").", hint: () => "Hãy dùng tệp mẫu do hệ thống tạo." },
  TEMPLATE_VERSION_INVALID: { severity: "error", stage: 2, text: (d) => "Phiên bản mẫu không hợp lệ (" + q(excerpt(d.found)) + ")." },
  TEMPLATE_VERSION_NEWER: { severity: "error", stage: 2, text: (d) => "Tệp mẫu phiên bản " + d.found + " mới hơn ứng dụng này (hỗ trợ: " + d.supported + ").", hint: () => "Cập nhật ứng dụng hoặc dùng tệp mẫu hiện hành." },
  TEMPLATE_VERSION_UNSUPPORTED: { severity: "error", stage: 2, text: (d) => "Tệp mẫu phiên bản " + d.found + " không còn được hỗ trợ (hỗ trợ: " + d.supported + ").", hint: () => "Hãy tải lại tệp mẫu." },
  HEADER_CHECKSUM_MISMATCH: { severity: "error", stage: 2, text: () => "Tiêu đề cột đã bị sửa so với mẫu (mã kiểm tra tiêu đề không khớp).", hint: () => "Hãy khôi phục tiêu đề cột đúng như tệp mẫu hoặc tải lại tệp mẫu." },
  // ---- stage 3: schema
  HEADER_MISSING: { severity: "error", stage: 3, text: (d) => "Thiếu cột tiêu đề " + q(d.header) + " (cột " + d.columnLetter + ").", hint: () => "Giữ nguyên dòng tiêu đề của tệp mẫu." },
  HEADER_MISMATCH: { severity: "error", stage: 3, text: (d) => "Cột " + d.columnLetter + " phải có tiêu đề " + q(d.header) + " nhưng là " + q(excerpt(d.found)) + ".", hint: () => "Giữ nguyên dòng tiêu đề của tệp mẫu." },
  EXTRA_COLUMN_DATA: { severity: "error", stage: 3, text: (d) => "Ô ở cột " + d.columnLetter + " nằm ngoài các cột của mẫu và có dữ liệu.", hint: () => "Xóa dữ liệu ngoài các cột của mẫu (không tự động bỏ qua)." },
  FRAMEWORK_ROW_COUNT: { severity: "error", stage: 3, text: (d) => "Sheet KHUNG phải có đúng một dòng dữ liệu (dòng 2), hiện có " + d.count + ".", hint: () => "Chỉ điền tên khung ở dòng 2." },
  // ---- stage 4: row normalization / cells
  REQUIRED_MISSING: { severity: "error", stage: 4, text: (d) => "Ô " + q(d.column) + " bắt buộc nhưng đang trống.", hint: () => "Điền giá trị hoặc xóa toàn bộ dòng nếu không dùng." },
  CELL_FORMULA: { severity: "error", stage: 4, text: (d) => "Ô chứa công thức; chỉ nhận giá trị nhập trực tiếp.", hint: () => "Sao chép rồi dán đặc biệt ở dạng giá trị (Paste Values)." },
  CELL_TYPE_BOOLEAN: { severity: "error", stage: 4, text: () => "Ô chứa giá trị logic (TRUE/FALSE); chỉ nhận chữ hoặc số." },
  CELL_TYPE_DATE: { severity: "error", stage: 4, text: () => "Ô chứa ngày/giờ; chỉ nhận chữ hoặc số.", hint: () => "Định dạng ô là Văn bản rồi nhập lại." },
  CELL_TYPE_ERROR: { severity: "error", stage: 4, text: (d) => "Ô chứa giá trị lỗi" + (d.value ? " " + q(d.value) : "") + "." },
  CELL_TYPE_NOT_TEXT: { severity: "error", stage: 4, text: () => "Ô phải là văn bản nhưng đang là số.", hint: () => "Định dạng ô là Văn bản rồi nhập lại." },
  CELL_TOO_LONG: { severity: "error", stage: 4, text: (d) => "Ô dài hơn " + n(d.max) + " ký tự." },
  CHAR_CONTROL: { severity: "error", stage: 4, text: () => "Ô chứa ký tự điều khiển không hợp lệ.", hint: () => "Xóa ký tự lạ rồi nhập lại." },
  CHAR_BIDI: { severity: "error", stage: 4, text: () => "Ô chứa ký tự điều khiển hướng chữ (bidi) không được phép.", hint: () => "Xóa ký tự lạ rồi nhập lại." },
  CHAR_INVISIBLE: { severity: "warning", stage: 4, text: () => "Ô chứa ký tự vô hình (độ rộng bằng 0).", hint: () => "Có thể gây trùng mã khó thấy; nên xóa và nhập lại." },
  CELL_NUMERIC_CODE: { severity: "warning", stage: 4, text: (d) => "Mã " + q(d.value) + " được đọc từ ô số (có thể mất số 0 ở đầu).", hint: () => "Định dạng cột là Văn bản để giữ nguyên mã." },
  CELL_MERGED: { severity: "warning", stage: 4, text: () => "Có ô gộp; chỉ đọc giá trị của ô đầu tiên." },
  ROW_HIDDEN: { severity: "warning", stage: 4, text: () => "Dòng đang bị ẩn nhưng vẫn được nhập." },
  COLUMN_HIDDEN: { severity: "warning", stage: 4, text: (d) => "Cột " + d.columnLetter + " đang bị ẩn nhưng vẫn được nhập." },
  ORDER_NOT_INTEGER: { severity: "error", stage: 4, text: (d) => "Thứ tự " + q(excerpt(d.value)) + " không phải số nguyên.", hint: () => "Nhập số nguyên từ 0 đến 100000 hoặc để trống." },
  ORDER_RANGE: { severity: "error", stage: 4, text: (d) => "Thứ tự " + q(excerpt(d.value)) + " ngoài khoảng 0 đến 100000." },
  ORDER_FROM_TEXT: { severity: "warning", stage: 4, text: (d) => "Thứ tự " + q(excerpt(d.value)) + " được đọc từ ô văn bản thành số." },
  // ---- stage 5: relations / order
  LESSONS_OF_INVALID_SUBJECT: { severity: "warning", stage: 5, text: (d) => d.count + " bài tham chiếu mã môn " + q(excerpt(d.value)) + " của dòng " + d.subjectRow + " (sheet MÔN), dòng đó đang lỗi; các bài này sẽ được kiểm tra lại sau khi sửa dòng " + d.subjectRow + "." },
  LESSON_ORPHAN: { severity: "error", stage: 5, text: (d) => "Mã môn " + q(excerpt(d.value)) + " không có trong sheet MÔN.", hint: () => "Thêm môn vào sheet MÔN hoặc sửa mã môn của bài." },
  SUBJECT_EMPTY: { severity: "warning", stage: 5, text: (d) => "Môn " + q(excerpt(d.value)) + " chưa có bài nào." },
  ORDER_MIXED: { severity: "error", stage: 5, text: (d) => "Ô Thứ tự chỉ điền cho một số dòng của " + d.group + ".", hint: () => "Điền đủ Thứ tự cho tất cả dòng của nhóm hoặc để trống toàn bộ." },
  ORDER_DUPLICATE: { severity: "error", stage: 5, text: (d) => "Thứ tự " + d.value + " trùng với dòng " + d.otherRow + " trong cùng " + d.group + "." },
  NO_SUBJECT: { severity: "error", stage: 5, text: () => "Cần ít nhất một môn trong sheet MÔN.", hint: () => "Điền môn đầu tiên ở dòng 2 của sheet MÔN." },
  // ---- stage 6: P3 domain
  FRAMEWORK_NAME_LENGTH: { severity: "error", stage: 6, text: (d) => "Tên khung cần từ " + d.min + " đến " + d.max + " ký tự (hiện " + d.length + ")." },
  NAME_LENGTH: { severity: "error", stage: 6, text: (d) => "Tên cần từ " + d.min + " đến " + d.max + " ký tự (hiện " + d.length + ")." },
  CODE_LENGTH: { severity: "error", stage: 6, text: (d) => "Mã cần từ " + d.min + " đến " + d.max + " ký tự (hiện " + d.length + ")." },
  DOMAIN_ERROR: { severity: "error", stage: 6, text: (d) => "Dữ liệu không hợp lệ theo quy tắc chương trình: " + excerpt(d.detail) + "." },
  // ---- stage 7: canonical codes
  CODE_DUPLICATE: { severity: "error", stage: 7, text: (d) => "Mã " + q(excerpt(d.value)) + " trùng với dòng " + d.otherRow + " (sheet " + d.otherSheet + "). Khác hoa/thường, dấu cách hoặc dạng Unicode vẫn được coi là trùng." },
  // ---- stage 8: bounds
  NODE_LIMIT: { severity: "error", stage: 8, text: (d) => "Tổng số mục (môn + bài) là " + n(d.count) + ", vượt giới hạn " + n(d.max) + "." },
  ERRORS_TRUNCATED: { severity: "error", stage: 8, text: (d) => "Có quá nhiều lỗi; chỉ ghi nhận " + n(d.max) + " lỗi đầu tiên. Hãy sửa rồi chọn lại tệp." },
  // ---- stage 9: preview readiness
  TREE_INVALID: { severity: "error", stage: 9, text: (d) => "Cây chương trình không hợp lệ: " + excerpt(d.detail) + "." },
  NOT_READY: { severity: "error", stage: 9, text: (d) => "Khung chưa sẵn sàng: " + excerpt(d.detail) + "." },
  // ---- stage 10: pre-write revalidation
  ORGANIZATION_READ_ONLY: { severity: "error", stage: 10, text: () => "Đơn vị không ở trạng thái hoạt động nên không thể nhập." },
  PLAN_BUILD_FAILED: { severity: "error", stage: 10, text: (d) => "Không lập được kế hoạch nhập: " + excerpt(d.detail) + "." }
};
export const DIAGNOSTIC_CODES = freeze(Object.keys(C));
export const diagnosticSpec = (code) => C[code] || null;

export function columnLetter(index) { // 0 -> A
  let text = "", value = index;
  do { text = String.fromCharCode(65 + (value % 26)) + text; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return text;
}

// diag("CODE_DUPLICATE", { sheet, row, column, field, value, refs, otherRow, ... }) -> frozen diagnostic. Unknown codes throw (programming error).
const freezeData = (value) => JSON.parse(JSON.stringify(value), (key, v) => (v && typeof v === "object" ? freeze(v) : v));
export function diag(code, d = {}) {
  const spec = C[code];
  if (!spec) throw new Error("unknown diagnostic code " + code);
  const sheet = d.sheet === undefined ? null : d.sheet;
  const row = d.row === undefined ? null : d.row;
  const where = sheet !== null ? "Sheet " + q(sheet) + (row !== null ? ", dòng " + row : "") + (d.column ? ", cột " + q(d.column) : "") + ": " : "";
  const body = spec.text(d);
  return freeze({
    severity: spec.severity, code, stage: spec.stage, sheet, row, column: d.column === undefined ? null : d.column, field: d.field === undefined ? null : d.field,
    message: where + body, hint: spec.hint ? spec.hint(d) : null,
    refs: freeze((d.refs || []).map((ref) => freeze({ sheet: ref.sheet, row: ref.row }))), value: excerpt(d.value),
    data: d.data === undefined ? null : freezeData(d.data)
  });
}

const sevRank = (s) => (s === "error" ? 0 : 1);
// Deterministic order: stage, severity, sheet, row, code.
export function sortDiagnostics(list) {
  return list.slice().sort((a, b) => (a.stage - b.stage) || (sevRank(a.severity) - sevRank(b.severity)) || String(a.sheet ?? "").localeCompare(String(b.sheet ?? ""), "en") || ((a.row ?? 0) - (b.row ?? 0)) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || String(a.value ?? "").localeCompare(String(b.value ?? ""), "en"));
}
export const errorsOf = (list) => list.filter((item) => item.severity === "error");
export const warningsOf = (list) => list.filter((item) => item.severity === "warning");
// warningsSummary for the import batch: { code: count }, at most 20 keys (Rules bound), alphabetical.
export function warningsSummary(list) {
  const counts = {};
  for (const item of list) if (item.severity === "warning") counts[item.code] = (counts[item.code] || 0) + 1;
  const keys = Object.keys(counts).sort().slice(0, 20);
  const summary = {};
  for (const key of keys) summary[key] = counts[key];
  return summary;
}

// Bounded collector: at most `maxErrors` errors and `maxWarnings` warnings are kept; the first overflow is reported ONCE as ERRORS_TRUNCATED (R1 s17).
export function createCollector({ maxErrors = 1000, maxWarnings = 1000 } = {}) {
  const items = [];
  let errors = 0, warnings = 0, truncated = false;
  return {
    add(item) {
      if (item.severity === "error") { if (errors >= maxErrors) { truncated = true; return false; } errors++; }
      else { if (warnings >= maxWarnings) return false; warnings++; }
      items.push(item);
      return true;
    },
    addAll(list) { for (const item of list) this.add(item); },
    get errorCount() { return errors; },
    get truncated() { return truncated; },
    items() { return truncated ? [...items, diag("ERRORS_TRUNCATED", { max: maxErrors })] : items.slice(); }
  };
}
