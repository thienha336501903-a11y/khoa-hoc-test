import fs from 'fs';
import path from 'path';

const adminPath = path.join('/Users/phamhung/Downloads/Telegram Desktop/khoa-hoc-test-main', 'admin.html');
let content = fs.readFileSync(adminPath, 'utf8');

// 1. Remove the first testMainVideoUrl definition (after renderLessonList)
// The first definition:
const firstDefTarget = `function testMainVideoUrl() {
  const raw = document.getElementById("fVideoUrl").value.trim();
  const statusEl = document.getElementById("mainVideoStatus");
  if (!raw) { statusEl.innerHTML = ""; return; }

  const bunny = parseBunnyUrl(raw);
  if (bunny.ok) {
    document.getElementById("fVideoUrl").value = bunny.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Bunny hợp lệ — Library: <b>\${bunny.libraryId}</b> | Video: <b>\${bunny.videoId}</b></div>\`;
    return;
  }
  const yt = parseYouTubeUrl(raw);
  if (yt.ok) {
    document.getElementById("fVideoUrl").value = yt.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ YouTube hợp lệ — ID: <b>\${yt.videoId}</b></div>\`;
    return;
  }
  const gd = parseGoogleDriveUrl(raw);
  if (gd.ok) {
    document.getElementById("fVideoUrl").value = raw; // keep raw; backend will normalize
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Google Drive hợp lệ — ID: <b>\${gd.fileId}</b><br><small style="color:#6b7280;">Sẽ phát qua: \${gd.previewUrl}</small></div>\`;
    return;
  }
  statusEl.innerHTML = \`<div class="media-block-status status-err">⚠ Không nhận diện được Bunny, YouTube hoặc Google Drive. Kiểm tra lại link.</div>\`;
}`;

if (content.includes(firstDefTarget)) {
  content = content.replace(firstDefTarget, '');
  console.log("Successfully removed the first duplicate testMainVideoUrl definition!");
} else {
  console.log("Warning: First duplicate testMainVideoUrl target not found. Checking if it's already removed or differs.");
}

// 2. Replace the second testMainVideoUrl definition (lower down)
const secondDefTarget = `// ── MAIN VIDEO URL TESTER ─────────────────────────────────────────────────
function testMainVideoUrl() {
  const raw = document.getElementById("fVideoUrl").value.trim();
  const statusEl = document.getElementById("mainVideoStatus");
  if (!raw) { statusEl.innerHTML = ""; return; }

  const bunny = parseBunnyUrl(raw);
  if (bunny.ok) {
    document.getElementById("fVideoUrl").value = bunny.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Bunny hợp lệ — Library: <b>\${bunny.libraryId}</b> | Video: <b>\${bunny.videoId}</b></div>\`;
    return;
  }
  const yt = parseYouTubeUrl(raw);
  if (yt.ok) {
    document.getElementById("fVideoUrl").value = yt.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ YouTube hợp lệ — ID: <b>\${yt.videoId}</b></div>\`;
    return;
  }
  statusEl.innerHTML = \`<div class="media-block-status status-err">⚠ Không nhận diện được Bunny hoặc YouTube. Kiểm tra lại link.</div>\`;
}`;

const cleanTestMainVideoUrl = `// ── MAIN VIDEO URL TESTER ─────────────────────────────────────────────────
function testMainVideoUrl() {
  const raw = document.getElementById("fVideoUrl").value.trim();
  const statusEl = document.getElementById("mainVideoStatus");
  if (!raw) { statusEl.innerHTML = ""; return; }

  const bunny = parseBunnyUrl(raw);
  if (bunny.ok) {
    document.getElementById("fVideoUrl").value = bunny.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Bunny hợp lệ — Library: <b>\${bunny.libraryId}</b> | Video: <b>\${bunny.videoId}</b></div>\`;
    return;
  }
  const yt = parseYouTubeUrl(raw);
  if (yt.ok) {
    document.getElementById("fVideoUrl").value = yt.url;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ YouTube hợp lệ — ID: <b>\${yt.videoId}</b></div>\`;
    return;
  }
  const gd = parseGoogleDriveUrl(raw);
  if (gd.ok) {
    document.getElementById("fVideoUrl").value = gd.previewUrl;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Google Drive hợp lệ — ID: <b>\${gd.fileId}</b></div>\`;
    return;
  }
  statusEl.innerHTML = \`<div class="media-block-status status-err">⚠ Không nhận diện được Bunny, YouTube hoặc Google Drive. Kiểm tra lại link.</div>\`;
}`;

if (content.includes(secondDefTarget)) {
  content = content.replace(secondDefTarget, cleanTestMainVideoUrl);
  console.log("Successfully updated the main video tester implementation!");
} else {
  console.log("Warning: Second testMainVideoUrl target not found. Checking alternate matching.");
}

// 3. Update checkMediaBlock(id) to include URL normalization
const checkMediaBlockOld = `  // 2. Google Drive
  const gd = parseGoogleDriveUrl(url);
  if (gd.ok) {
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Google Drive hợp lệ — ID: <b>\${gd.fileId}</b></div>\`;
    previewEl.innerHTML = \`
      <div class="aspect-video relative w-full max-w-sm rounded-xl overflow-hidden border border-brandBrown/10 mt-2" style="aspect-ratio:16/9;position:relative;width:100%;max-width:320px;">
        <iframe class="absolute inset-0 w-full h-full border-0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" src="\${gd.previewUrl}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      </div>\`;
    return;
  }`;

const checkMediaBlockNew = `  // 2. Google Drive
  const gd = parseGoogleDriveUrl(url);
  if (gd.ok) {
    urlInput.value = gd.previewUrl;
    statusEl.innerHTML = \`<div class="media-block-status status-ok">✓ Google Drive hợp lệ — ID: <b>\${gd.fileId}</b></div>\`;
    previewEl.innerHTML = \`
      <div class="aspect-video relative w-full max-w-sm rounded-xl overflow-hidden border border-brandBrown/10 mt-2" style="aspect-ratio:16/9;position:relative;width:100%;max-width:320px;">
        <iframe class="absolute inset-0 w-full h-full border-0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" src="\${gd.previewUrl}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      </div>\`;
    return;
  }`;

if (content.includes(checkMediaBlockOld)) {
  content = content.replace(checkMediaBlockOld, checkMediaBlockNew);
  console.log("Successfully updated checkMediaBlock with Drive URL normalization!");
} else {
  console.log("Warning: checkMediaBlockOld target not found.");
}

// 4. Update loadLessonToEditor(idx) to map type 'video' with Google Drive URL to type 'gdrive'
const loadLessonToEditorOld = `  // Render media blocks from mediaUrls
  document.getElementById("mediaBlocksContainer").innerHTML = "";
  if (l.mediaUrls) {
    l.mediaUrls.split("\\n").filter(Boolean).forEach(line => {
      const firstPipe = line.indexOf("|");
      const secondPipe = line.indexOf("|", firstPipe + 1);
      if (firstPipe === -1 || secondPipe === -1) return;
      const type  = line.slice(0, firstPipe).trim();
      const title = line.slice(firstPipe + 1, secondPipe).trim();
      const url   = line.slice(secondPipe + 1).trim();
      addMediaBlock(type, title, url);
    });
  }`;

const loadLessonToEditorNew = `  // Render media blocks from mediaUrls
  document.getElementById("mediaBlocksContainer").innerHTML = "";
  if (l.mediaUrls) {
    l.mediaUrls.split("\\n").filter(Boolean).forEach(line => {
      const firstPipe = line.indexOf("|");
      const secondPipe = line.indexOf("|", firstPipe + 1);
      if (firstPipe === -1 || secondPipe === -1) return;
      const type  = line.slice(0, firstPipe).trim();
      const title = line.slice(firstPipe + 1, secondPipe).trim();
      const url   = line.slice(secondPipe + 1).trim();
      
      let displayType = type;
      if (type === "video" && isGoogleDriveVideoUrl(url)) {
        displayType = "gdrive";
      }
      addMediaBlock(displayType, title, url);
    });
  }`;

if (content.includes(loadLessonToEditorOld)) {
  content = content.replace(loadLessonToEditorOld, loadLessonToEditorNew);
  console.log("Successfully updated loadLessonToEditor to detect gdrive type!");
} else {
  console.log("Warning: loadLessonToEditorOld target not found.");
}

// 5. Update buildMediaUrls() to map type 'gdrive' back to 'video' for saving
const buildMediaUrlsOld = `    const rawTitle = String(titleInput?.value || "").trim();
    const url      = String(urlInput?.value   || "").trim().replace(/[|\\n\\r]/g, "");

    if (!type || !url) return "";  // url bắt buộc; type bắt buộc

    // Fallback title nếu user bỏ trống
    const safeTitle = (rawTitle.replace(/[|\\n\\r]/g, "-") || (
      type === "video"   ? "Video Bunny"  :
      type === "youtube" ? "Video YouTube" :
      "Ảnh"
    ));

    return \`\${type}|\${safeTitle}|\${url}\`;`;

const buildMediaUrlsNew = `    const rawTitle = String(titleInput?.value || "").trim();
    const url      = String(urlInput?.value   || "").trim().replace(/[|\\n\\r]/g, "");

    if (!type || !url) return "";  // url bắt buộc; type bắt buộc

    // Fallback title nếu user bỏ trống
    const safeTitle = (rawTitle.replace(/[|\\n\\r]/g, "-") || (
      type === "video"   ? "Video Bunny"  :
      type === "youtube" ? "Video YouTube" :
      type === "gdrive"  ? "Video Google Drive" :
      "Ảnh"
    ));

    let saveType = type;
    if (type === "gdrive") {
      saveType = "video";
    }

    return \`\${saveType}|\${safeTitle}|\${url}\`;`;

if (content.includes(buildMediaUrlsOld)) {
  content = content.replace(buildMediaUrlsOld, buildMediaUrlsNew);
  console.log("Successfully updated buildMediaUrls to map gdrive to video!");
} else {
  console.log("Warning: buildMediaUrlsOld target not found.");
}

fs.writeFileSync(adminPath, content, 'utf8');
console.log("Successfully updated admin.html!");
