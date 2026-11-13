/**
 * Google Apps Script - บันทึกและดึงข้อมูลทั้งหมดในหน้า "ตั้งค่า / สำรองข้อมูล" (เพิ่ม / ลบ / แก้ไข)
 * โปรแกรมจัดแพลนช่าง (PlanAFPL3)
 * สเปรดชีตเป้าหมาย: https://docs.google.com/spreadsheets/d/1t7pPPKKVBFCdDqbJVqcNWPvX9WQfXpxXfCdBxuUR7Jw/edit?gid=0#gid=0
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 * 1. เปิด Google Sheet ลิงก์ด้านบน
 * 2. ไปที่เมนู: ส่วนขยาย (Extensions) > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดชุดนี้ลงไปแทน
 * 4. กดปุ่มบันทึก (Save 💾)
 * 5. กดปุ่มสีน้ำเงินมุมขวาบน "ทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 *    - เลือกประเภท (Select type): "เว็บแอป" (Web app)
 *    - คำอธิบาย (Description): Sync Settings & Master Data PlanAFPL3
 *    - ดำเนินการในฐานะ (Execute as): "ฉัน" (Me)
 *    - ผู้มีสิทธิ์เข้าถึง (Who has access): "ทุกคน" (Anyone) **สำคัญมาก ต้องเลือก Anyone**
 * 6. กด "ทำให้ใช้งานได้" (Deploy) แล้วคัดลอก "URL เว็บแอป" (ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 7. นำ URL ไปวางในหน้า "ตั้งค่า / สำรองข้อมูล" ของโปรแกรม แล้วกด "บันทึกและเชื่อมต่อ"
 */

var SETTINGS_SHEET_TABS = {
  LOG: "SyncLog",
  TECHS: "Technicians",
  DAYSOFF: "DaysOff",
  ALIASES: "Aliases",
  SETTINGS: "Settings",
  BIG_TITLES: "BigTitles",
  BIG_KW: "BigKeywords",
  EX_PKGS: "ExcludePackages",
  EX_PROVS: "ExcludeProvinces",
  BACKUP: "BackupSnapshot"
};

var SETTING_LABELS = {
  workMin: "เวลาทำงานต่อจุด (นาที)",
  speed: "ความเร็วเฉลี่ย (กม./ชม.)",
  circuity: "ตัวคูณระยะถนน/เส้นตรง",
  maxHouses: "จำนวนบ้านสูงสุด/ช่าง/วัน",
  target: "เป้าหมายงานต่อช่าง/วัน",
  doubleKm: "Double-Up ห่างกันไม่เกิน (กม.)",
  maxZone: "ระยะไกลสุดจากเขตเริ่มงาน (กม.)",
  prefHop: "ระยะต้องการระหว่างงานติดกัน (กม.)",
  maxHop: "ระยะห่างสูงสุดระหว่างงานติดกัน (กม.)",
  maxSpan: "ระยะกระจายสูงสุดทั้งวัน (กม.)",
  maxStart: "งาน S1 ห่างเขตเริ่มไม่เกิน (กม.)",
  doubleSlots: "Slot ที่อนุญาตให้รับงานเบิ้ล",
  excludeBig: "ไม่จัดงานทีมใหญ่ลงแพลน",
  keepPlaybox: "คงงาน PLAYBOX ไว้ในแพลน",
  useRealRoutes: "เปิดใช้งานระยะทางและเวลาขับรถจริง",
  crossPenalty: "ค่าปรับข้ามแม่น้ำเจ้าพระยา",
  hlWords: "คำไฮไลต์พิเศษ"
};

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "getAll";
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "ping") {
      return jsonOut({
        status: "success",
        message: "เชื่อมต่อ Google Sheet สำเร็จ",
        spreadsheetName: ss.getName(),
        timestamp: nowThaiStr()
      });
    }

    if (action === "getBackup") {
      return jsonOut(readFullBackup(ss));
    }

    // Default: getAll (อ่านข้อมูลตั้งค่า ช่าง วันหยุด เงื่อนไขทั้งหมดจากชีต)
    return jsonOut(readAllSettingsData(ss));
  } catch (err) {
    return jsonOut({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = payload.action || "syncAll";

    if (action === "saveBackup") {
      var resBackup = writeFullBackup(ss, payload);
      return jsonOut(resBackup);
    }

    // Default: syncAll (บันทึกทุกหมวดหมู่ลงชีตทันที ทั้ง เพิ่ม / ลบ / แก้ไข)
    var res = writeAllSettingsData(ss, payload);
    return jsonOut(res);
  } catch (err) {
    return jsonOut({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowThaiStr() {
  return Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
}

function getOrCreateTab(ss, name, useFirstSheetIfBlank) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  if (useFirstSheetIfBlank) {
    var first = ss.getSheets()[0];
    if (first) {
      var fn = first.getName();
      if ((fn === "Sheet1" || fn === "แผ่น1") && first.getLastRow() <= 1) {
        first.setName(name);
        return first;
      }
    }
  }
  return ss.insertSheet(name);
}

function writeBatchTable(ss, tabName, headers, rows, headerBg, colWidths, useFirstIfBlank) {
  var sh = getOrCreateTab(ss, tabName, useFirstIfBlank);
  sh.clearContents();

  var allRows = [headers];
  for (var i = 0; i < rows.length; i++) {
    allRows.push(rows[i]);
  }

  var range = sh.getRange(1, 1, allRows.length, headers.length);
  range.setNumberFormat("@"); // ป้องกันตัวเลขหรือวันที่เพี้ยนเป็น format อื่นที่ไม่คาดคิดเมื่อแก้ไข
  range.setValues(allRows);

  // ตกแต่งหัวตาราง
  var hRange = sh.getRange(1, 1, 1, headers.length);
  hRange.setBackground(headerBg || "#4338ca");
  hRange.setFontColor("#ffffff");
  hRange.setFontWeight("bold");
  hRange.setHorizontalAlignment("center");
  hRange.setVerticalAlignment("middle");
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1);

  if (colWidths && colWidths.length) {
    for (var c = 0; c < colWidths.length; c++) {
      if (colWidths[c]) sh.setColumnWidth(c + 1, colWidths[c]);
    }
  }
  return sh;
}

function appendSyncLog(ss, actionLabel, detailText) {
  var sh = getOrCreateTab(ss, SETTINGS_SHEET_TABS.LOG, true);
  if (sh.getLastRow() === 0) {
    var headers = ["วันและเวลา (Timestamp)", "การดำเนินการ (Action)", "รายละเอียดการเปลี่ยนแปลง", "จำนวนช่าง", "จำนวนวันหยุด", "จำนวน Title/แพ็กเกจ"];
    sh.appendRow(headers);
    var hRange = sh.getRange(1, 1, 1, headers.length);
    hRange.setBackground("#1e1b4b");
    hRange.setFontColor("#ffffff");
    hRange.setFontWeight("bold");
    hRange.setHorizontalAlignment("center");
    sh.setRowHeight(1, 34);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 175);
    sh.setColumnWidth(2, 220);
    sh.setColumnWidth(3, 380);
    sh.setColumnWidth(4, 110);
    sh.setColumnWidth(5, 120);
    sh.setColumnWidth(6, 150);
  }
  return sh;
}

function writeAllSettingsData(ss, payload) {
  var ts = nowThaiStr();
  var techs = payload.techs || [];
  var dayOff = payload.dayOff || {};
  var aliases = payload.aliases || [];
  var settings = payload.settings || {};

  // 1. SyncLog (วางไว้แท็บแรก gid=0 เพื่อเห็นประวัติล่าสุดทันที)
  var logSh = appendSyncLog(ss, payload.changeAction, payload.changeDetail);

  // 2. Technicians
  var techRows = techs.map(function(t) {
    return [
      String(t.id || ""),
      String(t.name || ""),
      String(t.zone || ""),
      String(t.homeLat || ""),
      String(t.homeLon || ""),
      String(t.klongFrom != null ? t.klongFrom : ""),
      t.noCross !== false ? "TRUE" : "FALSE",
      t.active !== false ? "TRUE" : "FALSE",
      String(t.line || ""),
      String(t.ref || "")
    ];
  });
  writeBatchTable(
    ss,
    SETTINGS_SHEET_TABS.TECHS,
    ["id", "name", "zone", "homeLat", "homeLon", "klongFrom", "noCross", "active", "line", "ref"],
    techRows,
    "#4f46e5",
    [130, 180, 150, 110, 110, 100, 90, 90, 140, 110],
    false
  );

  // Map techId -> techName สำหรับแท็บ DaysOff
  var techNameMap = {};
  for (var i = 0; i < techs.length; i++) {
    techNameMap[techs[i].id] = techs[i].name;
  }

  // 3. DaysOff
  var offRows = [];
  var offDates = Object.keys(dayOff).sort();
  for (var d = 0; d < offDates.length; d++) {
    var dt = offDates[d];
    var map = dayOff[dt] || {};
    var tids = Object.keys(map);
    for (var j = 0; j < tids.length; j++) {
      if (map[tids[j]]) {
        offRows.push([dt, tids[j], techNameMap[tids[j]] || ""]);
      }
    }
  }
  writeBatchTable(
    ss,
    SETTINGS_SHEET_TABS.DAYSOFF,
    ["date", "techId", "techName"],
    offRows,
    "#d97706",
    [130, 130, 200],
    false
  );

  // 4. Aliases
  var aliasRows = aliases.map(function(a) {
    return [String(a.alias || ""), String(a.district || "")];
  });
  writeBatchTable(
    ss,
    SETTINGS_SHEET_TABS.ALIASES,
    ["alias", "district"],
    aliasRows,
    "#059669",
    [260, 200],
    false
  );

  // 5. Settings (Parameters & Toggles)
  var scalarKeys = [
    "workMin", "speed", "circuity", "maxHouses", "target",
    "doubleKm", "maxZone", "prefHop", "maxHop", "maxSpan",
    "maxStart", "doubleSlots", "excludeBig", "keepPlaybox",
    "useRealRoutes", "crossPenalty", "hlWords"
  ];
  var settingRows = [];
  for (var k = 0; k < scalarKeys.length; k++) {
    var key = scalarKeys[k];
    var val = settings[key];
    var strVal = "";
    if (Array.isArray(val)) {
      strVal = val.join(",");
    } else if (typeof val === "boolean") {
      strVal = val ? "TRUE" : "FALSE";
    } else if (val !== undefined && val !== null) {
      strVal = String(val);
    }
    settingRows.push([key, strVal, SETTING_LABELS[key] || key]);
  }
  writeBatchTable(
    ss,
    SETTINGS_SHEET_TABS.SETTINGS,
    ["key", "value", "description"],
    settingRows,
    "#7c3aed",
    [160, 180, 320],
    false
  );

  // 6. BigTitles
  var bigTitleRows = (settings.bigTitles || []).map(function(x) { return [String(x)]; });
  writeBatchTable(ss, SETTINGS_SHEET_TABS.BIG_TITLES, ["title"], bigTitleRows, "#b45309", [650], false);

  // 7. BigKeywords
  var bigKwRows = (settings.bigKw || []).map(function(x) { return [String(x)]; });
  writeBatchTable(ss, SETTINGS_SHEET_TABS.BIG_KW, ["keyword"], bigKwRows, "#d97706", [320], false);

  // 8. ExcludePackages
  var exPkgRows = (settings.excludePkgs || []).map(function(x) { return [String(x)]; });
  writeBatchTable(ss, SETTINGS_SHEET_TABS.EX_PKGS, ["packageName"], exPkgRows, "#be123c", [580], false);

  // 9. ExcludeProvinces
  var exProvRows = (settings.excludeProvs || []).map(function(x) { return [String(x)]; });
  writeBatchTable(ss, SETTINGS_SHEET_TABS.EX_PROVS, ["province"], exProvRows, "#047857", [240], false);

  // บันทึกประวัติลง SyncLog
  logSh.appendRow([
    ts,
    payload.changeAction || "บันทึกการตั้งค่าทั้งหมด",
    payload.changeDetail || "ซิงก์ข้อมูลจากหน้าเว็บ",
    techRows.length + " คน",
    offRows.length + " รายการ",
    bigTitleRows.length + " / " + exPkgRows.length
  ]);

  return {
    status: "success",
    message: "บันทึกข้อมูลตั้งค่าทั้งหมดลง Google Sheet เรียบร้อยแล้ว",
    timestamp: ts,
    counts: {
      techs: techRows.length,
      daysOff: offRows.length,
      aliases: aliasRows.length,
      bigTitles: bigTitleRows.length,
      excludePkgs: exPkgRows.length,
      excludeProvs: exProvRows.length
    }
  };
}

function parseBoolCell(v, defVal) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = String(v || "").trim().toUpperCase();
  if (!s) return defVal;
  if (s === "TRUE" || s === "1" || s === "YES" || s === "ใช่") return true;
  if (s === "FALSE" || s === "0" || s === "NO" || s === "ไม่") return false;
  return defVal;
}

function formatDateCell(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, "Asia/Bangkok", "yyyy-MM-dd");
  }
  return String(v || "").trim();
}

function readTabRows(ss, tabName) {
  var sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues();
}

function readAllSettingsData(ss) {
  var techVals = readTabRows(ss, SETTINGS_SHEET_TABS.TECHS);
  var settingVals = readTabRows(ss, SETTINGS_SHEET_TABS.SETTINGS);

  if (techVals.length < 2 && settingVals.length < 2) {
    return {
      status: "success",
      initialized: false,
      message: "ยังไม่มีข้อมูลตั้งค่าใน Google Sheet (รอการซิงก์ครั้งแรก)",
      timestamp: nowThaiStr()
    };
  }

  // 1. Technicians
  var techs = [];
  var nameToId = {};
  for (var i = 1; i < techVals.length; i++) {
    var r = techVals[i];
    var id = String(r[0] || "").trim();
    var name = String(r[1] || "").trim();
    if (!name && !id) continue;
    if (!id) id = "t_gs_" + i;
    var tObj = {
      id: id,
      name: name || ("ช่าง " + i),
      zone: String(r[2] || "").trim(),
      homeLat: String(r[3] || "").trim(),
      homeLon: String(r[4] || "").trim(),
      klongFrom: String(r[5] || "").trim() === "" ? "" : Number(r[5]),
      noCross: parseBoolCell(r[6], true),
      active: parseBoolCell(r[7], true),
      line: String(r[8] || "").trim(),
      ref: String(r[9] || "").trim()
    };
    if (isNaN(tObj.klongFrom)) tObj.klongFrom = "";
    techs.push(tObj);
    if (name) nameToId[name] = id;
  }

  // 2. DaysOff
  var dayOff = {};
  var offVals = readTabRows(ss, SETTINGS_SHEET_TABS.DAYSOFF);
  for (var d = 1; d < offVals.length; d++) {
    var dt = formatDateCell(offVals[d][0]);
    var tid = String(offVals[d][1] || "").trim();
    var tname = String(offVals[d][2] || "").trim();
    if (!tid && tname && nameToId[tname]) tid = nameToId[tname];
    if (dt && tid) {
      if (!dayOff[dt]) dayOff[dt] = {};
      dayOff[dt][tid] = true;
    }
  }

  // 3. Aliases
  var aliases = [];
  var aliasVals = readTabRows(ss, SETTINGS_SHEET_TABS.ALIASES);
  for (var a = 1; a < aliasVals.length; a++) {
    var al = String(aliasVals[a][0] || "").trim();
    var dist = String(aliasVals[a][1] || "").trim();
    if (al && dist) aliases.push({ alias: al, district: dist });
  }

  // 4. Settings
  var settings = { _userEditedFilters: true };
  var numKeys = { workMin:1, speed:1, circuity:1, maxHouses:1, target:1, doubleKm:1, maxZone:1, prefHop:1, maxHop:1, maxSpan:1, maxStart:1, crossPenalty:1 };
  var boolKeys = { excludeBig:1, keepPlaybox:1, useRealRoutes:1 };
  for (var s = 1; s < settingVals.length; s++) {
    var k = String(settingVals[s][0] || "").trim();
    var v = settingVals[s][1];
    if (!k) continue;
    if (numKeys[k]) {
      var n = Number(v);
      if (!isNaN(n)) settings[k] = n;
    } else if (boolKeys[k]) {
      settings[k] = parseBoolCell(v, true);
    } else if (k === "doubleSlots") {
      settings[k] = String(v || "").split(",").map(function(x) { return Number(x.trim()); }).filter(function(x) { return !isNaN(x) && x > 0; });
    } else if (k === "hlWords") {
      settings[k] = String(v || "").split(",").map(function(x) { return x.trim(); }).filter(Boolean);
    }
  }

  // 5-8. Lists (อ่านแม้จะว่าง เพื่อให้ลบทั้งหมดได้จริง)
  var readSingleCol = function(tabName) {
    var sh = ss.getSheetByName(tabName);
    if (!sh) return null;
    var last = sh.getLastRow();
    if (last < 2) return [];
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    var out = [];
    for (var idx = 0; idx < vals.length; idx++) {
      var item = String(vals[idx][0] || "").trim();
      if (item) out.push(item);
    }
    return out;
  };

  var bt = readSingleCol(SETTINGS_SHEET_TABS.BIG_TITLES);
  if (bt !== null) settings.bigTitles = bt;

  var bkw = readSingleCol(SETTINGS_SHEET_TABS.BIG_KW);
  if (bkw !== null) settings.bigKw = bkw;

  var ep = readSingleCol(SETTINGS_SHEET_TABS.EX_PKGS);
  if (ep !== null) settings.excludePkgs = ep;

  var eprov = readSingleCol(SETTINGS_SHEET_TABS.EX_PROVS);
  if (eprov !== null) settings.excludeProvs = eprov;

  return {
    status: "success",
    initialized: true,
    timestamp: nowThaiStr(),
    data: {
      techs: techs,
      dayOff: dayOff,
      aliases: aliases,
      settings: settings
    }
  };
}

function writeFullBackup(ss, payload) {
  var ts = nowThaiStr();
  var stateJson = String(payload.stateJson || "");
  if (!stateJson) return { status: "error", message: "ไม่มีข้อมูลสำหรับสำรอง" };

  var CHUNK_SIZE = 40000;
  var rows = [];
  for (var i = 0, part = 1; i < stateJson.length; i += CHUNK_SIZE, part++) {
    rows.push([String(part), ts, stateJson.substring(i, i + CHUNK_SIZE)]);
  }

  writeBatchTable(
    ss,
    SETTINGS_SHEET_TABS.BACKUP,
    ["part", "savedAt", "chunkJson"],
    rows,
    "#0f172a",
    [80, 180, 500],
    false
  );

  var logSh = appendSyncLog(ss);
  logSh.appendRow([
    ts,
    "สำรองข้อมูลทั้งหมด (Full Backup)",
    "บันทึกสำรองใบงาน + แพลน + ตั้งค่าทั้งหมด (" + rows.length + " ส่วน, " + Math.round(stateJson.length / 1024) + " KB)",
    "-",
    "-",
    "-"
  ]);

  return {
    status: "success",
    message: "สำรองข้อมูลทั้งหมดลง Google Sheet เรียบร้อยแล้ว",
    timestamp: ts,
    chunks: rows.length
  };
}

function readFullBackup(ss) {
  var vals = readTabRows(ss, SETTINGS_SHEET_TABS.BACKUP);
  if (vals.length < 2) {
    return { status: "error", message: "ยังไม่มีข้อมูลสำรองทั้งหมดในแท็บ BackupSnapshot" };
  }
  var jsonStr = "";
  var savedAt = String(vals[1][1] || "");
  for (var i = 1; i < vals.length; i++) {
    jsonStr += String(vals[i][2] || "");
  }
  return {
    status: "success",
    savedAt: savedAt,
    stateJson: jsonStr
  };
}
