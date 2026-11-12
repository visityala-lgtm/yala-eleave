/**
 * YALA E-LEAVE — Leave workflow and PDF service
 * Requires Code.gs and Auth.gs in the same Apps Script project.
 *
 * Install as a single file named LeaveService.gs.
 * Required Script Property: SPREADSHEET_ID
 * Optional Script Property: LEAVE_PDF_FOLDER_ID
 *
 * NOTE: PDF layout below is a structured draft, not yet a pixel-perfect
 * reproduction of the supplied government DOCX forms.
 */

const LEAVE_STAGES_ = [
  { key: 'security', name: 'ฝ่ายรักษาการณ์' },
  { key: 'head', name: 'หัวหน้าฝ่าย' },
  { key: 'director', name: 'ผู้อำนวยการ' },
  { key: 'commander', name: 'ผู้บัญชาการเรือนจำ' },
  { key: 'hr', name: 'เจ้าหน้าที่ กจ.' }
];

const LEAVE_ROLE_STAGE_ = {
  security: 0,
  head: 1,
  director: 2,
  commander: 3,
  hr: 4
};

const LEAVE_TYPES_ = [
  'ลาป่วย',
  'ลาคลอดบุตร',
  'ลากิจส่วนตัว',
  'ลาพักผ่อน'
];

const LEAVE_EXTRA_HEADERS_ = [
  'employee_position',
  'personnel_type',
  'last_leave_type',
  'last_leave_from',
  'last_leave_to',
  'last_leave_days',
  'leave_year_stats',
  'leave_balance_previous',
  'leave_entitlement',
  'duty_note',
  'preview_pdf_file_id',
  'final_pdf_file_id'
];

/**
 * Submit a leave request and create its preview PDF.
 * input fields: leave_type, date_from, date_to, days, reason,
 * contact, address, shift_group, personnel_type and optional form details.
 */
function submitLeave(token, input) {
  const user = requireSession_(token);
  input = input || {};

  const type = String(input.leave_type || '');
  const from = String(input.date_from || '');
  const to = String(input.date_to || '');
  const days = Number(input.days);
  const reason = String(input.reason || '').trim();

  if (LEAVE_TYPES_.indexOf(type) < 0) {
    return { ok: false, error: 'ประเภทใบลาไม่ถูกต้อง' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return { ok: false, error: 'กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ถูกต้อง' };
  }
  if (!(days > 0 && days <= 365)) {
    return { ok: false, error: 'จำนวนวันลาไม่ถูกต้อง' };
  }
  if (!reason) {
    return { ok: false, error: 'กรุณาระบุเหตุผลการลา' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = leaveSheet_();
    const now = new Date().toISOString();
    const id = Utilities.getUuid();
    const code = 'YL-' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') +
      '-' + id.substring(0, 6).toUpperCase();

    const item = {
      id: id,
      code: code,
      user_id: user.id,
      employee_name: user.name,
      employee_position: user.position || '',
      personnel_type: String(input.personnel_type || ''),
      last_leave_type: String(input.last_leave_type || ''),
      last_leave_from: String(input.last_leave_from || ''),
      last_leave_to: String(input.last_leave_to || ''),
      last_leave_days: String(input.last_leave_days || ''),
      leave_year_stats: String(input.leave_year_stats || ''),
      leave_balance_previous: String(input.leave_balance_previous || ''),
      leave_entitlement: String(input.leave_entitlement || ''),
      duty_note: String(input.duty_note || ''),
      department: user.department || '',
      shift_group: String(input.shift_group || ''),
      leave_type: type,
      date_from: from,
      date_to: to,
      days: days,
      reason: reason,
      contact: String(input.contact || '').trim(),
      address: String(input.address || '').trim(),
      attachment_file_id: '',
      stage: 'security',
      status: 'pending',
      created_at: now,
      updated_at: now,
      preview_pdf_file_id: '',
      final_pdf_file_id: ''
    };

    appendObject_(sheet, item);
    logLeaveEvent_(user, 'leave_submit', id, 'ยื่นใบลา ' + code);

    const preview = createLeavePdf_(item, false);
    setLeaveField_(id, 'preview_pdf_file_id', preview.id);

    return {
      ok: true,
      id: id,
      code: code,
      previewPdfUrl: preview.url,
      status: 'pending'
    };
  } finally {
    lock.releaseLock();
  }
}

/** List only the signed-in user's leave requests. */
function listMyLeaves(token) {
  const user = requireSession_(token);
  return readObjects_(leaveSheet_())
    .filter(function (row) {
      return String(row.user_id) === String(user.id);
    })
    .map(publicLeave_);
}

/** List requests waiting at the current approver's stage. */
function listPendingApprovals(token) {
  const user = requireSession_(token);
  const stageIndex = LEAVE_ROLE_STAGE_[user.role];

  if (stageIndex === undefined) {
    throw new Error('ไม่มีสิทธิ์ตรวจใบลา');
  }

  return readObjects_(leaveSheet_())
    .filter(function (row) {
      return row.status === 'pending' &&
        row.stage === LEAVE_STAGES_[stageIndex].key;
    })
    .map(publicLeave_);
}

/**
 * Approve or reject a request.
 * Only the role assigned to the current stage can act.
 * The final PDF is created only after HR approves.
 */
function reviewLeave(token, leaveId, decision, note) {
  const user = requireSession_(token);
  const stageIndex = LEAVE_ROLE_STAGE_[user.role];

  if (stageIndex === undefined) {
    return { ok: false, error: 'ไม่มีสิทธิ์อนุมัติ' };
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return { ok: false, error: 'คำสั่งไม่ถูกต้อง' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = leaveSheet_();
    const item = readObjects_(sheet).find(function (row) {
      return String(row.id) === String(leaveId);
    });

    if (!item) {
      return { ok: false, error: 'ไม่พบใบลา' };
    }
    if (item.status !== 'pending' ||
        item.stage !== LEAVE_STAGES_[stageIndex].key) {
      return {
        ok: false,
        error: 'ใบลานี้ไม่ได้อยู่ในขั้นตอนที่ท่านมีสิทธิ์ดำเนินการ'
      };
    }

    const now = new Date().toISOString();
    const approvals = getDatabase_().getSheetByName('Approvals');
    if (!approvals) {
      throw new Error('ไม่พบชีต Approvals กรุณารัน setupDatabase()');
    }

    approvals.appendRow([
      Utilities.getUuid(),
      item.id,
      user.role,
      LEAVE_STAGES_[stageIndex].name,
      user.id,
      user.name,
      decision,
      String(note || ''),
      now
    ]);

    if (decision === 'reject') {
      setLeaveFields_(item.id, {
        status: 'rejected',
        updated_at: now
      });
    } else if (stageIndex === LEAVE_STAGES_.length - 1) {
      const updated = Object.assign({}, item, {
        status: 'approved',
        stage: 'completed',
        updated_at: now
      });
      const finalPdf = createLeavePdf_(updated, true);
      setLeaveFields_(item.id, {
        status: 'approved',
        stage: 'completed',
        updated_at: now,
        final_pdf_file_id: finalPdf.id
      });
    } else {
      setLeaveFields_(item.id, {
        stage: LEAVE_STAGES_[stageIndex + 1].key,
        updated_at: now
      });
    }

    logLeaveEvent_(user, 'leave_' + decision, item.id, note || '');

    return {
      ok: true,
      status: decision === 'reject'
        ? 'rejected'
        : (stageIndex === LEAVE_STAGES_.length - 1 ? 'approved' : 'pending')
    };
  } finally {
    lock.releaseLock();
  }
}

/** Return a Drive URL after checking session and access rights. */
function getLeavePdfUrl(token, leaveId, finalVersion) {
  const user = requireSession_(token);
  const item = findLeaveById_(leaveId);

  assertLeaveAccess_(user, item);

  const fileId = finalVersion
    ? item.final_pdf_file_id
    : item.preview_pdf_file_id;

  if (!fileId) {
    throw new Error(finalVersion
      ? 'ยังไม่มี PDF ฉบับสมบูรณ์'
      : 'ยังไม่มี PDF ตัวอย่าง');
  }

  return {
    url: DriveApp.getFileById(fileId).getUrl(),
    status: item.status
  };
}

/** Return PDF base64 after checking session and access rights. */
function getLeavePdfData(token, leaveId, finalVersion) {
  const user = requireSession_(token);
  const item = findLeaveById_(leaveId);

  assertLeaveAccess_(user, item);

  const fileId = finalVersion
    ? item.final_pdf_file_id
    : item.preview_pdf_file_id;

  if (!fileId) {
    throw new Error(finalVersion
      ? 'ยังไม่มี PDF ฉบับสมบูรณ์'
      : 'ยังไม่มี PDF ตัวอย่าง');
  }

  const file = DriveApp.getFileById(fileId);
  return {
    filename: file.getName(),
    mimeType: 'application/pdf',
    base64: Utilities.base64Encode(file.getBlob().getBytes())
  };
}

/* ------------------------- Internal helpers ------------------------- */

function requireSession_(token) {
  const user = getSessionUser(token);
  if (!user) {
    throw new Error('SESSION_EXPIRED');
  }
  return user;
}

function assertLeaveAccess_(user, item) {
  if (!item) {
    throw new Error('ไม่พบใบลา');
  }
  if (user.role === 'staff' && String(item.user_id) !== String(user.id)) {
    throw new Error('ไม่มีสิทธิ์เข้าถึงเอกสารนี้');
  }
}

function findLeaveById_(leaveId) {
  return readObjects_(leaveSheet_()).find(function (row) {
    return String(row.id) === String(leaveId);
  }) || null;
}

/** Add missing columns safely without overwriting existing columns. */
function leaveSheet_() {
  const ss = getDatabase_();
  const sheet = ss.getSheetByName('Leaves');

  if (!sheet) {
    throw new Error('ไม่พบชีต Leaves กรุณารัน setupDatabase()');
  }

  let lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    throw new Error('ชีต Leaves ไม่มีหัวตาราง');
  }

  let headers = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(String);

  LEAVE_EXTRA_HEADERS_.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      lastColumn += 1;
      sheet.getRange(1, lastColumn).setValue(header);
      headers.push(header);
    }
  });

  return sheet;
}

function readObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(String);
  return values.slice(1)
    .filter(function (row) {
      return row.some(function (value) {
        return value !== '';
      });
    })
    .map(function (row) {
      const object = {};
      headers.forEach(function (header, index) {
        const value = row[index];
        object[header] = value instanceof Date
          ? value.toISOString()
          : value;
      });
      return object;
    });
}

function appendObject_(sheet, object) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(String);

  sheet.appendRow(headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(object, header)
      ? object[header]
      : '';
  }));
}

function setLeaveField_(id, field, value) {
  const fields = {};
  fields[field] = value;
  setLeaveFields_(id, fields);
}

function setLeaveFields_(id, fields) {
  const sheet = leaveSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idColumn = headers.indexOf('id');

  if (idColumn < 0) {
    throw new Error('ไม่พบคอลัมน์ id ในชีต Leaves');
  }

  const rowIndex = values.findIndex(function (row, index) {
    return index > 0 && String(row[idColumn]) === String(id);
  });

  if (rowIndex < 1) {
    throw new Error('ไม่พบใบลา');
  }

  Object.keys(fields).forEach(function (key) {
    const column = headers.indexOf(key);
    if (column >= 0) {
      sheet.getRange(rowIndex + 1, column + 1).setValue(fields[key]);
    }
  });
}

function publicLeave_(row) {
  const allowed = [
    'id', 'code', 'employee_name', 'employee_position',
    'department', 'leave_type', 'date_from', 'date_to',
    'days', 'reason', 'contact', 'address', 'stage',
    'status', 'created_at', 'preview_pdf_file_id',
    'final_pdf_file_id'
  ];

  const result = {};
  allowed.forEach(function (key) {
    result[key] = row[key] || '';
  });
  return result;
}

function logLeaveEvent_(user, action, target, details) {
  const sheet = getDatabase_().getSheetByName('Logs');
  if (!sheet) {
    throw new Error('ไม่พบชีต Logs กรุณารัน setupDatabase()');
  }

  sheet.appendRow([
    Utilities.getUuid(),
    user.id,
    user.name,
    action,
    'leave',
    target,
    String(details || ''),
    new Date().toISOString()
  ]);
}

function pdfFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = properties.getProperty('LEAVE_PDF_FOLDER_ID');

  if (folderId) {
    return DriveApp.getFolderById(folderId);
  }

  const folder = DriveApp.createFolder(
    'YALA E-LEAVE — เอกสารใบลา (Private)'
  );
  properties.setProperty('LEAVE_PDF_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * Create preview or final PDF.
 * This is a clean draft layout. It must be checked against the original
 * official forms before being used as an official government document.
 */
function createLeavePdf_(item, isFinal) {
  const folder = pdfFolder_();
  const title = 'ใบลา_' + item.code +
    (isFinal ? '_ฉบับสมบูรณ์' : '_ตัวอย่าง');

  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  body.setMarginTop(42)
    .setMarginBottom(42)
    .setMarginLeft(48)
    .setMarginRight(48);

  body.appendParagraph('เรือนจำกลางยะลา')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setBold(true);

  body.appendParagraph('แบบใบ' + item.leave_type)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setBold(true)
    .setFontSize(16);

  body.appendParagraph('เขียนที่ เรือนจำกลางยะลา')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  body.appendParagraph('วันที่ .......... เดือน ........................ พ.ศ. ..........')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  body.appendParagraph(
    'เรื่อง ' + (item.leave_type === 'ลาพักผ่อน'
      ? 'ขออนุญาตลาพักผ่อน'
      : 'ขอ' + item.leave_type)
  );

  body.appendParagraph('เรียน ผู้บัญชาการเรือนจำกลางยะลา');

  const rows = [
    ['ชื่อ-นามสกุล', item.employee_name || '',
      'ตำแหน่ง', item.employee_position || ''],
    ['สังกัด', item.department || '',
      'ประเภทการลา', item.leave_type || ''],
    ['วันที่เริ่มลา', thaiDate_(item.date_from),
      'วันที่สิ้นสุด', thaiDate_(item.date_to)],
    ['จำนวนวันลา', String(item.days || '') + ' วัน',
      'สถานะ', isFinal
        ? 'อนุมัติครบทุกลำดับ'
        : 'ตัวอย่าง — อยู่ระหว่างดำเนินการ'],
    ['เหตุผลการลา', item.reason || '',
      'โทรศัพท์ระหว่างลา', item.contact || ''],
    ['ที่อยู่ระหว่างลา', item.address || '', '', '']
  ];

  body.appendTable(rows).setBorderWidth(0.5);

  body.appendParagraph(
    'ประวัติการลาครั้งสุดท้าย: ' +
    [
      item.last_leave_type,
      item.last_leave_from,
      item.last_leave_to,
      item.last_leave_days
    ].filter(Boolean).join(' / ')
  );

  body.appendParagraph(
    'สิทธิวันลาพักผ่อนคงเหลือจากปีก่อน: ' +
    (item.leave_balance_previous || '................') +
    '   สิทธิปีปัจจุบัน: ' +
    (item.leave_entitlement || '................')
  );

  body.appendParagraph(
    'หมายเหตุเวรยาม: ' +
    (item.duty_note || '................................')
  );

  body.appendParagraph(
    'สถิติการลาในปีงบประมาณนี้: ' +
    (item.leave_year_stats || 'รอข้อมูลจากระบบทะเบียนวันลา')
  ).setBold(true);

  body.appendTable([
    ['ประเภทการลา', 'จำนวนวัน'],
    ['ลาป่วย', '................'],
    ['ลากิจส่วนตัว', '................'],
    ['ลาพักผ่อน', '................'],
    ['ลาคลอดบุตร', '................']
  ]).setBorderWidth(0.5);

  body.appendParagraph(
    'ความเห็นฝ่ายรักษาการณ์ / หัวหน้าฝ่าย / ผู้อำนวยการ'
  );

  body.appendParagraph(
    '................................................................................................................'
  );

  body.appendParagraph('คำสั่งผู้บัญชาการเรือนจำกลางยะลา');

  body.appendParagraph(
    isFinal
      ? '☑ อนุญาต     ☐ ไม่อนุญาต'
      : '☐ อนุญาต     ☐ ไม่อนุญาต (รอผลการพิจารณา)'
  );

  body.appendParagraph(
    '\nลงชื่อ ........................................................ ผู้บัญชาการเรือนจำกลางยะลา'
  );

  body.appendParagraph(
    'เจ้าหน้าที่ กจ. ตรวจสอบและจัดพิมพ์: ........................................................'
  );

  if (!isFinal) {
    body.appendParagraph(
      'เอกสารฉบับตัวอย่าง ไม่ใช่คำสั่งอนุมัติ และห้ามใช้แทนเอกสารฉบับสมบูรณ์'
    )
      .setBold(true)
      .setForegroundColor('#9C6500');
  }

  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getBlob()
    .getAs(MimeType.PDF)
    .setName(title + '.pdf');
  const pdfFile = folder.createFile(pdfBlob);

  pdfFile.setSharing(
    DriveApp.Access.PRIVATE,
    DriveApp.Permission.NONE
  );

  docFile.setTrashed(true);

  return {
    id: pdfFile.getId(),
    url: pdfFile.getUrl()
  };
}

/** Convert yyyy-MM-dd to Thai Buddhist Era date. */
function thaiDate_(isoDate) {
  if (!isoDate) {
    return '';
  }

  const parts = String(isoDate).split('-');
  if (parts.length !== 3) {
    return String(isoDate);
  }

  return parts[2] + '/' + parts[1] + '/' +
    (Number(parts[0]) + 543);
}
