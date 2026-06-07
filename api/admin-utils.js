// api/admin-utils.js — REBUILT CLEAN 2026-06-07
// Service Account: Sheets ONLY (read/write Lessons + Config)
// Gmail Admin OAuth: Drive/Docs ONLY (upload images, create Docs)

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const ADMIN_BUILD_VERSION = "admin-rebuild-clean-2026-06-07-01";
const ADMIN_SESSION_COOKIE = "admin_session_token";
const SESSION_DAYS = 30;

// ─── ADMIN EMAIL LIST ──────────────────────────────────────────────────────────

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return getAdminEmails().includes(normalizeEmail(email));
}

// ─── STRING HELPERS ────────────────────────────────────────────────────────────

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

// ─── SESSION SIGNING ───────────────────────────────────────────────────────────

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_ID ||
    "fallback-secret"
  ).trim();
}

function signPayload(payloadB64, secret = sessionSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
}

export function createAdminSession(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 86400_000;
  const payload = { email: normalizeEmail(email), role: "admin", exp: expiresAt };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

export function verifyAdminSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const secrets = [
    process.env.SESSION_SECRET,
    process.env.GOOGLE_CLIENT_ID,
    "fallback-secret",
  ]
    .filter(Boolean)
    .map((s) => String(s).trim());

  const validSig = secrets.some((s) => {
    const expected = signPayload(payloadB64, s);
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });

  if (!validSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.email || !payload.exp || payload.role !== "admin") return null;
    if (Date.now() > Number(payload.exp)) return null;
    if (!isAdminEmail(payload.email)) return null;
    return { email: normalizeEmail(payload.email), expiresAt: Number(payload.exp) };
  } catch {
    return null;
  }
}

// ─── COOKIE HELPERS ────────────────────────────────────────────────────────────

export function cookieOptions(maxAgeMs) {
  const parts = ["Path=/", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try { acc[key] = decodeURIComponent(val); } catch { acc[key] = val; }
    }
    return acc;
  }, {});
}

// ─── GET ADMIN EMAIL FROM REQUEST ─────────────────────────────────────────────

export function getAdminFromRequest(req) {
  const cookies = parseCookies(req);
  const token =
    req.body?.sessionToken ||
    req.query?.sessionToken ||
    (req.headers?.authorization || "").replace(/^Bearer\s+/i, "") ||
    cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  return verifyAdminSession(token);
}

// ─── SERVICE ACCOUNT — SHEETS ONLY ────────────────────────────────────────────

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

export async function getSheetsClient() {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: "v4", auth });
}

// ─── GOOGLE OAUTH CLIENT — DRIVE/DOCS ONLY ────────────────────────────────────
// accessToken comes from Gmail admin browser OAuth (google.accounts.oauth2)
// Never use Service Account for Drive or Docs.

export function getDriveClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export function getDocsClientWithToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth });
}

// ─── GOOGLE ID TOKEN VERIFY ────────────────────────────────────────────────────

export async function verifyGoogleIdToken(credential) {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return normalizeEmail(payload?.email);
}

// ─── URL NORMALIZERS ───────────────────────────────────────────────────────────

function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const m = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return m ? m[1].trim() : text;
}

export function normalizeBunnyUrl(input) {
  let src = extractIframeSrc(input).replace(/&amp;/g, "&").trim();
  if (!src) return { ok: false, url: "", libraryId: "", videoId: "" };

  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");
    if (
      host === "player.mediadelivery.net" ||
      host === "iframe.mediadelivery.net" ||
      host === "video.bunnycdn.com"
    ) {
      const parts = url.pathname.split("/").filter(Boolean);
      // parts: ["embed", "LIBRARY_ID", "VIDEO_ID"] or ["play", ...]
      const mode = parts[0];
      const libraryId = parts[1];
      const videoId = parts[2];
      if ((mode === "embed" || mode === "play") && libraryId && videoId) {
        return {
          ok: true,
          url: `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`,
          libraryId,
          videoId,
        };
      }
    }
  } catch { /* fallback below */ }

  const m = src.match(
    /(?:player|iframe)\.mediadelivery\.net\/(?:embed|play)\/([^/]+)\/([^/?#\s]+)/
  );
  if (m) {
    return {
      ok: true,
      url: `https://iframe.mediadelivery.net/embed/${m[1]}/${m[2]}`,
      libraryId: m[1],
      videoId: m[2],
    };
  }
  return { ok: false, url: src, libraryId: "", videoId: "" };
}

export function normalizeYouTubeUrl(input) {
  let text = extractIframeSrc(input).replace(/&amp;/g, "&").trim();
  if (!text) return { ok: false, url: "", videoId: "" };

  const extractId = (u) => {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "youtu.be") {
        const id = parsed.pathname.split("/").filter(Boolean)[0];
        if (id) return id;
      }
      if (
        host === "youtube.com" ||
        host === "m.youtube.com" ||
        host === "youtube-nocookie.com"
      ) {
        if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(parts[0]) && parts[1]) return parts[1];
      }
    } catch { /* ignore */ }
    return "";
  };

  let videoId = extractId(text);
  if (!videoId) {
    const m = text.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    if (m) videoId = m[1];
  }

  if (videoId) {
    return { ok: true, url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  }
  return { ok: false, url: text, videoId: "" };
}

// ─── MEDIAURLS SANITIZER ───────────────────────────────────────────────────────
// Each line: type|title|url
// Sanitize title and url to not contain pipe or newline
// Keep newlines BETWEEN items (they are the separators)

export function sanitizeMediaUrls(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const firstPipe = trimmed.indexOf("|");
      if (firstPipe === -1) return "";
      const secondPipe = trimmed.indexOf("|", firstPipe + 1);
      if (secondPipe === -1) return "";
      const type = trimmed.slice(0, firstPipe).trim();
      const title = trimmed.slice(firstPipe + 1, secondPipe).trim().replace(/[|\n\r]/g, "-");
      const url = trimmed.slice(secondPipe + 1).trim().replace(/[|\n\r]/g, "");
      if (!type || !title || !url) return "";
      return `${type}|${title}|${url}`;
    })
    .filter(Boolean)
    .join("\n");
}

// ─── STANDARD ERROR RESPONSE ───────────────────────────────────────────────────

export function errResponse(res, status, opts) {
  const { error, message, code, reason, hint, extra, googleErrors } = opts || {};
  return res.status(status).json({
    success: false,
    error: error || "Unknown error",
    message: message || error || "Unknown error",
    ...(code !== undefined && { code }),
    ...(reason !== undefined && { reason }),
    ...(hint !== undefined && { hint }),
    ...(extra !== undefined && { extra }),
    ...(googleErrors !== undefined && { googleErrors }),
  });
}
