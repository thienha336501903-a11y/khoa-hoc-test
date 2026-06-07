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
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents"
    ]
  });
}

export async function getSheetsClient() {
  const auth = getGoogleAuthWrite();
  return google.sheets({ version: "v4", auth });
}

export async function getDriveClient() {
  const auth = getGoogleAuthWrite();
  return google.drive({ version: "v3", auth });
}

export async function getDocsClient() {
  const auth = getGoogleAuthWrite();
  return google.docs({ version: "v1", auth });
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
