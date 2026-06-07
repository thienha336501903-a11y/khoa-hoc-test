import { Readable } from "stream";
import { getDriveClient, getAdminEmailFromRequest, adminError } from "./admin-utils.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function isValidBase64(input) {
  const text = String(input || "").trim();
  return Boolean(text) && /^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0;
}

export default async function handler(req, res) {
  try {
    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return adminError(res, 401, "Unauthorized: Admin access required", new Error("Unauthorized"), {
        api: "admin-upload-image"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { fileData, fileName, mimeType, course, lesson, title } = req.body || {};
    const folderId = process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID || "";
    const serviceEmail = process.env.GOOGLE_CLIENT_EMAIL || "";

    if (!fileData) {
      return res.status(400).json({ error: "Missing fileData parameter" });
    }

    let cleanData = fileData;
    let cleanMimeType = mimeType || "image/jpeg";

    if (fileData.includes(";base64,")) {
      const parts = fileData.split(";base64,");
      const mimeMatch = parts[0].match(/data:(.*)/);
      if (mimeMatch) {
        cleanMimeType = mimeMatch[1];
      }
      cleanData = parts[1];
    }

    cleanData = String(cleanData || "").trim();

    if (!cleanMimeType.startsWith("image/")) {
      return adminError(res, 400, "File tải lên không phải ảnh", new Error("Invalid image mimeType"), {
        api: "admin-upload-image",
        mimeType: cleanMimeType,
        folderId,
        serviceEmail
      });
    }

    if (!isValidBase64(cleanData)) {
      return adminError(res, 400, "fileData không phải base64 hợp lệ", new Error("Invalid base64 fileData"), {
        api: "admin-upload-image",
        mimeType: cleanMimeType,
        folderId,
        serviceEmail
      });
    }

    // Determine target file name
    let finalFileName = fileName || `image_${Date.now()}.jpg`;
    if (course && lesson && title) {
      const extension = cleanMimeType.split("/")[1] || "jpg";
      finalFileName = `${course} - ${lesson} - ${title}.${extension}`.replace(/[/\\?%*:|"<>]/g, "-");
    }

    const drive = await getDriveClient();

    // Convert base64 data to stream
    const buffer = Buffer.from(cleanData, "base64");
    if (buffer.length > MAX_IMAGE_BYTES) {
      return adminError(res, 413, "File ảnh tải lên quá lớn", new Error("request entity too large"), {
        api: "admin-upload-image",
        fileName: finalFileName,
        mimeType: cleanMimeType,
        sizeBytes: buffer.length,
        maxBytes: MAX_IMAGE_BYTES,
        folderId,
        serviceEmail
      });
    }

    const media = {
      mimeType: cleanMimeType,
      body: Readable.from(buffer)
    };

    const fileMetadata = {
      name: finalFileName
    };

    if (folderId) {
      fileMetadata.parents = [folderId.trim()];
    }

    // 1. Create file on Drive
    const driveFileResult = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, webViewLink, webContentLink",
      supportsAllDrives: true
    });

    const fileId = driveFileResult.data.id;
    if (!fileId) {
      throw new Error("Failed to upload file to Google Drive");
    }

    // 2. Share permissions to anyone as reader
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      },
      supportsAllDrives: true
    });

    // 3. Return view and direct download link
    const imageUrl = `https://drive.google.com/file/d/${fileId}/view`;
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    return res.status(200).json({
      success: true,
      fileId,
      imageUrl,
      directUrl
    });

  } catch (err) {
    return adminError(res, 500, "Upload ảnh lên Google Drive thất bại", err, {
      api: "admin-upload-image",
      course: req.body?.course || "",
      lesson: req.body?.lesson || "",
      title: req.body?.title || "",
      folderId: process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID || "",
      serviceEmail: process.env.GOOGLE_CLIENT_EMAIL || ""
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb"
    }
  }
};
