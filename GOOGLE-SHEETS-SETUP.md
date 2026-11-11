# เชื่อม Google Sheets — ระบบลาออนไลน์เรือนจำกลางยะลา

เอกสารนี้เป็นขั้นเตรียมฐานข้อมูลกลาง (schema bootstrap) เท่านั้น ยังไม่เปิด API อ่าน/เขียนข้อมูลจนกว่าจะติดตั้งชั้นยืนยันตัวตนและกำหนดสิทธิ์ครบถ้วน

## โครงสร้างที่เตรียมไว้

- Users — บัญชีเจ้าหน้าที่ (เก็บ password_hash ไม่เก็บรหัสผ่านปกติ)
- Departments — ฝ่าย/หน่วยงาน
- Leaves — ใบลา
- Approvals — ประวัติอนุมัติ 5 ขั้น
- Settings — ค่ากำหนดระบบ
- ShiftRules — เพดานผู้ลาพร้อมกัน 5 กลุ่มเวร
- Logs — audit log

## ขั้นตอนสำหรับผู้ดูแล Google Workspace

1. สร้าง Google Spreadsheet ใหม่ใน Shared Drive/พื้นที่ที่หน่วยงานควบคุม และตั้งชื่อ เช่น `YALA E-LEAVE DATABASE`
2. จำกัดการแชร์เฉพาะบัญชี/กลุ่มเจ้าหน้าที่ที่ได้รับอนุญาต ห้ามตั้งเป็น Anyone.
3. เปิด https://script.google.com/ ด้วยบัญชี Workspace ที่มีสิทธิ์จัดการไฟล์ดังกล่าว แล้วสร้าง Apps Script project
4. คัดลอกไฟล์ `Code.gs` จากโฟลเดอร์ `google-apps-script` ไปวางใน Apps Script
5. ไปที่ Project Settings → Script Properties เพิ่ม `SPREADSHEET_ID` โดยใช้เฉพาะ ID จาก URL ของ Spreadsheet
6. รัน `setupDatabase()` จาก Apps Script editor และอนุญาตสิทธิ์ตามนโยบายของหน่วยงาน
7. ตรวจสอบว่ามีชีต Users, Departments, Leaves, Approvals, Settings, ShiftRules และ Logs ครบ

## ข้อควรทราบ

- ณ ขั้นนี้หน้า GitHub Pages ยังไม่ได้เชื่อมกับ Google Sheets; ไฟล์ Code.gs นี้เตรียมตารางและ health check เท่านั้น
- doPost ถูกปิดไว้โดยตั้งใจจนกว่าจะเพิ่ม authentication, session/token, role authorization, validation, audit logging และการป้องกัน concurrent writes
- ห้ามใส่ Spreadsheet ID, access token, password หรือ secret ลงในไฟล์ index.html หรือ repository สาธารณะ
- ก่อนย้ายข้อมูลจริง ต้องสำรอง JSON เดิมจากระบบเดิม และตรวจสอบข้อมูล/บัญชีเจ้าหน้าที่ร่วมกับผู้รับผิดชอบ
- แนะนำให้ผู้ดูแล Workspace ตรวจสอบนโยบาย Apps Script deployment, external access, Drive sharing, retention และ PDPA ก่อนใช้งานจริง

## ขั้นตอนถัดไป

หลังสร้าง Spreadsheet แล้ว ให้ผู้ดูแลส่งเฉพาะ **Apps Script Web App URL** และยืนยันว่า deployment จำกัดสิทธิ์ตามนโยบาย Workspace แล้ว (ไม่ต้องส่งรหัสผ่านหรือ secret) เพื่อดำเนินการเชื่อม API ฝั่งหน้าเว็บและทดสอบการย้ายข้อมูลด้วยชุดข้อมูลทดลองก่อน
