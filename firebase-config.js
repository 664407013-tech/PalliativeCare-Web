/* =========================================================
   Firebase Project Configuration
   =========================================================
   วิธีหาค่าเหล่านี้:
   1. ไปที่ https://console.firebase.google.com/ แล้วสร้างโปรเจกต์ใหม่
      (หรือใช้โปรเจกต์เดิมถ้ามีอยู่แล้ว)
   2. ไปที่ Project settings (รูปเฟือง) > General
   3. เลื่อนลงมาที่ "Your apps" กด "</>" (Web app) เพื่อสร้างเว็บแอป
   4. คัดลอกค่า firebaseConfig ที่ได้มาวางแทนค่าด้านล่างนี้ทั้งหมด
   5. เปิดใช้งาน Authentication > Sign-in method > Email/Password
   6. เปิดใช้งาน Firestore Database (เริ่มด้วย production mode)
      แล้วนำกฎในไฟล์ firestore.rules ไปวางใน Firestore > Rules
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyB9uzPjcgg0mG-CxF0pjj0iSJNSc-5OXlo",
  authDomain: "palliative-care-9276e.firebaseapp.com",
  projectId: "palliative-care-9276e",
  storageBucket: "palliative-care-9276e.firebasestorage.app",
  messagingSenderId: "177727727726",
  appId: "1:177727727726:web:b6abb1ac1c02c4908a9e7f",
  measurementId: "G-NEFGC0S3LG"
};


// แอปหลัก (ใช้งานทั่วไป: login, อ่าน/เขียนข้อมูล)
firebase.initializeApp(firebaseConfig);

// แอปสำรอง (ใช้เฉพาะตอน Admin สร้างบัญชีผู้ใช้งานใหม่ผ่าน Firebase Auth
// เพื่อไม่ให้ session ของ Admin ที่ล็อกอินอยู่หลุดออกไปแทนที่ด้วยบัญชีใหม่)
const firebaseSecondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
