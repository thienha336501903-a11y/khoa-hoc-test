// api/admin-auth.js — REBUILT CLEAN 2026-06-07
// Purpose: Verify Google ID token, check ADMIN_EMAILS, issue admin session.
// Does NOT touch Drive or Docs. No OAuth flow here.

import {
  verifyGoogleIdToken,
  verifyAdminSession,
  createAdminSession,
  isAdminEmail,
  normalizeEmail,
  cookieOptions,
  parseCookies,
  errResponse,
} from "./admin-utils.js";

const ADMIN_SESSION_COOKIE = "admin_session_token";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { credential, sessionToken } = req.body || {};
    const cookies = parseCookies(req);
    const existingToken = sessionToken || cookies[ADMIN_SESSION_COOKIE];

    // ── 1. Restore existing session ──────────────────────────────────────────
    if (existingToken && !credential) {
      const session = verifyAdminSession(existingToken);
      if (session) {
        return res.status(200).json({
          success: true,
          email: session.email,
          sessionToken: existingToken,
          sessionExpiresAt: session.expiresAt,
        });
      }
      // Clear expired/invalid cookie
      res.setHeader("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
      return errResponse(res, 401, {
        error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn",
        hint: "Vui lòng đăng nhập lại bằng Google.",
      });
    }

    // ── 2. New login via Google credential ───────────────────────────────────
    if (!credential) {
      return errResponse(res, 400, {
        error: "Thiếu thông tin đăng nhập Google",
        hint: "Vui lòng bấm nút Đăng nhập với Google.",
      });
    }

    let email;
    try {
      email = await verifyGoogleIdToken(credential);
    } catch (err) {
      return errResponse(res, 400, {
        error: "Không thể xác minh tài khoản Google",
        message: err.message,
        hint: "Kiểm tra GOOGLE_CLIENT_ID có khớp với token không.",
      });
    }

    if (!email) {
      return errResponse(res, 400, {
        error: "Không lấy được email từ Google",
      });
    }

    if (!isAdminEmail(email)) {
      return errResponse(res, 403, {
        error: "Tài khoản này không có quyền quản trị.",
        extra: { email },
        hint: `Thêm email vào biến môi trường ADMIN_EMAILS trên Vercel nếu cần.`,
      });
    }

    // Issue session
    const session = createAdminSession(email);
    res.setHeader(
      "Set-Cookie",
      `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(session.token)}; ${cookieOptions(
        session.expiresAt - Date.now()
      )}`
    );

    return res.status(200).json({
      success: true,
      email,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    });
  } catch (err) {
    console.error("[admin-auth] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server khi xác thực admin",
      message: err.message,
    });
  }
}
