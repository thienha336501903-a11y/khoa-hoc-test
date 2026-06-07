// api/admin-courses.js — REBUILT CLEAN 2026-06-07
// Purpose: Read course list and manage Config tab in Google Sheet.
// Uses Service Account (Sheets only). No Drive/Docs involved.

import { getAdminFromRequest, getSheetsClient, errResponse } from "./admin-utils.js";

export default async function handler(req, res) {
  try {
    // ── Auth check ────────────────────────────────────────────────────────────
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return errResponse(res, 401, {
        error: "Chưa đăng nhập admin",
        hint: "Vui lòng đăng nhập lại.",
      });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return errResponse(res, 500, {
        error: "Thiếu GOOGLE_SHEET_ID trong cấu hình Vercel",
        hint: "Thêm biến môi trường GOOGLE_SHEET_ID.",
      });
    }

    const sheets = await getSheetsClient();

    // ── GET: Read courses list + Config ───────────────────────────────────────
    if (req.method === "GET") {
      // 1. Get unique course slugs from Lessons tab
      let courses = [];
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Lessons!A:A",
        });
        const rows = result.data.values || [];
        if (rows.length >= 2) {
          // rows[0] is the header row, skip it
          const slugSet = new Set();
          for (let i = 1; i < rows.length; i++) {
            const slug = String(rows[i][0] || "").trim();
            if (slug) slugSet.add(slug);
          }
          courses = Array.from(slugSet);
        }
      } catch (err) {
        console.warn("[admin-courses] Could not read Lessons tab:", err.message);
        // Provide sensible defaults so the UI still works
        courses = ["banh-mi"];
      }

      // 2. Read Config tab (key/value pairs)
      let config = {};
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Config!A:B",
        });
        const rows = result.data.values || [];
        for (const row of rows) {
          if (row[0]) config[String(row[0]).trim()] = String(row[1] || "").trim();
        }
      } catch (err) {
        console.warn("[admin-courses] Could not read Config tab:", err.message);
      }

      return res.status(200).json({ success: true, courses, config });
    }

    // ── POST: Update Config ───────────────────────────────────────────────────
    if (req.method === "POST") {
      const { action, course, config: newConfig } = req.body || {};

      if (action !== "updateConfig") {
        return errResponse(res, 400, { error: "action không hợp lệ" });
      }
      if (!course) {
        return errResponse(res, 400, { error: "Thiếu tham số course" });
      }
      if (!newConfig || typeof newConfig !== "object") {
        return errResponse(res, 400, { error: "Thiếu dữ liệu config" });
      }

      // Read current Config rows
      let configRows = [];
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Config!A:B",
        });
        configRows = result.data.values || [];
      } catch (err) {
        return errResponse(res, 500, {
          error: "Không đọc được tab Config",
          message: err.message,
        });
      }

      // Build a map of key → row index (1-based)
      const keyToRow = {};
      for (let i = 0; i < configRows.length; i++) {
        const key = String(configRows[i][0] || "").trim();
        if (key) keyToRow[key] = i + 1;
      }

      // Determine if we should use prefixed keys (e.g., "banh-mi_title") or global
      const hasPrefixedKeys = Object.keys(keyToRow).some((k) => k.includes("_"));

      for (const [field, value] of Object.entries(newConfig)) {
        const prefixedKey = `${course}_${field}`;
        const globalKey = field;
        const val = String(value || "").trim();

        // Try prefixed key first, then global key
        const targetKey =
          keyToRow[prefixedKey] !== undefined
            ? prefixedKey
            : keyToRow[globalKey] !== undefined && !hasPrefixedKeys
            ? globalKey
            : hasPrefixedKeys
            ? prefixedKey
            : globalKey;

        const existingRow = keyToRow[targetKey];

        if (existingRow !== undefined) {
          // Update existing row
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Config!B${existingRow}`,
            valueInputOption: "RAW",
            requestBody: { values: [[val]] },
          });
        } else {
          // Append new row
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Config!A:B",
            valueInputOption: "RAW",
            requestBody: { values: [[targetKey, val]] },
          });
          configRows.push([targetKey, val]);
          keyToRow[targetKey] = configRows.length;
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-courses] Unexpected error:", err);
    return errResponse(res, 500, {
      error: "Lỗi server trong admin-courses",
      message: err.message,
      hint: "Kiểm tra Service Account có quyền Editor trên Google Sheet không.",
      extra: {
        serviceEmail: process.env.GOOGLE_CLIENT_EMAIL || "(not set)",
        sheetId: process.env.GOOGLE_SHEET_ID || "(not set)",
      },
    });
  }
}
