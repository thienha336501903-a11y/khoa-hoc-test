import { OAuth2Client } from "google-auth-library";
import {
  ADMIN_EMAILS,
  normalizeEmail,
  createAdminSessionToken,
  verifyAdminSessionToken,
  cookieOptions,
  parseCookies,
  adminError
} from "./admin-utils.js";

const ADMIN_SESSION_COOKIE = "admin_session_token";

async function getEmailFromGoogleCredential(credential) {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();
  return normalizeEmail(payload?.email);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { credential, sessionToken } = req.body || {};
    const cookies = parseCookies(req);
    const tokenToVerify = sessionToken || cookies[ADMIN_SESSION_COOKIE];

    // If attempting to verify an existing session
    if (tokenToVerify) {
      const verifyResult = verifyAdminSessionToken(tokenToVerify);
      if (verifyResult.valid) {
        return res.status(200).json({
          allowed: true,
          email: verifyResult.email,
          sessionToken: tokenToVerify,
          sessionExpiresAt: verifyResult.sessionExpiresAt
        });
      } else {
        // Clear expired/invalid cookie
        res.setHeader(
          "Set-Cookie",
          `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
        );
        return res.status(401).json({
          allowed: false,
          error: `Invalid session: ${verifyResult.reason}`
        });
      }
    }

    // If logging in with new Google credential
    if (credential) {
      const email = await getEmailFromGoogleCredential(credential);
      if (!email) {
        return res.status(400).json({
          allowed: false,
          error: "Failed to extract email from Google credential"
        });
      }

      if (!ADMIN_EMAILS.includes(email)) {
        return res.status(403).json({
          allowed: false,
          email,
          error: "Tài khoản này không có quyền quản trị."
        });
      }

      // Generate admin session
      const session = createAdminSessionToken(email);

      res.setHeader(
        "Set-Cookie",
        `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(
          session.sessionToken
        )}; ${cookieOptions(session.sessionExpiresAt - Date.now())}`
      );

      return res.status(200).json({
        allowed: true,
        email,
        sessionToken: session.sessionToken,
        sessionExpiresAt: session.sessionExpiresAt
      });
    }

    return res.status(400).json({
      allowed: false,
      error: "Missing credential or session token"
    });

  } catch (err) {
    return adminError(res, 500, "Admin Google Login thất bại", err, {
      api: "admin-auth",
      hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
      adminEmailsConfigured: ADMIN_EMAILS.length
    });
  }
}
