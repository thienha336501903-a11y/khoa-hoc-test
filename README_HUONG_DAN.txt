# Web khóa học Online: Google Login + Google Sheet + Google Drive

## 1. Cấu trúc Google Sheet

Tạo Google Sheet có 3 tab:

### Tab Students
Dòng 1 bắt buộc:

gmail | course | status | note

Ví dụ:

abc@gmail.com | banh-mi | active | Đã thanh toán

### Tab Lessons
Dòng 1 bắt buộc:

course | lesson | title | description | duration | level | thumbnailUrl | videoUrl | recipeUrl

Ví dụ:

banh-mi | 1 | Bánh mì Việt Nam truyền thống | Công thức chuẩn vị, vỏ giòn ruột xốp | 31:45 | Cơ bản | link ảnh | link video drive | link công thức

### Tab Config
Dòng 1 trở đi:

title | BÁNH MÌ<br><span class="text-[#d85c00]">VIỆT NAM</span>
subtitle | 5 BÀI HỌC – CÔNG THỨC CHI TIẾT – VIDEO HƯỚNG DẪN
heroImage | link ảnh banner

## 2. Quyền Drive

Video không để public nếu muốn bảo mật.

Share thư mục Drive/video cho Gmail học viên đã mua.

## 3. Google Cloud

Tạo OAuth Client ID dạng Web Application.

Authorized JavaScript origins:

http://localhost:3000
https://ten-web-cua-ban.vercel.app

## 4. Service Account

Tạo Service Account.
Tạo key JSON.
Lấy client_email và private_key.
Share Google Sheet cho client_email đó với quyền Viewer.

## 5. Vercel Environment Variables

GOOGLE_CLIENT_ID
GOOGLE_SHEET_ID
GOOGLE_CLIENT_EMAIL
GOOGLE_PRIVATE_KEY

Lưu ý GOOGLE_PRIVATE_KEY giữ nguyên cả đoạn có -----BEGIN PRIVATE KEY----- và xuống dòng.
Nếu Vercel lỗi xuống dòng, thay xuống dòng bằng \n.

## 6. Chạy

Đưa toàn bộ project lên GitHub rồi import vào Vercel.
