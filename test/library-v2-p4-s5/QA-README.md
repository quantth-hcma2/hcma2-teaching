# P4-S5-B — Môi trường QA nhập Excel cho Owner (CHỈ emulator, dữ liệu giả)

## Chạy
```
node test/library-v2-p4-s5/qa-env.mjs            # giữ cửa sổ này mở; Ctrl+C để tắt tất cả
node test/library-v2-p4-s5/qa-env.mjs --self-test  # tự kiểm tra rồi thoát (không cần trình duyệt)
```
Cần: Firebase CLI, Java 21+ (tự dò Eclipse Adoptium), cổng 8080 / 9099 / 8212 trống. Cửa sổ lệnh in: địa chỉ ứng dụng, tài khoản Platform Admin (mật khẩu ngẫu nhiên mỗi lần), thư mục tệp XLSX mẫu.

## Vì sao không thể nối nhầm production
1. Mã dự án Firebase là mã demo `demo-hcma2-production-prep`; launcher từ chối chạy nếu không phải mã `demo-…`.
2. Ứng dụng chỉ chạy ở `127.0.0.1` khi có `?emulator=1` và khi đó chỉ nói chuyện với emulator `127.0.0.1:8080/9099` (không có phương án dự phòng sang production; `app-environment.mjs`). Máy chủ QA tự chuyển mọi trang vào `?emulator=1`.
3. Máy chủ chỉ lắng nghe `127.0.0.1`.
4. Launcher từ chối chạy nếu Rules không phải đúng bản đang chạy trên production (SHA-256 `F6B9DE01…7D4A`), nếu mất cơ chế chặn trong `app-environment.mjs`, hoặc nếu cổng emulator đã bị chiếm. Biến `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_TOKEN` bị gỡ khỏi tiến trình.
5. Tài khoản và dữ liệu chỉ tồn tại trong emulator và biến mất khi tắt.

## Trợ giúp trong lúc QA (chỉ trên máy này)
`/__help` (trang hướng dẫn) · `/__status` (lô nhập + nhật ký nhập) · `/__tamper` (sửa 1 mục của lần nhập đang dở để tạo trạng thái “một phần”) · `/__reset` (khôi phục dữ liệu mẫu) · `/__clear-imports` (xóa lần nhập, khung đã nhập, nhật ký nhập).

## Danh sách kiểm tra (đánh dấu ĐẠT / KHÔNG ĐẠT)
Tệp mẫu: `01` hợp lệ 5 mục · `02` 1.200 mục · `03` 5.000 mục · `04` lỗi trùng mã · `05` tệp khác. Đường dẫn: Đơn vị → “Khoa Quản trị (QA)” → Chương trình → ⬆ NHẬP TỪ EXCEL.
1. **Xem trước** — chọn `01`: “Tệp hợp lệ”, 2 môn · 3 bài · 5 mục, cây Môn → Bài; chưa có dữ liệu nào được ghi (`/__status` trống).
2. **Xác nhận rõ ràng** — nút XÁC NHẬN NHẬP bị khóa cho đến khi tick xác nhận; bấm đúp chỉ tạo MỘT lần nhập.
3. **Tiến độ + hoàn tất** — thanh tiến độ, “Đã nhập xong và kiểm tra đầy đủ”; khung nháp xuất hiện trong danh sách Chương trình.
4. **Nhật ký (hoàn tất)** — dòng “Đã ghi nhật ký hoạt động.”; menu Nhật ký hoạt động có `curriculum.import.completed` đúng 1 lần.
5. **Kích hoạt khung đã nhập** — MỞ → KÍCH HOẠT thành công.
6. **Cảnh báo trùng tệp** — chọn lại `01`: thẻ vàng “Tệp này đã được nhập thành công trước đó” (ngày, số mục); vẫn nhập lại được. Chọn `05`: không cảnh báo (“Đã kiểm tra: chưa có lần nhập hoàn tất…”).
7. **Gián đoạn + tiếp tục** — nhập `02`, tải lại trang giữa chừng; vào lại: thẻ “Có lần nhập chưa hoàn tất”; TIẾP TỤC (chọn đúng `02`) → hoàn tất đủ 1.200 mục; chọn sai tệp bị từ chối. Khi tiếp tục KHÔNG có bước kiểm tra trùng tệp.
8. **Khóa nhập (Import Freeze) + nhãn P3** — trong lúc dở: dòng khung ở danh sách Chương trình có nhãn “Đang nhập dữ liệu”, mọi nút bị khóa kèm giải thích tiếng Việt; lần nhập dừng một phần có nhãn “Nhập chưa hoàn tất”.
9. **Hoàn tác** — HOÀN TÁC NHẬP cần tick xác nhận; kết quả “Đã hoàn tác lần nhập”; khung và mục biến mất; có `curriculum.import.rolledBack` đúng 1 lần và KHÔNG có `partial`.
10. **Trạng thái “một phần”** — nhập `02`, tải lại giữa chừng, mở `/__tamper`, TIẾP TỤC với đúng `02` → dừng “KHÔNG khớp kế hoạch”, dòng nhật ký `curriculum.import.partial` đúng 1 lần; HOÀN TÁC thêm đúng 1 `rolledBack`.
11. **Tiếng Việt** — mọi thông báo, nút, chú giải đều tiếng Việt, không lộ thông báo lỗi kỹ thuật.
12. **Màn hình hẹp** — thu cửa sổ còn ~375 px: không cuộn ngang ở màn Import, thẻ cảnh báo trùng, thẻ nhật ký, dòng khung bị khóa; nút ≥ 44 px.
13. **Chặn đường sai** — đơn vị đã lưu trữ (“Đơn vị cũ (QA)”) không cho nhập; tài khoản giảng viên không có mục Đơn vị.
Ký xác nhận: họ tên / ngày / ảnh chụp lưu ở Vault `evidence/p4-s5/`.
