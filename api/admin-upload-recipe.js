import {
  getDriveClient,
  getDocsClient,
  getAdminEmailFromRequest,
  adminError
} from "./admin-utils.js";

export default async function handler(req, res) {
  try {
    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return adminError(res, 401, "Unauthorized: Admin access required", new Error("Unauthorized"), {
        api: "admin-upload-recipe"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { course, lesson, title, text, fileData, fileName } = req.body || {};
    const folderId = process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "";
    const serviceEmail = process.env.GOOGLE_CLIENT_EMAIL || "";

    if (!serviceEmail) {
      return adminError(res, 500, "Thiếu GOOGLE_CLIENT_EMAIL khi tạo Google Docs", new Error("Missing GOOGLE_CLIENT_EMAIL"), {
        api: "admin-upload-recipe",
        folderId
      });
    }

    if (!process.env.GOOGLE_PRIVATE_KEY) {
      return adminError(res, 500, "Thiếu GOOGLE_PRIVATE_KEY khi tạo Google Docs", new Error("Missing GOOGLE_PRIVATE_KEY"), {
        api: "admin-upload-recipe",
        folderId,
        serviceEmail
      });
    }

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
      fields: "id",
      supportsAllDrives: true
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
      },
      supportsAllDrives: true
    });

    const recipeUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    return res.status(200).json({
      success: true,
      recipeUrl,
      documentId
    });

  } catch (err) {
    return adminError(res, 500, "Tạo Google Docs công thức thất bại", err, {
      api: "admin-upload-recipe",
      course: req.body?.course || "",
      lesson: req.body?.lesson || "",
      title: req.body?.title || "",
      folderId: process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "",
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
