// GROUP PDF V1 — synthetic, deterministic Vietnamese fixtures shared by the browser test and the local Owner QA
// page. Pure data; no Firebase, no real class, no real student. Timestamps mimic Firestore Timestamps.
const ts = (iso) => ({ toMillis: () => Date.parse(iso) });
export const OWNER = "ownerQA", ACTIVITY_ID = "Ab12Cd34Ef56Gh78", GROUP = 3;
const run = (text, extra = {}) => ({ text, ...extra });
// The production contract caps a run at 500 code points; long text is therefore split into 400-char runs.
const longRuns = (text) => Array.from({ length: Math.ceil(text.length / 400) }, (_, i) => run(text.slice(i * 400, (i + 1) * 400)));
const para = (runs, extra = {}) => ({ type: "paragraph", runs: Array.isArray(runs) ? runs : [run(runs)], ...extra });
export const commonImagePath = `groupActivityContent/${OWNER}/${ACTIVITY_ID}/common/pic1.jpg`;
export const groupImagePath = `groupActivityContent/${OWNER}/${ACTIVITY_ID}/groups/${GROUP}/pic2.png`;
export const submissionPath = (sub, ext) => `groupActivitySubmissions/${OWNER}/${ACTIVITY_ID}/groups/${GROUP}/uidSENTINEL/${sub}/asset.${ext}`;

export const LONG_VI = "Hội nghị tổng kết công tác đào tạo, bồi dưỡng cán bộ năm học vừa qua tại Học viện Chính trị khu vực II đã diễn ra thành công tốt đẹp với sự tham gia đông đủ của các đơn vị chức năng, các giảng viên và học viên. Các đại biểu đã thảo luận sôi nổi về phương pháp giảng dạy lý luận chính trị gắn với thực tiễn, nhấn mạnh vai trò của việc đồng kiến tạo tri thức giữa người dạy và người học; đồng thời đề xuất nhiều giải pháp nâng cao chất lượng, hiệu quả công tác giáo dục chính trị tư tưởng trong tình hình mới. ";

export function sampleActivity(extra = {}) {
  return {
    id: ACTIVITY_ID, ownerId: OWNER, title: "Đồng kiến tạo tri thức trong giảng dạy lý luận chính trị", className: "K77.B02 TPHCM",
    status: "closed", createdAt: ts("2026-10-01T02:00:00Z"), startedAt: ts("2026-10-01T02:05:00Z"), durationSec: 900,
    collectStudentNames: true, groupCount: 6,
    instructionsRich: {
      version: 2,
      blocks: [
        para([run("NHIỆM VỤ CHUNG — ", { bold: true, size: 24 }), run("Đồng kiến tạo tri thức", { bold: true, italic: true, size: 24, color: "blue" })], { align: "center", spacing: "wide" }),
        para([run("Anh/chị hãy "), run("đọc kỹ", { bold: true }), run(" tình huống sư phạm, "), run("thảo luận", { underline: true }), run(" trong nhóm và "), run("không dùng", { strike: true }), run(" ý kiến cá nhân chưa thống nhất.")]),
        para(longRuns(LONG_VI + LONG_VI.slice(0, 200)), { align: "justify", lineSpacing: "1.5" }),
        para("Mỗi thành viên nêu ít nhất một ý kiến.", { list: "bullet" }),
        para([run("Nhóm trưởng "), run("tổng hợp", { bold: true }), run(" và "), run("thống nhất", { underline: true }), run(" kết luận chung của cả nhóm trước khi gửi.")], { list: "bullet" }),
        para("Ý phụ thụt lề mức 1", { list: "bullet", indent: 1 }),
        para("Ý phụ thụt lề mức 2", { list: "bullet", indent: 2 }),
        para("Xác định vấn đề chính.", { list: "number" }), para("Phân tích nguyên nhân.", { list: "number" }), para("Đề xuất giải pháp.", { list: "number" }),
        para("Đoạn thụt lề mức 3 (không phải danh sách).", { indent: 3 }),
        { type: "paragraph", runs: [] },
        para("Đoạn sau một dòng trống (căn phải).", { align: "right" }),
        { type: "table", rows: [
          { cells: [{ runs: [run("Phương án", { bold: true })] }, { runs: [run("Ưu điểm", { bold: true, color: "green" })] }, { runs: [run("Hạn chế", { bold: true, strike: true })] }] },
          { cells: [{ runs: [run("Đồng kiến tạo tri thức")] }, { runs: [run("Phát huy ", { italic: true }), run("tính chủ động", { underline: true })] }, "Tốn thời gian chuẩn bị"] },
          { cells: [{ runs: [run("ặ ằ ẳ ẵ ố ồ ổ ỗ ộ ứ ừ ử ữ ự")] }, { runs: [] }, { runs: [run("Ô trống ở giữa")] }] }
        ] },
        { type: "image", storagePath: commonImagePath, alt: "Sơ đồ quy trình đồng kiến tạo", mimeType: "image/jpeg", size: 4000 }
      ]
    },
    instructions: "Nhiệm vụ chung (bản văn bản).",
    ...extra
  };
}

export function sampleTopic() {
  return {
    topic: "Nhiệm vụ nhóm 3",
    topicRich: {
      version: 2,
      blocks: [
        para([run("Nhiệm vụ nhóm 3: ", { bold: true }), run("Phân tích nguyên nhân và đề xuất giải pháp.", { font: "times", italic: true, color: "purple" })], { align: "justify" }),
        para("Nêu nguyên nhân khách quan", { list: "number" }), para("Nêu nguyên nhân chủ quan", { list: "number" }),
        { type: "image", storagePath: groupImagePath, alt: "", mimeType: "image/png", size: 3000 }
      ]
    }
  };
}

export function sampleNotes() {
  const base = [
    ["n01", "uA", "Tôi cho rằng cần gắn lý luận với thực tiễn địa phương.\nDòng thứ hai của ý kiến để kiểm tra giữ xuống dòng.", "2026-10-01T02:10:07Z"],
    ["n02", "uB", "Nhóm đề xuất tổ chức thảo luận đồng kiến tạo 😀 và dùng ★ để đánh dấu ý hay → xem thêm. 学习 vẫn là tiếng Việt có dấu: ặ ằ ẳ ẵ ế ề ể ễ ệ.", "2026-10-01T02:11:07Z"],
    ["n03", "uC", "Ý kiến không có tên học viên (học viên này chưa xác nhận họ tên).", "2026-10-01T02:12:07Z"],
    ["n04", "uA", LONG_VI.slice(0, 600), "2026-10-01T02:13:07Z"]
  ];
  return base.map(([id, participantId, text, at]) => ({ id, group: GROUP, text, participantId: `${participantId}`, createdAt: ts(at) }))
    .concat([{ id: "nOther", group: 4, text: "Ý kiến của nhóm khác — không được xuất hiện.", participantId: "uZ", createdAt: ts("2026-10-01T02:00:00Z") }]);
}

export function sampleMembers() {
  return [
    { uid: "uA", displayName: "Nguyễn Thị Ánh Tuyết", group: GROUP },
    { uid: "uB", displayName: "Trần Đức Bảo", group: GROUP },
    { uid: "uZ", displayName: "Học viên nhóm khác", group: 4 }
  ];
}

export function samplePhotos() {
  return [
    { id: "p1", group: GROUP, name: "so-do-nhom-3.jpg", storagePath: submissionPath("p1", "jpg"), contentType: "image/jpeg", size: 90000, participantId: "uA", createdAt: ts("2026-10-01T02:20:00Z") },
    { id: "p2", group: GROUP, name: "anh-hong.webp", storagePath: submissionPath("p2", "webp"), contentType: "image/webp", size: 50000, participantId: "uB", createdAt: ts("2026-10-01T02:21:00Z") },
    { id: "p3", group: GROUP, name: "anh-loi.png", storagePath: submissionPath("p3", "png"), contentType: "image/png", size: 40000, participantId: "uB", createdAt: ts("2026-10-01T02:22:00Z") }
  ];
}

export function sampleFiles() {
  return [
    { id: "f1", group: GROUP, name: "Báo cáo nhóm 3.pdf", storagePath: submissionPath("f1", "pdf"), contentType: "application/pdf", size: 2461000, participantId: "uA", createdAt: ts("2026-10-01T02:30:00Z") },
    { id: "f2", group: GROUP, name: "Liên kết nhóm", link: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing", participantId: "uB", createdAt: ts("2026-10-01T02:31:00Z") },
    { id: "f3", group: GROUP, name: "Liên kết nhóm", link: "javascript:alert(1)", participantId: "uB", createdAt: ts("2026-10-01T02:32:00Z") },
    { id: "f4", group: GROUP, name: "tep-cu.docx", storagePath: "groupActivityContent/ownerQA/old/tep-cu.docx", size: 12000, participantId: "uA", createdAt: ts("2026-10-01T02:33:00Z") }
  ];
}

export function sampleExportInput(extra = {}) {
  return { activity: sampleActivity(), group: GROUP, topic: sampleTopic(), notes: sampleNotes(), photos: samplePhotos(), files: sampleFiles(), members: sampleMembers(), ...extra };
}

// Long case: many notes, long paragraphs/list items, tall table -> several pages.
export function longExportInput() {
  const blocks = [];
  for (let i = 1; i <= 14; i++) blocks.push(para(longRuns(`Đoạn ${i}: ` + LONG_VI + LONG_VI), { align: "justify" }));
  blocks.push(para(longRuns("MỤC-DÀI " + LONG_VI.repeat(4) + " ENDLONGITEM"), { list: "number" }));
  blocks.push({ type: "table", rows: Array.from({ length: 10 }, (_, r) => ({ cells: Array.from({ length: 4 }, (_, c) => ({ runs: [run(`R${r + 1}C${c + 1} `, { bold: true }), run(LONG_VI.slice(c * 20, c * 20 + 70 + r * 12))] })) })) });
  const activity = sampleActivity({ instructionsRich: { version: 2, blocks } });
  const notes = Array.from({ length: 70 }, (_, i) => ({ id: `n${String(i).padStart(3, "0")}`, group: GROUP, text: `Ý kiến số ${i + 1}: ` + (i % 5 === 0 ? LONG_VI : "Tôi cho rằng cần gắn lý luận với thực tiễn.\nDòng hai."), participantId: i % 2 ? "uA" : "uB", createdAt: ts(`2026-10-01T03:${String(i % 60).padStart(2, "0")}:00Z`) }));
  return { activity, group: GROUP, topic: sampleTopic(), notes, photos: samplePhotos().slice(0, 1), files: sampleFiles(), members: sampleMembers() };
}
