// api/admin-lessons.js — REBUILT CLEAN 2026-06-07
// Purpose: CRUD operations for lessons in Google Sheet.
// Uses Service Account (Sheets only). No Drive/Docs involved.
// Auth required for ALL methods (GET and POST).

import {
  getAdminFromRequest,
  getSheetsClient,
  normalizeBunnyUrl,
  normalizeYouTubeUrl,
  sanitizeMediaUrls,
  errResponse,
} from "./admin-utils.js";

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] !== undefined ? String(row[i]).trim() : "";
  });
  return obj;
}

function normalizeVideoUrl(raw) {
  const str = String(raw || "").trim();
  if (!str) return "";
  // Try Bunny first
  const bunny = normalizeBunnyUrl(str);
  if (bunny.ok) return bunny.url;
  // Try YouTube
  const yt = normalizeYouTubeUrl(str);
  if (yt.ok) return yt.url;
  return str;
}

const REQUIRED_LESSON_FIELDS = [
  "course", "lesson", "title", "description",
  "duration", "level", "thumbnailUrl", "videoUrl",
  "recipeUrl", "mediaUrls", "status",
];

// ─── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    // ── Auth — required for ALL methods ──────────────────────────────────────
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return errResponse(res, 401, {
        error: "Chưa đăng nhập admin",
        hint: "Vui lòng đăng nhập lại.",
      });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return errResponse(res, 500, {
        error: "Thiếu GOOGLE_SHEET_ID trong cấu hình Vercel",
      });
    }

    const sheets = await getSheetsClient();

    // ── GET: List lessons for a course ────────────────────────────────────────
    if (req.method === "GET") {
      const { course } = req.query || {};
      if (!course) {
        return errResponse(res, 400, { error: "Thiếu tham số course" });
      }
      const courseSlug = String(course).trim();

      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Lessons!A:Z",
      });
      const rows = result.data.values || [];

      if (rows.length < 1) return res.status(200).json({ success: true, lessons: [] });

      const headers = rows[0].map((h) => String(h).trim());
      const lessons = rows
        .slice(1)
        .map((row) => rowToObject(headers, row))
        .filter((l) => String(l.course || "").trim() === courseSlug)
        .sort((a, b) => Number(a.lesson || 0) - Number(b.lesson || 0));

      return res.status(200).json({ success: true, lessons });
    }

    // ── POST: Create / Update / Delete ────────────────────────────────────────
    if (req.method === "POST") {
      const { action, course, lesson, originalCourse, originalLesson, lessonData } =
        req.body || {};

      if (!action) {
        return errResponse(res, 400, { error: "Thiếu tham số action" });
      }

      // Fetch full Lessons sheet
      const sheetResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Lessons!A:Z",
      });
      const rows = sheetResult.data.values || [];

      if (rows.length < 1) {
        return errResponse(res, 500, {
          error: "Tab Lessons trống hoặc thiếu dòng tiêu đề",
          hint: "Vào Google Sheet và tạo dòng tiêu đề với các cột cần thiết.",
        });
      }

      const headers = rows[0].map((h) => String(h).trim());

      // ── Check mediaUrls column ────────────────────────────────────────────
      if (!headers.includes("mediaUrls")) {
        return errResponse(res, 400, {
          error: "Sheet thiếu cột mediaUrls. Vào tab Lessons thêm cột mediaUrls.",
          hint: "Thêm cột có tên chính xác 'mediaUrls' vào dòng tiêu đề của tab Lessons.",
          extra: { currentHeaders: headers },
        });
      }

      const courseColIdx = headers.indexOf("course");
      const lessonColIdx = headers.indexOf("lesson");

      if (courseColIdx === -1 || lessonColIdx === -1) {
        return errResponse(res, 400, {
          error: "Tab Lessons thiếu cột 'course' hoặc 'lesson'",
          extra: { headers },
        });
      }

      // ── BUILD ROW from lessonData ─────────────────────────────────────────
      const buildRow = (data, existingRow = null) => {
        const videoUrl = normalizeVideoUrl(data.videoUrl);
        const mediaUrls = sanitizeMediaUrls(data.mediaUrls);
        return headers.map((h, colIdx) => {
          if (h === "course") return String(data.course || "").trim();
          if (h === "lesson") return String(data.lesson || "").trim();
          if (h === "title") return String(data.title || "").trim();
          if (h === "description") return String(data.description || "").trim();
          if (h === "duration") return String(data.duration || "").trim();
          if (h === "level") return String(data.level || "").trim();
          if (h === "thumbnailUrl") return String(data.thumbnailUrl || "").trim();
          if (h === "videoUrl") return videoUrl;
          if (h === "recipeUrl") return String(data.recipeUrl || "").trim();
          if (h === "mediaUrls") return mediaUrls;
          if (h === "status") {
            return String(
              data.status || (existingRow ? String(existingRow[colIdx] || "") : "active")
            ).trim();
          }
          // Preserve existing value for unknown custom columns
          if (existingRow && existingRow[colIdx] !== undefined) {
            return String(existingRow[colIdx]);
          }
          return "";
        });
      };

      // ── ACTION: CREATE ────────────────────────────────────────────────────
      if (action === "create") {
        if (!lessonData || typeof lessonData !== "object") {
          return errResponse(res, 400, { error: "Thiếu dữ liệu lessonData" });
        }
        const newRow = buildRow({ ...lessonData, status: "active" });

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Lessons!A:A",
          valueInputOption: "RAW",
          requestBody: { values: [newRow] },
        });

        return res.status(200).json({ success: true, message: "Tạo bài học thành công" });
      }

      // ── ACTION: UPDATE ────────────────────────────────────────────────────
      if (action === "update") {
        if (!originalCourse || !originalLesson) {
          return errResponse(res, 400, {
            error: "Thiếu originalCourse hoặc originalLesson",
            hint: "Cần để tìm đúng dòng bài học cần sửa.",
          });
        }
        if (!lessonData || typeof lessonData !== "object") {
          return errResponse(res, 400, { error: "Thiếu dữ liệu lessonData" });
        }

        // Find the row
        let foundRowIdx = -1; // 1-based spreadsheet row index
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (
            String(row[courseColIdx] || "").trim() === String(originalCourse).trim() &&
            String(row[lessonColIdx] || "").trim() === String(originalLesson).trim()
          ) {
            foundRowIdx = i + 1;
            break;
          }
        }

        if (foundRowIdx === -1) {
          return errResponse(res, 404, {
            error: "Không tìm thấy bài học cần cập nhật",
            extra: { originalCourse, originalLesson },
            hint: "Kiểm tra lại course slug và số bài.",
          });
        }

        const existingRow = rows[foundRowIdx - 1];
        const updatedRow = buildRow(lessonData, existingRow);

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Lessons!A${foundRowIdx}`,
          valueInputOption: "RAW",
          requestBody: { values: [updatedRow] },
        });

        return res.status(200).json({ success: true, message: "Cập nhật bài học thành công" });
      }

      // ── ACTION: DELETE ────────────────────────────────────────────────────
      if (action === "delete") {
        if (!course || !lesson) {
          return errResponse(res, 400, {
            error: "Thiếu tham số course hoặc lesson",
          });
        }

        let foundRowIdx = -1;
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (
            String(row[courseColIdx] || "").trim() === String(course).trim() &&
            String(row[lessonColIdx] || "").trim() === String(lesson).trim()
          ) {
            foundRowIdx = i + 1;
            break;
          }
        }

        if (foundRowIdx === -1) {
          return errResponse(res, 404, {
            error: "Không tìm thấy bài học cần xóa",
            extra: { course, lesson },
          });
        }

        const statusColIdx = headers.indexOf("status");

        if (statusColIdx !== -1) {
          // Soft delete: set status = "hidden"
          const existingRow = [...(rows[foundRowIdx - 1] || [])];
          existingRow[statusColIdx] = "hidden";

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Lessons!A${foundRowIdx}`,
            valueInputOption: "RAW",
            requestBody: { values: [existingRow] },
          });
          return res.status(200).json({
            success: true,
            message: "Đã ẩn bài học (status = hidden)",
          });
        } else {
          // No status column — refuse physical delete to prevent data loss
          return errResponse(res, 400, {
            error: "Tab Lessons không có cột 'status' nên không thể ẩn bài an toàn.",
            hint: "Thêm cột 'status' vào tab Lessons để hỗ trợ ẩn bài. Hiện chưa hỗ trợ xóa vật lý để tránh mất dữ liệu.",
          });
        }
      }

      return errResponse(res, 400, { error: `action '${action}' không hợp lệ` });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-lessons] Unexpected error:", err);

    // Detect permission errors
    const isPermError =
      err.message?.includes("PERMISSION_DENIED") ||
      err.message?.includes("403") ||
      err.code === 403;

    return errResponse(res, 500, {
      error: isPermError
        ? "Service Account không có quyền ghi Google Sheet"
        : "Lỗi server trong admin-lessons",
      message: err.message,
      hint: isPermError
        ? `Vào Google Sheet và cấp quyền Editor cho: ${process.env.GOOGLE_CLIENT_EMAIL || "(chưa cấu hình)"}`
        : "Kiểm tra logs Vercel để biết chi tiết.",
      extra: {
        serviceEmail: process.env.GOOGLE_CLIENT_EMAIL || "(not set)",
        sheetId: process.env.GOOGLE_SHEET_ID || "(not set)",
      },
    });
  }
}
