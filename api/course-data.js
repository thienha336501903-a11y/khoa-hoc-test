import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { credential, course } = req.body || {};
    const courseSlug = String(course || "banh-mi").trim();

    if (!credential) {
      return res.status(401).json({ allowed: false, error: "Missing Google credential" });
    }

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);

    if (!email) {
      return res.status(401).json({ allowed: false, error: "Cannot read Gmail" });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({ allowed: false, error: "Missing GOOGLE_SHEET_ID" });
    }

    const sheets = await getSheetsClient();

    const studentRows = await readSheetRange(sheets, spreadsheetId, "Students!A:Z");
    if (studentRows.length < 2) {
      return res.status(403).json({ allowed: false, email, error: "No students found" });
    }

    const studentHeaders = studentRows[0].map(h => String(h).trim());
    const students = studentRows.slice(1).map(row => rowToObject(studentHeaders, row));

    const found = students.find(s =>
      normalizeEmail(s.gmail) === email &&
      String(s.course || "").trim() === courseSlug &&
      String(s.status || "").trim().toLowerCase() === "active"
    );

    if (!found) {
      return res.status(403).json({ allowed: false, email });
    }

    const lessonRows = await readSheetRange(sheets, spreadsheetId, "Lessons!A:Z");
    if (lessonRows.length < 2) {
      return res.status(200).json({ allowed: true, email, lessons: [] });
    }

    const lessonHeaders = lessonRows[0].map(h => String(h).trim());
    const lessons = lessonRows
      .slice(1)
      .map(row => rowToObject(lessonHeaders, row))
      .filter(l => String(l.course || "").trim() === courseSlug)
      .sort((a, b) => Number(a.lesson || 0) - Number(b.lesson || 0));

    let courseInfo = {};
    try {
      const configRows = await readSheetRange(sheets, spreadsheetId, "Config!A:B");
      configRows.forEach(row => {
        if (row[0]) courseInfo[String(row[0]).trim()] = row[1] ? String(row[1]).trim() : "";
      });
    } catch (e) {
      courseInfo = {};
    }

    return res.status(200).json({
      allowed: true,
      email,
      course: courseSlug,
      courseInfo,
      lessons
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
