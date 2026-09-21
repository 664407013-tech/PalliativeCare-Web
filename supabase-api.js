/* =========================================================================
   supabase-api.js
   ชั้นเชื่อมต่อฐานข้อมูล — ใช้แทน api.php + db.php เดิมทั้งหมด
   ทุกฟังก์ชันคืนค่ารูปแบบ JSON เดียวกับที่ api.php เคยตอบกลับ
   ทำให้โค้ดหน้าเว็บ (script.js / login.js) แก้เพียงจุดเรียก fetch()

   ต้องโหลดตามลำดับ:
     1) supabase-js (CDN)  2) supabase-config.js  3) treatment-calc.js  4) supabase-api.js
   ========================================================================= */
(function () {
    'use strict';

    const cfg = window.SUPABASE_CONFIG;
    if (!window.supabase || !cfg) {
        console.error('[supabase-api] ไม่พบ supabase-js หรือ supabase-config.js');
        return;
    }

    let authStorage;
    try {
        authStorage = cfg.sessionStorage === 'local' ? window.localStorage : window.sessionStorage;
    } catch (e) {
        authStorage = undefined; // เบราว์เซอร์บล็อก storage → ใช้ค่าเริ่มต้นของไลบรารี
    }

    const sb = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storage: authStorage
        }
    });

    /* ---------------------------------------------------------------- utils */

    function fail(message) {
        return { success: false, message: message };
    }

    function usernameToEmail(username) {
        return String(username).trim().toLowerCase() + '@' + cfg.authEmailDomain;
    }

    // FormData / plain object → plain object (ฟิลด์ชื่อลงท้าย [] จะรวมเป็น array)
    function toObj(input) {
        if (typeof FormData !== 'undefined' && input instanceof FormData) {
            const o = {};
            for (const [k, v] of input.entries()) {
                if (k.endsWith('[]')) {
                    const key = k.slice(0, -2);
                    (o[key] = o[key] || []).push(v);
                } else {
                    o[k] = v;
                }
            }
            return o;
        }
        return input || {};
    }

    const num = (v) => parseFloat(v) || 0;
    const int = (v) => parseInt(v, 10) || 0;

    function asArray(v) {
        if (Array.isArray(v)) return v;
        return v === undefined || v === null || v === '' ? [] : [v];
    }

    /* ----------------------------------------------------- session / login */

    // อ่านโปรไฟล์ของผู้ใช้ที่ login อยู่ (ผ่าน RLS จึงยืนยัน token กับเซิร์ฟเวอร์ไปในตัว)
    async function getProfile() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return null;
        const { data, error } = await sb
            .from('profiles')
            .select('id, username, full_name, role, is_active')
            .eq('id', session.user.id)
            .maybeSingle();
        if (error || !data) return null;
        return data;
    }

    async function checkSession() {
        try {
            const p = await getProfile();
            if (!p || !p.is_active) return { success: true, authenticated: false };
            return {
                success: true,
                authenticated: true,
                user: { id: p.id, username: p.username, full_name: p.full_name, role: p.role }
            };
        } catch (e) {
            return { success: true, authenticated: false };
        }
    }

    async function login(username, password) {
        username = String(username || '').trim();
        password = String(password || '');
        if (username === '' || password === '') {
            return fail('กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน');
        }

        const { error } = await sb.auth.signInWithPassword({
            email: usernameToEmail(username),
            password: password
        });

        if (error) {
            if (error.name === 'AuthRetryableFetchError') throw error; // เครือข่ายมีปัญหา → ให้หน้า login แสดงข้อความเชื่อมต่อไม่ได้
            if (error.status === 429) return fail('พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
            return fail('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
        }

        const profile = await getProfile();
        if (!profile || !profile.is_active) {
            await sb.auth.signOut();
            return fail('บัญชีนี้ไม่มีสิทธิ์ใช้งานหรือถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        }

        await sb.rpc('touch_last_login'); // ไม่ critical — ถ้าพลาดก็ไม่ต้องกัน login

        return {
            success: true,
            user: { username: profile.username, full_name: profile.full_name, role: profile.role }
        };
    }

    async function logout() {
        try { await sb.auth.signOut(); } catch (e) { /* ไม่เป็นไร */ }
        return { success: true };
    }

    /* ------------------------------------------- จัดการผู้ใช้งาน (Admin) */

    // การสร้าง/แก้ไข/ลบบัญชี ต้องใช้สิทธิ์ service role ซึ่งห้ามอยู่ในเบราว์เซอร์
    // จึงเรียกผ่าน Edge Function "admin-users" (ตรวจสิทธิ์ Admin ฝั่งเซิร์ฟเวอร์)
    async function callAdminUsers(payload) {
        const { data, error } = await sb.functions.invoke('admin-users', { body: payload });
        if (error) {
            let msg = error.message || 'เรียก Edge Function ไม่สำเร็จ';
            try {
                const j = await error.context.json();
                if (j && j.message) msg = j.message;
            } catch (e) { /* ใช้ข้อความเดิม */ }
            return fail(msg);
        }
        return data || fail('เซิร์ฟเวอร์ไม่ตอบกลับ');
    }

    async function listUsers(search) {
        try {
            const p = await getProfile();
            if (!p || p.role !== 'admin') {
                return fail('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ใช้งานส่วนนี้');
            }
            const { data, error } = await sb
                .from('profiles')
                .select('id, full_name, username, email, phone, role, is_active, created_at')
                .order('created_at', { ascending: true });
            if (error) return fail('ไม่สามารถดึงรายชื่อผู้ใช้งานได้: ' + error.message);

            const q = String(search || '').trim().toLowerCase();
            const users = q === '' ? data : data.filter(u =>
                [u.full_name, u.username, u.email].some(v => String(v || '').toLowerCase().includes(q))
            );
            return { success: true, users: users };
        } catch (e) {
            return fail('ไม่สามารถดึงรายชื่อผู้ใช้งานได้: ' + e.message);
        }
    }

    async function addUser(input) {
        const f = toObj(input);
        if (!String(f.full_name || '').trim() || !String(f.username || '').trim() || !f.password) {
            return fail('กรุณากรอกชื่อ-นามสกุล, ชื่อผู้ใช้งาน และรหัสผ่านให้ครบถ้วน');
        }
        if (String(f.password).length < 6) return fail('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
        if (f.password !== f.confirm_password) return fail('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        return callAdminUsers({ action: 'create', ...f });
    }

    async function updateUser(input) {
        const f = toObj(input);
        if (!f.id || !String(f.full_name || '').trim() || !String(f.username || '').trim()) {
            return fail('ข้อมูลไม่ครบถ้วนสำหรับการแก้ไขผู้ใช้งาน');
        }
        if (f.password) {
            if (String(f.password).length < 6) return fail('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
            if (f.password !== f.confirm_password) return fail('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        }
        return callAdminUsers({ action: 'update', ...f });
    }

    async function deleteUser(id) {
        if (!id) return fail('ไม่พบผู้ใช้งานที่ต้องการลบ');
        return callAdminUsers({ action: 'delete', id: id });
    }

    /* ---------------------------------------------- ผู้ป่วย / ประวัติการประเมิน */

    // 1. ดึงข้อมูลผู้ป่วยรายเก่า + ข้อมูลการรักษารอบล่าสุด
    async function getPatient(idCard) {
        try {
            const { data: patient, error } = await sb
                .from('patients').select('*').eq('id_card', idCard).maybeSingle();
            if (error) return fail(error.message);
            if (!patient) return fail('ไม่พบข้อมูลผู้ป่วยรายเก่า');

            const { data: last, error: e2 } = await sb
                .from('assessments').select('*').eq('id_card', idCard)
                .order('created_at', { ascending: false }).order('id', { ascending: false })
                .limit(1).maybeSingle();
            if (e2) return fail(e2.message);

            return { success: true, patient: patient, last_assessment: last || null };
        } catch (e) {
            return fail(e.message);
        }
    }

    // เวลาเริ่มต้นวัน (เวลาท้องถิ่นของเครื่อง) จากสตริง 'YYYY-MM-DD'
    function localDayStart(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    // 2. ดึงรายการประวัติทั้งหมด พร้อมตัวกรองระยะเวลาและช่วงวันที่กำหนดเอง
    //    (โยน error ออกไปให้หน้าเว็บแสดง แทนการกลืนแล้วคืน [] เหมือนเดิม จะได้เห็นปัญหาสิทธิ์/เครือข่ายจริง)
    async function getArchive(params) {
        params = params || {};
        const searchId = String(params.search_id || '').trim();
        const filterType = params.filter_type || 'all';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let from = null, to = null; // ช่วงเวลา [from, to)
        if (filterType === 'daily') {
            from = today;
            to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        } else if (filterType === 'monthly') {
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        } else if (filterType === '6m') {
            from = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
        } else if (filterType === '12m') {
            from = new Date(today.getFullYear(), today.getMonth() - 12, today.getDate());
        } else if (filterType === 'custom' && params.start_date && params.end_date) {
            from = localDayStart(params.start_date);
            const end = localDayStart(params.end_date);
            to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
        }

        const buildQuery = () => {
            let q = sb.from('assessments').select('*, patients(weight, age)');
            if (searchId) q = q.ilike('id_card', '%' + searchId + '%');
            if (from) q = q.gte('created_at', from.toISOString());
            if (to) q = q.lt('created_at', to.toISOString());
            return q
                .order('id_card', { ascending: true })
                .order('created_at', { ascending: false })
                .order('id', { ascending: false });
        };

        // PostgREST จำกัดจำนวนแถวต่อคำขอ (ค่าเริ่มต้น 1,000) → ดึงเป็นหน้าๆ จนครบ
        const PAGE = 1000;
        let rows = [];
        for (let offset = 0; ; offset += PAGE) {
            const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
            if (error) throw new Error(error.message);
            rows = rows.concat(data);
            if (data.length < PAGE) break;
        }

        const grouped = new Map();
        for (const r of rows) {
            const p = Array.isArray(r.patients) ? r.patients[0] : r.patients;
            const row = Object.assign({}, r, { weight: p ? p.weight : null, age: p ? p.age : null });
            delete row.patients;

            if (!grouped.has(row.id_card)) {
                grouped.set(row.id_card, {
                    id_card: row.id_card,
                    age: row.age,
                    weight: row.weight,
                    assessments: []
                });
            }
            grouped.get(row.id_card).assessments.push(row);
        }
        return Array.from(grouped.values());
    }

    // 3. ลบข้อมูลประวัติเดี่ยว
    async function deleteAssessment(id) {
        try {
            const { data, error } = await sb.from('assessments').delete().eq('id', id).select('id');
            if (error) return fail(error.message);
            if (!data || data.length === 0) return fail('ไม่พบรายการที่ต้องการลบ หรือไม่มีสิทธิ์ลบรายการนี้');
            return { success: true };
        } catch (e) {
            return fail(e.message);
        }
    }

    // 4. ดึงประวัติการรักษาย้อนหลังราย ID
    async function getAssessmentById(id) {
        try {
            const { data, error } = await sb
                .from('assessments').select('*, patients(weight, age)').eq('id', id).maybeSingle();
            if (error) return fail(error.message);
            if (!data) return { success: false };

            const p = Array.isArray(data.patients) ? data.patients[0] : data.patients;
            const weight = p ? p.weight : 0;
            const age = p ? p.age : 0;

            let result = data.treatment_plan;
            if (!result || typeof result !== 'object') {
                result = window.calculateTreatmentPlan(
                    data.id_card, weight, age, data.crcl, data.pps_score, data.pain_score,
                    data.drug_type, data.care_location, String(data.complications || '').split(',')
                );
            }
            result.id = data.id;
            // แผนที่บันทึกไว้ไม่มี drug_type → เติมให้ เพื่อให้หน้าแก้ไขเลือกชนิดยาเดิมได้ถูกต้อง
            result.drug_type = data.drug_type;
            return { success: true, result: result };
        } catch (e) {
            return fail(e.message);
        }
    }

    // อ่านค่าจากฟอร์มการประเมิน (ใช้ร่วมกันทั้งบันทึกใหม่และแก้ไข)
    function readAssessmentForm(input) {
        const f = toObj(input);
        return {
            id: int(f.id),
            id_card: String(f.id_card || '').trim(),
            weight: num(f.weight),
            age: int(f.age),
            crcl: num(f.crcl),
            pps_score: int(f.pps_score),
            pain_score: int(f.pain_score),
            drug_type: String(f.drug_type || ''),
            care_location: String(f.care_location || ''),
            complications_arr: asArray(f.complications).filter(v => v !== null && v !== ''),
            adjustment_mode: f.adjustment_mode || 'auto',
            titrate_action: f.titrate_action || '',
            prev_dose: num(f.prev_dose),
            prev_drug_type: f.prev_drug_type || ''
        };
    }

    // 5. บันทึกและประมวลผลแผนการรักษา (สร้างรายการใหม่)
    async function saveAssessment(input) {
        try {
            const f = readAssessmentForm(input);
            if (!f.id_card) return fail('กรุณากรอกเลขบัตรประชาชน');

            const calc = window.calculateTreatmentPlan(
                f.id_card, f.weight, f.age, f.crcl, f.pps_score, f.pain_score,
                f.drug_type, f.care_location, f.complications_arr,
                f.adjustment_mode, f.titrate_action, f.prev_dose, f.prev_drug_type
            );

            const { data: newId, error } = await sb.rpc('save_assessment', {
                p_id_card: f.id_card,
                p_weight: f.weight,
                p_age: f.age,
                p_crcl: f.crcl,
                p_pps_score: f.pps_score,
                p_pain_score: f.pain_score,
                p_drug_type: f.drug_type,
                p_care_location: f.care_location,
                p_complications: f.complications_arr.join(','),
                p_base_daily_dose: calc.base_daily_dose,
                p_adjusted_daily_dose: calc.adjusted_daily_dose,
                p_prn_dose: calc.prn_dose,
                p_treatment_plan: calc
            });
            if (error) return fail('เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล: ' + error.message);

            calc.id = newId; // เลขอ้างอิงเอกสาร (AS-000123) ตอนพิมพ์
            return { success: true, result: calc };
        } catch (e) {
            return fail('เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล: ' + e.message);
        }
    }

    // 6. อัปเดตและคำนวณแผนการรักษาใหม่เมื่อกดแก้ไขจาก Edit Modal
    async function updateAssessment(input) {
        try {
            const f = readAssessmentForm(input);
            if (f.id <= 0) return fail('ไม่พบ ID รายการประวัติที่ต้องการแก้ไข');

            const calc = window.calculateTreatmentPlan(
                f.id_card, f.weight, f.age, f.crcl, f.pps_score, f.pain_score,
                f.drug_type, f.care_location, f.complications_arr
            );
            calc.id = f.id;

            const { error } = await sb.rpc('update_assessment', {
                p_id: f.id,
                p_id_card: f.id_card,
                p_weight: f.weight,
                p_age: f.age,
                p_crcl: f.crcl,
                p_pps_score: f.pps_score,
                p_pain_score: f.pain_score,
                p_drug_type: f.drug_type,
                p_care_location: f.care_location,
                p_complications: f.complications_arr.join(','),
                p_base_daily_dose: calc.base_daily_dose,
                p_adjusted_daily_dose: calc.adjusted_daily_dose,
                p_prn_dose: calc.prn_dose,
                p_treatment_plan: calc
            });
            if (error) return fail('เกิดข้อผิดพลาดในการแก้ไข: ' + error.message);

            return { success: true, result: calc };
        } catch (e) {
            return fail('เกิดข้อผิดพลาดในการแก้ไข: ' + e.message);
        }
    }

    /* --------------------------------------------------------------- export */
    window.api = {
        client: sb,
        checkSession, login, logout,
        listUsers, addUser, updateUser, deleteUser,
        getPatient, getArchive, getAssessmentById,
        saveAssessment, updateAssessment, deleteAssessment
    };
})();
