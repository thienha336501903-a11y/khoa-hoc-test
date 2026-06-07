import {
  getSheetsClient,
  getAdminEmailFromRequest,
  normalizeBunnyUrl,
  normalizeYouTubeUrl
} from "./admin-utils.js";

// Check if a URL is a YouTube link
function isYouTubeUrl(url) {
  const text = String(url || "").toLowerCase();
  return (
    text.includes("youtube.com") ||
    text.includes("youtu.be") ||
    text.includes("youtube-nocookie.com")
  );
}

// Check if a URL is a Bunny link
function isBunnyUrl(url) {
  const text = String(url || "").toLowerCase();
  return (
    text.includes("mediadelivery.net") ||
    text.includes("bunnycdn.com")
  );
}

function normalizeVideoUrl(url) {
  if (isYouTubeUrl(url)) {
    return normalizeYouTubeUrl(url);
  }
  if (isBunnyUrl(url)) {
    return normalizeBunnyUrl(url);
  }
  return String(url || "").trim();
}

function sanitizeMediaUrls(val) {
  return String(val || "")
    .split("\n")
    .map(line => {
      const parts = line.split("|");
      if (parts.length < 3) return "";
      const type = String(parts[0]).trim();
      const title = String(parts[1]).trim().replace(/[|\n]/g, "-");
      const url = String(parts[2]).trim().replace(/[|\n]/g, "");
      return `${type}|${title}|${url}`;
    })
    .filter(Boolean)
    .join("\n");
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ? String(row[i]).trim() : "";
  });
  return obj;
}

export default async function handler(req, res) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({ error: "Missing GOOGLE_SHEET_ID in environment" });
    }

    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return res.status(401).json({ error: "Unauthorized: Admin access required" });
    }

    const sheets = await getSheetsClient();

    // GET: Read lessons for a course slug
    if (req.method === "GET") {
      const { course } = req.query || {};
      const courseSlug = String(course || "").trim();

      if (!courseSlug) {
        return res.status(400).json({ error: "Missing course parameter" });
      }

      const lessonRowsResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Lessons!A:Z"
      });
      const lessonRows = lessonRowsResult.data.values || [];

      if (lessonRows.length < 1) {
        return res.status(200).json({ lessons: [] });
      }

      const headers = lessonRows[0].map(h => String(h).trim());
      const lessons = lessonRows
        .slice(1)
        .map(row => rowToObject(headers, row))
        .filter(l => String(l.course || "").trim() === courseSlug)
        .sort((a, b) => Number(a.lesson || 0) - Number(b.lesson || 0));

      return res.status(200).json({ lessons });
    }

    // POST: Write operations (Create, Update, Delete)
    if (req.method === "POST") {
      const { action, course, lesson, originalCourse, originalLesson, lessonData } = req.body || {};
      
      if (!action) {
        return res.status(400).json({ error: "Missing action parameter" });
      }

      // Fetch current sheet to check headers and rows
      const lessonRowsResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Lessons!A:Z"
      });
      const lessonRows = lessonRowsResult.data.values || [];

      if (lessonRows.length < 1) {
        return res.status(500).json({
          error: "Sheet Lessons trống hoặc không có dòng tiêu đề. Vui lòng tạo dòng tiêu đề trước."
        });
      }

      const headers = lessonRows[0].map(h => String(h).trim());
      
      // CRITICAL REQUIREMENT: Check if mediaUrls column exists
      if (!headers.includes("mediaUrls")) {
        return res.status(400).json({
          error: "Sheet thiếu cột mediaUrls, vui lòng thêm cột này vào tab Lessons."
        });
      }

      // 1. CREATE LESSON
      if (action === "create") {
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ error: "Missing lessonData" });
        }

        // Normalize URLs
        const videoUrl = normalizeVideoUrl(lessonData.videoUrl);
        const mediaUrls = sanitizeMediaUrls(lessonData.mediaUrls);
        
        // Prepare the new row matching the exact headers order
        const newRow = headers.map(h => {
          if (h === "course") return String(lessonData.course || course || "").trim();
          if (h === "lesson") return String(lessonData.lesson || "").trim();
          if (h === "title") return String(lessonData.title || "").trim();
          if (h === "description") return String(lessonData.description || "").trim();
          if (h === "duration") return String(lessonData.duration || "").trim();
          if (h === "level") return String(lessonData.level || "").trim();
          if (h === "thumbnailUrl") return String(lessonData.thumbnailUrl || "").trim();
          if (h === "videoUrl") return videoUrl;
          if (h === "mediaUrls") return mediaUrls;
          if (h === "recipeUrl") return String(lessonData.recipeUrl || "").trim();
          if (h === "status") return String(lessonData.status || "active").trim();
          
          // For any other columns, set empty string
          return "";
        });

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Lessons!A:A",
          valueInputOption: "RAW",
          requestBody: {
            values: [newRow]
          }
        });

        return res.status(200).json({ success: true, message: "Tạo bài học thành công" });
      }

      // 2. UPDATE LESSON
      if (action === "update") {
        if (!originalCourse || !originalLesson) {
          return res.status(400).json({ error: "Missing originalCourse or originalLesson to identify the row" });
        }
        if (!lessonData || typeof lessonData !== "object") {
          return res.status(400).json({ error: "Missing lessonData" });
        }

        // Find row index (1-based, plus 1 for headers)
        let foundRowIndex = -1;
        const courseColIdx = headers.indexOf("course");
        const lessonColIdx = headers.indexOf("lesson");

        for (let i = 1; i < lessonRows.length; i++) {
          const row = lessonRows[i];
          if (
            String(row[courseColIdx] || "").trim() === String(originalCourse).trim() &&
            String(row[lessonColIdx] || "").trim() === String(originalLesson).trim()
          ) {
            foundRowIndex = i + 1; // 1-based index
            break;
          }
        }

        if (foundRowIndex === -1) {
          return res.status(404).json({ error: "Không tìm thấy bài học để cập nhật" });
        }

        // Keep all existing column data to avoid breaking custom fields, and update the edited ones
        const existingRow = lessonRows[foundRowIndex - 1];
        const videoUrl = normalizeVideoUrl(lessonData.videoUrl);

        const updatedRow = headers.map((h, colIdx) => {
          if (h === "course") return String(lessonData.course || originalCourse || "").trim();
          if (h === "lesson") return String(lessonData.lesson || "").trim();
          if (h === "title") return String(lessonData.title || "").trim();
          if (h === "description") return String(lessonData.description || "").trim();
          if (h === "duration") return String(lessonData.duration || "").trim();
          if (h === "level") return String(lessonData.level || "").trim();
          if (h === "thumbnailUrl") return String(lessonData.thumbnailUrl || "").trim();
          if (h === "videoUrl") return videoUrl;
          if (h === "mediaUrls") return sanitizeMediaUrls(lessonData.mediaUrls);
          if (h === "recipeUrl") return String(lessonData.recipeUrl || "").trim();
          if (h === "status") return String(lessonData.status || existingRow[colIdx] || "active").trim();
          
          // Return existing value for other/custom columns to preserve them
          return existingRow[colIdx] !== undefined ? String(existingRow[colIdx]) : "";
        });

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Lessons!A${foundRowIndex}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [updatedRow]
          }
        });

        return res.status(200).json({ success: true, message: "Cập nhật bài học thành công" });
      }

      // 3. DELETE LESSON
      if (action === "delete") {
        const targetCourse = course;
        const targetLesson = lesson;

        if (!targetCourse || !targetLesson) {
          return res.status(400).json({ error: "Missing course or lesson parameter for delete" });
        }

        let foundRowIndex = -1;
        const courseColIdx = headers.indexOf("course");
        const lessonColIdx = headers.indexOf("lesson");

        for (let i = 1; i < lessonRows.length; i++) {
          const row = lessonRows[i];
          if (
            String(row[courseColIdx] || "").trim() === String(targetCourse).trim() &&
            String(row[lessonColIdx] || "").trim() === String(targetLesson).trim()
          ) {
            foundRowIndex = i + 1; // 1-based index
            break;
          }
        }

        if (foundRowIndex === -1) {
          return res.status(404).json({ error: "Không tìm thấy bài học để xóa" });
        }

        const statusColIdx = headers.indexOf("status");
        if (statusColIdx !== -1) {
          // If status column exists, set it to "hidden"
          const rowIndex = foundRowIndex;
          const existingRow = lessonRows[rowIndex - 1];
          const updatedRow = [...existingRow];
          updatedRow[statusColIdx] = "hidden";

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Lessons!A${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: {
              values: [updatedRow]
            }
          });
          return res.status(200).json({ success: true, message: "Đã ẩn bài học (đặt status=hidden)" });
        } else {
          // If no status column, delete row entirely from the sheet
          const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
          const sheet = spreadsheet.data.sheets.find(s => s.properties.title === "Lessons");
          if (!sheet) {
            return res.status(500).json({ error: "Không tìm thấy tab Lessons trong spreadsheet" });
          }
          const sheetId = sheet.properties.sheetId;

          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  deleteDimension: {
                    range: {
                      sheetId,
                      dimension: "ROWS",
                      startIndex: foundRowIndex - 1, // 0-based inclusive
                      endIndex: foundRowIndex        // 0-based exclusive
                    }
                  }
                }
              ]
            }
          });

          return res.status(200).json({ success: true, message: "Đã xóa bài học khỏi Sheet" });
        }
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Admin Lessons API Error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}
