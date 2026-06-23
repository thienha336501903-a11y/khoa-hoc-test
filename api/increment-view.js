import { google } from "googleapis";

function getServiceAccountAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: "v4", auth });
}

function columnIndexToLabel(index) {
  let label = "";
  let temp = index;
  while (temp >= 0) {
    label = String.fromCharCode((temp % 26) + 65) + label;
    temp = Math.floor(temp / 26) - 1;
  }
  return label;
}

export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { course, lesson } = req.body || {};
  const courseSlug = String(course || "").trim();
  const lessonNum = String(lesson || "").trim();

  if (!courseSlug || !lessonNum) {
    return res.status(400).json({ success: false, error: "Thiếu thông tin course hoặc lesson" });
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    return res.status(500).json({ success: false, error: "Thiếu cấu hình GOOGLE_SHEET_ID" });
  }

  try {
    const sheets = await getSheetsClient();

    // Đọc toàn bộ dữ liệu tab Lessons
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Lessons!A:Z",
    });
    const rows = result.data.values || [];

    if (rows.length < 1) {
      return res.status(500).json({ success: false, error: "Tab Lessons rỗng hoặc không tồn tại" });
    }

    const headers = rows[0].map((h) => String(h).trim());
    let viewsColIdx = headers.indexOf("views");

    // Nếu cột views chưa tồn tại, tự động thêm vào cuối hàng tiêu đề
    if (viewsColIdx === -1) {
      viewsColIdx = headers.length;
      const colLabel = columnIndexToLabel(viewsColIdx);
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Lessons!${colLabel}1`,
        valueInputOption: "RAW",
        requestBody: { values: [["views"]] },
      });
      headers.push("views");
    }

    const courseColIdx = headers.indexOf("course");
    const lessonColIdx = headers.indexOf("lesson");

    if (courseColIdx === -1 || lessonColIdx === -1) {
      return res.status(400).json({
        success: false,
        error: "Tab Lessons thiếu cột 'course' hoặc 'lesson'",
      });
    }

    // Tìm dòng chứa bài học khớp với course và lesson
    let foundRowIdx = -1; // 1-based index trên Google Sheet
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (
        String(row[courseColIdx] || "").trim() === courseSlug &&
        String(row[lessonColIdx] || "").trim() === lessonNum
      ) {
        foundRowIdx = i + 1;
        break;
      }
    }

    if (foundRowIdx === -1) {
      return res.status(404).json({
        success: false,
        error: `Không tìm thấy bài học ${lessonNum} thuộc khóa học ${courseSlug}`,
      });
    }

    // Lấy giá trị lượt xem hiện tại và tăng lên 1
    const matchedRow = rows[foundRowIdx - 1];
    const currentViewsVal = matchedRow[viewsColIdx] ? String(matchedRow[viewsColIdx]).trim() : "";
    const currentViews = parseInt(currentViewsVal, 10) || 0;
    const newViews = currentViews + 1;

    // Ghi lại số lượt xem mới vào Google Sheet
    const targetColLabel = columnIndexToLabel(viewsColIdx);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Lessons!${targetColLabel}${foundRowIdx}`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(newViews)]] },
    });

    return res.status(200).json({
      success: true,
      course: courseSlug,
      lesson: lessonNum,
      views: newViews,
    });
  } catch (err) {
    console.error("[api/increment-view] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi hệ thống khi cập nhật lượt xem",
      detail: err.message,
    });
  }
}
