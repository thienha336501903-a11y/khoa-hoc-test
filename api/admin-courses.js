import { getSheetsClient, getAdminEmailFromRequest, adminError } from "./admin-utils.js";

export default async function handler(req, res) {
  try {
    const adminEmail = await getAdminEmailFromRequest(req);
    if (!adminEmail) {
      return adminError(res, 401, "Unauthorized: Admin access required", new Error("Unauthorized"), {
        api: "admin-courses"
      });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return adminError(res, 500, "Missing GOOGLE_SHEET_ID in environment", new Error("Missing GOOGLE_SHEET_ID"), {
        api: "admin-courses"
      });
    }

    const sheets = await getSheetsClient();

    if (req.method === "GET") {
      // 1. Get unique course slugs from Lessons
      let courses = [];
      try {
        const lessonRowsResult = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Lessons!A:Z"
        });
        const lessonRows = lessonRowsResult.data.values || [];
        if (lessonRows.length >= 2) {
          const headers = lessonRows[0].map(h => String(h).trim().toLowerCase());
          const courseColIdx = headers.indexOf("course");
          if (courseColIdx !== -1) {
            const slugs = new Set();
            for (let i = 1; i < lessonRows.length; i++) {
              const row = lessonRows[i];
              if (row[courseColIdx]) {
                slugs.add(String(row[courseColIdx]).trim());
              }
            }
            courses = Array.from(slugs);
          }
        }
      } catch (err) {
        console.warn("Could not read courses from Lessons sheet:", err.message);
      }

      // If no courses found, default to some standard ones
      if (courses.length === 0) {
        courses = ["banh-mi", "donut", "thach-rau-cau"];
      }

      // 2. Read all config from Config tab
      let config = {};
      try {
        const configRowsResult = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: "Config!A:B"
        });
        const configRows = configRowsResult.data.values || [];
        configRows.forEach(row => {
          if (row[0]) {
            config[String(row[0]).trim()] = row[1] ? String(row[1]).trim() : "";
          }
        });
      } catch (err) {
        console.warn("Could not read Config sheet:", err.message);
      }

      return res.status(200).json({ courses, config });
    }

    if (req.method === "POST") {
      const { action, course, config: newConfig } = req.body || {};

      if (action !== "updateConfig") {
        return res.status(400).json({ error: "Invalid action" });
      }

      if (!course) {
        return res.status(400).json({ error: "Missing course parameter" });
      }

      if (!newConfig || typeof newConfig !== "object") {
        return res.status(400).json({ error: "Missing or invalid config object" });
      }

      // Read current Config tab
      const configRowsResult = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Config!A:B"
      });
      const configRows = configRowsResult.data.values || [];

      // We will update Config keys.
      // For each key-value pair in newConfig (e.g. title, subtitle, heroImage),
      // we check:
      // 1. Is there a `${course}_${key}` in the sheet? If yes, update it.
      // 2. Is there a `${key}` in the sheet? If yes, update it.
      // 3. Otherwise, append a new row for `${course}_${key}` (or `${key}`).
      
      const keysToUpdate = Object.keys(newConfig);

      for (const key of keysToUpdate) {
        const val = String(newConfig[key] || "").trim();
        const coursePrefixedKey = `${course}_${key}`;

        // Find index in configRows
        let foundIndex = -1; // 0-based index of configRows
        let foundKeyName = "";

        for (let i = 0; i < configRows.length; i++) {
          const rowKey = String(configRows[i][0] || "").trim();
          if (rowKey === coursePrefixedKey) {
            foundIndex = i;
            foundKeyName = coursePrefixedKey;
            break;
          }
        }

        // If prefixed key not found, check for global key
        if (foundIndex === -1) {
          for (let i = 0; i < configRows.length; i++) {
            const rowKey = String(configRows[i][0] || "").trim();
            if (rowKey === key) {
              foundIndex = i;
              foundKeyName = key;
              break;
            }
          }
        }

        if (foundIndex !== -1) {
          // Update existing cell
          const rowIndex = foundIndex + 1; // 1-based row index for Sheets range
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Config!B${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: {
              values: [[val]]
            }
          });
          // Update in-memory copy for subsequent keys
          configRows[foundIndex][1] = val;
        } else {
          // Append new key. If the config already has some global titles,
          // let's create a prefixed key to avoid overwriting global ones if multiple courses are active.
          // However, if the sheet seems to use only global keys, we can append `${key}`.
          // Let's check if there are any other course-prefixed keys in the sheet.
          const hasPrefixedKeys = configRows.some(row => 
            row[0] && row[0].includes("_") && !row[0].startsWith("_")
          );

          const finalKeyToAppend = hasPrefixedKeys ? coursePrefixedKey : key;
          
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: "Config!A:B",
            valueInputOption: "RAW",
            requestBody: {
              values: [[finalKeyToAppend, val]]
            }
          });

          // Update in-memory copy
          configRows.push([finalKeyToAppend, val]);
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    return adminError(res, 500, "Admin courses API thất bại", err, {
      api: "admin-courses",
      method: req.method,
      action: req.body?.action || ""
    });
  }
}
