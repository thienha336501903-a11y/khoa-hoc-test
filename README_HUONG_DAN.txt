# Hướng Dẫn Cấu Hình Hệ Thống Khóa Học Online

Hệ thống khóa học online sử dụng Google Sign-In, lấy dữ liệu từ Google Sheets, hiển thị công thức từ Drive/Docs, và phát video được bảo mật chặt chẽ qua Bunny Stream (chỉ xem được trên điện thoại, chặn Cốc Cốc, gắn watermark động).

---

## 1. Cấu Hình Bunny Stream Security (BẮT BUỘC)

Để bảo vệ video không bị tải chùa bằng IDM hoặc Cốc Cốc, bạn phải cài đặt bảo mật trong thư mục Bunny Stream như sau:

1. **Enable Direct Play**: `OFF` (Tắt phát trực tiếp qua file thô).
2. **Block Direct URL File Access**: `ON` (Chặn truy cập file video trực tiếp).
3. **Embed View Token Authentication**: `ON` (Bắt buộc ký Token bảo mật cho Iframe Embed).
4. **CDN Token Authentication**: `OFF` (Không cần thiết nếu đang dùng Embed Iframe).
5. **Allowed Referrers / Allowed Domains**:
   - Thêm tên miền chính thức trên Vercel của bạn (ví dụ: `khoa-hoc-test.vercel.app`).
   - Thêm `localhost` nếu muốn chạy test dưới local.
   - *Lưu ý*: KHÔNG thêm `player.mediadelivery.net` hay `iframe.mediadelivery.net` vào danh sách này.

---

## 2. Định Dạng Nhập Dữ Liệu Video Trong Google Sheets

Trong tab `Lessons`, tại cột `videoUrl`, bạn có thể nhập theo các dạng sau:

1. **Link Bunny sạch (Khuyên dùng)**:
   `https://player.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID`

2. **Link iframe cũ**:
   `https://iframe.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID`

3. **Full mã nhúng iframe copy trực tiếp từ Bunny**:
   `<iframe src="https://player.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID?token=...&expires=..."></iframe>`
   *(Hệ thống sẽ tự động tách URL từ thẻ `src`)*

4. **Link có token cũ**:
   `https://player.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID?token=...&expires=...`
   *(Hệ thống sẽ tự động loại bỏ token cũ và sinh token mới có hiệu lực 10 phút)*

**Lưu ý cực kỳ quan trọng**:
- Link embed không có token khi mở trực tiếp trên trình duyệt sẽ báo lỗi `403 Forbidden` là hoàn toàn bình thường. Video chỉ phát được thông qua iframe được hệ thống web tự sinh token ký số bằng `BUNNY_STREAM_TOKEN_KEY`.
- Không sử dụng link trực tiếp `.mp4` hay `.m3u8` thô trên frontend nhằm tránh việc bị bắt link và tải về hàng loạt.

---

## 3. Cấu Trúc Google Sheet

Tạo một Google Sheet và chia sẻ quyền **Viewer** cho Service Account Gmail (`GOOGLE_CLIENT_EMAIL`). Sheet gồm các tab bắt buộc sau:

### Tab: Students
Cột:
- `gmail`: Địa chỉ email của học viên.
- `course`: Slug của khóa học (ví dụ: `banh-mi`).
- `status`: Phải để `active` thì học viên mới được quyền học.

### Tab: Lessons
Cột:
- `course`: Slug khóa học (ví dụ: `banh-mi`).
- `lesson`: Số thứ tự bài (ví dụ: `1`, `2`). Sort tăng dần theo cột này.
- `title`: Tiêu đề bài học.
- `description`: Mô tả ngắn.
- `duration`: Thời lượng (ví dụ: `15:30`).
- `level`: Cấp độ (ví dụ: `Cơ bản`, `Nâng cao`).
- `thumbnailUrl`: Link ảnh đại diện bài học.
- `videoUrl`: Link hoặc mã nhúng Bunny.
- `recipeUrl`: Link Google Docs / Google Drive file công thức.

### Tab: Config
Cột (Dữ liệu dạng Key - Value):
- Cột A: Tên cấu hình (`title`, `subtitle`, `heroImage`).
- Cột B: Giá trị cấu hình tương ứng.

---

## 4. Biến Môi Trường Trên Vercel (Environment Variables)

Cần cấu hình đủ các biến môi trường sau:

- `GOOGLE_CLIENT_ID`: Client ID từ Google Cloud Console (OAuth Client ID).
- `GOOGLE_SHEET_ID`: ID của Google Sheet chứa dữ liệu học viên & bài học.
- `GOOGLE_CLIENT_EMAIL`: Email của Service Account.
- `GOOGLE_PRIVATE_KEY`: Khóa riêng tư của Service Account. Thay thế toàn bộ ký tự xuống dòng bằng `\n` nếu dán vào Vercel bị lỗi.
- `SESSION_SECRET`: Chuỗi ký tự bất kỳ để mã hóa session cookie HMAC-SHA256.
- `BUNNY_STREAM_TOKEN_KEY`: Token Key lấy từ trang quản lý thư mục video của Bunny Stream (phần Security).
- `SESSION_DAYS`: (Tùy chọn) Số ngày duy trì đăng nhập (Mặc định: 30).
