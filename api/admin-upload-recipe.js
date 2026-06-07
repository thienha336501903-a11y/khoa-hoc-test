import {
  getDriveClient,
  getDocsClient,
  getAdminEmailFromRequest
} from "./admin-utils.js";

export default async function handler(req, res) {
  try {
    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return res.status(401).json({ error: "Unauthorized: Admin access required" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { course, lesson, title, text, fileData, fileName } = req.body || {};

    if (!course || !lesson || !title) {
      return res.status(400).json({ error: "Missing course, lesson, or title parameters" });
    }

    let content = "";
    if (fileData) {
      try {
        content = Buffer.from(fileData, "base64").toString("utf8").trim();
      } catch (err) {
        return res.status(400).json({ error: "Invalid base64 file data" });
      }
    } else if (text) {
      content = String(text).trim();
    }

    if (!content) {
      return res.status(400).json({ error: "Nội dung công thức trống" });
    }

    const drive = await getDriveClient();
    const docs = await getDocsClient();

    const folderId = process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID;
    const docName = `${course} - ${lesson} - ${title}`;

    // 1. Create a Google Doc file inside the folder (if specified)
    const fileMetadata = {
      name: docName,
      mimeType: "application/vnd.google-apps.document"
    };

    if (folderId) {
      fileMetadata.parents = [folderId.trim()];
    }

    const docFile = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id"
    });

    const documentId = docFile.data.id;
    if (!documentId) {
      throw new Error("Failed to create Google Doc in Drive");
    }

    // 2. Insert content into the Google Doc
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              index: 1,
              text: content
            }
          }
        ]
      }
    });

    // 3. Share permissions so the system/anyone can view it
    await drive.permissions.create({
      fileId: documentId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    const recipeUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    return res.status(200).json({
      success: true,
      recipeUrl,
      documentId
    });

  } catch (err) {
    console.error("Admin Upload Recipe Error:", err);
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

