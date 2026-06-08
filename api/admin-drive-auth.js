// api/admin-drive-auth.js — REBUILT CLEAN 2026-06-07 (v2: drive.file only)
// Purpose: Verify Gmail admin OAuth access token for Drive.
// Only requires scope: drive.file — no documents scope needed.
// Called ONLY when user explicitly clicks "Kết nối Google Drive".
// Never called on login, course load, or lesson load.

import { getAdminFromRequest, isAdminEmail, normalizeEmail, errResponse } from "./admin-utils.js";

// Scope yêu cầu — chỉ drive.file, không cần documents
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/drive.file";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // ── 1. Verify admin session first ────────────────────────────────────────
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return errResponse(res, 401, {
        error: "Chưa đăng nhập admin",
        hint: "Vui lòng đăng nhập tài khoản admin trước.",
      });
    }

    // ── 2. Check access token presence ───────────────────────────────────────
    const { accessToken } = req.body || {};

    if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Chưa có Google Drive OAuth access token",
        hint: "Hãy bấm Kết nối Google Drive hoặc thao tác lại Tạo Docs/Upload ảnh và chọn Cho phép.",
      });
    }

    // ── 3. Verify token with Google tokeninfo endpoint ────────────────────────
    let tokenInfo;
    try {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
      );
      tokenInfo = await tokenInfoRes.json();
    } catch (err) {
      return errResponse(res, 502, {
        error: "Không thể kiểm tra token với Google",
        message: err.message,
        hint: "Kiểm tra kết nối mạng hoặc thử lại.",
      });
    }

    if (tokenInfo.error) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Access token không hợp lệ hoặc đã hết hạn",
        reason: tokenInfo.error_description || tokenInfo.error,
        hint: "Bấm Kết nối Google Drive để lấy token mới.",
      });
    }

    // ── 4. Verify email matches admin ─────────────────────────────────────────
    const tokenEmail = normalizeEmail(tokenInfo.email);
    if (!isAdminEmail(tokenEmail)) {
      return errResponse(res, 403, {
        error: "Token Drive không thuộc tài khoản admin",
        extra: { tokenEmail, adminEmail: adminSession.email },
        hint: `Token Drive phải thuộc email admin. Đang dùng: ${adminSession.email}`,
      });
    }

    // ── 5. Verify drive.file scope (chỉ cần drive.file, không cần documents) ──
    const scope = String(tokenInfo.scope || "");
    const hasDriveFile =
      scope.includes("drive.file") ||
      scope.includes("https://www.googleapis.com/auth/drive.file");

    if (!hasDriveFile) {
      return res.status(200).json({
        success: false,
        needsOAuth: true,
        error: "Token thiếu quyền drive.file",
        extra: { scope, hasDriveFile },
        hint: `Cần scope: ${REQUIRED_SCOPE}. Hãy bấm Kết nối Google Drive lại để xin đúng quyền.`,
      });
    }

    return res.status(200).json({
      success: true,
      email: tokenEmail,
      scopes: { hasDriveFile },
    });
  } catch (err) {
    console.error("[admin-drive-auth] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server khi kiểm tra Drive OAuth",
      message: err.message,
    });
  }
}
