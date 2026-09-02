/**
 * Saiyai Dashboard — Google Drive backend (Google Apps Script)
 * -----------------------------------------------------------------
 * รับข้อมูลรายงานจากเว็บ แล้วเก็บลง Google Drive:
 *   - แยกโฟลเดอร์ต่อ 1 งาน  ชื่อโฟลเดอร์ = "รหัสเลขงาน ชื่องาน"
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

function doGet() {
  return jsonOut({ ok: true, service: "Saiyai Drive endpoint" });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);

    // ---- โฟลเดอร์ของงาน : "รหัสเลขงาน ชื่องาน" ----
    var folderName = [data.jobCode, data.jobName]
      .filter(function (x) { return x && String(x).trim(); })
      .join(" ").trim();
    folderName = folderName.replace(/[\/\\]/g, "-") || ("งานไม่ระบุชื่อ " + new Date().getTime());
    var jobFolder = getOrCreateFolder(parent, folderName);

    // batch id กันไฟล์ซ้ำเวลากดซิงค์ใหม่ (idempotent)
    var batch = String(data.created || new Date().toISOString()).replace(/[^0-9A-Za-z]/g, "").slice(0, 16);

    // ---- ไฟล์สรุปรายงาน + ข้อมูลดิบ ----
    createIfMissing(jobFolder, "รายงาน_" + batch + ".txt", buildSummary(data), "text/plain");
    createIfMissing(jobFolder, "report_" + batch + ".json", JSON.stringify(data, null, 2), "application/json");

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

    return jsonOut({ ok: true, folderId: jobFolder.getId(), folderUrl: jobFolder.getUrl() });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
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
  L.push("รายงานประจำวัน — Saiyai");
  L.push("=======================================");
  L.push("รหัสเลขงาน : " + (d.jobCode || "-"));
  L.push("ชื่องาน     : " + (d.jobName || "-"));
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
  L.push("รูปงาน " + ((d.workImages || []).length) + " รูป" +
    (d.removeCable === "yes" ? ", รูปรื้อกลับ " + ((d.removeImages || []).length) + " รูป" : ""));
  return L.join("\n");
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
