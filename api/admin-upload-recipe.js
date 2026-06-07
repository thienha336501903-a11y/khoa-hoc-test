import {
  getAdminOAuthClients,
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

    const { course, lesson, title, text, fileData, fileName, accessToken } = req.body || {};
    const folderId = process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "";

    if (!course || !lesson || !title) {
      return res.status(400).json({ error: "Missing course, lesson, or title parameters" });
    }

    let content = "";
    if (fileData) {
      try {
        content = Buffer.from(fileData, "base64").toString("utf8").trim();
      } catch (err) {
        return adminError(res, 400, "File công thức không phải base64 hợp lệ", err, {
          api: "admin-upload-recipe",
          fileName: fileName || ""
        });
      }
    } else if (text) {
      content = String(text).trim();
    }

    if (!content) {
      return res.status(400).json({ error: "Nội dung công thức trống" });
    }

    const { drive, docs, tokenInfo } = await getAdminOAuthClients(accessToken, adminEmail);
    const ownerEmail = tokenInfo.email || adminEmail;
    const docName = `${course} - ${lesson} - ${title}`;

    const fileMetadata = {
      name: docName,
      mimeType: "application/vnd.google-apps.document"
    };

    if (folderId) {
      fileMetadata.parents = [folderId.trim()];
    }

    const docFile = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id, owners(emailAddress)",
      supportsAllDrives: true
    });

    const documentId = docFile.data.id;
    if (!documentId) {
      throw new Error("Failed to create Google Doc in Drive");
    }

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
      documentId,
      ownerEmail,
      authMode: "admin_oauth"
    });
  } catch (err) {
    return adminError(res, err.status || 500, "Tạo Google Docs công thức thất bại", err, {
      api: "admin-upload-recipe",
      course: req.body?.course || "",
      lesson: req.body?.lesson || "",
      title: req.body?.title || "",
      folderId: process.env.GOOGLE_DRIVE_RECIPE_FOLDER_ID || "",
      usesAdminOAuth: true
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
