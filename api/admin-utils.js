import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const ADMIN_SESSION_COOKIE = "admin_session_token";

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_ID ||
    "fallback-session-secret"
  ).trim();
}

function sessionSecrets() {
  return [
    process.env.SESSION_SECRET,
    process.env.GOOGLE_CLIENT_ID,
    "fallback-session-secret"
  ]
    .filter(Boolean)
    .map(secret => String(secret).trim())
    .filter((secret, index, secrets) => secret && secrets.indexOf(secret) === index);
}

export function signPayload(payloadBase64, secret = sessionSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64url");
}

export function createAdminSessionToken(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  const payload = {
    email: normalizeEmail(email),
    role: "admin",
    exp: expiresAt
  };

  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    sessionToken: `${payloadBase64}.${signature}`,
    sessionExpiresAt: expiresAt
  };
}

export function cookieOptions(maxAgeMs) {
  const parts = [
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";

  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (e) {
        cookies[key] = value;
      }
    }

    return cookies;
  }, {});
}

export function verifyAdminSessionToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing_session_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "bad_session_format" };
  }

  const [payloadBase64, signature] = parts;
  const validSignature = sessionSecrets().some(secret => {
    const expectedSignature = signPayload(payloadBase64, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });

  if (!validSignature) {
    return { valid: false, reason: "bad_session_signature" };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8")
    );

    if (!payload.email || !payload.exp || payload.role !== "admin") {
      return { valid: false, reason: "bad_session_payload" };
    }

    if (Date.now() > Number(payload.exp)) {
      return { valid: false, reason: "expired_session" };
    }

    const email = normalizeEmail(payload.email);
    if (!ADMIN_EMAILS.includes(email)) {
      return { valid: false, reason: "unauthorized_admin" };
    }

    return {
      valid: true,
      email,
      sessionExpiresAt: Number(payload.exp)
    };
  } catch (e) {
    return { valid: false, reason: "unreadable_session_payload" };
  }
}

export function getGoogleAuthWrite() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets"
    ]
  });
}

export async function getSheetsClient() {
  const auth = getGoogleAuthWrite();
  return google.sheets({ version: "v4", auth });
}

export function getGoogleOAuthClient(accessToken) {
  const auth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export async function verifyAdminGoogleAccessToken(accessToken, expectedEmail = "") {
  if (!accessToken) {
    const err = new Error("Missing Google OAuth access token");
    err.status = 401;
    throw err;
  }

  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let tokenInfo;

  try {
    tokenInfo = await client.getTokenInfo(accessToken);
  } catch (err) {
    err.status = 401;
    err.message = "Phiên Google Drive đã hết hạn. Vui lòng đăng nhập lại.";
    throw err;
  }

  const scopes = Array.isArray(tokenInfo.scopes) ? tokenInfo.scopes : [];
  const email = normalizeEmail(tokenInfo.email || "");
  const expected = normalizeEmail(expectedEmail);

  if (email && !ADMIN_EMAILS.includes(email)) {
    const err = new Error("Gmail OAuth không nằm trong danh sách admin.");
    err.status = 403;
    throw err;
  }

  if (expected && email && email !== expected) {
    const err = new Error("Gmail OAuth không khớp với Gmail admin đang đăng nhập.");
    err.status = 403;
    throw err;
  }

  return {
    email: email || expected,
    scopes
  };
}

export async function getAdminOAuthClients(accessToken, expectedEmail = "") {
  const tokenInfo = await verifyAdminGoogleAccessToken(accessToken, expectedEmail);
  const auth = getGoogleOAuthClient(accessToken);

  return {
    tokenInfo,
    drive: google.drive({ version: "v3", auth }),
    docs: google.docs({ version: "v1", auth })
  };
}

export function buildAdminErrorHint(context, message, code, reason) {
  const haystack = `${context || ""} ${message || ""} ${code || ""} ${reason || ""}`.toLowerCase();

  if (haystack.includes("missing google oauth access token")) {
    return "Admin chưa cấp quyền Google Drive OAuth. Hãy bấm Kết nối Google Drive hoặc thao tác lại Tạo Docs/Upload ảnh và chọn Cho phép.";
  }

  if (haystack.includes("phiên google drive đã hết hạn") || haystack.includes("invalid_token") || haystack.includes("invalid token")) {
    return "Phiên Google Drive đã hết hạn. Vui lòng đăng nhập lại.";
  }

  if (haystack.includes("insufficient") || haystack.includes("insufficient permissions") || haystack.includes("insufficient authentication scopes")) {
    return "Bạn chưa cấp quyền Google Drive cho Admin CMS.";
  }

  if (String(code) === "403" || haystack.includes("caller does not have permission") || haystack.includes("permission")) {
    return "Service Account chưa có quyền Editor với Google Sheet hoặc folder Drive.";
  }

  if (String(code) === "404" || haystack.includes("file not found") || haystack.includes("not found")) {
    return "Folder ID hoặc File ID sai, hoặc Service Account chưa được chia sẻ quyền.";
  }

  if (haystack.includes("invalid_grant") || haystack.includes("google_private_key") || haystack.includes("private key")) {
    return "Kiểm tra biến GOOGLE_PRIVATE_KEY trên Vercel, phải giữ đúng \\n.";
  }

  if (haystack.includes("google_sheet_id")) {
    return "Thiếu hoặc sai GOOGLE_SHEET_ID trong Vercel.";
  }

  if (haystack.includes("google_client_email")) {
    return "Thiếu GOOGLE_CLIENT_EMAIL hoặc Service Account email chưa đúng.";
  }

  if (haystack.includes("admin_emails") || haystack.includes("unauthorized")) {
    return "Thiếu ADMIN_EMAILS hoặc Gmail đăng nhập chưa nằm trong danh sách admin.";
  }

  if (haystack.includes("mediaurls")) {
    return "Sheet thiếu cột mediaUrls. Vào tab Lessons thêm cột mediaUrls.";
  }

  if (haystack.includes("payloadtoolargeerror") || haystack.includes("request entity too large") || haystack.includes("body too large")) {
    return "File tải lên quá lớn. Hãy nén ảnh dưới 4MB.";
  }

  if (haystack.includes("google docs") || haystack.includes("document")) {
    return "Tạo Google Docs lỗi. Kiểm tra quyền Service Account, folder Drive và nội dung công thức.";
  }

  if (haystack.includes("sheets") || haystack.includes("sheet") || haystack.includes("values.update") || haystack.includes("values.append")) {
    return "Google Sheets update lỗi. Kiểm tra GOOGLE_SHEET_ID, tên tab, quyền Editor và cấu trúc cột.";
  }

  if (haystack.includes("drive")) {
    return "Google Drive lỗi. Kiểm tra folder ID và quyền Editor của Service Account.";
  }

  return "Xem message, code, reason và extra để xác định API hoặc cấu hình đang lỗi.";
}

export function adminError(res, statusCode, context, err, extra = {}) {
  const message = err?.message || String(err || "Unknown error");
  const code = err?.code || err?.response?.status || err?.status || "";
  const reason = err?.errors?.[0]?.reason || err?.response?.data?.error || "";
  const googleErrors = err?.errors || err?.response?.data || null;

  const safeExtra = { ...extra };
  delete safeExtra.GOOGLE_PRIVATE_KEY;
  delete safeExtra.BUNNY_STREAM_TOKEN_KEY;
  delete safeExtra.SESSION_SECRET;
  delete safeExtra.privateKey;
  delete safeExtra.sessionSecret;

  console.error(`[ADMIN_ERROR] ${context}`, {
    statusCode,
    message,
    code,
    reason,
    googleErrors,
    extra: safeExtra
  });

  return res.status(statusCode || 500).json({
    success: false,
    error: context,
    message,
    code,
    reason,
    googleErrors,
    extra: safeExtra,
    hint: buildAdminErrorHint(context, message, code, reason)
  });
}

// Admin validation wrapper
export async function getAdminEmailFromRequest(req) {
  const cookies = parseCookies(req);
  const token = req.body?.sessionToken || req.headers?.authorization?.replace("Bearer ", "") || cookies[ADMIN_SESSION_COOKIE];
  
  if (!token) return null;
  
  const result = verifyAdminSessionToken(token);
  if (result.valid) {
    return result.email;
  }
  return null;
}

export function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

export function normalizeBunnyUrl(input) {
  let src = extractIframeSrc(input).replace(/&amp;/g, "&").trim();
  if (!src) return "";

  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");

    if (
      host === "player.mediadelivery.net" ||
      host === "iframe.mediadelivery.net" ||
      host === "video.bunnycdn.com"
    ) {
      const parts = url.pathname.split("/").filter(Boolean);
      const mode = parts[0];
      const libraryId = parts[1];
      const videoId = parts[2];

      if ((mode === "embed" || mode === "play") && libraryId && videoId) {
        return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`;
      }
    }
  } catch (err) {}

  // Fallback regex matching
  const match = src.match(/(?:player|iframe)\.mediadelivery\.net\/(?:embed|play)\/([^/]+)\/([^/?#]+)/);
  if (match) {
    return `https://iframe.mediadelivery.net/embed/${match[1]}/${match[2]}`;
  }
  return src;
}

export function normalizeYouTubeUrl(input) {
  let text = extractIframeSrc(input).replace(/&amp;/g, "&").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (parsed.searchParams.get("v")) {
        return `https://www.youtube.com/watch?v=${parsed.searchParams.get("v")}`;
      }

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
        const id = parts[1];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
    }
  } catch (err) {}

  // Fallback regex
  const match = text.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (match) {
    return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return text;
}
