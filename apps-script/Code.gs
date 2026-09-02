/**
 * Saiyai Dashboard — Google Drive backend (Google Apps Script)
 * -----------------------------------------------------------------
 * รับข้อมูลรายงานจากเว็บ แล้วเก็บลง Google Drive:
 *   - แยกโฟลเดอร์ต่อ 1 งาน  ชื่อโฟลเดอร์ = "รหัสเลขงาน สถานที่ปฏิบัติงาน"
 *   - ถ้ามีรื้อสายกลับ จะสร้างโฟลเดอร์ย่อย "รื้อสายกลับ" ในงานนั้น
 *   - บันทึกรูปงาน + ไฟล์สรุปรายงาน (.txt) + ไฟล์ข้อมูลดิบ (report.json)
 *
 * วิธี deploy:
 *   1. ไปที่ https://script.google.com  → New project
 *   2. ลบโค้ดเดิม วางไฟล์นี้ทั้งหมด แล้ว Save
 *   3. Deploy → New deployment → เลือก type "Web app"
 *        - Execute as: Me
 *        - Who has access: Anyone
 *   4. Authorize/อนุญาตสิทธิ์ Drive แล้วคัดลอก "Web app URL" (ลงท้าย /exec)
 *   5. นำ URL ไปวางในหน้า "ตั้งค่า" ของเว็บ Saiyai
 */

// โฟลเดอร์ปลายทางบน Google Drive (จาก URL ที่ให้มา)
var PARENT_FOLDER_ID = "1IEpgyCOQR1yoedUgfN7DoQ85lzZMOHAL";
var INDEX_NAME = "_saiyai_index.json"; // ไฟล์ดัชนีกลาง (สรุปทุกงาน) เพื่อให้ทุกเครื่องเห็นชุดเดียวกัน

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === "list") {
    var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
    return jsonOut({ ok: true, reports: readIndex(parent) });
  }
  return jsonOut({ ok: true, service: "Saiyai Drive endpoint" });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === "delete") return handleDelete(data);
    var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);

    // ---- โฟลเดอร์ของงาน : "รหัสเลขงาน สถานที่ปฏิบัติงาน" ----
    var folderName = [data.jobCode, data.jobName]
      .filter(function (x) { return x && String(x).trim(); })
      .join(" ").trim();
    folderName = folderName.replace(/[\/\\]/g, "-") || ("งานไม่ระบุชื่อ " + new Date().getTime());

    // ถ้าเป็นการแก้ไขงานเดิม (id เดิมมีในดัชนี) ให้ใช้โฟลเดอร์เดิมแล้วเปลี่ยนชื่อ
    var existing = findIndexEntry(parent, data.id);
    var jobFolder;
    if (existing && existing.folderId) {
      try { jobFolder = DriveApp.getFolderById(existing.folderId); if (jobFolder.getName() !== folderName) jobFolder.setName(folderName); }
      catch (e) { jobFolder = getOrCreateFolder(parent, folderName); }
    } else {
      jobFolder = getOrCreateFolder(parent, folderName);
    }

    // batch id กันไฟล์ซ้ำเวลากดซิงค์ใหม่ (idempotent)
    var batch = String(data.created || new Date().toISOString()).replace(/[^0-9A-Za-z]/g, "").slice(0, 16);

    // ---- ไฟล์สรุปรายงาน + ข้อมูลดิบ (เขียนทับเสมอ เพื่อรองรับการแก้ไข) ----
    writeFile(jobFolder, "รายงาน_" + batch + ".txt", buildSummary(data), "text/plain");
    writeFile(jobFolder, "report_" + batch + ".json", JSON.stringify(data, null, 2), "application/json");

    // ---- รูปงาน ----
    (data.workImages || []).forEach(function (url, i) {
      saveImage(jobFolder, url, "งาน_" + batch + "_" + pad(i + 1));
    });

    // ---- รื้อสายกลับ → โฟลเดอร์ย่อย ----
    if (data.removeCable === "yes") {
      var sub = getOrCreateFolder(jobFolder, "รื้อสายกลับ");
      if (data.removeDetail) {
        createIfMissing(sub, "รายละเอียดรื้อกลับ_" + batch + ".txt", String(data.removeDetail), "text/plain");
      }
      (data.removeImages || []).forEach(function (url, i) {
        saveImage(sub, url, "รื้อกลับ_" + batch + "_" + pad(i + 1));
      });
    }

    // ---- อัปเดตดัชนีกลาง (กันซ้ำด้วย id) ----
    var lock = LockService.getScriptLock();
    try { lock.waitLock(20000); } catch (le) {}
    try {
      var idx = readIndex(parent);
      var entry = summaryEntry(data, jobFolder);
      var key = String(data.id || batch);
      entry.id = key;
      idx = idx.filter(function (x) { return String(x.id) !== key; });
      idx.unshift(entry);
      writeIndex(parent, idx);
    } finally { try { lock.releaseLock(); } catch (le2) {} }

    return jsonOut({ ok: true, folderId: jobFolder.getId(), folderUrl: jobFolder.getUrl() });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function handleDelete(data) {
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (le) {}
  try {
    var idx = readIndex(parent);
    var key = String(data.id || "");
    var entry = idx.filter(function (x) { return String(x.id) === key; })[0];
    idx = idx.filter(function (x) { return String(x.id) !== key; });
    writeIndex(parent, idx);
    if (entry && entry.folderId) {
      try { DriveApp.getFolderById(entry.folderId).setTrashed(true); } catch (e) {}
    }
    return jsonOut({ ok: true });
  } finally { try { lock.releaseLock(); } catch (le2) {} }
}

// สรุปงาน (ไม่รวมรูป base64) สำหรับเก็บลงดัชนี
function summaryEntry(d, folder) {
  return {
    jobCode: d.jobCode || "", jobName: d.jobName || "", jobDate: d.jobDate || "", jobTime: d.jobTime || "", created: d.created || new Date().toISOString(),
    urgentOnly: !!d.urgentOnly,
    folderId: folder.getId(), folderUrl: folder.getUrl(),
    connectors: d.connectors || [], cables: d.cables || [], loops: d.loops || [],
    spliceOfc: d.spliceOfc || "", splicePoints: d.splicePoints || "",
    removeCable: d.removeCable || "no", removeDetail: d.removeDetail || "", detail: d.detail || "",
    workCount: (d.workCount != null ? d.workCount : (d.workImages || []).length),
    removeCount: (d.removeCount != null ? d.removeCount : (d.removeImages || []).length),
    editLog: d.editLog || [],
    synced: true
  };
}

function findIndexEntry(parent, id) {
  if (id == null) return null;
  var idx = readIndex(parent), key = String(id);
  return idx.filter(function (x) { return String(x.id) === key; })[0] || null;
}

function writeFile(folder, name, content, mime) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(content);
  else folder.createFile(name, content, mime);
}

function readIndex(parent) {
  var it = parent.getFilesByName(INDEX_NAME);
  if (!it.hasNext()) return [];
  try { return JSON.parse(it.next().getBlob().getDataAsString("UTF-8")) || []; } catch (e) { return []; }
}

function writeIndex(parent, arr) {
  var content = JSON.stringify(arr);
  var it = parent.getFilesByName(INDEX_NAME);
  if (it.hasNext()) it.next().setContent(content);
  else parent.createFile(INDEX_NAME, content, "application/json");
}

/* ---------------- helpers ---------------- */

function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function createIfMissing(folder, name, content, mime) {
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(name, content, mime);
}

function saveImage(folder, dataUrl, baseName) {
  if (!dataUrl) return;
  var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  var mime = m ? m[1] : "image/jpeg";
  var b64 = m ? m[2] : dataUrl;
  var ext = mime.indexOf("png") > -1 ? ".png" : (mime.indexOf("webp") > -1 ? ".webp" : ".jpg");
  var name = baseName + ext;
  if (folder.getFilesByName(name).hasNext()) return; // กันซ้ำ
  var bytes = Utilities.base64Decode(b64);
  var blob = Utilities.newBlob(bytes, mime, name);
  folder.createFile(blob);
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function buildSummary(d) {
  var L = [];
  L.push("รายงานการทำงาน — Saiyai");
  L.push("=======================================");
  L.push("รหัสเลขงาน : " + (d.jobCode || "-"));
  L.push("สถานที่ปฏิบัติงาน     : " + (d.jobName || "-"));
  L.push("วันที่/เวลา : " + (d.jobDate || "-") + (d.jobTime ? " " + d.jobTime + " น." : ""));
  if (d.urgentOnly) L.push("ประเภท : *** เบิกเฉพาะค่าเร่งด่วน ***");
  L.push("บันทึกเมื่อ : " + (d.created || "-"));
  L.push("");

  if ((d.connectors || []).length) {
    L.push("[ชื่อหัวต่อ]");
    d.connectors.forEach(function (c, i) {
      L.push("  " + (i + 1) + ". " + (c.name || "-") + (c.coord ? "  พิกัด " + c.coord : ""));
    });
    L.push("");
  }
  if ((d.cables || []).length) {
    L.push("[พาดสายใหม่]");
    d.cables.forEach(function (c, i) {
      L.push("  " + (i + 1) + ". OFC " + (c.ofc || "-") + " CORE, Drum " + (c.drum || "-") +
        ", ML " + (c.ml || "-") + ", " + (c.len || "0") + " M.");
    });
    L.push("");
  }
  if ((d.loops || []).length) {
    L.push("[ร่นสาย (Loop)]");
    d.loops.forEach(function (l, i) {
      L.push("  " + (i + 1) + ". ML " + (l.ml || "-") + ", " + (l.len || "0") + " M.");
    });
    L.push("");
  }
  if (d.spliceOfc || d.splicePoints) {
    L.push("[จุดตัดต่อ/ตัดต่อใหม่]");
    L.push("  OFC " + (d.spliceOfc || "-") + " CORE, " + (d.splicePoints || "0") + " จุด");
    L.push("");
  }
  L.push("[การรื้อสายกลับ] : " + (d.removeCable === "yes" ? "มีรื้อสายกลับ" : "ไม่มีสายรื้อกลับ"));
  if (d.removeCable === "yes" && d.removeDetail) L.push("  " + d.removeDetail);
  L.push("");
  if (d.detail) { L.push("[รายละเอียดการทำงาน]"); L.push(d.detail); L.push(""); }
  var wc = (d.workCount != null ? d.workCount : (d.workImages || []).length);
  var rc = (d.removeCount != null ? d.removeCount : (d.removeImages || []).length);
  L.push("รูปงาน " + wc + " รูป" + (d.removeCable === "yes" ? ", รูปรื้อกลับ " + rc + " รูป" : ""));

  if ((d.editLog || []).length) {
    L.push("");
    L.push("=======================================");
    L.push("[ประวัติการแก้ไข]");
    d.editLog.forEach(function (ed) {
      L.push("• แก้ไขวันที่ " + (ed.date || "-"));
      (ed.changes || []).forEach(function (c) { L.push("    - " + c); });
    });
  }
  return L.join("\n");
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
