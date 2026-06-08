// scratch/test_sheet.js
import { getSheetsClient } from "../api/admin-utils.js";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    console.error("Missing GOOGLE_SHEET_ID");
    return;
  }
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Lessons!A:Z",
  });
  const rows = res.data.values || [];
  if (rows.length < 1) {
    console.log("Empty sheet");
    return;
  }
  const headers = rows[0].map(h => String(h).trim());
  const courseCol = headers.indexOf("course");
  const lessonCol = headers.indexOf("lesson");
  const mediaCol = headers.indexOf("mediaUrls");

  console.log("Headers:", headers);
  rows.slice(1).forEach((row, i) => {
    const lessonNum = row[lessonCol];
    const course = row[courseCol];
    if (lessonNum === "9" || lessonNum === "10" || lessonNum === "11") {
      console.log(`Row ${i + 2} - Course: ${course}, Lesson: ${lessonNum}`);
      console.log("mediaUrls Raw:", row[mediaCol]);
      console.log("---------------------------------------");
    }
  });
}

run().catch(console.error);
