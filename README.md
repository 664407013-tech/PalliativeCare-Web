# Palliative Care Management — Firebase Edition

เวอร์ชันนี้แปลงจากระบบเดิม (PHP + MySQL + session) ให้เป็น **static site ล้วน ๆ**
ที่ใช้ **Firebase Authentication + Firestore** แทนฐานข้อมูล/เซิร์ฟเวอร์ เพื่อให้
deploy บน **GitHub Pages** ได้โดยไม่ต้องมีเซิร์ฟเวอร์ PHP เลย

ไฟล์ `api.php` และ `db.php` เดิม **ไม่ถูกใช้งานแล้ว** — ตรรกะทั้งหมด (รวมถึงสูตร
คำนวณขนาดยา MEDD/Titration) ถูกย้ายไปไว้ใน `api.js` (client-side) แบบ 1:1

---

## โครงสร้างไฟล์ใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| `firebase-config.js` | ใส่ค่า config ของโปรเจกต์ Firebase ของคุณ (ต้องแก้ก่อนใช้งาน) |
| `api.js` | แทนที่ `api.php` — Auth, Firestore CRUD, และสูตรคำนวณยา |
| `firestore.rules` | กฎความปลอดภัยของฐานข้อมูล (เอาไปวางใน Firebase Console) |
| `seed-admin.html` | ใช้ครั้งเดียวตอนติดตั้งระบบ เพื่อสร้างบัญชี Admin คนแรก |
| `login.html`, `index.html`, `login.js`, `script.js`, `*.css` | หน้าเว็บเดิม แก้เฉพาะจุดที่เรียก API |

---

## ขั้นตอนติดตั้ง

### 1) สร้างโปรเจกต์ Firebase
1. ไปที่ https://console.firebase.google.com/ → สร้างโปรเจกต์ใหม่
2. Project settings → General → Your apps → กด `</>` เพื่อสร้าง Web app
3. คัดลอกค่า `firebaseConfig` มาแทนที่ในไฟล์ `firebase-config.js`

### 2) เปิดใช้งาน Authentication
Build → Authentication → Sign-in method → เปิด **Email/Password**

> ระบบนี้ยังให้ผู้ใช้งาน login ด้วย "username" เหมือนเดิม — เบื้องหลังจะแปลงเป็น
> อีเมลปลอม `username@hospital.internal` ให้อัตโนมัติเพื่อใช้กับ Firebase Auth
> เท่านั้น ผู้ใช้งานไม่ต้องรู้หรือยุ่งเกี่ยวกับอีเมลนี้

### 3) เปิดใช้งาน Firestore
Build → Firestore Database → Create database (เลือก production mode)
แล้วไปที่แท็บ **Rules** วางเนื้อหาจากไฟล์ `firestore.rules` ที่ให้มา

### 4) สร้างบัญชี Admin คนแรก
เพราะการเพิ่มผู้ใช้งานต้อง login ด้วยสิทธิ์ Admin ก่อนอยู่แล้ว (ไก่กับไข่) ให้ทำดังนี้:
1. ไปที่ Firestore → Rules ชั่วคราวเปลี่ยนเป็น:
   ```
   match /users/{uid} { allow read, write: if request.auth != null; }
   match /usernames/{u} { allow read, write: if request.auth != null; }
   ```
2. เปิดไฟล์ `seed-admin.html` ผ่านเบราว์เซอร์ (รันในเครื่อง หรือ deploy ชั่วคราว) กรอกข้อมูล Admin แล้วกดสร้าง
3. กลับไปวางกฎเดิมจาก `firestore.rules` คืน (สำคัญมาก — ห้ามลืมขั้นตอนนี้)
4. ลบไฟล์ `seed-admin.html` ออกจากเว็บที่ deploy จริง (เก็บไว้เฉพาะในเครื่องเผื่อใช้อีกในอนาคต)

### 5) Deploy ขึ้น GitHub Pages
```bash
git init
git add .
git commit -m "Migrate to Firebase + GitHub Pages"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
จากนั้นไปที่ repo บน GitHub → Settings → Pages → Source: เลือก branch `main`
(root) → Save รอสักครู่แล้วเว็บจะขึ้นที่ `https://<your-username>.github.io/<your-repo>/`

---

## ข้อจำกัดที่ควรทราบ (สำคัญ)

การไม่มีเซิร์ฟเวอร์เลยทำให้บาง action ที่เดิมทำได้เต็มที่ด้วย PHP + Admin สิทธิ์เต็ม
ของฐานข้อมูล ตอนนี้มีข้อจำกัดตามธรรมชาติของ Firebase client SDK:

- **Admin เปลี่ยนรหัสผ่านผู้ใช้งานคนอื่นไม่ได้โดยตรง** — Firebase client SDK
  อนุญาตให้ผู้ใช้งานเปลี่ยนรหัสผ่าน "ของตัวเอง" เท่านั้น การเปลี่ยนรหัสผ่านคนอื่น
  ต้องใช้ Cloud Functions + Firebase Admin SDK (ต้องอัปเกรดเป็น Blaze plan ซึ่งมี
  free tier ให้ในตัว) ถ้าต้องการฟีเจอร์นี้เต็มรูปแบบ แนะนำให้เพิ่มฟังก์ชันแบบ
  `functions.https.onCall` ที่ตรวจสอบว่าผู้เรียกเป็น admin แล้วเรียก
  `admin.auth().updateUser(uid, {password})`
- **Admin ลบผู้ใช้งานได้แค่ "ปิดสิทธิ์การใช้งาน" ในแอป** (ลบเอกสารใน Firestore)
  แต่บัญชี Firebase Authentication ดิบ ๆ ยังไม่ถูกลบจริง (ต้องลบมือใน
  Firebase Console → Authentication → Users หรือใช้ Cloud Function เช่นกัน)
- **ค้นหาประวัติด้วยเลขบัตรประชาชนแบบ "มีคำนี้อยู่ตรงไหนก็ได้"** ทำแบบ SQL LIKE
  เดิมไม่ได้ตรง ๆ ใน Firestore ระบบจึงดึงข้อมูลตามช่วงวันที่ก่อนแล้วกรองคำค้นหา
  ฝั่ง client แทน (เหมาะกับข้อมูลระดับโรงพยาบาลทั่วไป ถ้าข้อมูลเยอะมากในอนาคต
  ควรพิจารณาใช้ Algolia/Typesense หรือเก็บ index คำค้นแยกต่างหาก)
- กฎ `usernames/{username}` เปิดให้ "อ่านได้" แม้ยังไม่ login (จำเป็นสำหรับ
  แปลง username → อีเมลตอน sign-in) แต่ข้อมูลในนั้นมีแค่ uid ไม่มีรหัสผ่านหรือ
  ข้อมูลอ่อนไหวใด ๆ

---

## ทดสอบก่อน deploy จริง

เปิด `login.html` ผ่าน local server (เช่น `npx serve .` หรือ VS Code Live Server)
**อย่าเปิดแบบ `file://` ตรง ๆ** เพราะ Firebase SDK บางส่วนต้องรันผ่าน http/https
