import {
  ADMIN_EMAILS,
  getAdminEmailFromRequest,
  verifyAdminGoogleAccessToken,
  adminError
} from "./admin-utils.js";

const REQUIRED_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents"
];

function oauthNotConnected(res) {
  return res.status(200).json({
    success: false,
    needsOAuth: true,
    error: "Chua co Google Drive OAuth access token",
    message: "Ban chua cap quyen Google Drive cho Admin CMS. Vui long bam lai va chon Cho phep.",
    hint: "Admin chua cap quyen Google Drive OAuth. Hay bam Ket noi Google Drive hoac thao tac lai Tao Docs/Upload anh va chon Cho phep.",
    extra: {
      api: "admin-drive-auth"
    }
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return adminError(res, 401, "Unauthorized: Admin access required", new Error("Unauthorized"), {
        api: "admin-drive-auth"
      });
    }

    const { accessToken } = req.body || {};
    const cleanAccessToken = String(accessToken || "").trim();

    if (!cleanAccessToken || cleanAccessToken === "undefined" || cleanAccessToken === "null") {
      return oauthNotConnected(res);
    }

    const tokenInfo = await verifyAdminGoogleAccessToken(cleanAccessToken, adminEmail);
    const missingScopes = REQUIRED_DRIVE_SCOPES.filter(scope => !tokenInfo.scopes.includes(scope));

    if (missingScopes.length > 0) {
      return adminError(res, 403, "Ban chua cap quyen Google Drive cho Admin CMS", new Error("Insufficient Google OAuth scopes"), {
        api: "admin-drive-auth",
        email: tokenInfo.email || adminEmail,
        requiredScopes: REQUIRED_DRIVE_SCOPES,
        grantedScopes: tokenInfo.scopes,
        missingScopes
      });
    }

    if (tokenInfo.email && !ADMIN_EMAILS.includes(tokenInfo.email)) {
      return adminError(res, 403, "Gmail OAuth khong nam trong danh sach admin", new Error("Unauthorized OAuth email"), {
        api: "admin-drive-auth",
        email: tokenInfo.email
      });
    }

    return res.status(200).json({
      success: true,
      email: tokenInfo.email || adminEmail,
      scopes: tokenInfo.scopes
    });
  } catch (err) {
    if (String(err?.message || "").includes("Missing Google OAuth access token")) {
      return oauthNotConnected(res);
    }

    return adminError(res, err.status || 500, "Xac thuc Google Drive OAuth that bai", err, {
      api: "admin-drive-auth"
    });
  }
}
