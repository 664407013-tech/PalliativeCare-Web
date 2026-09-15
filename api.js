/* =========================================================
   api.js
   =========================================================
   ไฟล์นี้เข้ามาแทนที่ api.php + db.php เดิม โดยทำหน้าที่เดียวกันทุก
   ประการ แต่เปลี่ยนจาก PHP + MySQL (session-based) ไปใช้
   Firebase Authentication + Firestore แทน เพื่อให้เว็บนี้ทำงานเป็น
   static site ล้วน ๆ (deploy บน GitHub Pages ได้โดยไม่ต้องมี server)

   หน้า login.js / script.js เดิมเรียก fetch('api.php?action=...')
   ไฟล์นี้จึงมีฟังก์ชัน apiCall(action, options) ที่ "คืนค่าในรูปแบบ
   เดียวกันทุกประการ" กับที่ api.php เคยตอบกลับ (resolve เป็น object
   ที่ parse JSON แล้วเลย) เพื่อให้แก้โค้ดฝั่งหน้าบ้านน้อยที่สุด
   ========================================================= */

const db = firebase.firestore();
const auth = firebase.auth();

// โดเมนปลอมสำหรับสร้างอีเมลใช้ยืนยันตัวตนกับ Firebase Auth เท่านั้น
// (ผู้ใช้งานยังคง login ด้วย username ตามปกติ ไม่ต้องรู้เรื่องอีเมลนี้)
const AUTH_EMAIL_DOMAIN = 'hospital.internal';

function escapeHtmlLite(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// แปลง FormData / URLSearchParams / plain object ให้เป็น plain object
// เดียวกัน โดยรองรับ field ที่ซ้ำกันแบบ "complications[]" ให้กลายเป็น array
function normalizeParams(input) {
    const out = {};
    if (!input) return out;

    const setField = (key, value) => {
        const isArrayField = key.endsWith('[]');
        const cleanKey = isArrayField ? key.slice(0, -2) : key;
        if (isArrayField) {
            if (!Array.isArray(out[cleanKey])) out[cleanKey] = [];
            out[cleanKey].push(value);
        } else {
            out[cleanKey] = value;
        }
    };

    if (input instanceof FormData || input instanceof URLSearchParams) {
        for (const [key, value] of input.entries()) setField(key, value);
    } else if (typeof input === 'object') {
        Object.keys(input).forEach((key) => {
            const val = input[key];
            if (Array.isArray(val)) {
                val.forEach((v) => setField(key.endsWith('[]') ? key : key + '[]', v));
            } else {
                setField(key, val);
            }
        });
    }
    return out;
}

function tsToIso(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    return ts;
}

/* =========================================================
   ฟังก์ชันคำนวณแผนการรักษา — ย้ายมาจาก calculateTreatmentPlan()
   ใน api.php แบบ 1:1 (ตรรกะทางคลินิกเดิมทุกจุด ไม่มีการแก้ไข)
   ========================================================= */
function calculateTreatmentPlan(id_card, weight, age, crcl, pps_score, pain_score, drug_type, care_location, complications_arr, adjustment_mode = 'auto', titrate_action = '', prev_dose = 0, prev_drug_type = '') {

    let base_daily_oral_morphine = 20;

    if (adjustment_mode === 'titrate' && prev_dose > 0 && prev_drug_type) {
        let prev_medd = 20;
        if (prev_drug_type === 'morphine_oral') {
            prev_medd = prev_dose;
        } else if (prev_drug_type === 'morphine_iv') {
            prev_medd = prev_dose * 3;
        } else if (prev_drug_type === 'fentanyl_iv') {
            prev_medd = prev_dose / 8;
        } else if (prev_drug_type === 'fentanyl_patch') {
            prev_medd = prev_dose * 2.4;
        }

        switch (titrate_action) {
            case 'increase_30':
                base_daily_oral_morphine = Math.round(prev_medd * 1.3 * 10) / 10;
                break;
            case 'increase_50':
                base_daily_oral_morphine = Math.round(prev_medd * 1.5 * 10) / 10;
                break;
            case 'decrease_25':
                base_daily_oral_morphine = Math.round(prev_medd * 0.75 * 10) / 10;
                break;
            case 'decrease_50':
                base_daily_oral_morphine = Math.round(prev_medd * 0.50 * 10) / 10;
                break;
            case 'same':
            default:
                base_daily_oral_morphine = prev_medd;
                break;
        }
    } else {
        if (pain_score >= 7) {
            base_daily_oral_morphine = 40;
        } else if (pain_score >= 4) {
            base_daily_oral_morphine = 30;
        }
    }

    let renal_percent = 100;
    let renal_status = "การทำงานของไตปกติ (GFR > 50 mL/min)";

    if (crcl > 50) {
        renal_percent = 100;
        renal_status = "GFR > 50 mL/min (ใช้ยาได้ 100%)";
    } else if (crcl >= 10 && crcl <= 50) {
        if (String(drug_type).includes('fentanyl')) {
            renal_percent = 75;
        } else {
            renal_percent = 50;
        }
        renal_status = `GFR 10-50 mL/min (ปรับลดขนาดยาเหลือ ${renal_percent}%)`;
    } else {
        if (drug_type === 'morphine_oral' || drug_type === 'morphine_iv') {
            drug_type = 'fentanyl_patch';
        }
        renal_percent = 50;
        renal_status = "GFR < 10 mL/min (ห้ามใช้ Morphine เด็ดขาด / ระบบเปลี่ยนเป็น Fentanyl ลดขนาดลงเหลือ 50%)";
    }

    let adjusted_dose = Math.round((base_daily_oral_morphine * renal_percent) / 100);
    let prn_dose = Math.round(adjusted_dose * 0.15 * 10) / 10;

    let atc_instruction = "";
    let prn_instruction = "";
    let drug_name = "";
    let unit = "mg";

    switch (drug_type) {
        case 'morphine_oral':
            drug_name = "Morphine ชนิดรับประทาน (Oral)";
            if (adjusted_dose <= 20) {
                atc_instruction = "- MST 10 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 1 แคปซูล ทุก 24 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup (10mg/5ml) ทาน 2 cc (4 mg) ทุก 2-4 ชั่วโมง เมื่อมีอาการปวดเฉียบพลัน";
            } else if (adjusted_dose <= 30) {
                atc_instruction = "- MST 10 mg ทาน 1 เม็ด ทุก 8 ชั่วโมง";
                prn_instruction = "- Morphine Syrup ทาน 2.5 cc (5 mg) หรือ Mo IR 10 mg ทานครึ่งเม็ด (5 mg) ทุก 2-4 ชั่วโมง";
            } else if (adjusted_dose <= 40) {
                atc_instruction = "- MST 10 mg ทาน 2 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 1 แคปซูล ทุก 12 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup ทาน 3.5 cc (7 mg) หรือ Mo IR 10 mg ทานครึ่งเม็ด ทุก 2-4 ชั่วโมง";
            } else if (adjusted_dose <= 60) {
                atc_instruction = "- MST 30 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 3 แคปซูล ทุก 24 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup ทาน 5 cc (10 mg) หรือ Mo IR 10 mg ทาน 1 เม็ด (10 mg) ทุก 2-4 ชั่วโมง";
            } else if (adjusted_dose <= 80) {
                atc_instruction = "- Kapanol 20 mg ทาน 2 แคปซูล ทุก 12 ชั่วโมง (หรือ MST 10 mg ทาน 4 เม็ด ทุก 12 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup ทาน 6.5 cc (13 mg) หรือ Mo IR 10 mg ทาน 1 เม็ด ทุก 2-4 ชั่วโมง";
            } else if (adjusted_dose <= 90) {
                atc_instruction = "- MST 30 mg ทาน 1 เม็ด ทุก 8 ชั่วโมง (หรือ MST 10 mg ทาน 3 เม็ด ทุก 8 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup ทาน 7.5 cc (15 mg) หรือ Mo IR 10 mg ทาน 1.5 เม็ด ทุก 2-4 ชั่วโมง";
            } else {
                atc_instruction = "- MST 60 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ MST 30 mg ทาน 2 เม็ด ทุก 12 ชั่วโมง)";
                prn_instruction = "- Morphine Syrup ทาน 10 cc (20 mg) หรือ Mo IR 10 mg ทาน 2 เม็ด ทุก 2-4 ชั่วโมง";
            }
            break;

        case 'morphine_iv': {
            drug_name = "Morphine ชนิดฉีด (IV/SC Infusion)";
            const iv_daily_dose = Math.round(adjusted_dose / 3 * 10) / 10;
            const iv_hourly = Math.round(iv_daily_dose / 24 * 100) / 100;
            const prn_iv = Math.round(iv_daily_dose * 0.15 * 10) / 10;

            atc_instruction = `- Morphine IV/SC continuous infusion อัตรา ${iv_hourly} mg/hr (ปริมาณรวม ${iv_daily_dose} mg ในรอบ 24 ชั่วโมง)`;
            prn_instruction = `- Morphine ${prn_iv} mg IV/SC prn สำหรับอาการปวดปะทุเฉียบพลัน (Breakthrough pain) ทุก 2-4 ชั่วโมง`;
            adjusted_dose = iv_daily_dose;
            break;
        }

        case 'fentanyl_iv': {
            drug_name = "Fentanyl ชนิดฉีด (IV/SC Infusion)";
            unit = "mcg";
            const fentanyl_mcg_hr = Math.round((adjusted_dose / 60) * 20 * 10) / 10;
            const prn_fentanyl = Math.round(fentanyl_mcg_hr * 1.5 * 10) / 10;

            atc_instruction = `- Fentanyl IV/SC continuous infusion อัตรา ${fentanyl_mcg_hr} mcg/hr`;
            prn_instruction = `- Fentanyl ${prn_fentanyl} mcg IV/SC prn สำหรับอาการปวดปะทุเฉียบพลัน ทุก 1-2 ชั่วโมง`;
            adjusted_dose = fentanyl_mcg_hr * 24;
            break;
        }

        case 'fentanyl_patch': {
            drug_name = "Fentanyl ชนิดแผ่นแปะผิวหนัง (Transdermal Patch)";
            unit = "mcg/hr";
            let patch_size = 12;
            if (adjusted_dose > 60 && adjusted_dose <= 90) {
                patch_size = 25;
            } else if (adjusted_dose > 90 && adjusted_dose <= 120) {
                patch_size = 37;
            } else if (adjusted_dose > 120 && adjusted_dose <= 180) {
                patch_size = 50;
            } else if (adjusted_dose > 180 && adjusted_dose <= 240) {
                patch_size = 62;
            } else if (adjusted_dose > 240 && adjusted_dose <= 300) {
                patch_size = 75;
            } else if (adjusted_dose > 300 && adjusted_dose <= 360) {
                patch_size = 87;
            } else if (adjusted_dose > 360) {
                patch_size = 100;
            }

            atc_instruction = `- แปะ Fentanyl Patch ขนาด ${patch_size} mcg/hr ที่หน้าอกหรือต้นแขน (เปลี่ยนแผ่นใหม่ทุกๆ 72 ชั่วโมง หรือ ทุก 3 วัน)`;
            prn_instruction = "- กรณีปวดเฉียบพลันระหว่างใช้อุปกรณ์แผ่นแปะ ให้ใช้ยาบรรเทาปวดเสริม Fentanyl IV prn หรือ Morphine Syrup/IR (หากค่าไต GFR > 10)";
            adjusted_dose = patch_size;
            break;
        }
    }

    let clinical_advice = "• การควบคุมความปวดได้ดีคือ ปวดน้อยเกือบตลอดเวลา (Pain score ≤ 3)<br>";
    clinical_advice += "• มีความปวดเฉียบพลันปะทุไม่เกิน 2 ครั้งต่อวัน และเมื่อได้รับประทานยาสำรอง PRN แล้วสามารถลดอาการลงมาได้รวดเร็ว";
    if (adjustment_mode === 'titrate') {
        clinical_advice += `<br>• <strong>[ปรับปรุงแผนยา]:</strong> คำนวณปริมาณยาเทียบเท่ารอบก่อนด้วย MEDD เพื่อดำเนินการ: <strong>${escapeHtmlLite(titrate_action)}</strong>`;
    }

    return {
        id_card,
        weight,
        age,
        crcl,
        pps_score,
        pain_score,
        care_location,
        complications: (complications_arr || []).filter(Boolean).join(','),
        renal_status,
        renal_percent,
        drug_name,
        unit,
        base_daily_dose: base_daily_oral_morphine,
        adjusted_daily_dose: adjusted_dose,
        prn_dose,
        atc_instruction,
        prn_instruction,
        clinical_advice
    };
}

/* =========================================================
   Auth helpers
   ========================================================= */
function authEmailFor(username) {
    return `${encodeURIComponent(String(username).toLowerCase())}@${AUTH_EMAIL_DOMAIN}`;
}

let authReadyResolved = false;
let cachedAuthUser = undefined;
function waitForAuthReady() {
    return new Promise((resolve) => {
        if (authReadyResolved) return resolve(cachedAuthUser);
        const unsub = auth.onAuthStateChanged((user) => {
            authReadyResolved = true;
            cachedAuthUser = user;
            unsub();
            resolve(user);
        });
    });
}

async function getActiveProfile(uid) {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.is_active === false) return null;
    return { id: doc.id, ...data };
}

/* =========================================================
   Action handlers — action name ตรงกับที่ api.php เดิมใช้ทุกจุด
   ========================================================= */
const actions = {

    async login(p) {
        const username = String(p.username || '').trim();
        const password = p.password || '';
        if (!username || !password) {
            return { success: false, message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน' };
        }
        try {
            const cred = await auth.signInWithEmailAndPassword(authEmailFor(username), password);
            const profile = await getActiveProfile(cred.user.uid);
            if (!profile) {
                await auth.signOut();
                return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
            }
            db.collection('users').doc(cred.user.uid).update({
                last_login: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(() => {});
            return {
                success: true,
                user: { username: profile.username, full_name: profile.full_name, role: profile.role }
            };
        } catch (e) {
            return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }
    },

    async logout() {
        await auth.signOut();
        return { success: true };
    },

    async check_session() {
        const user = await waitForAuthReady();
        if (!user) return { success: true, authenticated: false };
        const profile = await getActiveProfile(user.uid);
        if (!profile) {
            await auth.signOut();
            return { success: true, authenticated: false };
        }
        return {
            success: true,
            authenticated: true,
            user: { username: profile.username, full_name: profile.full_name, role: profile.role }
        };
    },

    async list_users(p) {
        const search = String(p.search || '').trim().toLowerCase();
        const snap = await db.collection('users').orderBy('created_at', 'asc').get();
        let users = snap.docs.map((d) => {
            const u = d.data();
            return {
                id: d.id,
                full_name: u.full_name,
                username: u.username,
                email: u.email || null,
                phone: u.phone || null,
                role: u.role,
                is_active: u.is_active !== false,
                created_at: tsToIso(u.created_at)
            };
        });
        if (search) {
            users = users.filter((u) =>
                (u.full_name || '').toLowerCase().includes(search) ||
                (u.username || '').toLowerCase().includes(search) ||
                (u.email || '').toLowerCase().includes(search)
            );
        }
        return { success: true, users };
    },

    async add_user(p) {
        const full_name = String(p.full_name || '').trim();
        const email = String(p.email || '').trim();
        const username = String(p.username || '').trim();
        const phone = String(p.phone || '').trim();
        const password = p.password || '';
        const confirm = p.confirm_password || '';
        let role = p.role || 'user';

        if (!full_name || !username || !password) {
            return { success: false, message: 'กรุณากรอกชื่อ-นามสกุล, ชื่อผู้ใช้งาน และรหัสผ่านให้ครบถ้วน' };
        }
        if (password.length < 6) {
            return { success: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' };
        }
        if (password !== confirm) {
            return { success: false, message: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' };
        }
        if (!['user', 'admin'].includes(role)) role = 'user';

        const usernameDoc = await db.collection('usernames').doc(username).get();
        if (usernameDoc.exists) {
            return { success: false, message: 'ชื่อผู้ใช้งานนี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น' };
        }

        try {
            // ใช้แอปสำรอง (Secondary) สร้างบัญชีใหม่ เพื่อไม่ให้ admin ที่ล็อกอินอยู่หลุด session
            const secondaryAuth = firebaseSecondaryApp.auth();
            const cred = await secondaryAuth.createUserWithEmailAndPassword(authEmailFor(username), password);
            const uid = cred.user.uid;
            await secondaryAuth.signOut();

            await db.collection('users').doc(uid).set({
                full_name,
                email: email || null,
                username,
                phone: phone || null,
                role,
                is_active: true,
                created_at: firebase.firestore.FieldValue.serverTimestamp(),
                last_login: null
            });
            await db.collection('usernames').doc(username).set({ uid });

            return { success: true, message: 'เพิ่มผู้ใช้งานใหม่สำเร็จ', id: uid };
        } catch (e) {
            const msg = e && e.code === 'auth/email-already-in-use'
                ? 'ชื่อผู้ใช้งานนี้ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น'
                : ('เกิดข้อผิดพลาดในการเพิ่มผู้ใช้งาน: ' + (e.message || e));
            return { success: false, message: msg };
        }
    },

    async update_user(p) {
        const id = String(p.id || '');
        const full_name = String(p.full_name || '').trim();
        const email = String(p.email || '').trim();
        const username = String(p.username || '').trim();
        const phone = String(p.phone || '').trim();
        const password = p.password || '';
        const confirm = p.confirm_password || '';
        let role = p.role || 'user';

        if (!id || !full_name || !username) {
            return { success: false, message: 'ข้อมูลไม่ครบถ้วนสำหรับการแก้ไขผู้ใช้งาน' };
        }
        if (!['user', 'admin'].includes(role)) role = 'user';

        const userRef = db.collection('users').doc(id);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return { success: false, message: 'ไม่พบผู้ใช้งานนี้ในระบบ' };
        }
        const oldUsername = userSnap.data().username;

        if (username !== oldUsername) {
            const clash = await db.collection('usernames').doc(username).get();
            if (clash.exists) {
                return { success: false, message: 'ชื่อผู้ใช้งานนี้ถูกใช้งานโดยบัญชีอื่นแล้ว' };
            }
        }

        if (password !== '') {
            if (password.length < 6) {
                return { success: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' };
            }
            if (password !== confirm) {
                return { success: false, message: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' };
            }
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.uid === id) {
                try {
                    await currentUser.updatePassword(password);
                } catch (e) {
                    return { success: false, message: 'เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + (e.message || e) + ' (อาจต้อง login ใหม่ก่อนเปลี่ยนรหัสผ่านของตนเอง)' };
                }
            } else {
                // ข้อจำกัดของ Firebase client SDK: เปลี่ยนรหัสผ่านของ "ผู้ใช้งานคนอื่น" จากฝั่ง
                // client ไม่ได้โดยตรง ต้องใช้ Cloud Function + Admin SDK (ดู README)
                return {
                    success: false,
                    message: 'ไม่สามารถเปลี่ยนรหัสผ่านของผู้ใช้งานอื่นจากฝั่ง client ได้ (ข้อจำกัดของ Firebase) กรุณาตั้งค่า Cloud Function ตามคำแนะนำใน README หรือให้ผู้ใช้งานเปลี่ยนรหัสผ่านด้วยตนเอง'
                };
            }
        }

        try {
            if (username !== oldUsername) {
                await db.collection('usernames').doc(oldUsername).delete();
                await db.collection('usernames').doc(username).set({ uid: id });
            }
            await userRef.update({
                full_name,
                email: email || null,
                username,
                phone: phone || null,
                role
            });
            return { success: true, message: 'บันทึกข้อมูลผู้ใช้งานสำเร็จ' };
        } catch (e) {
            return { success: false, message: 'เกิดข้อผิดพลาดในการแก้ไขผู้ใช้งาน: ' + (e.message || e) };
        }
    },

    async delete_user(p) {
        const id = String(p.id || '');
        if (!id) return { success: false, message: 'ไม่พบผู้ใช้งานที่ต้องการลบ' };
        if (auth.currentUser && auth.currentUser.uid === id) {
            return { success: false, message: 'ไม่สามารถลบบัญชีของตนเองที่กำลังใช้งานอยู่ได้' };
        }
        try {
            const userRef = db.collection('users').doc(id);
            const snap = await userRef.get();
            if (snap.exists) {
                const username = snap.data().username;
                if (username) await db.collection('usernames').doc(username).delete();
            }
            await userRef.delete();
            // หมายเหตุ: บัญชี Firebase Authentication ของผู้ใช้งานนี้ยังไม่ถูกลบจริง (ต้องใช้ Admin
            // SDK/Cloud Function หรือลบมือใน Firebase Console) แต่จะเข้าใช้แอปนี้ไม่ได้อีกต่อไป
            // เพราะระบบตรวจสอบสิทธิ์จากเอกสารใน collection "users" เป็นหลัก
            return { success: true, message: 'ลบผู้ใช้งานสำเร็จ' };
        } catch (e) {
            return { success: false, message: 'เกิดข้อผิดพลาดในการลบผู้ใช้งาน: ' + (e.message || e) };
        }
    },

    async get_patient(p) {
        const id_card = p.id_card || '';
        try {
            const patientDoc = await db.collection('patients').doc(id_card).get();
            if (!patientDoc.exists) {
                return { success: false, message: 'ไม่พบข้อมูลผู้ป่วยรายเก่า' };
            }
            const patient = { id_card, ...patientDoc.data() };

            const lastSnap = await db.collection('assessments')
                .where('id_card', '==', id_card)
                .orderBy('created_at', 'desc')
                .limit(1)
                .get();

            let last_assessment = null;
            if (!lastSnap.empty) {
                const d = lastSnap.docs[0];
                last_assessment = { id: d.id, ...d.data(), created_at: tsToIso(d.data().created_at) };
            }

            return { success: true, patient, last_assessment };
        } catch (e) {
            return { success: false, message: e.message || String(e) };
        }
    },

    async get_archive(p) {
        try {
            const search_id = (p.search_id || '').trim();
            const filter_type = p.filter_type || 'all';
            const start_date = p.start_date || '';
            const end_date = p.end_date || '';

            let query = db.collection('assessments').orderBy('created_at', 'desc');
            const now = new Date();

            if (filter_type === 'daily') {
                const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                query = query.where('created_at', '>=', start).where('created_at', '<', end);
            } else if (filter_type === 'monthly') {
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                query = query.where('created_at', '>=', start).where('created_at', '<', end);
            } else if (filter_type === '6m') {
                const start = new Date(now); start.setMonth(start.getMonth() - 6);
                query = query.where('created_at', '>=', start);
            } else if (filter_type === '12m') {
                const start = new Date(now); start.setMonth(start.getMonth() - 12);
                query = query.where('created_at', '>=', start);
            } else if (filter_type === 'custom' && start_date && end_date) {
                const start = new Date(start_date + 'T00:00:00');
                const end = new Date(end_date + 'T23:59:59.999');
                query = query.where('created_at', '>=', start).where('created_at', '<=', end);
            }

            const snap = await query.get();
            let rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: tsToIso(d.data().created_at) }));

            if (search_id) {
                rows = rows.filter((r) => (r.id_card || '').includes(search_id));
            }

            const grouped = {};
            rows.forEach((row) => {
                const id_card = row.id_card;
                if (!grouped[id_card]) {
                    grouped[id_card] = { id_card, age: row.age, weight: row.weight, assessments: [] };
                }
                grouped[id_card].assessments.push(row);
            });

            return Object.values(grouped);
        } catch (e) {
            return [];
        }
    },

    async delete_assessment(p) {
        try {
            const id = p.id || '';
            await db.collection('assessments').doc(String(id)).delete();
            return { success: true };
        } catch (e) {
            return { success: false, message: e.message || String(e) };
        }
    },

    async get_assessment_by_id(p) {
        try {
            const id = String(p.id || '');
            const doc = await db.collection('assessments').doc(id).get();
            if (!doc.exists) return { success: false };
            const data = doc.data();

            let result = data.treatment_plan;
            if (!result) {
                result = calculateTreatmentPlan(
                    data.id_card, data.weight, data.age, data.crcl,
                    data.pps_score, data.pain_score, data.drug_type,
                    data.care_location, String(data.complications || '').split(',')
                );
            }
            result = { ...result, id: doc.id, weight: data.weight, age: data.age, drug_type: data.drug_type };
            return { success: true, result };
        } catch (e) {
            return { success: false, message: e.message || String(e) };
        }
    },

    async save_assessment(p) {
        try {
            const id_card = p.id_card || '';
            const weight = parseFloat(p.weight || 0);
            const age = parseInt(p.age || 0, 10);
            const crcl = parseFloat(p.crcl || 0);
            const pps_score = parseInt(p.pps_score || 0, 10);
            const pain_score = parseInt(p.pain_score || 0, 10);
            const drug_type = p.drug_type || '';
            const care_location = p.care_location || '';
            const complications_arr = Array.isArray(p.complications) ? p.complications : (p.complications ? [p.complications] : []);

            const adjustment_mode = p.adjustment_mode || 'auto';
            const titrate_action = p.titrate_action || '';
            const prev_dose = parseFloat(p.prev_dose || 0);
            const prev_drug_type = p.prev_drug_type || '';

            await db.collection('patients').doc(id_card).set({ id_card, weight, age }, { merge: true });

            const calcResult = calculateTreatmentPlan(
                id_card, weight, age, crcl, pps_score, pain_score,
                drug_type, care_location, complications_arr,
                adjustment_mode, titrate_action, prev_dose, prev_drug_type
            );

            await db.collection('assessments').add({
                id_card, weight, age, crcl, pps_score, pain_score,
                drug_type, care_location,
                complications: calcResult.complications,
                base_daily_dose: calcResult.base_daily_dose,
                adjusted_daily_dose: calcResult.adjusted_daily_dose,
                prn_dose: calcResult.prn_dose,
                treatment_plan: calcResult,
                created_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, result: calcResult };
        } catch (e) {
            return { success: false, message: 'เกิดข้อผิดพลาดในการบันทึกฐานข้อมูล: ' + (e.message || e) };
        }
    },

    async update_assessment(p) {
        try {
            const id = String(p.id || '');
            const id_card = p.id_card || '';
            const weight = parseFloat(p.weight || 0);
            const age = parseInt(p.age || 0, 10);
            const crcl = parseFloat(p.crcl || 0);
            const pps_score = parseInt(p.pps_score || 0, 10);
            const pain_score = parseInt(p.pain_score || 0, 10);
            const drug_type = p.drug_type || '';
            const care_location = p.care_location || '';
            const complications_arr = Array.isArray(p.complications) ? p.complications : (p.complications ? [p.complications] : []);

            if (!id) throw new Error('ไม่พบ ID รายการประวัติที่ต้องการแก้ไข');

            await db.collection('patients').doc(id_card).set({ weight, age }, { merge: true });

            const calcResult = calculateTreatmentPlan(
                id_card, weight, age, crcl, pps_score, pain_score,
                drug_type, care_location, complications_arr
            );
            calcResult.id = id;

            await db.collection('assessments').doc(id).update({
                id_card, weight, age, crcl, pps_score, pain_score,
                drug_type, care_location,
                complications: calcResult.complications,
                base_daily_dose: calcResult.base_daily_dose,
                adjusted_daily_dose: calcResult.adjusted_daily_dose,
                prn_dose: calcResult.prn_dose,
                treatment_plan: calcResult
            });

            return { success: true, result: calcResult };
        } catch (e) {
            return { success: false, message: 'เกิดข้อผิดพลาดในการแก้ไข: ' + (e.message || e) };
        }
    }
};

const PUBLIC_ACTIONS = ['login', 'check_session'];
const ADMIN_ONLY_ACTIONS = ['list_users', 'add_user', 'update_user', 'delete_user'];

/**
 * ฟังก์ชันหลักที่ login.js / script.js เรียกใช้แทน fetch('api.php?action=...')
 * คืนค่าเป็น Promise ที่ resolve เป็น object เดียวกันกับที่ api.php เคยตอบกลับ
 */
async function apiCall(action, opts = {}) {
    const params = normalizeParams({ ...normalizeParams(opts.params), ...normalizeParams(opts.body) });

    if (!actions[action]) {
        return { success: false, message: 'ไม่พบ action นี้: ' + action };
    }

    if (!PUBLIC_ACTIONS.includes(action)) {
        const user = await waitForAuthReady();
        if (!user) {
            return { success: false, message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', auth_required: true };
        }
        if (ADMIN_ONLY_ACTIONS.includes(action)) {
            const profile = await getActiveProfile(user.uid);
            if (!profile || profile.role !== 'admin') {
                return { success: false, message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ใช้งานส่วนนี้' };
            }
        }
    }

    return actions[action](params);
}

// เผื่อไฟล์อื่นต้องใช้ฟังก์ชันคำนวณตรง ๆ
window.calculateTreatmentPlan = calculateTreatmentPlan;
window.apiCall = apiCall;
