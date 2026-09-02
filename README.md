# HCMA2 - TEACHING

Nền tảng hỗ trợ giảng dạy và tương tác với học viên theo thời gian thực — bỏ phiếu, khảo sát, tình huống, kiểm tra nhanh. Học viên chỉ cần quét mã QR để tham gia, **không cần đăng nhập**. Chạy hoàn toàn trên **GitHub Pages + Firebase** (Authentication + Cloud Firestore), không cần server riêng, không cần Node.js để vận hành.

Tài liệu này hướng dẫn từng bước cho người **không rành kỹ thuật**. Cứ làm theo đúng thứ tự là được.

---

## Mục lục

1. [Tạo Firebase Project](#1-tạo-firebase-project)
2. [Bật Authentication (Email/Password + Anonymous)](#2-bật-authentication)
3. [Tạo Cloud Firestore](#3-tạo-cloud-firestore)
4. [Cài đặt Firestore Rules](#4-cài-đặt-firestore-rules)
5. [Lấy cấu hình Firebase Web App](#5-lấy-cấu-hình-firebase-web-app)
6. [Tạo GitHub Repository & bật GitHub Pages](#6-tạo-github-repository--bật-github-pages)
7. [Thêm domain vào Authorized Domains](#7-thêm-domain-vào-authorized-domains)
8. [Tạo tài khoản Admin đầu tiên](#8-tạo-tài-khoản-admin-đầu-tiên)
9. [Tạo & duyệt tài khoản Giảng viên](#9-tạo--duyệt-tài-khoản-giảng-viên)
10. [Hướng dẫn sử dụng: Tạo lớp](#10-tạo-lớp)
11. [Hướng dẫn sử dụng: Tạo phiên tương tác (Wizard 9 bước)](#11-tạo-phiên-tương-tác)
12. [Hướng dẫn sử dụng: Mở phiên & mã QR](#12-mở-phiên--mã-qr)
13. [Hướng dẫn sử dụng: Học viên tham gia](#13-học-viên-tham-gia)
14. [Hướng dẫn sử dụng: Trình chiếu (Presentation Mode)](#14-trình-chiếu)
15. [Hướng dẫn sử dụng: Xem kết quả / Báo cáo / Xuất dữ liệu](#15-xem-kết-quả--báo-cáo--xuất-dữ-liệu)
16. [Xử lý lỗi thường gặp](#16-xử-lý-lỗi-thường-gặp)
17. [Cấu trúc dữ liệu Firestore](#17-cấu-trúc-dữ-liệu-firestore)
18. [Giới hạn của phiên bản V1 & định hướng mở rộng](#18-giới-hạn-của-phiên-bản-v1--định-hướng-mở-rộng)
19. [Firestore Indexes](#19-firestore-indexes)
20. [Cấu trúc file / Bảo trì](#20-cấu-trúc-file--bảo-trì)

---

## 1. Tạo Firebase Project

Dự án này **đã được cấu hình sẵn** để dùng chung Firebase Project có sẵn:

- Project ID: `bo-phieu-hcma2`

Nếu bạn dùng đúng project này, có thể bỏ qua bước tạo project mới — chuyển sang [Mục 2](#2-bật-authentication).

Nếu bạn muốn tạo **project Firebase riêng của mình** (khuyến nghị nếu bạn là quản trị viên hệ thống độc lập):

1. Truy cập https://console.firebase.google.com
2. Bấm **"Add project" / "Thêm dự án"**.
3. Đặt tên dự án (ví dụ: `hcma2-teaching`), bấm **Continue**.
4. Có thể bật hoặc tắt Google Analytics tùy ý (ứng dụng vẫn chạy tốt nếu tắt).
5. Bấm **Create project** và đợi vài giây.
6. Sau khi tạo xong, mở project đó và làm tiếp các bước 2–5 bên dưới, sau đó thay `firebaseConfig` trong file `index.html` bằng cấu hình project mới của bạn (xem [Mục 5](#5-lấy-cấu-hình-firebase-web-app)).

---

## 2. Bật Authentication

Trong Firebase Console, chọn project → menu bên trái **Build → Authentication**.

1. Bấm **Get started** (nếu là lần đầu).
2. Vào tab **Sign-in method**.
3. Bật **Email/Password**:
   - Bấm vào dòng "Email/Password" → gạt **Enable** → **Save**.
   - Đây là phương thức đăng nhập dành cho **Giảng viên** và **Admin**.
4. Bật **Anonymous**:
   - Bấm vào dòng "Anonymous" → gạt **Enable** → **Save**.
   - Đây là phương thức đăng nhập **ẩn** dành cho **Học viên** (học viên không nhìn thấy màn hình đăng nhập nào cả — hệ thống tự đăng nhập ẩn danh phía sau).

> Nếu quên bật "Anonymous", học viên sẽ gặp lỗi khi cố gắng tham gia phiên. Ứng dụng sẽ hiển thị thông báo lỗi tiếng Việt dễ hiểu, không hiển thị mã lỗi kỹ thuật thô.

---

## 3. Tạo Cloud Firestore

1. Menu bên trái **Build → Firestore Database**.
2. Bấm **Create database**.
3. Chọn **Start in production mode** (khuyến nghị — vì chúng ta sẽ cài đặt Rules chặt chẽ ở Mục 4).
4. Chọn vị trí máy chủ (location) gần người dùng nhất (ví dụ `asia-southeast1`), bấm **Enable**.

---

## 4. Cài đặt Firestore Rules

Đây là bước **BẮT BUỘC** — nếu bỏ qua, dữ liệu của giảng viên/học viên sẽ không được bảo vệ đúng cách (hoặc ngược lại, ứng dụng sẽ báo lỗi "không có quyền" cho mọi thao tác).

1. Trong Firestore Database, vào tab **Rules**.
2. Mở file `firestore.rules` đi kèm trong bộ tài liệu này.
3. Copy **toàn bộ nội dung** file đó, dán đè vào ô Rules trên Firebase Console.
4. Bấm **Publish**.

Rules này đảm bảo:

- Giảng viên chỉ đọc/sửa được lớp, phiên, câu hỏi, kết quả **của chính mình**, và **chỉ khi tài khoản đang ở trạng thái `active`** — một giảng viên bị Admin khóa (`status = suspended`) bị Rules từ chối **ngay lập tức** ở mọi collection (lớp, phiên, câu hỏi, phương án, thư viện, câu trả lời, mã tham gia), không chỉ bị ẩn trên giao diện.
- Giảng viên **không thể** tự đổi `role`/`status` của mình để tự phong Admin hay tự mở khóa chính mình.
- Học viên (đăng nhập ẩn danh) chỉ đọc được phiên đã **mở**, câu hỏi **đang active**, và **không bao giờ** đọc được câu trả lời của người khác (chỉ đọc được đúng câu trả lời của chính mình, và không bao giờ liệt kê được `responses`).
- Học viên **chỉ gửi được câu trả lời cho đúng câu hỏi đang active** của phiên đang mở — Rules từ chối thẳng nếu gửi cho câu hỏi cũ (giảng viên đã chuyển câu), phiên đã đóng, hoặc **đã hết thời gian trả lời** (nếu câu hỏi có đặt giới hạn thời gian, Rules so sánh với đồng hồ máy chủ, không tin đồng hồ máy học viên).
- Dữ liệu câu trả lời gửi lên bị **giới hạn đúng 6 trường cho phép** (`sessionId, questionId, participantId, answer, selectedOptions, submittedAt`) — học viên không thể chèn thêm trường lạ, và `submittedAt` bắt buộc là dấu thời gian thật của máy chủ (không thể giả mạo từ trình duyệt).
- Mỗi học viên chỉ gửi được **một** câu trả lời cho mỗi câu hỏi (trừ khi giảng viên bật "cho phép đổi câu trả lời").
- **Gửi/sửa/tự đọc câu trả lời chỉ được phép khi đang đăng nhập ẩn danh (Anonymous Auth)** — đúng quy định "học viên V1 luôn dùng Anonymous Auth, không có tài khoản". Một tài khoản email/mật khẩu bình thường (kể cả chính giảng viên/admin đăng nhập bằng email của họ) **không thể** tự đóng vai học viên để ghi `responses` thông qua Firestore client, kể cả khi biết rõ cấu trúc dữ liệu.
- Việc **tạo mới một phiên tương tác** (Wizard 9 bước) ghi `sessions` + `joinCodes` + `sessionTokens` + toàn bộ `questions` + `questions/*/options` trong **một thao tác ghi hàng loạt (atomic `writeBatch`) duy nhất** — Rules dùng đúng cơ chế `getAfter()` của Firestore ở 2 điểm cần thiết (xác nhận câu hỏi thuộc đúng phiên vừa tạo, xác nhận phương án thuộc đúng câu hỏi vừa tạo — cả hai đều là tài liệu "anh em" được tạo cùng lúc trong cùng batch) để việc tạo phiên **luôn thành công đúng như thiết kế**, đồng thời vẫn giữ nguyên toàn bộ ranh giới sở hữu (Giảng viên B không thể chèn câu hỏi vào phiên của Giảng viên A) và việc chặn giảng viên bị khóa. Xem chi tiết kỹ thuật ở [Mục 18](#18-giới-hạn-của-phiên-bản-v1--định-hướng-mở-rộng).
- Admin quản lý được toàn bộ tài khoản giảng viên, nhưng việc **cấp quyền Admin đầu tiên vẫn phải làm thủ công** trong Firebase Console (xem Mục 8) — không ai có thể tự phong Admin từ giao diện web.

Nếu sau này bạn thấy Firestore báo lỗi "The query requires an index" ở đâu đó (ví dụ mục Thống kê hệ thống của Admin), xem [Mục 19](#19-firestore-indexes).

---

## 5. Lấy cấu hình Firebase Web App

Ứng dụng đã có sẵn cấu hình trong `index.html` (dự án `bo-phieu-hcma2`). Bạn **chỉ cần làm bước này nếu tạo project Firebase riêng**:

1. Trong Firebase Console → bấm biểu tượng **⚙️ Project settings**.
2. Kéo xuống mục **Your apps** → bấm biểu tượng **</>** (Web) để tạo Web App mới (nếu chưa có).
3. Đặt tên app (ví dụ "HCMA2 Teaching Web"), **không cần** tick Firebase Hosting.
4. Firebase sẽ hiển thị đoạn `firebaseConfig` — copy toàn bộ object đó.
5. Mở file `index.html`, tìm đoạn:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..."
};
```

6. Thay toàn bộ object này bằng cấu hình project của bạn, lưu file lại.

> Đây là **cấu hình Web App công khai** (không phải mật khẩu, không phải khóa bí mật) — việc để lộ trong mã nguồn frontend là **bình thường và an toàn** đối với Firebase, vì mọi quyền truy cập dữ liệu thực sự được kiểm soát bởi **Firestore Security Rules** (Mục 4), không phải bởi việc giấu `firebaseConfig`.

---

## 6. Tạo GitHub Repository & bật GitHub Pages

1. Đăng nhập https://github.com, bấm **New repository**.
2. Đặt tên repository (ví dụ `hcma2-teaching`), chọn **Public**, bấm **Create repository**.
3. Upload 3 file trong bộ tài liệu này lên repository (kéo-thả trực tiếp trên GitHub cũng được):
   - `index.html`
   - `firestore.rules` *(chỉ để lưu trữ/tham khảo — không ảnh hưởng đến việc chạy web, vì rules được publish riêng ở Mục 4)*
   - `firestore.indexes.json` *(tương tự, chỉ để tham khảo)*
   - `README.md` (file này)
4. Vào tab **Settings** của repository → menu bên trái **Pages**.
5. Ở mục **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: chọn **main** (hoặc `master`), thư mục **/ (root)** → bấm **Save**.
6. Đợi khoảng 1–2 phút, GitHub sẽ cấp cho bạn một địa chỉ dạng:

   ```
   https://USERNAME.github.io/REPOSITORY/
   ```

7. Mở địa chỉ đó — bạn sẽ thấy màn hình đăng nhập của **HCMA2 - TEACHING**.

> Ứng dụng **tự động xác định** địa chỉ gốc của chính nó (`window.location.origin + window.location.pathname`) để tạo link QR cho học viên, nên **hoạt động đúng** dù repository nằm ở thư mục con (`/REPOSITORY/`) — bạn không cần chỉnh sửa gì thêm.

---

## 7. Thêm domain vào Authorized Domains

Vì Firebase Authentication chỉ cho phép các domain đã được "duyệt" thực hiện đăng nhập:

1. Firebase Console → **Authentication → Settings → Authorized domains**.
2. Bấm **Add domain**.
3. Nhập domain GitHub Pages của bạn, ví dụ: `USERNAME.github.io` (chỉ phần domain, không kèm `https://` hay đường dẫn `/REPOSITORY/`).
4. Bấm **Add**.

Nếu bỏ qua bước này, khi truy cập trang qua GitHub Pages, việc đăng nhập/đăng ký sẽ báo lỗi.

---

## 8. Tạo tài khoản Admin đầu tiên

Hệ thống **không** tự động biến người đăng ký đầu tiên thành Admin (đây là chủ ý, để đảm bảo an toàn — không ai có thể tự phong Admin từ giao diện web). Bạn cần làm thủ công **một lần duy nhất**:

1. Mở trang web (GitHub Pages URL của bạn).
2. Vào tab **Đăng ký giảng viên**, đăng ký một tài khoản bình thường (email + mật khẩu) — tài khoản này sẽ ở trạng thái **"role: teacher, status: pending"**.
3. Vào Firebase Console → **Firestore Database → Data**.
4. Mở collection **`users`**, tìm document có `uid` tương ứng với tài khoản bạn vừa đăng ký (có thể nhận diện qua trường `email`).
5. Sửa 2 trường của document đó:
   - `role`: đổi từ `"teacher"` thành `"admin"`
   - `status`: đổi từ `"pending"` thành `"active"`
6. Bấm **Update**.
7. Quay lại trang web, **đăng xuất rồi đăng nhập lại** — bạn sẽ vào thẳng **ADMIN DASHBOARD**.

Từ giờ, tài khoản Admin này có thể duyệt/khóa các tài khoản giảng viên khác **ngay trên giao diện web**, không cần vào Firebase Console nữa. Muốn thêm Admin thứ hai, lặp lại đúng quy trình trên cho tài khoản đó.

---

## 9. Tạo & duyệt tài khoản Giảng viên

- Giảng viên tự đăng ký tại tab **Đăng ký giảng viên** trên trang đăng nhập.
- Sau khi đăng ký, tài khoản ở trạng thái **🟡 Chờ cấp phép** — chưa vào được Teacher Dashboard, chỉ thấy thông báo "Tài khoản của bạn đang chờ quản trị viên cấp phép."
- Admin vào **Admin Dashboard → Quản lý giảng viên**, tìm tài khoản đó, bấm **[DUYỆT]**.
- Ngay khi được duyệt (`status = active`), giảng viên đăng nhập lại là dùng được toàn bộ Teacher Dashboard.
- Admin có thể **[KHÓA]** một tài khoản đang hoạt động bất kỳ lúc nào; tài khoản bị khóa sẽ thấy thông báo "Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên." và không thể sử dụng hệ thống cho đến khi được **[MỞ KHÓA]**. Việc khóa có hiệu lực **ngay tại tầng Firestore Rules** (không chỉ ẩn trên giao diện) — nếu giảng viên đang mở Dashboard đúng lúc bị khóa, hệ thống phát hiện gần như tức thời và tự chuyển sang màn hình khóa (xem Mục 18, mục 6).
- Admin có thể bấm **[GỬI LINK ĐẶT LẠI MẬT KHẨU]** để gửi email đặt lại mật khẩu cho giảng viên (dùng tính năng Password Reset Email có sẵn của Firebase Authentication — Admin **không** thể và không cần biết/đặt mật khẩu thay giảng viên).

---

## 10. Tạo lớp

Trong Teacher Dashboard → menu **Lớp học** → **+ Tạo lớp mới**. Nhập tên lớp (ví dụ `K76.A01`), mã lớp, khóa học, sĩ số (không bắt buộc). Mỗi lớp thuộc về đúng một giảng viên (`ownerId`), giảng viên khác không thấy được.

---

## 11. Tạo phiên tương tác

Trong Teacher Dashboard → **+ TẠO TƯƠNG TÁC MỚI** (hoặc menu **Tạo tương tác**), làm theo Wizard 9 bước:

1. **Tên hoạt động** — ví dụ "Khảo sát đầu giờ".
2. **Chọn lớp** — lớp đã tạo ở Mục 10.
3. **Nhập câu hỏi** — nội dung câu hỏi.
4. **Chọn loại câu hỏi** — 1 trong 7 loại: Một lựa chọn, Nhiều lựa chọn, Đúng/Sai, Likert, Thang điểm, Xếp hạng, Câu hỏi mở.
5. **Nhập phương án** — tùy loại câu hỏi. Riêng **Đúng/Sai**: hệ thống **tự động cố định 2 phương án "Đúng" / "Sai"** — giáo viên không cần (và không thể) gõ tay, nhưng 2 phương án này **vẫn được ghi đầy đủ vào Firestore** (`questions/{id}/options`) giống hệt các loại câu hỏi có phương án khác, để biểu đồ/báo cáo/Student View hoạt động đúng. **Câu hỏi mở** không cần nhập phương án (học viên gõ tự do).
6. **Chọn biểu đồ** — hệ thống gợi ý biểu đồ phù hợp nhất, bạn có thể đổi trong danh sách được phép cho loại câu hỏi đó.
   - Ở bước này có thể bấm **"+ Thêm câu hỏi khác"** để tạo phiên có **nhiều câu hỏi** (lặp lại bước 3–6 cho mỗi câu).
7. **Thiết lập** — thời gian trả lời, hiển thị kết quả (Ẩn/Trực tiếp), cho phép đổi câu trả lời, hiển thị số người trả lời. (Học viên **luôn** trả lời ẩn danh — đây là thiết kế cố định của hệ thống vì học viên không có tài khoản, nên không có tùy chọn bật/tắt cho mục này.)
8. **Xem trước** — kiểm tra lại toàn bộ nội dung.
9. **Bắt đầu** — bấm **"BẮT ĐẦU — Tạo phiên"**, hệ thống ghi dữ liệu vào Firestore và chuyển sang màn hình **Điều khiển trực tiếp**.

---

## 12. Mở phiên & mã QR

Ở màn hình **Điều khiển trực tiếp** của phiên vừa tạo:

- Bấm **[MỞ PHIÊN]** để chuyển trạng thái từ "Sẵn sàng" sang "Đang mở" — kể từ lúc này học viên mới quét QR/tham gia được.
- Bấm **[HIỂN THỊ QR]** để xem mã QR lớn, có thể **phóng to, tải PNG, copy liên kết**, kèm **mã tham gia dự phòng** dạng `ABC-729` (dùng khi học viên không quét được QR, chỉ cần gõ mã này). Liên kết QR **không chứa ID phiên trực tiếp** — chỉ chứa một mã truy cập ngẫu nhiên (`accessToken`, 28 ký tự) — trình duyệt học viên phải tra cứu đúng mã đó trên Firestore mới suy ra được phiên thật (xem Mục 18, mục "Cơ chế bảo vệ liên kết QR").
- Dùng **[CÂU TRƯỚC] / [CÂU TIẾP]** hoặc bấm trực tiếp vào "Câu 1, Câu 2…" để điều khiển câu hỏi đang hiển thị cho học viên — học viên **chỉ thấy đúng câu đang active**, không thấy trước các câu sau.
- Bấm **[HIỂN THỊ KẾT QUẢ]/[ẨN KẾT QUẢ]** để chuyển chế độ Live/Hidden bất kỳ lúc nào trong khi phiên đang mở.
- Bấm **[ĐÓNG BÌNH CHỌN]** khi muốn ngừng nhận câu trả lời mới; có thể **[MỞ LẠI PHIÊN]** nếu cần nhận thêm; bấm **[KẾT THÚC PHIÊN]** để lưu trữ (archive) khi đã xong hẳn.

---

## 13. Học viên tham gia

Học viên **không cần tài khoản**:

1. Quét mã QR bằng camera điện thoại (hoặc mở liên kết được gửi, hoặc mở trang web và gõ **mã tham gia** dạng `ABC-729`).
2. Hệ thống tự động đăng nhập ẩn danh phía sau (học viên không nhìn thấy màn hình đăng nhập nào).
3. Xem câu hỏi đang active, chọn/nhập câu trả lời, bấm **[GỬI CÂU TRẢ LỜI]**.
4. Màn hình chỉ hiện **"✓ ĐÃ GHI NHẬN"** sau khi Firebase xác nhận ghi dữ liệu thành công (không hiện sớm hơn, kể cả khi mạng chậm).
5. Nếu phiên đã đóng: hiện **"PHIÊN ĐÃ KẾT THÚC"**. Nếu hết thời gian: hiện **"ĐÃ HẾT THỜI GIAN"**. Nếu trả lời trùng (và giảng viên không cho đổi câu trả lời): hiện **"Bạn đã trả lời câu hỏi này."**

---

## 14. Trình chiếu

Từ màn hình Điều khiển trực tiếp, bấm **[HIỂN THỊ TRÌNH CHIẾU]** để mở một tab mới tối ưu cho máy chiếu/màn hình lớn (tỷ lệ 16:9), hiển thị: tên lớp, tên hoạt động, câu hỏi, mã QR, số người trả lời, biểu đồ (nếu chế độ hiển thị đang là "Trực tiếp"). Có nút **⛶ Toàn màn hình**.

> **Lưu ý vận hành:** để màn hình Trình chiếu hiển thị được biểu đồ/số liệu, hãy **mở song song** cùng lúc với màn hình Điều khiển trực tiếp (ví dụ: máy tính điều khiển mở cả 2 tab, một tab chiếu ra máy chiếu). Xem thêm [Mục 18](#18-giới-hạn-của-phiên-bản-v1--định-hướng-mở-rộng) để hiểu vì sao.

---

## 15. Xem kết quả / Báo cáo / Xuất dữ liệu

- Menu **Lịch sử phiên**: xem lại toàn bộ phiên đã tạo, lọc theo trạng thái, bấm **[MỞ LẠI KẾT QUẢ]** để xem báo cáo.
- Menu **Báo cáo**: chọn phiên → xem báo cáo đầy đủ (giảng viên, lớp, ngày, hoạt động, tỷ lệ tham gia, biểu đồ từng câu).
- Trong màn hình Báo cáo có các nút: **[IN / LƯU PDF]** (dùng chức năng in của trình duyệt, chọn "Save as PDF"), **[XUẤT CSV]**, **[XUẤT JSON]** — tải toàn bộ dữ liệu câu trả lời (không gồm email/thông tin cá nhân, vì học viên trả lời ẩn danh).

---

## 16. Xử lý lỗi thường gặp

Ứng dụng luôn cố gắng hiển thị thông báo **tiếng Việt dễ hiểu** thay vì mã lỗi kỹ thuật, kèm nút **[THỬ LẠI]** khi phù hợp:

| Tình huống | Thông báo hiển thị |
|---|---|
| Mất mạng | "Mất kết nối mạng. Đang thử kết nối lại…" |
| Sai email/mật khẩu | "Email hoặc mật khẩu không đúng." |
| Tài khoản chờ duyệt | "Tài khoản của bạn đang chờ quản trị viên cấp phép." |
| Tài khoản bị khóa | "Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên." |
| Học viên mở QR khi phiên chưa mở | "Phiên chưa mở hoặc không tồn tại. Vui lòng thử lại sau." |
| Liên kết QR/token sai hoặc bị chỉnh sửa | "Liên kết tham gia không hợp lệ hoặc đã hết hạn. Vui lòng dùng mã tham gia." |
| Tài khoản giảng viên bị Admin khóa trong khi đang mở Dashboard | Hệ thống tự phát hiện gần như tức thời (theo dõi realtime), khóa ngay các thao tác và hiển thị lại "Tài khoản của bạn đã bị tạm khóa." |
| Học viên mở QR cũ sau khi phiên đã đóng | "PHIÊN ĐÃ KẾT THÚC" |
| Hết giờ trả lời | "ĐÃ HẾT THỜI GIAN" |
| Trả lời trùng | "Bạn đã trả lời câu hỏi này." |
| Không có quyền (Rules chặn) | "Bạn không có quyền thực hiện thao tác này." |
| Nếu quên bật Anonymous Authentication | Học viên sẽ thấy lỗi khi vào phiên — vào lại **Mục 2** để bật. |

**Hai giảng viên tạo phiên cùng lúc / hai học viên gửi cùng lúc:** mỗi thao tác ghi dữ liệu (tạo lớp, tạo phiên, gửi câu trả lời...) đều dùng ID độc lập do Firestore cấp hoặc theo công thức `questionId_participantId`, nên không xảy ra xung đột ghi đè giữa những người dùng khác nhau.

---

## 17. Cấu trúc dữ liệu Firestore

```
users/{uid}                          — hồ sơ Admin/Giảng viên
classes/{classId}                    — lớp học (ownerId = uid giảng viên)
sessions/{sessionId}                 — phiên tương tác
  sessions/{sessionId}/responses/{questionId_participantId}
questions/{questionId}               — câu hỏi (sessionId, ownerId, order, type…)
  questions/{questionId}/options/{optionId}
library/{itemId}                     — thư viện câu hỏi cá nhân của giảng viên
joinCodes/{shortCode}                — ánh xạ mã tham gia ngắn (VD: ABC-729) → sessionId
sessionTokens/{accessToken}          — ánh xạ mã truy cập QR (28 ký tự ngẫu nhiên) → sessionId
```

Các trường mở rộng phục vụ vận hành an toàn/hiệu năng (không có trong danh sách trường tối thiểu nhưng cần thiết để hệ thống chạy đúng trên kiến trúc client-only):

- `sessions.shortCode`, `sessions.className` — mã tham gia ngắn và tên lớp được lưu kèm để học viên xem được mà không cần quyền đọc `classes`.
- `sessions.activeQuestionStartedAt` — mốc thời gian phía máy chủ (Firestore serverTimestamp) để đồng hồ đếm ngược **không phụ thuộc đồng hồ máy học viên**.
- `sessions.liveAggregate` — số liệu **tổng hợp, không chứa câu trả lời cá nhân** (đếm theo phương án), do giảng viên (chủ phiên) ghi lại mỗi khi có câu trả lời mới, để Student View / Presentation View (đăng nhập ẩn danh) hiển thị được số người trả lời/biểu đồ **mà không cần** quyền đọc trực tiếp `responses` (quyền này luôn bị từ chối với học viên để bảo vệ dữ liệu người khác — xem Mục 18).
- `questions.scaleMin`, `questions.scaleMax` — cấu hình thang điểm cho loại câu hỏi "Thang điểm".

---

## 18. Giới hạn của phiên bản V1 & định hướng mở rộng

Theo đúng nguyên tắc "không giả vờ an toàn nếu thực tế chưa an toàn", các giới hạn sau được ghi nhận minh bạch:

1. **Biểu đồ ở Trình chiếu/Student View phụ thuộc dữ liệu tổng hợp do giảng viên phát ra (`liveAggregate`).**
   Vì học viên đăng nhập ẩn danh **không bao giờ** được cấp quyền đọc trực tiếp bộ sưu tập `responses` (đây là yêu cầu bảo mật bắt buộc: "Student → Đọc responses = DENY", được Rules chặn ở cả `get` lẫn `list`), màn hình Trình chiếu/Student View hiển thị số liệu tổng hợp do chính trình duyệt của **giảng viên** (người có quyền đọc `responses`) tính toán và ghi lại vào field an toàn `sessions.liveAggregate` (chỉ chứa số đếm/biểu đồ tổng hợp — **không bao giờ** chứa câu trả lời cá nhân của từng học viên). Vì vậy, số liệu này cập nhật tốt nhất khi giảng viên có màn hình **Điều khiển trực tiếp** đang mở song song. Nếu giảng viên đóng hẳn tab Điều khiển trực tiếp, số liệu trên Trình chiếu sẽ dừng ở lần cập nhật gần nhất cho đến khi giảng viên mở lại. Đây là đánh đổi an toàn có chủ đích, không phải lỗi.

2. **Chống liệt kê (enumeration) phiên:** học viên/ẩn danh chỉ được **đọc theo ID đã biết** (`get`), không được **liệt kê** (`list`) bộ sưu tập `sessions`/`responses`/`joinCodes`/`sessionTokens` — Rules đã tách riêng quyền `get` và `list` để không ai có thể quét toàn bộ danh sách phiên đang mở của toàn hệ thống.

3. **Cơ chế bảo vệ liên kết QR (`accessToken`) — và giới hạn thực sự của nó.** Kể từ bản FIX bảo mật này, liên kết/QR học viên quét **không còn nhúng trực tiếp `sessionId`** trong đường dẫn nữa — nó chỉ chứa `accessToken` (chuỗi 28 ký tự sinh ngẫu nhiên bằng `crypto.getRandomValues`, không đoán được). Trình duyệt học viên phải `get` đúng document `sessionTokens/{accessToken}` (không được `list`) để suy ra `sessionId` thật, y hệt cơ chế mã tham gia ngắn `joinCodes/{code}`. Điều này có nghĩa: **chỉ người có đúng liên kết/QR/mã tham gia do giảng viên phát ra mới biết được `sessionId`** — không ai có thể dò ra bằng cách liệt kê hay đoán.
   **Giới hạn cần hiểu rõ (đúng bản chất kiến trúc client-only của Firestore Rules):** sau khi đã biết `sessionId` (dù qua token, qua mã tham gia, hay bằng cách nào khác), việc `get` trực tiếp `sessions/{sessionId}` **không đòi hỏi phải trình lại `accessToken`** — vì Firestore Rules chỉ nhìn thấy dữ liệu của document đang được đọc, **không nhìn thấy được query string trên URL trình duyệt**, nên không có cách nào để một rule bắt buộc "phải kèm đúng token mới được đọc document này". Đây là giới hạn cố hữu của mọi kiến trúc Firebase Rules-only (không riêng gì hệ thống này) khi không có Cloud Function/backend trung gian để xác thực token thủ công. Bảo vệ thực tế đến từ 2 lớp: (a) không ai được `list` để dò `sessionId` hợp lệ, và (b) `sessionId` do Firestore tự sinh có độ ngẫu nhiên rất cao, không thể đoán mò. Nếu cần đóng nốt lỗ hổng lý thuyết này (ví dụ: thu hồi quyền truy cập một liên kết QR cụ thể ngay lập tức), cần bổ sung một Cloud Function xác thực token phía server ở V2 — nằm ngoài phạm vi "chỉ dùng GitHub Pages + Firebase Auth/Firestore thuần client" của V1.

4. **Mã tham gia ngắn** (`ABC-729`, 3 chữ + 3 số ≈ 17,5 triệu tổ hợp) tra cứu qua `joinCodes/{code}` bằng `get` theo ID, không qua truy vấn `list`, nên không lộ danh sách mã của giảng viên khác. Rủi ro trùng mã giữa các phiên khác nhau là rất thấp nhưng khác 0 ở quy mô cực lớn — nếu cần tuyệt đối, có thể mở rộng độ dài mã trong V2. Mã này được sinh bằng `Math.random()` (không phải hàm ngẫu nhiên mật mã học) vì nó chỉ là **tiện ích để gõ tay**, không phải một token bảo mật — sự bảo vệ thực sự vẫn đến từ việc `joinCodes` không cho `list`.

5. **Cách ly đăng nhập giữa Giảng viên/Admin và Học viên/Trình chiếu trên cùng một trình duyệt.** Firebase Auth lưu trạng thái đăng nhập theo **từng App instance**, namespace theo tên app trong `localStorage`. Hệ thống dùng **2 Firebase App instance độc lập** trong cùng `index.html`: app mặc định (`auth`/`db`) dành riêng cho Giảng viên/Admin, và một app thứ hai đặt tên `"public"` (`publicAuth`/`publicDb`) dành riêng cho Học viên/Trình chiếu. Nhờ vậy, nếu một giáo viên mở màn hình Học viên hoặc Trình chiếu **trong cùng trình duyệt** đang đăng nhập Teacher Dashboard (ví dụ mở 2 tab để tự kiểm tra), 2 phiên đăng nhập tồn tại **hoàn toàn song song, không ảnh hưởng lẫn nhau**: `participantId` của "học viên" trong tab đó luôn là một UID ẩn danh riêng của app `"public"`, không bao giờ trùng với UID giảng viên đang đăng nhập ở app mặc định; và việc học viên đăng nhập ẩn danh **không bao giờ đăng xuất** phiên giảng viên ở tab khác (vì chúng là 2 App/2 phiên Auth độc lập). **Giới hạn cần biết:** đây là cách ly ở tầng ứng dụng (2 App instance), không phải cách ly ở tầng trình duyệt (không dùng cửa sổ ẩn danh/profile khác) — nếu cùng một máy tính dùng để vừa làm giáo viên vừa để nhiều học sinh lần lượt "mượn máy" quét QR, mỗi lần quét vẫn tái sử dụng **cùng một UID ẩn danh đã lưu trong `localStorage` của app `"public"`** trên máy đó (giống hệt hành vi Anonymous Auth tiêu chuẩn của Firebase, không phải lỗi riêng của hệ thống này) — nếu cần mỗi học sinh một danh tính ẩn danh mới trên cùng thiết bị dùng chung, hãy dùng chế độ duyệt web riêng tư (ẩn danh) cho từng lượt, hoặc xóa dữ liệu site giữa các lượt.

6. **Theo dõi trạng thái tài khoản theo thời gian thực (khóa/mở khóa giảng viên).** Nếu Admin khóa (`suspended`) một giảng viên trong khi giảng viên đó đang mở Teacher Dashboard, hệ thống dùng `onSnapshot` để theo dõi hồ sơ `users/{uid}` của chính giảng viên **xuyên suốt phiên làm việc** (không chỉ kiểm tra một lần lúc đăng nhập) — khi phát hiện đổi trạng thái, các listener nghiệp vụ khác (lớp/phiên/câu hỏi/phản hồi...) được dừng ngay và màn hình khóa được hiển thị gần như tức thời (độ trễ chỉ còn phụ thuộc độ trễ mạng của `onSnapshot`, thường dưới 1 giây). Việc **mở khóa lại** không tự động khôi phục Dashboard đang mở — giảng viên cần đăng xuất/đăng nhập lại hoặc tải lại trang, vì đây chỉ là theo dõi một chiều (phát hiện bị khóa) theo đúng yêu cầu, không phải đồng bộ hai chiều đầy đủ trạng thái phiên làm việc.

7. **Ghi nguyên tử (atomic batch) khi tạo phiên — và cơ chế `getAfter()`.** `finalizeWizard()` tạo một phiên hoàn chỉnh bằng **một `writeBatch()` duy nhất**, gồm: `sessions/{id}`, `joinCodes/{shortCode}`, `sessionTokens/{accessToken}`, toàn bộ `questions/{id}` và toàn bộ `questions/{id}/options/{id}` — hoặc **tất cả cùng thành công, hoặc tất cả cùng thất bại** (không bao giờ tạo dở dang một phiên thiếu câu hỏi/thiếu phương án). Về mặt Rules: `get()`/`exists()` thông thường chỉ nhìn thấy dữ liệu **đã được ghi nhận trước đó** trong database — chúng **không nhìn thấy** các văn bản "anh em" khác đang được ghi cùng lúc trong CÙNG một `writeBatch()`/transaction chưa commit. Vì `questions` được tạo cùng batch với `sessions` (và `options` cùng batch với `questions` cha của nó), nếu dùng `get()` để kiểm tra "câu hỏi này có thuộc đúng phiên của tôi không", Rules sẽ thấy phiên đó **"chưa tồn tại"** và từ chối oan toàn bộ batch. Rules trong hệ thống dùng đúng hàm `getAfter()` của Firestore (kiểm tra tài liệu sẽ trông như thế nào **sau khi** toàn bộ batch được áp dụng) — nhưng **chỉ ở đúng 2 chỗ cần thiết**: xác nhận chủ sở hữu phiên khi tạo `questions`, và xác nhận chủ sở hữu câu hỏi khi tạo `options`. Mọi lượt đọc chéo khác trong Rules (đọc hồ sơ giảng viên/admin, đọc phiên khi học viên trả lời, đọc câu hỏi khi kiểm tra active-question…) đều là đọc một tài liệu **đã tồn tại độc lập từ trước** với thao tác đang xét, nên vẫn dùng `get()` như thường — không có việc thay toàn bộ `get()` thành `getAfter()` một cách máy móc. Nhờ vậy: Giảng viên A tạo phiên (kèm nhiều câu hỏi/phương án) trong một batch → **luôn thành công**; Giảng viên B cố chèn một câu hỏi có `sessionId` trỏ vào phiên của Giảng viên A → Rules vẫn nhìn ra đúng chủ sở hữu thật của phiên đó (dù đọc qua `getAfter()`) và **từ chối**; giảng viên bị khóa (`suspended`) vẫn bị chặn ở bước `isActiveTeacher()` như cũ, không liên quan đến `getAfter()`.

8. **Response bắt buộc đến từ tài khoản ẩn danh (Anonymous Auth).** Đúng quy định V1 "học viên không có tài khoản, luôn dùng Firebase Anonymous Authentication", Rules giờ yêu cầu **rõ ràng** người gửi/sửa/tự-đọc một `response` phải đang đăng nhập ẩn danh (`request.auth.token.firebase.sign_in_provider == 'anonymous'`), không chỉ "đã đăng nhập bằng cách nào đó". Điều này chặn đứng khả năng một tài khoản email/mật khẩu bình thường (kể cả một giảng viên đang đăng nhập ở tab khác, hoặc bất kỳ ai tự viết script gọi thẳng Firestore SDK bằng tài khoản email/mật khẩu của họ) tự đóng vai học viên để ghi `responses` — cho dù họ biết chính xác cấu trúc dữ liệu cần gửi. Giảng viên/Admin đọc `responses` (xem kết quả, báo cáo, xuất dữ liệu) vẫn dùng đúng quyền owner/admin sẵn có, không bị ảnh hưởng bởi thay đổi này.

9. **App Check chưa được bật** trong V1 để tránh gây khó khăn khi chạy trên GitHub Pages (không có backend để cấu hình domain xác thực phức tạp). Kiến trúc (tách biệt hoàn toàn Rules theo `request.auth`) đã sẵn sàng để bật **Firebase App Check (reCAPTCHA v3 hoặc App Check for Web)** trong V2: vào Firebase Console → **App Check**, đăng ký Web App, dán site key vào phần khởi tạo Firebase trong `index.html` (cho cả 2 App instance ở mục 5), rồi bật "Enforce" cho Firestore.

10. **Không dùng AI** trong V1 theo đúng yêu cầu — nhưng schema (`questions`, `library`, `responses` dạng `answer` văn bản tự do cho câu hỏi mở) đã sẵn sàng để V2 bổ sung: AI tạo câu hỏi, AI phân tích câu trả lời mở, AI đề xuất câu hỏi/tình huống, AI tạo báo cáo — chỉ cần thêm một lớp gọi API ở phía client hoặc một Cloud Function riêng, không cần đổi cấu trúc dữ liệu hiện tại.

11. **Before/After (so sánh trước/sau):** schema đã có sẵn `sessionGroupId` và `roundNumber` trên `sessions` để nhóm nhiều phiên lại thành các "vòng" so sánh, nhưng giao diện so sánh kết quả giữa các vòng chưa được xây trong V1 (mục tiêu V1 chỉ cần sẵn sàng dữ liệu).

12. **Điểm danh, chấm điểm, leaderboard, ngân hàng câu hỏi dùng chung nhiều giảng viên, đa trường/đơn vị:** chưa xây trong V1 theo đúng phạm vi yêu cầu, nhưng mô hình `ownerId` tách biệt dữ liệu từng giảng viên đã là nền tảng phù hợp để mở rộng.

---

## 19. Firestore Indexes

File `firestore.indexes.json` khai báo sẵn các composite index cần thiết cho những truy vấn dùng nhiều điều kiện (VD: lọc theo `ownerId` + sắp xếp theo `createdAt`).

**Cách triển khai (một trong hai cách):**

- **Cách 1 (đơn giản nhất):** Cứ dùng app bình thường. Nếu Firestore báo lỗi dạng "The query requires an index" trong Console trình duyệt (nhấn F12 để xem), lỗi đó **luôn kèm theo một đường link** — bấm vào link đó, Firebase Console sẽ tự điền sẵn thông tin, bạn chỉ cần bấm **Create Index** và đợi vài phút.
- **Cách 2 (chủ động):** Nếu bạn có cài Firebase CLI (`npm install -g firebase-tools`), chạy:
  ```
  firebase deploy --only firestore:indexes
  ```
  từ thư mục chứa `firestore.indexes.json` (lệnh này **chỉ cần khi thiết lập ban đầu**, không ảnh hưởng đến việc GitHub Pages phục vụ `index.html` — index chỉ là cấu hình phía Firestore).

---

## 20. Cấu trúc file / Bảo trì

```
index.html               — toàn bộ frontend (HTML + CSS + JavaScript), chỉ cần file này để chạy trên GitHub Pages
firestore.rules           — Security Rules, dán vào Firebase Console → Firestore → Rules
firestore.indexes.json    — khai báo composite index (tham khảo / dùng với Firebase CLI)
README.md                 — tài liệu này
```

- **Không cần** `npm install`, **không cần** build, **không cần** Node.js để chạy production — chỉ cần mở `index.html` qua GitHub Pages (hoặc bất kỳ static hosting nào).
- Toàn bộ logic Firebase (Auth, Firestore, realtime `onSnapshot`) nằm trong thẻ `<script type="module">` của `index.html`, dùng Firebase Web SDK tải qua CDN (`https://www.gstatic.com/firebasejs/...`) — không cần bundler.
- Thư viện biểu đồ: **Chart.js** (CDN `cdn.jsdelivr.net`). Thư viện mã QR: **qrcodejs** (CDN `cdn.jsdelivr.net`).
- Muốn đổi giao diện/màu sắc: chỉnh phần `<style>` ở đầu `index.html` (biến CSS `:root { --brand: ... }`).
- Muốn thêm loại câu hỏi/biểu đồ mới: chỉnh các hằng số `QUESTION_TYPES` và `CHART_LABELS` trong phần script.

---

*HCMA2 - TEACHING V1 — Ổn định · An toàn · Dễ sử dụng · Dễ triển khai · Dễ mở rộng.*
