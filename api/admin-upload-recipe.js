// api/admin-upload-recipe.js — v2: Drive-only, no Docs API (2026-06-07)
// Purpose: Tạo Google Docs công thức bằng Drive API upload text/plain + convert.
// Scope yêu cầu: drive.file ONLY — không cần documents.
// Called ONLY when user explicitly clicks "Tạo Google Docs từ công thức".

import { Readable } from "stream";
import {
  getAdminFromRequest,
  getDriveClientWithToken,
  getSheetsClient,
  errResponse,
} from "./admin-utils.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // ── 1. Verify admin session ───────────────────────────────────────────────
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return errResponse(res, 401, {
        error: "Chưa đăng nhập admin",
        hint: "Vui lòng đăng nhập lại.",
      });
    }

    const { course, lesson, title, text, fileData, fileName, accessToken } = req.body || {};

    // ── 2. Check Drive access token ───────────────────────────────────────────
    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Chưa kết nối Google Drive",
        hint: "Bấm Kết nối Google Drive trong Admin CMS để cấp quyền tạo tài liệu.",
      });
    }

    // ── 3. Validate required fields ───────────────────────────────────────────
    if (!course || !lesson || !title) {
      return errResponse(res, 400, {
        error: "Thiếu course, lesson hoặc title",
        hint: "Hãy điền đầy đủ thông tin bài học trước khi tạo tài liệu công thức.",
      });
    }

    // ── 4. Resolve text content ───────────────────────────────────────────────
    let content = "";
    if (fileData && typeof fileData === "string") {
      try {
        content = Buffer.from(fileData, "base64").toString("utf8").trim();
      } catch {
        return errResponse(res, 400, {
          error: "Dữ liệu file không hợp lệ (base64 decode failed)",
        });
      }
    } else if (text) {
      content = String(text).trim();
    }

    if (!content) {
      return errResponse(res, 400, {
        error: "Nội dung công thức trống",
        hint: "Nhập văn bản vào ô công thức hoặc chọn file .txt.",
      });
    }

    // ── 5. Upload text/plain → convert to Google Docs via Drive API ───────────
    // Chỉ dùng drive.file scope, không cần documents scope.
    // Drive API tự convert khi mimeType requestBody = Google Docs
    // và media mimeType = text/plain.
    const drive = getDriveClientWithToken(accessToken);

    const folderId = (process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "").trim();
    const docName = `${course} - ${lesson} - ${title}`;

    const requestBody = {
      name: docName,
      mimeType: "application/vnd.google-apps.document",
    };
    if (folderId) requestBody.parents = [folderId];

    // Encode content as UTF-8 Buffer → Readable stream
    const contentBuffer = Buffer.from(content, "utf8");
    const bodyStream = Readable.from(contentBuffer);

    let docFile;
    try {
      docFile = await drive.files.create({
        requestBody,
        media: {
          mimeType: "text/plain",
          body: bodyStream,
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
    } catch (err) {
      const gErr = err?.errors?.[0] || {};
      return errResponse(res, 500, {
        error: "Tạo Google Docs công thức thất bại (Drive API)",
        message: err.message,
        code: gErr.code,
        reason: gErr.reason,
        hint: folderId
          ? `Kiểm tra tài khoản admin có quyền tạo file trong folder: ${folderId}`
          : "Thử thêm biến GOOGLE_DRIVE_RECIPE_FOLDER_ID hoặc kiểm tra quyền Drive.",
        extra: { folderId: folderId || "(root)", docName, adminEmail: adminSession.email },
        googleErrors: err?.errors,
      });
    }

    const fileId = docFile.data.id;
    if (!fileId) {
      return errResponse(res, 500, {
        error: "Google Drive API không trả về ID tài liệu",
      });
    }

    // ── 6. Share as public reader ─────────────────────────────────────────────
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch (err) {
      console.warn("[admin-upload-recipe] Could not share doc publicly:", err.message);
      // Not fatal — still return the URL
    }

    // Ưu tiên dùng webViewLink từ API; fallback build từ fileId
    const recipeUrl =
      docFile.data.webViewLink ||
      `https://docs.google.com/document/d/${fileId}/edit`;

    // ── 7. Cập nhật recipeUrl vào Google Sheet (Lessons) ─────────────────────
    let sheetUpdated = false;
    let warning = null;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Hàm phụ chuyển đổi chỉ số cột thành chữ cái cột (A-Z)
    function getColLetter(colIdx) {
      let temp = colIdx;
      let letter = "";
      while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
      }
      return letter;
    }

    if (spreadsheetId) {
      try {
        const sheets = await getSheetsClient();
        const sheetResult = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Lessons!A:Z",
        });
        const rows = sheetResult.data.values || [];

        if (rows.length > 0) {
          const headers = rows[0].map((h) => String(h).trim());
          const courseColIdx = headers.indexOf("course");
          const lessonColIdx = headers.indexOf("lesson");
          const recipeUrlColIdx = headers.indexOf("recipeUrl");

          if (courseColIdx !== -1 && lessonColIdx !== -1 && recipeUrlColIdx !== -1) {
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

            if (foundRowIdx !== -1) {
              const colLetter = getColLetter(recipeUrlColIdx);
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Lessons!${colLetter}${foundRowIdx}`,
                valueInputOption: "RAW",
                requestBody: {
                  values: [[recipeUrl]],
                },
              });
              sheetUpdated = true;
            } else {
              warning = "Đã tạo Docs nhưng chưa tìm thấy bài học để cập nhật Sheet";
            }
          } else {
            warning = "Đã tạo Docs nhưng tab Lessons thiếu cột course, lesson hoặc recipeUrl để cập nhật Sheet";
          }
        } else {
          warning = "Đã tạo Docs nhưng không đọc được dữ liệu từ tab Lessons để cập nhật Sheet";
        }
      } catch (sheetErr) {
        console.error("[admin-upload-recipe] Error updating sheet:", sheetErr);
        warning = `Đã tạo Docs nhưng không thể cập nhật Google Sheet: ${sheetErr.message}`;
      }
    } else {
      warning = "Đã tạo Docs nhưng thiếu GOOGLE_SHEET_ID để cập nhật Sheet";
    }

    return res.status(200).json({
      success: true,
      recipeUrl,
      fileId,
      docName,
      sheetUpdated,
      ...(warning && { warning }),
    });
  } catch (err) {
    console.error("[admin-upload-recipe] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server khi tạo Google Docs",
      message: err.message,
    });
  }
}
