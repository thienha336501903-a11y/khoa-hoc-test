// api/admin-upload-image.js — REBUILT CLEAN 2026-06-07
// Purpose: Upload image to Google Drive using Gmail admin OAuth access token.
// Does NOT use Service Account for Drive.
// Called ONLY when user explicitly chooses to upload an image.

import { Readable } from "stream";
import { getAdminFromRequest, getDriveClientWithToken, errResponse } from "./admin-utils.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

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

    const { fileData, fileName, mimeType, course, lesson, title, accessToken } =
      req.body || {};

    // ── 2. Check Drive access token ───────────────────────────────────────────
    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Chưa kết nối Google Drive",
        hint: "Bấm Kết nối Google Drive trong Admin CMS để cấp quyền upload ảnh.",
      });
    }

    // ── 3. Validate file data ─────────────────────────────────────────────────
    if (!fileData || typeof fileData !== "string") {
      return errResponse(res, 400, {
        error: "Thiếu dữ liệu ảnh (fileData)",
      });
    }

    // Parse base64 data URI or raw base64
    let cleanBase64 = fileData;
    let cleanMimeType = mimeType || "image/jpeg";

    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:([^;]+)/);
      if (mimeMatch) cleanMimeType = mimeMatch[1];
      cleanBase64 = parts[1];
    }

    // Decode and check size
    let buffer;
    try {
      buffer = Buffer.from(cleanBase64, "base64");
    } catch {
      return errResponse(res, 400, { error: "Dữ liệu ảnh không hợp lệ (base64 decode failed)" });
    }

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return errResponse(res, 400, {
        error: `Ảnh quá lớn (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB). Tối đa cho phép 4 MB.`,
        hint: "Nén ảnh nhỏ hơn trước khi upload.",
      });
    }

    // ── 4. Determine file name ────────────────────────────────────────────────
    const ext = cleanMimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    let finalFileName = fileName || `image_${Date.now()}.${ext}`;
    if (course && lesson && title) {
      finalFileName = `${course} - ${lesson} - ${title}.${ext}`.replace(
        /[/\\?%*:|"<>]/g,
        "-"
      );
    }

    // ── 5. Upload to Google Drive via admin OAuth ──────────────────────────────
    const drive = getDriveClientWithToken(accessToken);
    const folderId = (process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID || "").trim();

    const fileMetadata = { name: finalFileName };
    if (folderId) fileMetadata.parents = [folderId];

    let driveFile;
    try {
      driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: { mimeType: cleanMimeType, body: Readable.from(buffer) },
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true,
      });
    } catch (err) {
      const gErr = err?.errors?.[0] || {};
      return errResponse(res, 500, {
        error: "Upload ảnh lên Google Drive thất bại",
        message: err.message,
        code: gErr.code,
        reason: gErr.reason,
        hint: folderId
          ? `Kiểm tra tài khoản admin có quyền upload vào folder: ${folderId}`
          : "Thử thêm GOOGLE_DRIVE_IMAGE_FOLDER_ID hoặc kiểm tra quyền Drive.",
        extra: {
          folderId: folderId || "(root)",
          fileName: finalFileName,
          adminEmail: adminSession.email,
        },
        googleErrors: err?.errors,
      });
    }

    const fileId = driveFile.data.id;
    if (!fileId) {
      return errResponse(res, 500, { error: "Google API không trả về ID file" });
    }

    // ── 6. Share as public reader ─────────────────────────────────────────────
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch (err) {
      console.warn("[admin-upload-image] Could not share file publicly:", err.message);
    }

    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const webViewLink = driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    return res.status(200).json({
      success: true,
      fileId,
      directUrl,
      webViewLink,
    });
  } catch (err) {
    console.error("[admin-upload-image] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server khi upload ảnh",
      message: err.message,
    });
  }
}
