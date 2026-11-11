/**
 * YALA E-LEAVE — Authentication foundation
 * Add this file to the Apps Script project containing Code.gs.
 *
 * IMPORTANT:
 * - This module is a foundation, not the complete leave-management API.
 * - Call these functions from an Apps Script-hosted page using google.script.run.
 * - Never expose spreadsheet IDs, script properties, or session tokens in logs.
 */

const AUTH_CONFIG = {
  SESSION_TTL_SECONDS: 21600, // 6 hours
  MAX_FAILED_LOGINS: 5,
  LOCK_SECONDS: 900, // 15 minutes
  HASH_ROUNDS: 12000
};

/** One-time bootstrap. Creates admin/admin with temporary password 1234. */
function createInitialAdmin() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getDatabase_();
    const sheet = ss.getSheetByName('Users');
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const col = headerMap_(headers);
    const exists = rows.slice(1).some(r => String(r[col.username] || '').toLowerCase() === 'admin');
    if (exists) throw new Error('บัญชี admin มีอยู่แล้ว ไม่สร้างซ้ำ');

    const now = new Date().toISOString();
    const user = {
      id: 'u-admin',
      username: 'admin',
      password_hash: hashPassword_('1234'),
      name: 'ผู้ดูแลระบบ',
      role: 'admin',
      position: '',
      department: 'งานบริหารทั่วไป',
      personnel_type: 'ข้าราชการ',
      shift_group: '',
      years_of_service: 0,
      photo_file_id: '',
      approved: true,
      active: true,
      created_at: now,
      updated_at: now
    };
    sheet.appendRow(headers.map(h => Object.prototype.hasOwnProperty.call(user, h) ? user[h] : ''));
    logAuthEvent_('admin_bootstrap', 'u-admin', 'สร้างบัญชีผู้ดูแลระบบเริ่มต้น');
    return {ok:true, message:'สร้างบัญชี admin แล้ว ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน'};
  } finally {
    lock.releaseLock();
  }
}

/** Login returns a random session token and a minimal user profile. */
function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!username || !password) return {ok:false, error:'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'};

  const cache = CacheService.getScriptCache();
  const failKey = 'login_fail_' + digestText_(username);
  if (Number(cache.get(failKey) || 0) >= AUTH_CONFIG.MAX_FAILED_LOGINS) {
    return {ok:false, error:'เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณารอ 15 นาที'};
  }

  const ss = getDatabase_();
  const sheet = ss.getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const col = headerMap_(data[0]);
  const row = data.slice(1).find(r => String(r[col.username] || '').toLowerCase() === username);

  if (!row || !verifyPassword_(password, String(row[col.password_hash] || ''))) {
    const count = Number(cache.get(failKey) || 0) + 1;
    cache.put(failKey, String(count), AUTH_CONFIG.LOCK_SECONDS);
    return {ok:false, error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'};
  }
  if (!truthy_(row[col.active]) || !truthy_(row[col.approved])) {
    return {ok:false, error:'บัญชีนี้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'};
  }

  cache.remove(failKey);
  const token = Utilities.getUuid() + Utilities.getUuid();
  const profile = {
    id:String(row[col.id]),
    username:String(row[col.username]),
    name:String(row[col.name]),
    role:String(row[col.role]),
    position:String(row[col.position] || ''),
    department:String(row[col.department] || '')
  };
  cache.put('session_' + digestText_(token), JSON.stringify(profile), AUTH_CONFIG.SESSION_TTL_SECONDS);
  logAuthEvent_('login', profile.id, 'เข้าสู่ระบบ');
  return {ok:true, token:token, user:profile, mustChangePassword:password === '1234'};
}

/** Validate session on every protected server operation. */
function getSessionUser(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('session_' + digestText_(String(token)));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function logout(token) {
  if (!token) return {ok:true};
  const user = getSessionUser(token);
  CacheService.getScriptCache().remove('session_' + digestText_(String(token)));
  if (user) logAuthEvent_('logout', user.id, 'ออกจากระบบ');
  return {ok:true};
}

/** Change password. New password must be at least 10 characters. */
function changeOwnPassword(token, oldPassword, newPassword) {
  const session = getSessionUser(token);
  if (!session) return {ok:false, error:'SESSION_EXPIRED'};
  oldPassword = String(oldPassword || '');
  newPassword = String(newPassword || '');
  if (newPassword.length < 10) return {ok:false, error:'รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร'};
  if (newPassword === '1234') return {ok:false, error:'กรุณาตั้งรหัสผ่านใหม่ที่ไม่ใช่รหัสชั่วคราว'};

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getDatabase_().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();
    const col = headerMap_(data[0]);
    const index = data.slice(1).findIndex(r => String(r[col.id]) === session.id);
    if (index < 0) return {ok:false, error:'ไม่พบบัญชีผู้ใช้'};
    const rowNumber = index + 2;
    const currentHash = String(data[index + 1][col.password_hash] || '');
    if (!verifyPassword_(oldPassword, currentHash)) return {ok:false, error:'รหัสผ่านเดิมไม่ถูกต้อง'};
    sheet.getRange(rowNumber, col.password_hash + 1).setValue(hashPassword_(newPassword));
    sheet.getRange(rowNumber, col.updated_at + 1).setValue(new Date().toISOString());
    logAuthEvent_('password_change', session.id, 'เปลี่ยนรหัสผ่าน');
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

/** Admin-only account creation. Password is never returned or logged. */
function adminCreateUser(token, input) {
  const actor = getSessionUser(token);
  if (!actor || actor.role !== 'admin') return {ok:false, error:'ไม่มีสิทธิ์ดำเนินการ'};
  input = input || {};
  const username = String(input.username || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  const allowedRoles = ['staff','security','head','director','commander','hr'];
  const role = String(input.role || 'staff');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return {ok:false, error:'Username ต้องเป็น a-z, 0-9 หรือ . _ - ความยาว 3-40 ตัว'};
  if (!name) return {ok:false, error:'กรุณาระบุชื่อ-นามสกุล'};
  if (password.length < 10) return {ok:false, error:'รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 10 ตัวอักษร'};
  if (allowedRoles.indexOf(role) < 0) return {ok:false, error:'บทบาทไม่ถูกต้อง'};

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getDatabase_().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0], col = headerMap_(headers);
    if (data.slice(1).some(r => String(r[col.username] || '').toLowerCase() === username)) {
      return {ok:false, error:'Username นี้มีอยู่แล้ว'};
    }
    const now = new Date().toISOString();
    const user = {
      id:Utilities.getUuid(), username:username, password_hash:hashPassword_(password),
      name:name, role:role, position:String(input.position || ''),
      department:String(input.department || ''), personnel_type:String(input.personnel_type || ''),
      shift_group:String(input.shift_group || ''), years_of_service:Number(input.years_of_service || 0),
      photo_file_id:'', approved:true, active:true, created_at:now, updated_at:now
    };
    sheet.appendRow(headers.map(h => Object.prototype.hasOwnProperty.call(user, h) ? user[h] : ''));
    logAuthEvent_('user_create', actor.id, 'สร้างบัญชีบุคลากร: ' + username);
    return {ok:true, id:user.id, username:username};
  } finally {
    lock.releaseLock();
  }
}

function getDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ไม่พบ Script Property SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => map[String(h)] = i);
  ['id','username','password_hash','name','role','approved','active','updated_at'].forEach(k => {
    if (map[k] === undefined) throw new Error('ไม่พบคอลัมน์ Users: ' + k);
  });
  return map;
}

function hashPassword_(password) {
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const key = Utilities.newBlob(String(password)).getBytes();
  let value = Utilities.newBlob(salt).getBytes();
  for (let i = 0; i < AUTH_CONFIG.HASH_ROUNDS; i++) {
    value = Utilities.computeHmacSha256Signature(value, key);
  }
  return salt + ':' + bytesToHex_(value);
}

function verifyPassword_(password, encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length !== 2) return false;
  const key = Utilities.newBlob(String(password)).getBytes();
  let value = Utilities.newBlob(parts[0]).getBytes();
  for (let i = 0; i < AUTH_CONFIG.HASH_ROUNDS; i++) {
    value = Utilities.computeHmacSha256Signature(value, key);
  }
  return constantTimeEqual_(bytesToHex_(value), parts[1]);
}

function bytesToHex_(bytes) {
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function digestText_(value) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value)));
}
function truthy_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}
function logAuthEvent_(action, actorId, details) {
  try {
    const sheet = getDatabase_().getSheetByName('Logs');
    sheet.appendRow([Utilities.getUuid(), actorId, 'ระบบ', action, 'auth', actorId, details, new Date().toISOString()]);
  } catch (e) {
    // Authentication must not fail solely because audit logging failed.
    console.error('Audit log write failed');
  }
}
