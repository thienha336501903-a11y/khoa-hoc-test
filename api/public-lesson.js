import { google } from "googleapis";

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

function getGoogleAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets", // Required for writing view count
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

function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

function getGoogleDocId(url) {
  const text = String(url || "");
  const match = text.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  return match ? match[1] : "";
}

function getGoogleDriveFileId(input) {
  const text = extractIframeSrc(String(input || "")).trim();
  let match = text.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (match) return match[1];
  match = text.match(/[?&]id=([^&#]+)/);
  if (match) return match[1];
  return "";
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
      `Drive blocks download for this file. fileId=${fileId}; name=${name}; mimeType=${mimeType}; canDownload=false.`
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
      `${err.message}; fileId=${fileId}; name=${name}; mimeType=${mimeType}; canDownload=${String(canDownload)}`
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

function columnIndexToLabel(index) {
  let label = "";
  let temp = index;
  while (temp >= 0) {
    label = String.fromCharCode((temp % 26) + 65) + label;
    temp = Math.floor(temp / 26) - 1;
  }
  return label;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { course, lesson } = req.body || {};
  const courseSlug = String(course || "").trim();
  const lessonNum = String(lesson || "").trim();

  if (!courseSlug || !lessonNum) {
    return res.status(400).json({ success: false, error: "Thiếu thông tin course hoặc lesson" });
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    return res.status(500).json({ success: false, error: "Thiếu cấu hình GOOGLE_SHEET_ID" });
  }

  try {
    const sheets = await getSheetsClient();

    // Đọc dữ liệu tab Lessons
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Lessons!A:Z",
    });
    const rows = result.data.values || [];

    if (rows.length < 1) {
      return res.status(500).json({ success: false, error: "Tab Lessons rỗng" });
    }

    const headers = rows[0].map(h => String(h).trim());
    let viewsColIdx = headers.indexOf("views");

    // Nếu chưa có cột views, tự động khởi tạo
    if (viewsColIdx === -1) {
      viewsColIdx = headers.length;
      const colLabel = columnIndexToLabel(viewsColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Lessons!${colLabel}1`,
        valueInputOption: "RAW",
        requestBody: { values: [["views"]] },
      });
      headers.push("views");
    }

    const courseColIdx = headers.indexOf("course");
    const lessonColIdx = headers.indexOf("lesson");

    if (courseColIdx === -1 || lessonColIdx === -1) {
      return res.status(400).json({
        success: false,
        error: "Tab Lessons thiếu cột 'course' hoặc 'lesson'"
      });
    }

    // Tìm bài học khớp
    let foundRowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (
        String(row[courseColIdx] || "").trim() === courseSlug &&
        String(row[lessonColIdx] || "").trim() === lessonNum
      ) {
        foundRowIdx = i + 1;
        break;
      }
    }

    if (foundRowIdx === -1) {
      return res.status(404).json({
        success: false,
        error: `Không tìm thấy bài học ${lessonNum} của khóa học ${courseSlug}`
      });
    }

    // Tăng lượt xem
    const matchedRow = rows[foundRowIdx - 1];
    const currentViewsVal = matchedRow[viewsColIdx] ? String(matchedRow[viewsColIdx]).trim() : "";
    const currentViews = parseInt(currentViewsVal, 10) || 0;
    const newViews = currentViews + 1;

    // Ghi đè vào Google Sheet
    const targetColLabel = columnIndexToLabel(viewsColIdx);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Lessons!${targetColLabel}${foundRowIdx}`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(newViews)]] },
    });

    // Tạo đối tượng lesson
    const lessonObj = rowToObject(headers, matchedRow);
    lessonObj.views = String(newViews); // Đảm bảo trả về lượt xem mới nhất

    // Tải công thức chi tiết
    const lessonWithRecipe = await attachRecipeText(lessonObj);

    return res.status(200).json({
      success: true,
      lesson: lessonWithRecipe
    });

  } catch (err) {
    console.error("[api/public-lesson] Error:", err);
    return res.status(500).json({
      success: false,
      error: "Lỗi hệ thống khi tải bài học",
      detail: err.message
    });
  }
}
