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
    const tokenInfo = await verifyAdminGoogleAccessToken(accessToken, adminEmail);
    const missingScopes = REQUIRED_DRIVE_SCOPES.filter(scope => !tokenInfo.scopes.includes(scope));

    if (missingScopes.length > 0) {
      return adminError(res, 403, "Bạn chưa cấp quyền Google Drive cho Admin CMS", new Error("Insufficient Google OAuth scopes"), {
        api: "admin-drive-auth",
        email: tokenInfo.email || adminEmail,
        requiredScopes: REQUIRED_DRIVE_SCOPES,
        grantedScopes: tokenInfo.scopes,
        missingScopes
      });
    }

    if (tokenInfo.email && !ADMIN_EMAILS.includes(tokenInfo.email)) {
      return adminError(res, 403, "Gmail OAuth không nằm trong danh sách admin", new Error("Unauthorized OAuth email"), {
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
    return adminError(res, err.status || 500, "Xác thực Google Drive OAuth thất bại", err, {
      api: "admin-drive-auth"
    });
  }
}
