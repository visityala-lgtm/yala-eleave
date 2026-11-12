/**
 * YALA E-LEAVE — Leave workflow and official-form PDF service
 * Install beside Code.gs and Auth.gs in the Apps Script project.
 * Drive output folder is private by default. Optional Script Property:
 * LEAVE_PDF_FOLDER_ID (otherwise a private folder is created on first use).
 */
const LEAVE_STAGES_ = [
  {key:'security', name:'ฝ่ายรักษาการณ์'},
  {key:'head', name:'หัวหน้าฝ่าย'},
  {key:'director', name:'ผู้อำนวยการ'},
  {key:'commander', name:'ผู้บัญชาการเรือนจำ'},
  {key:'hr', name:'เจ้าหน้าที่ กจ.'}
];
const LEAVE_ROLE_STAGE_ = {security:0, head:1, director:2, commander:3, hr:4};
const LEAVE_TYPES_ = ['ลาป่วย','ลาคลอดบุตร','ลากิจส่วนตัว','ลาพักผ่อน'];
const LEAVE_EXTRA_HEADERS_ = ['preview_pdf_file_id','final_pdf_file_id'];

function submitLeave(token, input) {
  const user = requireSession_(token);
  input = input || {};
  const type = String(input.leave_type || '');
  const from = String(input.date_from || '');
  const to = String(input.date_to || '');
  const days = Number(input.days);
  const reason = String(input.reason || '').trim();
  if (LEAVE_TYPES_.indexOf(type) < 0) return {ok:false,error:'ประเภทใบลาไม่ถูกต้อง'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    return {ok:false,error:'กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ถูกต้อง'};
  if (!(days > 0 && days <= 365)) return {ok:false,error:'จำนวนวันลาไม่ถูกต้อง'};
  if (!reason) return {ok:false,error:'กรุณาระบุเหตุผลการลา'};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = leaveSheet_();
    const now = new Date().toISOString();
    const id = Utilities.getUuid();
    const code = 'YL-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + id.slice(0,6).toUpperCase();
    const item = {
      id:id, code:code, user_id:user.id, employee_name:user.name,
      department:user.department || '', shift_group:String(input.shift_group || ''),
      leave_type:type, date_from:from, date_to:to, days:days, reason:reason,
      contact:String(input.contact || '').trim(), address:String(input.address || '').trim(),
      attachment_file_id:'', stage:'security', status:'pending', created_at:now, updated_at:now,
      preview_pdf_file_id:'', final_pdf_file_id:''
    };
    appendObject_(sh, item);
    logLeaveEvent_(user,'leave_submit',id,'ยื่นใบลา '+code);
    const pdf = createLeavePdf_(item, false);
    setLeaveField_(id,'preview_pdf_file_id',pdf.id);
    return {ok:true,id:id,code:code,previewPdfUrl:pdf.url,status:'pending'};
  } catch (e) { throw e; }
  finally { lock.releaseLock(); }
}

function listMyLeaves(token) {
  const user = requireSession_(token);
  const rows = readObjects_(leaveSheet_());
  return rows.filter(r => String(r.user_id) === user.id).map(publicLeave_);
}

function listPendingApprovals(token) {
  const user = requireSession_(token);
  const idx = LEAVE_ROLE_STAGE_[user.role];
  if (idx === undefined) throw new Error('ไม่มีสิทธิ์ตรวจใบลา');
  return readObjects_(leaveSheet_()).filter(r => r.status === 'pending' && r.stage === LEAVE_STAGES_[idx].key).map(publicLeave_);
}

function reviewLeave(token, leaveId, decision, note) {
  const user = requireSession_(token);
  const idx = LEAVE_ROLE_STAGE_[user.role];
  if (idx === undefined) return {ok:false,error:'ไม่มีสิทธิ์อนุมัติ'};
  if (decision !== 'approve' && decision !== 'reject') return {ok:false,error:'คำสั่งไม่ถูกต้อง'};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = leaveSheet_(), item = readObjects_(sh).find(r => String(r.id) === String(leaveId));
    if (!item) return {ok:false,error:'ไม่พบใบลา'};
    if (item.status !== 'pending' || item.stage !== LEAVE_STAGES_[idx].key)
      return {ok:false,error:'ใบลานี้ไม่ได้อยู่ในขั้นตอนที่ท่านมีสิทธิ์ดำเนินการ'};
    const now = new Date().toISOString();
    const approvals = getDatabase_().getSheetByName('Approvals');
    approvals.appendRow([Utilities.getUuid(),item.id,user.role,LEAVE_STAGES_[idx].name,user.id,user.name,decision,String(note || ''),now]);
    if (decision === 'reject') {
      setLeaveFields_(item.id,{status:'rejected',updated_at:now});
    } else if (idx === LEAVE_STAGES_.length - 1) {
      setLeaveFields_(item.id,{status:'approved',stage:'completed',updated_at:now});
      const updated = Object.assign({},item,{status:'approved',stage:'completed',updated_at:now});
      const pdf = createLeavePdf_(updated,true);
      setLeaveField_(item.id,'final_pdf_file_id',pdf.id);
    } else {
      setLeaveFields_(item.id,{stage:LEAVE_STAGES_[idx+1].key,updated_at:now});
    }
    logLeaveEvent_(user,'leave_'+decision,item.id,(note || ''));
    return {ok:true,status:decision === 'reject' ? 'rejected' : (idx === 4 ? 'approved' : 'pending')};
  } finally { lock.releaseLock(); }
}

function getLeavePdfUrl(token, leaveId, finalVersion) {
  const user = requireSession_(token);
  const item = readObjects_(leaveSheet_()).find(r => String(r.id) === String(leaveId));
  if (!item) throw new Error('ไม่พบใบลา');
  if (item.user_id !== user.id && user.role === 'staff') throw new Error('ไม่มีสิทธิ์เข้าถึงเอกสารนี้');
  const fileId = finalVersion ? item.final_pdf_file_id : item.preview_pdf_file_id;
  if (!fileId) throw new Error(finalVersion ? 'ยังไม่มี PDF ฉบับสมบูรณ์' : 'ยังไม่มี PDF ตัวอย่าง');
  return {url:DriveApp.getFileById(fileId).getUrl(),status:item.status};
}

function requireSession_(token) {
  const user = getSessionUser(token);
  if (!user) throw new Error('SESSION_EXPIRED');
  return user;
}
function leaveSheet_() {
  const sh = getDatabase_().getSheetByName('Leaves');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  LEAVE_EXTRA_HEADERS_.forEach(h => { if (headers.indexOf(h) < 0) sh.getRange(1,sh.getLastColumn()+1).setValue(h); });
  return sh;
}
function readObjects_(sh) {
  const data = sh.getDataRange().getValues(); if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).filter(r => r.some(v => v !== '')).map(r => {
    const o={}; headers.forEach((h,i)=>o[h]=r[i] instanceof Date ? r[i].toISOString() : r[i]); return o;
  });
}
function appendObject_(sh,obj) {
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(headers.map(h => Object.prototype.hasOwnProperty.call(obj,h) ? obj[h] : ''));
}
function setLeaveField_(id,field,value) { const o={}; o[field]=value; setLeaveFields_(id,o); }
function setLeaveFields_(id,fields) {
  const sh=leaveSheet_(), data=sh.getDataRange().getValues(), headers=data[0].map(String);
  const idCol=headers.indexOf('id'); const row=data.findIndex((r,i)=>i>0 && String(r[idCol])===String(id));
  if(row<1) throw new Error('ไม่พบใบลา');
  Object.keys(fields).forEach(k=>{const c=headers.indexOf(k);if(c>=0)sh.getRange(row+1,c+1).setValue(fields[k]);});
}
function publicLeave_(r) {
  const o={}; ['id','code','employee_name','department','leave_type','date_from','date_to','days','reason','contact','address','stage','status','created_at','preview_pdf_file_id','final_pdf_file_id'].forEach(k=>o[k]=r[k] || '');
  return o;
}
function logLeaveEvent_(user,action,target,details) {
  getDatabase_().getSheetByName('Logs').appendRow([Utilities.getUuid(),user.id,user.name,action,'leave',target,String(details || ''),new Date().toISOString()]);
}
function pdfFolder_() {
  const props=PropertiesService.getScriptProperties(); let id=props.getProperty('LEAVE_PDF_FOLDER_ID');
  if(id) return DriveApp.getFolderById(id);
  const folder=DriveApp.createFolder('YALA E-LEAVE — เอกสารใบลา (Private)');
  props.setProperty('LEAVE_PDF_FOLDER_ID',folder.getId()); return folder;
}
function createLeavePdf_(item,isFinal) {
  const folder=pdfFolder_();
  const title='ใบลา_'+item.code+(isFinal?'_ฉบับสมบูรณ์':'_ตัวอย่าง');
  const doc=DocumentApp.create(title), body=doc.getBody();
  body.setMarginTop(42).setMarginBottom(42).setMarginLeft(48).setMarginRight(48);
  body.appendParagraph('เรือนจำกลางยะลา').setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true);
  body.appendParagraph('แบบใบ'+item.leave_type).setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true).setFontSize(16);
  body.appendParagraph('เขียนที่ เรือนจำกลางยะลา').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('วันที่ .......... เดือน ........................ พ.ศ. ..........').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('เรื่อง '+(item.leave_type==='ลาพักผ่อน'?'ขออนุญาตลาพักผ่อน':'ขอ'+item.leave_type));
  body.appendParagraph('เรียน ผู้บัญชาการเรือนจำกลางยะลา');
  const rows=[
    ['ชื่อ-นามสกุล',item.employee_name || '','ตำแหน่ง',item.position || ''],
    ['สังกัด',item.department || '','ประเภทการลา',item.leave_type],
    ['วันที่เริ่มลา',thaiDate_(item.date_from),'วันที่สิ้นสุด',thaiDate_(item.date_to)],
    ['จำนวนวันลา',String(item.days)+' วัน','สถานะ',isFinal?'อนุมัติครบทุกลำดับ':'ตัวอย่าง — อยู่ระหว่างดำเนินการ'],
    ['เหตุผลการลา',item.reason || '','โทรศัพท์ระหว่างลา',item.contact || ''],
    ['ที่อยู่ระหว่างลา',item.address || '','','']
  ];
  const table=body.appendTable(rows);
  table.setBorderWidth(0.5);
  body.appendParagraph('สถิติการลาในปีงบประมาณนี้').setBold(true);
  body.appendTable([['ประเภทการลา','จำนวนวัน'],['ลาป่วย','................'],['ลากิจส่วนตัว','................'],['ลาพักผ่อน','................'],['ลาคลอดบุตร','................']]).setBorderWidth(0.5);
  body.appendParagraph('ความเห็นฝ่ายรักษาการณ์ / หัวหน้าฝ่าย / ผู้อำนวยการ');
  body.appendParagraph('................................................................................................................');
  body.appendParagraph('คำสั่งผู้บัญชาการเรือนจำกลางยะลา');
  body.appendParagraph(isFinal?'☑ อนุญาต     ☐ ไม่อนุญาต':'☐ อนุญาต     ☐ ไม่อนุญาต  (รอผลการพิจารณา)');
  body.appendParagraph('\nลงชื่อ ........................................................ ผู้บัญชาการเรือนจำกลางยะลา');
  body.appendParagraph('เจ้าหน้าที่ กจ. ตรวจสอบและจัดพิมพ์: ........................................................');
  if(!isFinal) body.appendParagraph('เอกสารฉบับตัวอย่าง ไม่ใช่คำสั่งอนุมัติ และห้ามใช้แทนเอกสารฉบับสมบูรณ์').setBold(true).setForegroundColor('#9C6500');
  doc.saveAndClose();
  const docFile=DriveApp.getFileById(doc.getId());
  const pdf=folder.createFile(docFile.getBlob().getAs(MimeType.PDF).setName(title+'.pdf'));
  pdf.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
  docFile.setTrashed(true);
  return {id:pdf.getId(),url:pdf.getUrl()};
}
function thaiDate_(iso) {
  if(!iso) return '';
  const p=String(iso).split('-'); if(p.length!==3) return String(iso);
  return p[2]+'/'+p[1]+'/'+(Number(p[0])+543);
}
