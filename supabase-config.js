/* =========================================================================
   supabase-config.js — ค่าเชื่อมต่อ Supabase
   (โปรเจกต์นี้เป็น HTML/JS ล้วน ไม่ใช่ Next.js จึงไม่ใช้ตัวแปร NEXT_PUBLIC_*
    แต่ใส่ค่าชุดเดียวกันไว้ที่นี่แทน)

   Publishable key ออกแบบมาให้อยู่ในโค้ดฝั่งเบราว์เซอร์ได้ — ความปลอดภัยจริง
   อยู่ที่ Row Level Security ใน supabase_schema.sql
   ห้ามนำ Secret key / service_role key มาใส่ในไฟล์นี้เด็ดขาด
   ========================================================================= */
window.SUPABASE_CONFIG = {
    url: 'https://akwdvhpbkjfparfdgimu.supabase.co',
    publishableKey: 'sb_publishable_pCeeVIWbjuTVjiDBOjwmGg_TFIcycmQ',

    // Supabase Auth ต้องใช้อีเมลในการ login แต่ระบบเดิม login ด้วย "ชื่อผู้ใช้งาน"
    // จึงแปลง username → <username>@<โดเมนนี้> ให้อัตโนมัติ (ผู้ใช้ไม่ต้องรู้)
    // *** ต้องตั้งค่าเดียวกับ AUTH_EMAIL_DOMAIN ของ Edge Function admin-users ***
    authEmailDomain: 'palliative.local',

    // 'session' = ปิดเบราว์เซอร์/แท็บแล้วต้อง login ใหม่ (ใกล้เคียงพฤติกรรม PHP session เดิม เหมาะกับเครื่องส่วนกลาง)
    // 'local'   = จำการ login ไว้แม้ปิดเบราว์เซอร์
    sessionStorage: 'session'
};
