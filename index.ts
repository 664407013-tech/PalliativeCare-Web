// =========================================================================
//  Edge Function: admin-users
//  สร้าง / แก้ไข / ลบ บัญชีผู้ใช้งาน — เฉพาะผู้ใช้ที่เป็น Admin เท่านั้น
//
//  ทำไมต้องเป็น Edge Function: การจัดการบัญชีใน Supabase Auth ต้องใช้ service role key
//  ซึ่งห้ามเก็บไว้ในโค้ดฝั่งเบราว์เซอร์ (ใครเปิด DevTools ก็เห็น)
//
//  Deploy:  supabase functions deploy admin-users --no-verify-jwt
//  (ปิด verify_jwt ของ gateway ได้ เพราะฟังก์ชันนี้ตรวจ token + สิทธิ์ Admin เองทุกครั้งด้านล่าง)
//
//  Secrets (ตั้งด้วย `supabase secrets set ...` หรือ Dashboard → Edge Functions → Secrets):
//    AUTH_EMAIL_DOMAIN   ต้องตรงกับ authEmailDomain ใน supabase-config.js (ค่าเริ่มต้น palliative.local)
//    SERVICE_ROLE_KEY    (ไม่บังคับ) ใช้เมื่อ SUPABASE_SERVICE_ROLE_KEY ที่ระบบใส่ให้ใช้ไม่ได้
//  ส่วน SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY Supabase ใส่ให้อัตโนมัติ
// =========================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_DOMAIN = Deno.env.get('AUTH_EMAIL_DOMAIN') ?? 'palliative.local';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
}
const fail = (message: string, status = 200) => json({ success: false, message }, status);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9._-]{2,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const authEmail = (username: string) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// ตรวจว่าชื่อผู้ใช้ซ้ำหรือไม่ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) — ตารางเล็ก ดึงมาเทียบใน JS เพื่อเลี่ยงปัญหา wildcard ของ ilike
async function usernameTaken(username: string, exceptId?: string) {
    const { data, error } = await admin.from('profiles').select('id, username');
    if (error) throw new Error(error.message);
    return (data ?? []).some(
        (p) => p.username.toLowerCase() === username.toLowerCase() && p.id !== exceptId,
    );
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return fail('Method not allowed', 405);

    try {
        // ---------- 1) ยืนยันตัวตนผู้เรียก ----------
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData?.user) {
            return json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', auth_required: true }, 401);
        }
        const callerId = userData.user.id;

        // ---------- 2) ต้องเป็น Admin ที่เปิดใช้งานอยู่ ----------
        const { data: me } = await admin
            .from('profiles').select('id, role, is_active').eq('id', callerId).maybeSingle();
        if (!me || !me.is_active || me.role !== 'admin') {
            return fail('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ใช้งานส่วนนี้', 403);
        }

        const body = await req.json().catch(() => ({}));
        const action = body?.action;

        // ---------- เพิ่มผู้ใช้งาน ----------
        if (action === 'create') {
            const full_name = str(body.full_name);
            const username = str(body.username);
            const email = str(body.email);
            const phone = str(body.phone);
            const password = typeof body.password === 'string' ? body.password : '';
            const confirm = typeof body.confirm_password === 'string' ? body.confirm_password : '';
            const role = body.role === 'admin' ? 'admin' : 'user';

            if (!full_name || !username || !password) {
                return fail('กรุณากรอกชื่อ-นามสกุล, ชื่อผู้ใช้งาน และรหัสผ่านให้ครบถ้วน');
            }
            if (!USERNAME_RE.test(username)) {
                return fail('ชื่อผู้ใช้งานใช้ได้เฉพาะ a-z, A-Z, 0-9, จุด (.), ขีดล่าง (_), ขีดกลาง (-) ยาว 2-50 ตัวอักษร');
            }
            if (email && !EMAIL_RE.test(email)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
            if (password.length < 6) return fail('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
            if (password !== confirm) return fail('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
            if (await usernameTaken(username)) return fail('ชื่อผู้ใช้งานนี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น');

            const { data: created, error: cErr } = await admin.auth.admin.createUser({
                email: authEmail(username),
                password,
                email_confirm: true,
                user_metadata: { username, full_name },
            });
            if (cErr || !created?.user) {
                return fail('ไม่สามารถสร้างบัญชีได้: ' + (cErr?.message ?? 'unknown error'));
            }

            const { error: pErr } = await admin.from('profiles').insert({
                id: created.user.id,
                username,
                full_name,
                email: email || null,
                phone: phone || null,
                role,
                is_active: true,
            });
            if (pErr) {
                await admin.auth.admin.deleteUser(created.user.id); // ย้อนกลับ ไม่ให้เหลือบัญชีครึ่งๆ กลางๆ
                return fail('เกิดข้อผิดพลาดในการเพิ่มผู้ใช้งาน: ' + pErr.message);
            }
            return json({ success: true, message: 'เพิ่มผู้ใช้งานใหม่สำเร็จ', id: created.user.id });
        }

        // ---------- แก้ไขผู้ใช้งาน ----------
        if (action === 'update') {
            const id = str(body.id);
            const full_name = str(body.full_name);
            const username = str(body.username);
            const email = str(body.email);
            const phone = str(body.phone);
            const password = typeof body.password === 'string' ? body.password : '';
            const confirm = typeof body.confirm_password === 'string' ? body.confirm_password : '';
            const role = body.role === 'admin' ? 'admin' : 'user';

            if (!UUID_RE.test(id) || !full_name || !username) {
                return fail('ข้อมูลไม่ครบถ้วนสำหรับการแก้ไขผู้ใช้งาน');
            }
            if (!USERNAME_RE.test(username)) {
                return fail('ชื่อผู้ใช้งานใช้ได้เฉพาะ a-z, A-Z, 0-9, จุด (.), ขีดล่าง (_), ขีดกลาง (-) ยาว 2-50 ตัวอักษร');
            }
            if (email && !EMAIL_RE.test(email)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
            if (id === callerId && role !== 'admin') {
                return fail('ไม่สามารถลดสิทธิ์บัญชีของตนเองได้ (ป้องกันไม่ให้ระบบไม่เหลือผู้ดูแล)');
            }
            if (password !== '') {
                if (password.length < 6) return fail('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
                if (password !== confirm) return fail('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
            }

            const { data: target } = await admin
                .from('profiles').select('id, username').eq('id', id).maybeSingle();
            if (!target) return fail('ไม่พบผู้ใช้งานที่ต้องการแก้ไข');
            if (await usernameTaken(username, id)) return fail('ชื่อผู้ใช้งานนี้ถูกใช้งานโดยบัญชีอื่นแล้ว');

            // อัปเดตข้อมูลใน Supabase Auth เฉพาะส่วนที่เปลี่ยน (อีเมลสำหรับ login / รหัสผ่าน)
            const authUpdate: Record<string, unknown> = {};
            if (username.toLowerCase() !== target.username.toLowerCase()) {
                authUpdate.email = authEmail(username);
                authUpdate.email_confirm = true;
            }
            if (password !== '') authUpdate.password = password;
            if (Object.keys(authUpdate).length > 0) {
                const { error: aErr } = await admin.auth.admin.updateUserById(id, authUpdate);
                if (aErr) return fail('เกิดข้อผิดพลาดในการแก้ไขบัญชี: ' + aErr.message);
            }

            const { error: pErr } = await admin.from('profiles').update({
                full_name,
                username,
                email: email || null,
                phone: phone || null,
                role,
            }).eq('id', id);
            if (pErr) return fail('เกิดข้อผิดพลาดในการแก้ไขผู้ใช้งาน: ' + pErr.message);

            return json({ success: true, message: 'บันทึกข้อมูลผู้ใช้งานสำเร็จ' });
        }

        // ---------- ลบผู้ใช้งาน ----------
        if (action === 'delete') {
            const id = str(body.id);
            if (!UUID_RE.test(id)) return fail('ไม่พบผู้ใช้งานที่ต้องการลบ');
            if (id === callerId) return fail('ไม่สามารถลบบัญชีของตนเองที่กำลังใช้งานอยู่ได้');

            const { error: dErr } = await admin.auth.admin.deleteUser(id);
            if (dErr && !/not.?found/i.test(dErr.message)) {
                return fail('เกิดข้อผิดพลาดในการลบผู้ใช้งาน: ' + dErr.message);
            }
            await admin.from('profiles').delete().eq('id', id); // กันกรณีเหลือโปรไฟล์ค้าง
            return json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' });
        }

        return fail('ไม่รู้จักคำสั่งที่ส่งมา (action)', 400);
    } catch (e) {
        return fail('เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์: ' + (e instanceof Error ? e.message : String(e)), 500);
    }
});
