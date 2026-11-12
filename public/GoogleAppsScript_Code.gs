/**
 * Google Apps Script - บันทึก LOG ประวัติการเข้าใช้งานเว็บลง Google Sheet
 * โปรแกรมจัดแพลนช่าง (PlanAFPL3)
 * สเปรดชีตเป้าหมาย: https://docs.google.com/spreadsheets/d/15s3dk0kyC2T0RP16R29zBKeCgA_Bmh75YDmCNbzMebU/edit?gid=0#gid=0
 *
 * วิธีติดตั้ง (ทำครั้งเดียว 1 นาที):
 * 1. เปิด Google Sheet ลิงก์ด้านบน
 * 2. ไปที่เมนู: ส่วนขยาย (Extensions) > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมดใน Code.gs แล้ววางโค้ดชุดนี้ลงไปแทน
 * 4. กดปุ่มบันทึก (Save 💾)
 * 5. กดปุ่มสีน้ำเงินมุมขวาบน "ทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 *    - เลือกประเภท (Select type): "เว็บแอป" (Web app)
 *    - คำอธิบาย (Description): บันทึก Log เข้าใช้งาน PlanAFPL3
 *    - ดำเนินการในฐานะ (Execute as): "ฉัน" (Me - nuk.cs57@gmail.com)
 *    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): "ทุกคน" (Anyone) **สำคัญมาก ต้องเลือก Anyone**
 * 6. กด "ทำให้ใช้งานได้" (Deploy) แล้วคัดลอก "URL เว็บแอป" (ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 7. นำ URL ไปวางในหน้าเว็บโปรแกรม ตรงป็อปอัป LOG หรือหน้าตั้งค่า แล้วกดบันทึก
 */

function doPost(e) {
  return handleLogRequest(e);
}

function doGet(e) {
  return handleLogRequest(e);
}

function handleLogRequest(e) {
  var lock = LockService.getScriptLock();
  // รอคิวการเขียนชีต 10 วินาที ป้องกันข้อมูลชนกันกรณีมีผู้เข้าใช้งานพร้อมกัน
  lock.tryLock(10000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "AccessLogs";
    var sheet = ss.getSheetByName(sheetName);

    // หากยังไม่มีแผ่นงานชื่อ AccessLogs ให้สร้างใหม่ทันที
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // ตรวจสอบและสร้างหัวตาราง (Headers) หากเป็นชีตว่าง
    if (sheet.getLastRow() === 0) {
      var headers = [
        "วันและเวลา (Timestamp)",
        "วันที่",
        "เวลา",
        "รหัสผู้ใช้ (Session ID)",
        "รหัสเครื่อง (Device ID)",
        "ระบบปฏิบัติการ (OS)",
        "เบราว์เซอร์ (Browser)",
        "กิจกรรม (Action)",
        "URL หน้าเว็บ",
        "หมายเหตุ / จำนวนออนไลน์"
      ];
      sheet.appendRow(headers);

      // ตกแต่งหัวตารางด้วยสีครามสวยงาม
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#4338ca");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      headerRange.setVerticalAlignment("middle");
      sheet.setRowHeight(1, 36);
      sheet.setFrozenRows(1);

      // กำหนดความกว้างคอลัมน์เริ่มต้นให้อ่านง่าย
      sheet.setColumnWidth(1, 180); // Timestamp
      sheet.setColumnWidth(2, 110); // Date
      sheet.setColumnWidth(3, 90);  // Time
      sheet.setColumnWidth(4, 180); // Session ID
      sheet.setColumnWidth(5, 140); // Device ID
      sheet.setColumnWidth(6, 150); // OS
      sheet.setColumnWidth(7, 150); // Browser
      sheet.setColumnWidth(8, 190); // Action
      sheet.setColumnWidth(9, 250); // URL
      sheet.setColumnWidth(10, 180); // Note
    }

    // อ่านข้อมูลจาก POST Payload หรือ GET Parameter
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    // จัดการวันและเวลาปัจจุบันตาม Timezone ประเทศไทย (Asia/Bangkok)
    var now = new Date();
    var thaiDate = Utilities.formatDate(now, "Asia/Bangkok", "dd/MM/yyyy");
    var thaiTime = Utilities.formatDate(now, "Asia/Bangkok", "HH:mm:ss");
    var fullTimestamp = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");

    var sessionId = data.sessionId || data.id || "-";
    var deviceId  = data.deviceId  || data.dev || "-";
    var os        = data.os        || "-";
    var browser   = data.browser   || "-";
    var action    = data.action    || data.type || "เข้าใช้งานหน้าเว็บ (Visit)";
    var pageUrl   = data.url       || data.pageUrl || "-";
    var note      = data.note      || (data.onlineCount ? "ออนไลน์ขณะนั้น: " + data.onlineCount + " คน" : "-");

    // บันทึกแถวข้อมูลใหม่
    sheet.appendRow([
      fullTimestamp,
      thaiDate,
      thaiTime,
      sessionId,
      deviceId,
      os,
      browser,
      action,
      pageUrl,
      note
    ]);

    var lastRow = sheet.getLastRow();
    // จัดตำแหน่งคอลัมน์ให้อยู่ตรงกลางเพื่อความเรียบร้อย
    sheet.getRange(lastRow, 1, 1, 3).setHorizontalAlignment("center");
    sheet.getRange(lastRow, 4, 1, 2).setFontFamily("Courier New");
    sheet.getRange(lastRow, 8, 1, 1).setHorizontalAlignment("center");

    var response = {
      status: "success",
      message: "บันทึก LOG สำเร็จแล้ว",
      timestamp: fullTimestamp,
      row: lastRow
    };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    var errorResponse = {
      status: "error",
      message: error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
