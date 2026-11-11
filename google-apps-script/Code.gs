/**
 * YALA E-LEAVE — Google Sheets database bootstrap
 * Deploy only after reviewing access policy with the Workspace administrator.
 * Run setupDatabase() once from the Apps Script editor.
 */
const DB_SHEETS = {
  Users: ['id','username','password_hash','name','role','position','department','personnel_type','shift_group','years_of_service','photo_file_id','approved','active','created_at','updated_at'],
  Departments: ['id','name','active','created_at','updated_at'],
  Leaves: ['id','code','user_id','employee_name','department','shift_group','leave_type','date_from','date_to','days','reason','contact','address','attachment_file_id','stage','status','created_at','updated_at'],
  Approvals: ['id','leave_id','stage_key','stage_name','reviewer_id','reviewer_name','decision','note','created_at'],
  Settings: ['key','value','updated_at'],
  ShiftRules: ['group_name','max_concurrent_leave','active','updated_at'],
  Logs: ['id','actor_id','actor_name','action','target_type','target_id','details','created_at']
};

const DEFAULT_SETTINGS = {
  institution: 'เรือนจำกลางยะลา',
  yearStart: '01-10',
  civilUnder10: '10',
  civilOver10: '20',
  govAfter6m: '5'
};
const DEFAULT_SHIFT_RULES = [
  ['พัศดี',2,true], ['ผู้ช่วยพัศดี',2,true], ['ลูกเวร',4,true],
  ['ลูกเวรผู้หญิง',2,true], ['เวรเรือนจำชั่วคราว',2,true]
];

/** Create the database tabs and headers. Safe to run more than once. */
function setupDatabase() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('กรุณากำหนด Script Property ชื่อ SPREADSHEET_ID ก่อน');
  const ss = SpreadsheetApp.openById(spreadsheetId);

  Object.keys(DB_SHEETS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = DB_SHEETS[name];
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (current.every(v => !v)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else if (headers.some((h, i) => current[i] !== h)) {
      throw new Error('หัวตารางชีต ' + name + ' ไม่ตรงกับ schema; หยุดเพื่อป้องกันข้อมูลเดิมเสียหาย');
    }
  });

  const settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() < 2) {
    const now = new Date();
    settings.getRange(2,1,Object.keys(DEFAULT_SETTINGS).length,3)
      .setValues(Object.entries(DEFAULT_SETTINGS).map(([k,v]) => [k,v,now]));
  }
  const shifts = ss.getSheetByName('ShiftRules');
  if (shifts.getLastRow() < 2) {
    shifts.getRange(2,1,DEFAULT_SHIFT_RULES.length,4)
      .setValues(DEFAULT_SHIFT_RULES.map(r => [...r,new Date()]));
  }
  return {ok:true, spreadsheetName:ss.getName(), sheets:Object.keys(DB_SHEETS)};
}

/** Health check only; does not expose sheet contents or personal data. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok:true, service:'YALA E-LEAVE API', status:'initialized',
    timestamp:new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/** Reject writes until the authenticated API layer is installed. */
function doPost() {
  return ContentService.createTextOutput(JSON.stringify({
    ok:false, error:'API_NOT_CONFIGURED',
    message:'ยังไม่ได้เปิดใช้งาน API สำหรับข้อมูลส่วนบุคคล'
  })).setMimeType(ContentService.MimeType.JSON);
}
