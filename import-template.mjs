// Library V2 P4-S2 - versioned curriculum XLSX template definition `hcma2.curriculum.xlsx` schemaVersion 1 (pure, inert; no DOM, no network, no SheetJS).
// ONE definition shared by the strict reader/validators (P4-S2) and the later TAI FILE MAU generator (P4-S3): sheet names, headers, _meta keys, limits, the header
// checksum and the array-of-arrays content of every sheet. Authority: LIBRARY_V2_FROZEN_CONTRACTS_v1.1.md s9 (identifiers, sheet set, _meta identity) and
// LIBRARY_V2_P4_DESIGN_R2.md / R1 s4 + s9 (columns, rules, limits). Nothing here is wired into index.html.
import { sha256Hex } from "./import-sha256.mjs";

const freeze = Object.freeze;
const deepFreeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; };

export const TEMPLATE_ID = "hcma2.curriculum.xlsx";
export const TEMPLATE_SCHEMA_VERSION = 1;
export const SUPPORTED_TEMPLATE_VERSIONS = freeze([1]);
export const PARSER_ADAPTER_ID = "parser.xlsx.v1";
export const TEMPLATE_GENERATOR = "hcma2-teaching/import-template@1";

// Frozen sheet set (Contracts v1.1 s9). Names are compared after Unicode NFC, exactly (case-sensitive).
export const SHEET_GUIDE = "HƯỚNG DẪN";
export const SHEET_FRAMEWORK = "KHUNG";
export const SHEET_SUBJECTS = "MÔN";
export const SHEET_LESSONS = "BÀI";
export const SHEET_META = "_meta";
export const TEMPLATE_SHEET_NAMES = freeze([SHEET_GUIDE, SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META]);
// Sheets whose cells are read (the guide is only required to exist).
export const DATA_SHEET_NAMES = freeze([SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS, SHEET_META]);

// Header row 1 of each data sheet (R1 s4.2). `key` is the stable field name used in diagnostics and the normalized model.
export const SHEET_COLUMNS = deepFreeze({
  [SHEET_FRAMEWORK]: [{ key: "frameworkName", header: "Tên khung chương trình", required: true }],
  [SHEET_SUBJECTS]: [
    { key: "subjectCode", header: "Mã môn", required: true },
    { key: "subjectName", header: "Tên môn", required: true },
    { key: "order", header: "Thứ tự", required: false }
  ],
  [SHEET_LESSONS]: [
    { key: "subjectCode", header: "Mã môn", required: true },
    { key: "lessonCode", header: "Mã bài", required: false },
    { key: "lessonName", header: "Tên bài", required: true },
    { key: "order", header: "Thứ tự", required: false }
  ]
});
export const META_KEYS = freeze(["templateId", "schemaVersion", "generator", "headerChecksum"]);

// ---------------------------------------------------------------- strictness policy (Architect-approved, P4-S2 review)
// Deliberately STRICTER than the R2 s9 table: these are ERRORS, not warnings. A literal value is required wherever data is read, and the template is exactly the
// frozen sheet set. Pinned by test/library-v2-p4-s2 (strictness) - relaxing any entry is an Architect decision.
export const TEMPLATE_STRICTNESS = deepFreeze({
  unexpectedWorksheets: "error",      // R2 tolerated up to 3 as a warning
  formulaCells: "error",              // R2: warning with the cached value; the cached value is never trusted or used
  malformedStylesPart: "error",       // xl/styles.xml is optional, but when present it must be well-formed SpreadsheetML
  booleanDateErrorCells: "error",
  numericTextFields: "error",         // numbers are accepted only in code columns (warning) and in Thứ tự
  unicode: "preserve-after-trim",     // stored/display text is never normalized; canonical equivalence is for comparisons only (P3)
  unsupportedBrowser: "fail-closed"   // BROWSER_UNSUPPORTED, no unsafe fallback
});

// ---------------------------------------------------------------- limits (R1 s17 / R2 s9; business limits come from curriculum-model.mjs)
export const IMPORT_LIMITS = deepFreeze({
  maxFileBytes: 5 * 1024 * 1024,                 // frozen: source file <= 5 MiB
  parseTimeoutMs: 20000,                          // R2 D15: hard Worker timeout
  zip: {
    maxEntries: 100,
    maxEntryBytes: 20 * 1024 * 1024,              // per-entry uncompressed
    maxTotalBytes: 50 * 1024 * 1024,              // total uncompressed
    maxRatio: 100,                                // total uncompressed : file size, and per entry above ratioMinEntryBytes
    ratioMinEntryBytes: 1024 * 1024,
    maxSharedStrings: 50000,
    maxNameBytes: 255,
    maxContentTypesBytes: 262144,
    maxStylesBytes: 4 * 1024 * 1024
  },
  sheet: {
    maxRows: 5105,                                // 5000 nodes + header + slack (R1 s17)
    maxCols: 12,
    maxCellsPerSheet: 5105 * 12,
    maxTotalCells: 200000,
    maxCellChars: 1000                            // extraction cap per cell: every importable field is <= 200 characters
  },
  diagnostics: { maxCollected: 1000, maxDisplayed: 100 },
  metaRows: 50
});

// ---------------------------------------------------------------- header checksum (R1 s4.2: SHA-256 of the exact header strings of KHUNG, MÔN, BÀI)
const US = String.fromCharCode(0x1f), RS = String.fromCharCode(0x1e);
export const expectedHeaders = (sheet) => (SHEET_COLUMNS[sheet] || []).map((column) => column.header);
// Fixed separator contract: headers of one sheet joined by U+001F, the three sheets (KHUNG, MÔN, BÀI) joined by U+001E, NFC, UTF-8, lower-case hex.
export function headerChecksumOf(headersBySheet) {
  const parts = [SHEET_FRAMEWORK, SHEET_SUBJECTS, SHEET_LESSONS].map((sheet) => (headersBySheet[sheet] || []).map((h) => String(h).normalize("NFC")).join(US));
  return sha256Hex(parts.join(RS));
}
export const TEMPLATE_HEADER_CHECKSUM = headerChecksumOf({
  [SHEET_FRAMEWORK]: expectedHeaders(SHEET_FRAMEWORK), [SHEET_SUBJECTS]: expectedHeaders(SHEET_SUBJECTS), [SHEET_LESSONS]: expectedHeaders(SHEET_LESSONS)
});

// ---------------------------------------------------------------- sheet content for the generator (array of arrays; the data sheets hold ONLY the header row)
const GUIDE_LINES = freeze([
  ["HƯỚNG DẪN NHẬP KHUNG CHƯƠNG TRÌNH TỪ EXCEL"],
  ["Mẫu: " + TEMPLATE_ID + " - phiên bản " + TEMPLATE_SCHEMA_VERSION],
  [""],
  ["Mục đích: tạo một khung chương trình NHÁP mới gồm Môn học và Bài học. Việc nhập không thay đổi khung đã có."],
  [""],
  ["CÁCH ĐIỀN"],
  ["1. Sheet KHUNG: điền đúng một ô ở dòng 2 - tên khung chương trình (3 đến 120 ký tự)."],
  ["2. Sheet MÔN: mỗi dòng một môn. Cột Mã môn (bắt buộc, tối đa 40 ký tự), Tên môn (bắt buộc, tối đa 200 ký tự), Thứ tự (không bắt buộc)."],
  ["3. Sheet BÀI: mỗi dòng một bài. Cột Mã môn phải trùng với một Mã môn ở sheet MÔN. Mã bài không bắt buộc. Tên bài bắt buộc. Thứ tự không bắt buộc."],
  ["4. Không sửa, xóa hoặc thêm cột tiêu đề ở dòng 1. Không thêm sheet khác. Không xóa sheet _meta (sheet ẩn)."],
  [""],
  ["QUY TẮC"],
  ["- Mã (môn và bài) không được trùng nhau trong cùng một khung. Hai mã chỉ khác chữ hoa/chữ thường hoặc dấu cách thừa vẫn được coi là trùng."],
  ["- Hãy định dạng cột Mã môn và Mã bài là Văn bản để giữ số 0 ở đầu (ví dụ 007)."],
  ["- Thứ tự: số nguyên từ 0 đến 100000. Hoặc điền Thứ tự cho TẤT CẢ các dòng của cùng nhóm (môn với nhau; bài của cùng một môn với nhau) và không trùng, hoặc để trống TOÀN BỘ - khi đó thứ tự theo vị trí dòng."],
  ["- Không dùng công thức, macro, liên kết ngoài, ngày, ô logic hoặc ô lỗi. Chỉ nhập chữ hoặc số."],
  ["- Tối đa 5000 mục (môn và bài cộng lại) và tệp tối đa 5 MiB."],
  ["- Không để dòng trống nằm giữa dữ liệu quan trọng; dòng hoàn toàn trống sẽ được bỏ qua."],
  [""],
  ["VÍ DỤ (chỉ minh họa, không nằm trong các sheet dữ liệu)"],
  ["KHUNG: Chương trình Toán lớp 6"],
  ["MÔN: T01 | Số học | 1"],
  ["BÀI: T01 | T01-B01 | Tập hợp các số tự nhiên | 1"]
].map((row) => freeze(row)));

// OPTIONAL worked example (P4-S3 Template Center: "TẢI FILE MẪU CÓ VÍ DỤ"). It lives ONLY in the second download; the blank template keeps the data sheets
// header-only exactly as frozen (R1 s4.2). The example is valid template data (it passes every validation stage) and says so in its framework name.
export const TEMPLATE_EXAMPLE = deepFreeze({
  framework: "Khung ví dụ: Nghiệp vụ văn phòng (hãy xóa ví dụ trước khi nhập thật)",
  subjects: [["VP01", "Soạn thảo văn bản hành chính", 1], ["VP02", "Quản lý hồ sơ và lưu trữ", 2], ["VP03", "Giao tiếp công sở", 3]],
  lessons: [
    ["VP01", "VP01-B01", "Thể thức và kỹ thuật trình bày văn bản", 1], ["VP01", "VP01-B02", "Soạn thảo công văn, thông báo", 2], ["VP01", "VP01-B03", "Soạn thảo báo cáo và kế hoạch", 3],
    ["VP02", "VP02-B01", "Lập hồ sơ công việc", 1], ["VP02", "VP02-B02", "Bảo quản và tra cứu tài liệu", 2],
    ["VP03", "VP03-B01", "Giao tiếp qua điện thoại và thư điện tử", 1], ["VP03", null, "Ứng xử với khách đến làm việc (bài này không có mã)", 2]
  ]
});
export const TEMPLATE_FILE_NAMES = freeze({ blank: "HCMA2_mau_khung_chuong_trinh_v1.xlsx", example: "HCMA2_mau_khung_chuong_trinh_v1_co_vi_du.xlsx" });
const EXAMPLE_NOTE = freeze(["LƯU Ý: tệp này có DỮ LIỆU VÍ DỤ trong các sheet KHUNG, MÔN, BÀI. Hãy xóa hoặc thay bằng dữ liệu của bạn trước khi nhập. Dòng tiêu đề (dòng 1) giữ nguyên."]);

// withExample=false (default): the frozen blank template. withExample=true: the same workbook plus the worked example rows and a note at the top of the guide.
export function buildTemplateSheets({ generator = TEMPLATE_GENERATOR, withExample = false } = {}) {
  const meta = [["templateId", TEMPLATE_ID], ["schemaVersion", TEMPLATE_SCHEMA_VERSION], ["generator", generator], ["headerChecksum", TEMPLATE_HEADER_CHECKSUM]];
  const guide = GUIDE_LINES.map((row) => row.slice());
  if (withExample) guide.splice(2, 0, EXAMPLE_NOTE.slice());
  const example = (rows) => (withExample ? rows.map((row) => row.slice()) : []);
  return deepFreeze({
    [SHEET_GUIDE]: guide,
    [SHEET_FRAMEWORK]: [expectedHeaders(SHEET_FRAMEWORK), ...example([[TEMPLATE_EXAMPLE.framework]])],
    [SHEET_SUBJECTS]: [expectedHeaders(SHEET_SUBJECTS), ...example(TEMPLATE_EXAMPLE.subjects)],
    [SHEET_LESSONS]: [expectedHeaders(SHEET_LESSONS), ...example(TEMPLATE_EXAMPLE.lessons)],
    [SHEET_META]: meta
  });
}
