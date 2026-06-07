import { Readable } from "stream";
import { getDriveClient, getAdminEmailFromRequest } from "./admin-utils.js";

export default async function handler(req, res) {
  try {
    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return res.status(401).json({ error: "Unauthorized: Admin access required" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { fileData, fileName, mimeType, course, lesson, title } = req.body || {};

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

    // Determine target file name
    let finalFileName = fileName || `image_${Date.now()}.jpg`;
    if (course && lesson && title) {
      const extension = cleanMimeType.split("/")[1] || "jpg";
      finalFileName = `${course} - ${lesson} - ${title}.${extension}`.replace(/[/\\?%*:|"<>]/g, "-");
    }

    const drive = await getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_IMAGE_FOLDER_ID;

    // Convert base64 data to stream
    const buffer = Buffer.from(cleanData, "base64");
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
      fields: "id, webViewLink, webContentLink"
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
      }
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
    console.error("Admin Upload Image Error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb"
    }
  }
};

