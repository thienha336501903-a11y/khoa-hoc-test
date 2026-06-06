import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_COOKIE = "course_session_token";
const API_VERSION = "bunny-secure-embed-2026-06-06";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[String(h).trim()] = row[i] ? String(row[i]).trim() : "";
  });
  return obj;
}

function base64url(input) {
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

function signPayload(payloadBase64, secret = sessionSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64url");
}

function createSessionToken(email) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  const payload = {
    email: normalizeEmail(email),
    exp: expiresAt
  };

  const payloadBase64 = base64url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    sessionToken: `${payloadBase64}.${signature}`,
    sessionExpiresAt: expiresAt
  };
}

function cookieOptions(maxAgeMs) {
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

function parseCookies(req) {
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

function verifySessionToken(token) {
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

    if (!payload.email || !payload.exp) {
      return { valid: false, reason: "bad_session_payload" };
    }

    if (Date.now() > Number(payload.exp)) {
      return { valid: false, reason: "expired_session" };
    }

    return {
      valid: true,
      email: normalizeEmail(payload.email),
      sessionExpiresAt: Number(payload.exp)
    };
  } catch (e) {
    return { valid: false, reason: "unreadable_session_payload" };
  }
}

function getGoogleAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly"
    ]
  });
}

async function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

async function getDriveClient() {
  const auth = getGoogleAuth();
  return google.drive({ version: "v3", auth });
}

async function getDocsClient() {
  const auth = getGoogleAuth();
  return google.docs({ version: "v1", auth });
}

async function readSheetRange(sheets, spreadsheetId, range) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  return result.data.values || [];
}

function getGoogleDocId(url) {
  const text = String(url || "");
  const match = text.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  return match ? match[1] : "";
}

function getGoogleDriveFileId(url) {
  const text = String(url || "");
  let match = text.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (match) return match[1];

  match = text.match(/[?&]id=([^&]+)/);
  return match ? match[1] : "";
}

function publicServiceEmail() {
  return String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
}

function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

function normalizeBunnyEmbedUrl(input) {
  let text = extractIframeSrc(input).replace(/&amp;/g, "&").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, "");

    if (
      host !== "player.mediadelivery.net" &&
      host !== "iframe.mediadelivery.net" &&
      host !== "video.bunnycdn.com"
    ) {
      return "";
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const mode = parts[0];
    const libraryId = parts[1];
    const videoId = parts[2];

    if ((mode !== "embed" && mode !== "play") || !libraryId || !videoId) {
      return "";
    }

    return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`;
  } catch (err) {
    return "";
  }
}

function getBunnyEmbedParts(input) {
  const normalized = normalizeBunnyEmbedUrl(input);
  if (!normalized) return null;

  const match = normalized.match(/iframe\.mediadelivery\.net\/embed\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;

  return {
    libraryId: match[1],
    videoId: match[2],
    normalizedUrl: normalized
  };
}

function signBunnyEmbedUrl(videoUrl) {
  const parts = getBunnyEmbedParts(videoUrl);
  if (!parts) {
    return {
      secureVideoUrl: videoUrl || "",
      videoProvider: "",
      videoAuthStatus: "not_bunny_embed"
    };
  }

  const tokenKey = String(process.env.BUNNY_STREAM_TOKEN_KEY || "").trim();
  if (!tokenKey) {
    return {
      secureVideoUrl: "",
      videoProvider: "bunny_embed",
      videoAuthStatus: "missing_bunny_stream_token_key",
      normalizedVideoUrl: parts.normalizedUrl
    };
  }

  const expires = Math.floor(Date.now() / 1000) + 600;
  const token = crypto
    .createHash("sha256")
    .update(`${tokenKey}${parts.videoId}${expires}`)
    .digest("hex");

  return {
    secureVideoUrl: `${parts.normalizedUrl}?token=${token}&expires=${expires}`,
    videoProvider: "bunny_embed",
    videoAuthStatus: "signed",
    normalizedVideoUrl: parts.normalizedUrl,
    secureVideoExpiresAt: expires
  };
}

function attachSecureVideoUrl(lesson) {
  const videoUrl = lesson.videoUrl || "";
  const signedVideo = signBunnyEmbedUrl(videoUrl);
  return {
    ...lesson,
    ...signedVideo
  };
}

function recipeTextUrl(recipeUrl) {
  const url = String(recipeUrl || "").trim();
  if (!url) return "";

  const docId = getGoogleDocId(url);
  if (docId) {
    return `https://docs.google.com/document/d/${docId}/export?format=txt`;
  }

  const fileId = getGoogleDriveFileId(url);
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  return url;
}

function recipePublicDownloadUrls(recipeUrl) {
  const url = String(recipeUrl || "").trim();
  const fileId = getGoogleDocId(url) || getGoogleDriveFileId(url);
  if (!fileId) return [url].filter(Boolean);

  return [
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
    `https://docs.google.com/uc?export=download&id=${fileId}`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    recipeTextUrl(recipeUrl)
  ].filter(Boolean);
}

function googleDocBodyToText(document) {
  const lines = [];
  const content = document?.body?.content || [];

  content.forEach(block => {
    const paragraph = block.paragraph;
    if (!paragraph) return;

    const text = (paragraph.elements || [])
      .map(element => element.textRun?.content || "")
      .join("")
      .trimEnd();

    if (text.trim()) {
      lines.push(text.trim());
    }
  });

  return lines.join("\n").trim();
}

function htmlToPlainText(html) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (/^google drive|^sign in|quota exceeded|virus scan/i.test(text)) {
    return "";
  }

  return text;
}

async function fetchRecipeTextFromGoogleApi(recipeUrl) {
  const docId = getGoogleDocId(recipeUrl);
  let fileId = docId || getGoogleDriveFileId(recipeUrl);
  if (!fileId) return "";

  const drive = await getDriveClient();
  let metadata = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,exportLinks,shortcutDetails,capabilities,copyRequiresWriterPermission,webViewLink,webContentLink",
    supportsAllDrives: true
  });

  if (metadata.data.mimeType === "application/vnd.google-apps.shortcut" && metadata.data.shortcutDetails?.targetId) {
    fileId = metadata.data.shortcutDetails.targetId;
    metadata = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,exportLinks,shortcutDetails,capabilities,copyRequiresWriterPermission,webViewLink,webContentLink",
      supportsAllDrives: true
    });
  }

  const mimeType = metadata.data.mimeType || "";
  const name = metadata.data.name || "";
  const canDownload = metadata.data.capabilities?.canDownload;

  if (mimeType.startsWith("application/vnd.google-apps.")) {
    try {
      const result = await drive.files.export(
        {
          fileId,
          mimeType: "text/plain"
        },
        {
          responseType: "text"
        }
      );

      return String(result.data || "").trim();
    } catch (err) {
      if (mimeType === "application/vnd.google-apps.document") {
        const docs = await getDocsClient();
        const result = await docs.documents.get({ documentId: fileId });
        return googleDocBodyToText(result.data);
      }

      throw err;
    }
  }

  if (docId) {
    const docs = await getDocsClient();
    const result = await docs.documents.get({ documentId: docId });
    return googleDocBodyToText(result.data);
  }

  if (canDownload === false) {
    throw new Error(
      `Drive blocks download for this file. fileId=${fileId}; name=${name}; mimeType=${mimeType}; serviceEmail=${publicServiceEmail()}; canDownload=false. Convert the recipe file to Google Docs or enable download permission for this service account.`
    );
  }

  try {
    const result = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
        acknowledgeAbuse: true
      },
      {
        responseType: "arraybuffer"
      }
    );

    return Buffer.from(result.data || "").toString("utf8").trim();
  } catch (err) {
    throw new Error(
      `${err.message}; fileId=${fileId}; name=${name}; mimeType=${mimeType}; serviceEmail=${publicServiceEmail()}; canDownload=${String(canDownload)}`
    );
  }
}

async function fetchRecipeTextFromPublicUrl(recipeUrl) {
  const urls = recipePublicDownloadUrls(recipeUrl);
  if (!urls.length) return "";

  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Recipe fetch failed: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (contentType.includes("text/html") && /<html[\s>]/i.test(text)) {
        const plainText = htmlToPlainText(text);
        if (plainText) return plainText;
        throw new Error("Recipe URL returned HTML instead of plain text");
      }

      return text.trim();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Recipe URL could not be fetched");
}

async function fetchRecipeText(recipeUrl) {
  try {
    const text = await fetchRecipeTextFromGoogleApi(recipeUrl);
    if (text) return text;
  } catch (err) {
    const publicText = await fetchRecipeTextFromPublicUrl(recipeUrl).catch(publicErr => {
      throw new Error(`${err.message}; public fallback: ${publicErr.message}`);
    });

    if (publicText) return publicText;
  }

  return fetchRecipeTextFromPublicUrl(recipeUrl);
}

async function attachRecipeText(lesson) {
  if (!lesson.recipeUrl) return lesson;

  try {
    const recipeText = await fetchRecipeText(lesson.recipeUrl);
    return {
      ...lesson,
      recipeText
    };
  } catch (err) {
    return {
      ...lesson,
      recipeText: "",
      recipeTextError: err.message
    };
  }
}

async function getEmailFromGoogleCredential(credential) {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();
  return normalizeEmail(payload?.email);
}

async function getEmailFromRequest({ credential, sessionToken }) {
  if (sessionToken) {
    const session = verifySessionToken(sessionToken);

    if (session.valid && session.email) {
      return {
        email: session.email,
        sessionExpiresAt: session.sessionExpiresAt,
        fromSession: true
      };
    }

    return {
      error: session.reason || "invalid_session",
      fromSession: true
    };
  }

  if (credential) {
    const email = await getEmailFromGoogleCredential(credential);

    if (email) {
      return {
        email,
        fromSession: false
      };
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { credential, sessionToken, course } = req.body || {};
    const courseSlug = String(course || "banh-mi").trim();
    const cookies = parseCookies(req);

    const authInfo = await getEmailFromRequest({
      credential,
      sessionToken: sessionToken || cookies[SESSION_COOKIE]
    });

    if (!authInfo || !authInfo.email) {
      return res.status(401).json({
        allowed: false,
        error: "Missing or expired login session",
        authError: authInfo?.error || "missing_login_session",
        hasSessionToken: Boolean(sessionToken),
        hasSessionCookie: Boolean(cookies[SESSION_COOKIE])
      });
    }

    const email = authInfo.email;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({
        allowed: false,
        error: "Missing GOOGLE_SHEET_ID"
      });
    }

    const sheets = await getSheetsClient();

    const studentRows = await readSheetRange(sheets, spreadsheetId, "Students!A:Z");
    if (studentRows.length < 2) {
      return res.status(403).json({
        allowed: false,
        email,
        error: "No students found"
      });
    }

    const studentHeaders = studentRows[0].map(h => String(h).trim());
    const students = studentRows.slice(1).map(row => rowToObject(studentHeaders, row));

    const found = students.find(s =>
      normalizeEmail(s.gmail) === email &&
      String(s.course || "").trim() === courseSlug &&
      String(s.status || "").trim().toLowerCase() === "active"
    );

    if (!found) {
      return res.status(403).json({
        allowed: false,
        email
      });
    }

    const lessonRows = await readSheetRange(sheets, spreadsheetId, "Lessons!A:Z");
    let lessons = [];

    if (lessonRows.length >= 2) {
      const lessonHeaders = lessonRows[0].map(h => String(h).trim());

      lessons = lessonRows
        .slice(1)
        .map(row => rowToObject(lessonHeaders, row))
        .filter(l => String(l.course || "").trim() === courseSlug)
        .sort((a, b) => Number(a.lesson || 0) - Number(b.lesson || 0))
        .map(attachSecureVideoUrl);

      lessons = await Promise.all(lessons.map(attachRecipeText));
    }

    let courseInfo = {};
    try {
      const configRows = await readSheetRange(sheets, spreadsheetId, "Config!A:B");
      configRows.forEach(row => {
        if (row[0]) {
          courseInfo[String(row[0]).trim()] = row[1] ? String(row[1]).trim() : "";
        }
      });
    } catch (e) {
      courseInfo = {};
    }

    const session = createSessionToken(email);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(session.sessionToken)}; ${cookieOptions(session.sessionExpiresAt - Date.now())}`
    );

    return res.status(200).json({
      allowed: true,
      apiVersion: API_VERSION,
      email,
      course: courseSlug,
      courseInfo,
      lessons,
      sessionToken: session.sessionToken,
      sessionExpiresAt: session.sessionExpiresAt
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      allowed: false,
      error: "Server error",
      detail: err.message
    });
  }
}
