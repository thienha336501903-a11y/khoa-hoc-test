// api/admin-upload-recipe.js — REBUILT CLEAN 2026-06-07
// Purpose: Create Google Doc on Drive using Gmail admin OAuth access token.
// Does NOT use Service Account for Drive/Docs.
// Called ONLY when user explicitly clicks "Tạo Google Docs từ công thức".

import {
  getAdminFromRequest,
  getDriveClientWithToken,
  getDocsClientWithToken,
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

    // ── 5. Create Google Doc via admin OAuth ──────────────────────────────────
    const drive = getDriveClientWithToken(accessToken);
    const docs = getDocsClientWithToken(accessToken);

    const folderId = (process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "").trim();
    const docName = `${course} - ${lesson} - ${title}`;

    const fileMetadata = {
      name: docName,
      mimeType: "application/vnd.google-apps.document",
    };
    if (folderId) fileMetadata.parents = [folderId];

    let docFile;
    try {
      docFile = await drive.files.create({
        requestBody: fileMetadata,
        fields: "id",
        supportsAllDrives: true,
      });
    } catch (err) {
      const gErr = err?.errors?.[0] || {};
      return errResponse(res, 500, {
        error: "Tạo file Google Docs thất bại",
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

    const documentId = docFile.data.id;
    if (!documentId) {
      return errResponse(res, 500, {
        error: "Google API không trả về ID tài liệu",
      });
    }

    // ── 6. Insert content ─────────────────────────────────────────────────────
    try {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        },
      });
    } catch (err) {
      const gErr = err?.errors?.[0] || {};
      return errResponse(res, 500, {
        error: "Ghi nội dung vào Google Docs thất bại",
        message: err.message,
        code: gErr.code,
        reason: gErr.reason,
        extra: { documentId, adminEmail: adminSession.email },
        googleErrors: err?.errors,
      });
    }

    // ── 7. Share as public reader ─────────────────────────────────────────────
    try {
      await drive.permissions.create({
        fileId: documentId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch (err) {
      console.warn("[admin-upload-recipe] Could not share doc publicly:", err.message);
      // Not fatal — still return the URL
    }

    const recipeUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    return res.status(200).json({
      success: true,
      recipeUrl,
      documentId,
      docName,
    });
  } catch (err) {
    console.error("[admin-upload-recipe] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server khi tạo Google Docs",
      message: err.message,
    });
  }
}
