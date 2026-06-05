import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

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
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_CLIENT_ID ||
    "fallback-session-secret"
  );
}

function signPayload(payloadBase64) {
  return crypto
    .createHmac("sha256", sessionSecret())
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

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const expectedSignature = signPayload(payloadBase64);

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);

  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8")
    );

    if (!payload.email || !payload.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;

    return {
      email: normalizeEmail(payload.email),
      sessionExpiresAt: Number(payload.exp)
    };
  } catch (e) {
    return null;
  }
}

async function getSheetsClient() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  return google.sheets({ version: "v4", auth });
}

async function readSheetRange(sheets, spreadsheetId, range) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  return result.data.values || [];
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
    if (session && session.email) {
      return {
        email: session.email,
        sessionExpiresAt: session.sessionExpiresAt,
        fromSession: true
      };
    }
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

    const authInfo = await getEmailFromRequest({ credential, sessionToken });

    if (!authInfo || !authInfo.email) {
      return res.status(401).json({
        allowed: false,
        error: "Missing or expired login session"
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
        .sort((a, b) => Number(a.lesson || 0) - Number(b.lesson || 0));
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

    return res.status(200).json({
      allowed: true,
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
