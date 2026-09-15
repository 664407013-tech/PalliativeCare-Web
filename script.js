// เก็บสถานะตัวกรองปัจจุบัน
let currentFilterType = 'all';

// เก็บข้อมูลผลลัพธ์ล่าสุดไว้สำหรับใช้ตอนพิมพ์เอกสารทางการ (formal print)
let currentAssessmentResult = null; // ผลลัพธ์จากหน้าประเมินแผนการรักษา (resultCard)
let currentHistoryResult = null;    // ผลลัพธ์จากหน้าต่างดูประวัติในคลังข้อมูล (historyModal)

// โหลดข้อมูลผู้ใช้งานปัจจุบันจาก session มาแสดงใน Sidebar และ Header
function loadCurrentUser() {
    apiCall('check_session')
        .then(data => {
            if (data.success && data.authenticated && data.user) {
                const name = data.user.full_name || data.user.username || 'ผู้ใช้งาน';
                const initial = name.trim().charAt(0).toUpperCase() || 'U';
                const roleRaw = (data.user.role || 'user').toLowerCase();
                const role = roleRaw === 'admin' ? 'ADMIN' : 'บุคลากร';

                document.getElementById('sidebarUserAvatar').innerText = initial;
                document.getElementById('sidebarUserName').innerText = name;
                document.getElementById('sidebarUserRole').innerText = role;

                document.getElementById('headerUserAvatar').innerText = initial;
                document.getElementById('headerUserName').innerText = name;

                // แสดงเมนู "จัดการผู้ใช้งาน" เฉพาะผู้ใช้งานที่มีสิทธิ์ Admin เท่านั้น
                const navUsersItem = document.getElementById('nav-users-item');
                if (navUsersItem) {
                    if ((data.user.role || '').toLowerCase() === 'admin') {
                        navUsersItem.classList.remove('d-none');
                    } else {
                        navUsersItem.classList.add('d-none');
                    }
                }
            } else {
                // ไม่มี session ที่ถูกต้อง ให้กลับไปหน้าล็อกอิน
                window.location.replace('login.html');
            }
        })
        .catch(() => {
            window.location.replace('login.html');
        });
}
loadCurrentUser();

// ออกจากระบบ
function logoutUser() {
    if (!confirm('ต้องการออกจากระบบหรือไม่?')) return;
    apiCall('logout')
        .then(() => {
            window.location.href = 'login.html';
        })
        .catch(() => {
            // แม้ request จะล้มเหลว ก็พาไปหน้าล็อกอินอยู่ดีเพื่อความปลอดภัย
            window.location.href = 'login.html';
        });
}

// ฟังก์ชันกรองความปลอดภัยของ String ก่อนแทรกใน HTML (XSS Guardrail)
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// อัปเดตชื่อหัวข้อหน้าเว็บเมื่อเปลี่ยนแท็บจากเมนู Sidebar
function setActiveNav(activeId) {
    ['nav-assess', 'nav-archive', 'nav-users'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === activeId);
    });
}

document.getElementById('nav-assess').addEventListener('click', () => {
    document.getElementById('pageTitle').innerText = 'ประเมินแผนการรักษา';
    setActiveNav('nav-assess');
});

document.getElementById('nav-archive').addEventListener('click', () => {
    document.getElementById('pageTitle').innerText = 'คลังประวัติผู้ป่วย';
    setActiveNav('nav-archive');
});

const navUsersLink = document.getElementById('nav-users');
if (navUsersLink) {
    navUsersLink.addEventListener('click', () => {
        document.getElementById('pageTitle').innerText = 'จัดการผู้ใช้งาน';
        setActiveNav('nav-users');
    });
}

// สลับโหมดบันทึกผู้ป่วยใหม่/เก่า
function togglePatientType() {
    const isOld = document.getElementById('type_old').checked;
    const searchBox = document.getElementById('oldPatientSearch');
    const idInput = document.getElementById('id_card');
    const historyCard = document.getElementById('oldPatientHistoryCard');
    
    if (isOld) {
        searchBox.classList.remove('d-none');
        idInput.setAttribute('readonly', true);
        idInput.classList.add('bg-secondary-subtle');
    } else {
        searchBox.classList.add('d-none');
        idInput.removeAttribute('readonly');
        idInput.classList.remove('bg-secondary-subtle');
        document.getElementById('assessmentForm').reset();
        document.getElementById('type_new').checked = true;
        historyCard.classList.add('d-none');
        window.lastAssessment = null;
        checkRenalFunction();
    }
}

// สลับโหมดปรับโดสยาเก่า
function toggleAdjustmentMode() {
    const isTitrate = document.getElementById('mode_titrate').checked;
    const titrationOptions = document.getElementById('titrationOptions');
    if (isTitrate) {
        titrationOptions.classList.remove('d-none');
    } else {
        titrationOptions.classList.add('d-none');
    }
}

// ดึงข้อมูลผู้ป่วยและประวัติการรักษารอบเก่าล่าสุด
function fetchOldPatient() {
    const idCard = document.getElementById('search_id_card').value;
    const status = document.getElementById('search_status');
    
    if (idCard.length !== 13) {
        status.innerHTML = '<span class="text-danger">⚠️ กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก</span>';
        return;
    }

    status.innerHTML = '<span class="text-primary"><i class="bi bi-hourglass-split"></i> กำลังค้นหาข้อมูล...</span>';

    apiCall('get_patient', { params: { id_card: idCard } })
        .then(data => {
            if (data.success) {
                document.getElementById('id_card').value = data.patient.id_card;
                document.getElementById('weight').value = data.patient.weight;
                document.getElementById('age').value = data.patient.age;
                
                const historyCard = document.getElementById('oldPatientHistoryCard');
                if (data.last_assessment) {
                    window.lastAssessment = data.last_assessment;
                    document.getElementById('prev_date').innerText = new Date(data.last_assessment.created_at).toLocaleString('th-TH');
                    
                    let p_plan = data.last_assessment.treatment_plan;
                    let drugName = p_plan ? p_plan.drug_name : data.last_assessment.drug_type;
                    let adjustedDose = data.last_assessment.adjusted_daily_dose;
                    let unit = p_plan ? p_plan.unit : 'mg';
                    
                    document.getElementById('prev_drug_name').innerText = drugName;
                    document.getElementById('prev_dose_display').innerText = `${adjustedDose} ${unit}/วัน`;
                    document.getElementById('prev_pain').innerText = data.last_assessment.pain_score;
                    document.getElementById('prev_pps').innerText = data.last_assessment.pps_score;
                    document.getElementById('prev_crcl').innerText = data.last_assessment.crcl;
                    
                    document.getElementById('prev_dose').value = adjustedDose;
                    document.getElementById('prev_drug_type').value = data.last_assessment.drug_type;
                    
                    historyCard.classList.remove('d-none');
                    
                    let recommendation = data.last_assessment.pain_score >= 4 ? 
                        "⚠️ อาการล่าสุดปวดปานกลาง-รุนแรง แนะนำให้พิจารณาปรับเพิ่มขนาดยาขึ้น 30% - 50%" : 
                        "✅ อาการปวดควบคุมได้ดี แนะนำคงขนาดยาเดิมหรือปรับถอยลงหากมีอาการง่วงซึม";
                        
                    status.innerHTML = `<span class="text-success fw-bold">✓ ดึงฐานข้อมูลสำเร็จ</span> <span class="text-secondary small d-block">${recommendation}</span>`;
                } else {
                    historyCard.classList.add('d-none');
                    status.innerHTML = '<span class="text-success fw-bold">✓ ดึงข้อมูลผู้ป่วยเรียบร้อยแล้ว (ไม่พบประวัติการประเมินก่อนหน้า)</span>';
                }
            } else {
                status.innerHTML = '<span class="text-danger">❌ ไม่พบข้อมูลผู้ป่วยคนนี้ในระบบ (กรุณาสลับเป็นผู้ป่วยรายใหม่)</span>';
            }
        })
        .catch(err => {
            status.innerHTML = '<span class="text-danger">เกิดข้อผิดพลาด: ' + err.message + '</span>';
        });
}

// เช็คการทำงานของไต (CrCl Guardrail)
function checkRenalFunction() {
    const crcl = parseFloat(document.getElementById('crcl').value);
    const drugSelect = document.getElementById('drug_type');
    const warning = document.getElementById('crcl_warning');
    
    const oralMo = drugSelect.querySelector('option[value="morphine_oral"]');
    const ivMo = drugSelect.querySelector('option[value="morphine_iv"]');

    if (!isNaN(crcl) && crcl < 10) {
        warning.classList.remove('d-none');
        if (oralMo) oralMo.disabled = true;
        if (ivMo) ivMo.disabled = true;
        
        if (drugSelect.value === 'morphine_oral' || drugSelect.value === 'morphine_iv') {
            drugSelect.value = 'fentanyl_patch';
            alert('⚠️ เนื่องจากผู้ป่วยมีสภาวะไตเสื่อมรุนแรง (CrCl < 10 mL/min) ระบบจำเป็นต้องระงับยาประเภท Morphine และเปลี่ยนเป็น Fentanyl Patch ชั่วคราวเพื่อความปลอดภัย');
        }
    } else {
        warning.classList.add('d-none');
        if (oralMo) oralMo.disabled = false;
        if (ivMo) ivMo.disabled = false;
    }
}

// รายการอาการแทรกซ้อน / โรคประจำตัวที่เกี่ยวข้องกับผู้ใช้ยา Fentanyl และ Morphine
// (ใช้เป็นแหล่งข้อมูลเดียวสร้าง Dropdown ให้หน้าตาและการทำงานเหมือนกับ "ประเภทยา" ทุกจุดที่เรียก addComplication)
const COMPLICATION_OPTIONS = {
    'อาการแทรกซ้อนจากยา Fentanyl / Morphine': [
        'ท้องผูก (Constipation)',
        'คลื่นไส้ อาเจียน (Nausea/Vomiting)',
        'ง่วงซึมมากผิดปกติ (Excessive Sedation)',
        'กดการหายใจ (Respiratory Depression)',
        'คันตามผิวหนัง (Pruritus)',
        'ปากแห้ง คอแห้ง (Dry Mouth)',
        'เวียนศีรษะ มึนงง (Dizziness)',
        'สับสน เพ้อคลั่ง (Delirium/Confusion)',
        'ปัสสาวะคั่ง ปัสสาวะลำบาก (Urinary Retention)',
        'ภาวะดื้อยา/ทนต่อยา (Opioid Tolerance)',
        'ภาวะติดยาทางกาย (Physical Dependence)',
        'ภาวะไวต่อความปวดจากยา (Opioid-Induced Hyperalgesia)',
        'ผื่นแพ้บริเวณผิวหนังที่แปะแผ่นยา (Patch Site Reaction)',
        'ความดันโลหิตต่ำ (Hypotension)',
        'หัวใจเต้นช้า (Bradycardia)'
    ],
    'โรคประจำตัวที่ต้องระวังเป็นพิเศษ': [
        'โรคไตเรื้อรัง (Chronic Kidney Disease)',
        'โรคตับเรื้อรัง/ตับแข็ง (Chronic Liver Disease/Cirrhosis)',
        'โรคปอดอุดกั้นเรื้อรัง (COPD)',
        'โรคหอบหืด (Asthma)',
        'ภาวะหยุดหายใจขณะหลับจากการอุดกั้น (Obstructive Sleep Apnea)',
        'โรคหัวใจ (Heart Disease)',
        'โรคความดันโลหิตสูง (Hypertension)',
        'โรคเบาหวาน (Diabetes Mellitus)',
        'ภาวะต่อมไทรอยด์ทำงานต่ำ (Hypothyroidism)',
        'ภาวะต่อมหมวกไตทำงานบกพร่อง (Adrenal Insufficiency)',
        'โรคลมชัก (Epilepsy/Seizure Disorder)',
        'โรคซึมเศร้า/วิตกกังวล (Depression/Anxiety)',
        'ภาวะสมองเสื่อม (Dementia)',
        'โรคมะเร็งระยะแพร่กระจาย (Metastatic Cancer)'
    ]
};
const COMPLICATION_OTHER_VALUE = '__other__';

// สร้างแถว Dropdown อาการแทรกซ้อนแบบค้นหาได้ (custom searchable dropdown)
// โครงสร้าง: ปุ่ม dropdown หน้าตาเหมือน "ประเภทยา" -> เปิดเมนูที่มีช่องค้นหาอยู่บนสุด
// ตามด้วย "✏️ อื่นๆ (พิมพ์ระบุเอง)" แล้วจึงเป็นรายการโรค/อาการแบ่งกลุ่ม
function buildComplicationMenuItemsHTML() {
    let html = `<button type="button" class="dropdown-item complication-option complication-option-other fw-medium text-primary" data-value="${COMPLICATION_OTHER_VALUE}">✏️ อื่นๆ (พิมพ์ระบุเอง)</button>`;
    html += `<div class="dropdown-divider my-1"></div>`;
    for (const groupLabel in COMPLICATION_OPTIONS) {
        html += `<h6 class="dropdown-header complication-group-header">${escapeHTML(groupLabel)}</h6>`;
        COMPLICATION_OPTIONS[groupLabel].forEach(opt => {
            html += `<button type="button" class="dropdown-item complication-option" data-value="${escapeHTML(opt)}">${escapeHTML(opt)}</button>`;
        });
    }
    return html;
}

// จัดการเพิ่ม-ลบอาการแทรกซ้อน
// แถวแต่ละแถวเป็น Dropdown ค้นหาได้ หน้าตาปุ่มหลักเหมือน "ประเภทยา"
// เปิดเมนูแล้วเจอช่องค้นหาบนสุด รองลงมาคือ "อื่นๆ (พิมพ์ระบุเอง)" แล้วจึงเป็นรายการโรคแบ่งกลุ่ม
function addComplication(containerId = 'complicationsContainer', value = '') {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = 'input-group mb-2 complication-row';

    let matched = false;
    for (const groupLabel in COMPLICATION_OPTIONS) {
        if (COMPLICATION_OPTIONS[groupLabel].includes(value)) { matched = true; break; }
    }
    const isOther = !!value && !matched;
    const displayText = matched ? value : (isOther ? '✏️ อื่นๆ (พิมพ์ระบุเอง)' : '-- เลือกอาการแทรกซ้อน/โรค --');

    div.innerHTML = `
        <div class="dropdown complication-dropdown-wrapper flex-grow-1">
            <button type="button" class="form-select custom-input fw-medium text-primary complication-dropdown-btn text-start" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
                <span class="complication-dropdown-label">${escapeHTML(displayText)}</span>
            </button>
            <div class="dropdown-menu p-0 complication-dropdown-menu shadow-sm">
                <div class="p-2 border-bottom bg-white complication-search-wrap">
                    <div class="input-group input-group-sm">
                        <span class="input-group-text bg-white border-end-0"><i class="bi bi-search text-secondary"></i></span>
                        <input type="text" class="form-control border-start-0 complication-search-input" placeholder="ค้นหาอาการแทรกซ้อน/โรค...">
                    </div>
                </div>
                <div class="complication-options-list">
                    ${buildComplicationMenuItemsHTML()}
                    <div class="complication-no-results text-center text-muted small py-3 d-none">ไม่พบรายการที่ค้นหา</div>
                </div>
            </div>
        </div>
        <input type="text" class="form-control custom-input complication-other-input${isOther ? '' : ' d-none'}"${isOther ? ' name="complications[]"' : ''} value="${isOther ? escapeHTML(value) : ''}" placeholder="พิมพ์ระบุอาการแทรกซ้อน/โรคที่ต้องการ">
        <input type="hidden" class="complication-hidden-value"${isOther ? '' : ' name="complications[]"'} value="${matched ? escapeHTML(value) : ''}">
        <button class="btn btn-outline-danger px-3 rounded-end-3" type="button" onclick="removeComplication(this)"><i class="bi bi-trash3"></i></button>
    `;
    container.appendChild(div);
    initComplicationRow(div);
}

// ผูก event ของแถว Dropdown อาการแทรกซ้อน: เปิดเมนู, ค้นหา, และเลือกรายการ
function initComplicationRow(row) {
    const dropdownBtn = row.querySelector('.complication-dropdown-btn');
    const searchInput = row.querySelector('.complication-search-input');

    // ทุกครั้งที่เปิดเมนู ให้ล้างคำค้นหาเดิมและโฟกัสช่องค้นหาทันที เพื่อพิมพ์ค้นหาได้เลย
    dropdownBtn.addEventListener('shown.bs.dropdown', () => {
        searchInput.value = '';
        filterComplicationOptions(row, '');
        searchInput.focus();
    });

    // ไม่ให้การพิมพ์/คลิกในช่องค้นหาไปปิดเมนู
    searchInput.addEventListener('input', () => filterComplicationOptions(row, searchInput.value));
    searchInput.addEventListener('click', e => e.stopPropagation());
    searchInput.addEventListener('keydown', e => e.stopPropagation());

    row.querySelectorAll('.complication-option').forEach(btn => {
        btn.addEventListener('click', () => {
            selectComplicationOption(row, btn.getAttribute('data-value'), btn.textContent.trim());
        });
    });
}

// กรองรายการโรค/อาการตามคำค้นหา พร้อมซ่อนหัวข้อกลุ่มที่ไม่เหลือตัวเลือกให้เห็น
function filterComplicationOptions(row, query) {
    const q = query.trim().toLowerCase();
    const optionsList = row.querySelector('.complication-options-list');
    const noResults = row.querySelector('.complication-no-results');
    let anyVisible = false;

    optionsList.querySelectorAll('.complication-option:not(.complication-option-other)').forEach(btn => {
        const visible = q === '' || btn.textContent.toLowerCase().includes(q);
        btn.classList.toggle('d-none', !visible);
        if (visible) anyVisible = true;
    });

    optionsList.querySelectorAll('.complication-group-header').forEach(header => {
        let sibling = header.nextElementSibling;
        let hasVisible = false;
        while (sibling && !sibling.classList.contains('complication-group-header')) {
            if (sibling.classList.contains('complication-option') && !sibling.classList.contains('d-none')) {
                hasVisible = true;
                break;
            }
            sibling = sibling.nextElementSibling;
        }
        header.classList.toggle('d-none', !hasVisible);
    });

    noResults.classList.toggle('d-none', anyVisible || q === '');
}

// เมื่อเลือกตัวเลือกในเมนู: อัปเดตข้อความบนปุ่ม, ค่าที่จะส่งไปบันทึก, และสลับช่องพิมพ์เองถ้าเลือก "อื่นๆ"
function selectComplicationOption(row, value, labelText) {
    const otherInput = row.querySelector('.complication-other-input');
    const hiddenValue = row.querySelector('.complication-hidden-value');
    const labelEl = row.querySelector('.complication-dropdown-label');
    const dropdownBtn = row.querySelector('.complication-dropdown-btn');

    if (value === COMPLICATION_OTHER_VALUE) {
        hiddenValue.removeAttribute('name');
        hiddenValue.value = '';
        labelEl.textContent = '✏️ อื่นๆ (พิมพ์ระบุเอง)';
        otherInput.classList.remove('d-none');
        otherInput.setAttribute('name', 'complications[]');
        otherInput.value = '';
        setTimeout(() => otherInput.focus(), 50);
    } else {
        otherInput.classList.add('d-none');
        otherInput.removeAttribute('name');
        otherInput.value = '';
        hiddenValue.setAttribute('name', 'complications[]');
        hiddenValue.value = value;
        labelEl.textContent = labelText;
    }

    const bsDropdown = bootstrap.Dropdown.getOrCreateInstance(dropdownBtn);
    bsDropdown.hide();
}

function removeComplication(btn) {
    const row = btn.closest('.complication-row');
    const container = row.parentElement;
    if (container.querySelectorAll('.complication-row').length > 1) {
        row.remove();
    } else {
        // เหลือแถวเดียว: รีเซ็ตกลับเป็นค่าว่างแทนการลบทิ้ง
        const otherInput = row.querySelector('.complication-other-input');
        const hiddenValue = row.querySelector('.complication-hidden-value');
        const labelEl = row.querySelector('.complication-dropdown-label');
        otherInput.classList.add('d-none');
        otherInput.removeAttribute('name');
        otherInput.value = '';
        hiddenValue.setAttribute('name', 'complications[]');
        hiddenValue.value = '';
        labelEl.textContent = '-- เลือกอาการแทรกซ้อน/โรค --';
    }
}

// สร้างแถว Dropdown อาการแทรกซ้อนแถวแรกทันทีที่โหลดหน้า (แทนที่การ hardcode <input> ไว้ใน HTML)
addComplication('complicationsContainer');


// สลับสถานะปุ่ม "ประมวลผลแผนการรักษา" ระหว่างกำลังคำนวณ
function setAssessLoading(isLoading) {
    const btn = document.getElementById('assessSubmitBtn');
    const icon = document.getElementById('assessSubmitIcon');
    const text = document.getElementById('assessSubmitText');
    const spinner = document.getElementById('assessSubmitSpinner');

    btn.disabled = isLoading;
    if (isLoading) {
        icon.classList.add('d-none');
        spinner.classList.remove('d-none');
        text.textContent = 'กำลังประมวลผล...';
    } else {
        icon.classList.remove('d-none');
        spinner.classList.add('d-none');
        text.textContent = 'ประมวลผลแผนการรักษา';
    }
}

// เคลียร์ผลลัพธ์เก่าออกทั้งหมด ไม่ให้ค้างอยู่ระหว่างรอผลใหม่ หรือกรณีเกิดข้อผิดพลาด
function clearAssessmentResult() {
    currentAssessmentResult = null;
    const card = document.getElementById('resultCard');
    const content = document.getElementById('resultContent');
    card.classList.add('d-none');
    content.innerHTML = '';
}

// ล้างฟอร์มประเมินทั้งหมดกลับเป็นค่าเริ่มต้น หลังบันทึกสำเร็จ เพื่อให้พร้อมคีย์ข้อมูลผู้ป่วยรายถัดไปได้ทันที
// (ไม่ให้ข้อมูลผู้ป่วยที่พึ่งคีย์ไปก่อนหน้าตกค้างอยู่ในฟอร์ม)
function resetAssessmentFormForNextPatient() {
    const form = document.getElementById('assessmentForm');
    form.reset();

    // เคลียร์รายการอาการแทรกซ้อน ให้เหลือแค่แถวว่างแถวเดียวเหมือนตอนเปิดฟอร์มครั้งแรก
    const compContainer = document.getElementById('complicationsContainer');
    compContainer.innerHTML = '';
    addComplication('complicationsContainer');

    // สลับกลับไปโหมด "ผู้ป่วยรายใหม่" เสมอ พร้อมล้างประวัติผู้ป่วยรายเก่าที่เคยดึงมาแสดง
    document.getElementById('type_new').checked = true;
    document.getElementById('oldPatientSearch').classList.add('d-none');
    const idInput = document.getElementById('id_card');
    idInput.removeAttribute('readonly');
    idInput.classList.remove('bg-secondary-subtle');
    document.getElementById('search_id_card').value = '';
    document.getElementById('search_status').innerHTML = '';
    document.getElementById('oldPatientHistoryCard').classList.add('d-none');
    window.lastAssessment = null;

    // รีเซ็ตโหมดปรับยา กลับเป็น "คำนวณตั้งต้นใหม่" และซ่อนตัวเลือก titration
    document.getElementById('mode_auto').checked = true;
    document.getElementById('titrationOptions').classList.add('d-none');

    // รีเซ็ตคำเตือนเรื่องค่าไต และเปิดตัวเลือกยาที่อาจถูกปิดไว้ก่อนหน้ากลับมาใช้ได้ตามปกติ
    checkRenalFunction();
}

// ส่งบันทึกในหน้าหลัก
document.getElementById('assessmentForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);

    // เคลียร์แผนการรักษาเดิมออกทันทีที่กดประเมินใหม่ ป้องกันข้อมูลเก่าค้างจอระหว่างรอผลลัพธ์ใหม่
    clearAssessmentResult();
    setAssessLoading(true);

    apiCall('save_assessment', { body: formData })
    .then(data => {
        setAssessLoading(false);
        if (data.success) {
            displayResult(data.result);
            // ล้างฟอร์มคีย์ข้อมูลให้พร้อมสำหรับผู้ป่วยรายถัดไปทันที (ผลลัพธ์ล่าสุดยังแสดงอยู่ด้านล่างตามปกติ)
            resetAssessmentFormForNextPatient();
            alert('✅ บันทึกข้อมูลและประมวลผลแผนการรักษาเรียบร้อยแล้ว\nฟอร์มถูกล้างพร้อมสำหรับคีย์ข้อมูลผู้ป่วยรายถัดไปแล้ว');
        } else {
            alert('❌ ไม่สามารถบันทึกได้เนื่องจาก: ' + (data.message || 'ข้อผิดพลาดไม่ทราบสาเหตุ'));
        }
    })
    .catch(err => {
        setAssessLoading(false);
        alert('⚠️ เกิดข้อผิดพลาดในการส่งข้อมูล!\n\n' + err.message);
    });
});

// บันทึกแก้ไขจากใน Modal
document.getElementById('editForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    
    apiCall('update_assessment', { body: formData })
    .then(data => {
        if (data.success) {
            const editModalEl = document.getElementById('editModal');
            const editModal = bootstrap.Modal.getInstance(editModalEl);
            editModal.hide();
            
            alert('✏️ แก้ไขข้อมูลและคำนวณแผนการรักษาใหม่เรียบร้อยแล้ว');
            loadArchive();
        } else {
            alert('❌ ไม่สามารถแก้ไขข้อมูลได้: ' + (data.message || 'ข้อผิดพลาดไม่ทราบสาเหตุ'));
        }
    })
    .catch(err => {
        alert('⚠️ เกิดข้อผิดพลาดในระบบ: ' + err.message);
    });
});

// แสดงการประเมินใน Card ผลลัพธ์
function displayResult(res) {
    const card = document.getElementById('resultCard');
    const content = document.getElementById('resultContent');
    
    currentAssessmentResult = res;
    card.classList.remove('d-none');
    content.innerHTML = generatePlanHTML(res, 'printArea');
    card.scrollIntoView({ behavior: 'smooth' });
}

// ฟังก์ชันสร้างแผน HTML รายละเอียด
function generatePlanHTML(res, printContainerId) {
    let compHtml = res.complications ? res.complications.split(',').map(c => `<span class="badge bg-secondary-subtle text-dark border me-1">${escapeHTML(c.trim())}</span>`).join('') : '-';

    return `
        <div id="${printContainerId}">
            <div class="row mb-3 border-bottom pb-3 g-3">
                <div class="col-md-6">
                    <p class="mb-1 small"><strong>เลขบัตรประชาชน:</strong> <span class="text-primary fw-bold">${escapeHTML(res.id_card)}</span></p>
                    <p class="mb-1 small"><strong>อายุ:</strong> ${res.age} ปี | <strong>น้ำหนัก:</strong> ${res.weight} kg</p>
                </div>
                <div class="col-md-6">
                    <p class="mb-1 small"><strong>การทำงานของไต (CrCl):</strong> ${res.crcl} mL/min (<span class="text-secondary">${escapeHTML(res.renal_status)}</span>)</p>
                    <p class="mb-1 small"><strong>PPS Score:</strong> ${res.pps_score}% | <strong>ระดับความปวด:</strong> <span class="text-danger fw-bold">${res.pain_score}/10</span></p>
                    <p class="mb-1 small"><strong>โรคแทรกซ้อน:</strong> ${compHtml}</p>
                </div>
            </div>

            <h6 class="text-primary fw-bold mt-3 d-flex align-items-center gap-2">
                <i class="bi bi-capsule"></i> แผนการจ่ายยาทางคลินิก (Treatment Plan Specification)
            </h6>
            <div class="p-3 bg-primary-subtle rounded-3 mb-3 border border-primary-subtle">
                <p class="mb-1 small"><strong>ตัวยาควบคุมอาการที่ได้รับเลือก:</strong> <span class="fw-bold text-dark">${escapeHTML(res.drug_name)}</span></p>
                <p class="mb-1 small"><strong>ปริมาณยามอร์ฟีนอ้างอิงเทียบเท่าเริ่มต้น (MEDD):</strong> ${res.base_daily_dose} mg/day</p>
                <p class="mb-0 small text-danger"><strong>ปริมาณยาที่สั่งจ่ายหลังปรับค่าไตในผู้ป่วยจริง (${res.renal_percent}%):</strong> <span class="fs-6 fw-bold">${res.adjusted_daily_dose} ${escapeHTML(res.unit)}/day</span></p>
            </div>

            <div class="p-3 bg-light border rounded-3 mb-3">
                <h6 class="fw-bold text-dark small mb-1">1. ยารักษารายคาบเวลาควบคุมอาการต่อเนื่องตลอดวัน (Around the clock - ATC):</h6>
                <p class="mb-3 text-success fw-bold small">${escapeHTML(res.atc_instruction)}</p>
                
                <h6 class="fw-bold text-dark small mb-1">2. ยาบรรเทาความปวดแบบปะทุเสริมความเฉียบพลัน (PRN breakthrough dose):</h6>
                <p class="mb-0 text-warning-emphasis fw-bold small">${escapeHTML(res.prn_instruction)}</p>
            </div>

            <div class="alert alert-warning border-0 bg-warning-subtle text-dark small mb-0 rounded-3">
                <strong>💡 คำแนะนำทางการแพทย์ (Clinical Advice):</strong><br>
                ${res.clinical_advice}
            </div>
        </div>
        ${printContainerId === 'printArea' ? `
        <div class="text-end mt-4 no-print border-top pt-3">
            <button class="btn btn-outline-secondary rounded-pill px-4" onclick="printFormalDocument(currentAssessmentResult)"><i class="bi bi-printer"></i> พิมพ์เอกสาร PDF</button>
        </div>` : ''}
    `;
}

// จัดรูปแบบวันที่-เวลาเป็นภาษาไทยแบบเต็ม สำหรับหัวเอกสารพิมพ์
function formatThaiDateTime(date) {
    return date.toLocaleString('th-TH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// สร้าง HTML เอกสารทางการฉบับเต็ม (ใช้ตอนสั่งพิมพ์ PDF) ดึงข้อมูลทั้งหมดของผู้ป่วยมาจัดวางในรูปแบบเอกสารราชการ
function buildFormalPrintDocument(res) {
    const compHtml = (res.complications && res.complications.trim() !== '')
        ? res.complications.split(',').filter(c => c.trim() !== '').map(c => `<span class="fp-tag">${escapeHTML(c.trim())}</span>`).join('')
        : '<span class="text-muted">ไม่มีอาการแทรกซ้อน / โรคประจำตัวที่บันทึกไว้</span>';

    const printedAt = formatThaiDateTime(new Date());
    const docRef = res.id ? ('AS-' + String(res.id).padStart(6, '0')) : '-';

    return `
    <div class="fp-page">
        <div class="fp-header">
            <img src="hospital-logo-icon.png" class="fp-logo" alt="โลโก้โรงพยาบาลนราธิวาสราชนครินทร์">
            <div class="fp-header-text">
                <h1>โรงพยาบาลนราธิวาสราชนครินทร์</h1>
                <p>ศูนย์การจัดการดูแลแบบประคับประคอง (Palliative Care Management System)</p>
                <p class="fp-doc-title">แบบบันทึกการประเมินและแผนการรักษาด้วยยาโอปิออยด์</p>
            </div>
        </div>

        <div class="fp-meta">
            <span>เลขที่เอกสารอ้างอิง: ${escapeHTML(docRef)}</span>
            <span>วันที่พิมพ์เอกสาร: ${printedAt}</span>
        </div>

        <table class="fp-info-table">
            <tr>
                <td class="fp-label">เลขบัตรประชาชนผู้ป่วย</td>
                <td class="fp-value fp-value-strong">${escapeHTML(res.id_card)}</td>
                <td class="fp-label">อายุ</td>
                <td class="fp-value">${escapeHTML(String(res.age))} ปี</td>
            </tr>
            <tr>
                <td class="fp-label">น้ำหนักตัว</td>
                <td class="fp-value">${escapeHTML(String(res.weight))} kg</td>
                <td class="fp-label">การทำงานของไต (CrCl)</td>
                <td class="fp-value">${escapeHTML(String(res.crcl))} mL/min (${escapeHTML(res.renal_status)})</td>
            </tr>
            <tr>
                <td class="fp-label">PPS Score</td>
                <td class="fp-value">${escapeHTML(String(res.pps_score))}%</td>
                <td class="fp-label">ระดับความปวด (Pain Score)</td>
                <td class="fp-value fp-value-danger fp-value-strong">${escapeHTML(String(res.pain_score))} / 10</td>
            </tr>
            <tr>
                <td class="fp-label">โรค / อาการแทรกซ้อน</td>
                <td class="fp-value" colspan="3">${compHtml}</td>
            </tr>
        </table>

        <h2 class="fp-section-title">แผนการจ่ายยาทางคลินิก (Treatment Plan Specification)</h2>
        <table class="fp-info-table">
            <tr>
                <td class="fp-label">ตัวยาที่เลือกใช้</td>
                <td class="fp-value fp-value-strong" colspan="3">${escapeHTML(res.drug_name)}</td>
            </tr>
            <tr>
                <td class="fp-label">ขนาดยาอ้างอิงเทียบเท่ามอร์ฟีนเริ่มต้น (MEDD)</td>
                <td class="fp-value">${escapeHTML(String(res.base_daily_dose))} mg/day</td>
                <td class="fp-label">ขนาดยาที่สั่งจ่ายจริงหลังปรับตามค่าไต (${escapeHTML(String(res.renal_percent))}%)</td>
                <td class="fp-value fp-value-danger fp-value-strong">${escapeHTML(String(res.adjusted_daily_dose))} ${escapeHTML(res.unit)}/day</td>
            </tr>
        </table>

        <div class="fp-instruction-box">
            <h3>1. ยาควบคุมอาการต่อเนื่องตลอดวัน (Around the Clock – ATC)</h3>
            <p>${escapeHTML(res.atc_instruction)}</p>
            <h3>2. ยาบรรเทาอาการปวดปะทุเฉียบพลัน (PRN Breakthrough Dose)</h3>
            <p>${escapeHTML(res.prn_instruction)}</p>
        </div>

        <div class="fp-advice-box">
            <h3>💡 คำแนะนำทางการแพทย์ (Clinical Advice)</h3>
            <p>${res.clinical_advice}</p>
        </div>

        <div class="fp-signature-row">
            <div class="fp-signature-box">
                <div class="fp-sign-line"></div>
                <p>ผู้บันทึกการประเมิน</p>
                <p class="fp-sign-date">วันที่ ....../....../..........</p>
            </div>
            <div class="fp-signature-box">
                <div class="fp-sign-line"></div>
                <p>แพทย์ผู้ตรวจสอบและรับรองแผนการรักษา</p>
                <p class="fp-sign-date">วันที่ ....../....../..........</p>
            </div>
        </div>

        <p class="fp-footer-note">เอกสารนี้สร้างขึ้นโดยระบบคำนวณยา Palliative Care Management System — ใช้ประกอบการรักษาทางการแพทย์เท่านั้น กรุณาตรวจสอบความถูกต้องก่อนนำไปใช้จริง</p>
    </div>
    `;
}

// เติมเนื้อหาเอกสารทางการลงในกล่องซ่อน แล้วสั่งพิมพ์ (รอให้ browser render ก่อนค่อยเปิดหน้าต่างพิมพ์)
function printFormalDocument(res) {
    if (!res) {
        alert('ไม่พบข้อมูลสำหรับพิมพ์เอกสาร กรุณาลองเปิดรายการใหม่อีกครั้ง');
        return;
    }
    const container = document.getElementById('formalPrintDoc');
    container.innerHTML = buildFormalPrintDocument(res);
    requestAnimationFrame(() => {
        setTimeout(() => window.print(), 60);
    });
}

// ==========================================
// [แก้ไขระบบสลับสเกลตัวกรองและกล่องช่วงวันที่]
// ==========================================

function setFilter(type, btnElement) {
    currentFilterType = type;
    
    // เปลี่ยนสถานะสีปุ่ม
    document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    const customDateSection = document.getElementById('customDateRangeSection');
    
    // [จุดหลักที่แก้ไข] ถ้าไม่ใช่แบบกำหนดเอง (เช่น รายวัน/รายเดือน) ให้ซ่อนกล่องวันที่ทันที[cite: 4]
    if (type !== 'custom') {
        customDateSection.classList.add('d-none');
        document.getElementById('filter_start_date').value = '';
        document.getElementById('filter_end_date').value = '';
        loadArchive(); // ดึงข้อมูลทันทีเมื่อกดตัวกรองด่วน[cite: 4]
    } else {
        // หากกด "กำหนดเอง" ให้แสดงกล่องอินพุตวันที่[cite: 4]
        customDateSection.classList.remove('d-none');
        document.getElementById('filter_start_date').focus();
    }
}

function resetArchiveFilter() {
    currentFilterType = 'all';
    document.getElementById('archive_search_id').value = '';
    document.getElementById('filter_start_date').value = '';
    document.getElementById('filter_end_date').value = '';
    
    // เคลียร์แล้วทำการซ่อนกล่องตัวเลือกช่วงวันที่กลับไปสภาพเริ่มต้น[cite: 4]
    document.getElementById('customDateRangeSection').classList.add('d-none');
    
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-val') === 'all') {
            btn.classList.add('active');
        }
    });
    
    loadArchive();
}

// ดึงคลังข้อมูลประวัติแยกตามแถบตัวกรอง
function loadArchive() {
    const searchId = document.getElementById('archive_search_id').value.trim();
    const startDate = document.getElementById('filter_start_date').value;
    const endDate = document.getElementById('filter_end_date').value;

    if (currentFilterType === 'custom' && (!startDate || !endDate)) {
        alert('⚠️ กรุณาระบุ "วันที่เริ่มต้น" และ "วันที่สิ้นสุด" ให้ครบถ้วนเพื่อค้นหาแบบกำหนดเองครับ');
        return;
    }

    const container = document.getElementById('archiveAccordionContainer');
    container.innerHTML = '<div class="text-center py-4 text-primary"><i class="bi bi-hourglass-split fs-4 d-block mb-2"></i>กำลังโหลดข้อมูลตามตัวกรอง...</div>';

    const params = new URLSearchParams({
        action: 'get_archive',
        search_id: searchId,
        filter_type: currentFilterType,
        start_date: startDate,
        end_date: endDate
    });

    apiCall('get_archive', { params })
        .then(data => {
            container.innerHTML = '';
            
            if (!Array.isArray(data) || data.length === 0) {
                container.innerHTML = '<div class="text-center py-5 text-muted small"><i class="bi bi-inbox fs-1 d-block mb-2"></i>ไม่พบข้อมูลประวัติผู้ป่วยที่ตรงกับเงื่อนไขการค้นหา</div>';
                return;
            }

            data.forEach((patient, index) => {
                const accordionItemId = `patient_item_${index}`;
                const collapseId = `collapse_${index}`;
                
                let historyRows = '';
                patient.assessments.forEach(row => {
                    let plan = row.treatment_plan || {};
                    let drugName = plan.drug_name || row.drug_type;
                    let unit = plan.unit || 'mg';
                    let complicationsHtml = row.complications ? row.complications.split(',').map(c => `<span class="badge bg-light text-secondary border me-1">${escapeHTML(c.trim())}</span>`).join('') : '-';
                    
                    historyRows += `
                        <tr class="border-bottom">
                            <td class="small text-secondary">${new Date(row.created_at).toLocaleString('th-TH')}</td>
                            <td>
                                <div class="fw-bold text-dark small">Pain: ${row.pain_score}/10 | PPS: ${row.pps_score}%</div>
                                <div class="text-muted" style="font-size:0.75rem;">CrCl: ${row.crcl} mL/min</div>
                            </td>
                            <td>
                                <div style="font-size:0.8rem;"><strong>อาการแทรกซ้อน:</strong> ${complicationsHtml}</div>
                            </td>
                            <td class="bg-light bg-opacity-50">
                                <div class="text-primary fw-bold small">${escapeHTML(drugName)} (${row.adjusted_daily_dose} ${escapeHTML(unit)}/วัน)</div>
                                <div class="text-success" style="font-size: 0.75rem;"><strong>ATC:</strong> ${escapeHTML(plan.atc_instruction || '-')}</div>
                                <div class="text-warning-emphasis" style="font-size: 0.75rem;"><strong>PRN:</strong> ${escapeHTML(plan.prn_instruction || '-')}</div>
                            </td>
                            <td class="text-end">
                                <div class="btn-group btn-group-sm shadow-sm">
                                    <button class="btn btn-outline-primary rounded-start-pill px-3 fw-medium" onclick="viewHistory('${row.id}')"><i class="bi bi-eye"></i> ดู</button>
                                    <button class="btn btn-outline-warning px-3 fw-medium text-dark" onclick="editHistory('${row.id}')"><i class="bi bi-pencil-square"></i> แก้ไข</button>
                                    <button class="btn btn-outline-danger rounded-end-pill px-2" onclick="deleteHistory('${row.id}')"><i class="bi bi-trash"></i></button>
                                </div>
                            </td>
                        </tr>
                    `;
                });

                const accordionItem = document.createElement('div');
                accordionItem.className = 'accordion-item border shadow-sm mb-3 rounded-3 overflow-hidden';
                accordionItem.innerHTML = `
                    <h2 class="accordion-header" id="${accordionItemId}">
                        <button class="accordion-button collapsed bg-white text-dark py-3" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                            <div class="d-flex w-100 justify-content-between align-items-center flex-wrap gap-2 pe-3">
                                <div class="d-flex align-items-center gap-2">
                                    <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1 rounded-pill">ID ผู้ป่วย</span>
                                    <strong class="fs-6 text-dark">${escapeHTML(patient.id_card)}</strong>
                                </div>
                                <div class="text-secondary small">
                                    <span>อายุ: <strong>${patient.age}</strong> ปี</span> | 
                                    <span>น้ำหนัก: <strong>${patient.weight}</strong> kg</span> | 
                                    <span class="badge bg-primary text-white ms-1">${patient.assessments.length} ประวัติ</span>
                                </div>
                            </div>
                        </button>
                    </h2>
                    <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#archiveAccordionContainer">
                        <div class="accordion-body bg-light p-0">
                            <div class="table-responsive">
                                <table class="table table-hover align-middle mb-0 bg-white" style="font-size: 0.85rem;">
                                    <thead class="table-light text-secondary">
                                        <tr>
                                            <th style="width: 15%;">วัน/เวลาประเมิน</th>
                                            <th style="width: 18%;">สภาพร่างกาย</th>
                                            <th style="width: 20%;">อาการแทรกซ้อน</th>
                                            <th style="width: 33%;">แผนการรักษา</th>
                                            <th style="width: 14%;" class="text-end">จัดการ</th>
                                        </tr>
                                    </thead>
                                    <tbody>${historyRows}</tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(accordionItem);
            });
        })
        .catch(err => {
            document.getElementById('archiveAccordionContainer').innerHTML = '<div class="alert alert-danger small">ไม่สามารถเชื่อมต่อคลังข้อมูลได้: ' + err.message + '</div>';
        });
}

// ดูประวัติเดี่ยว
function viewHistory(id) {
    apiCall('get_assessment_by_id', { params: { id } })
        .then(data => {
            if (data.success) {
                currentHistoryResult = data.result;
                const modalContent = document.getElementById('modalHistoryContent');
                modalContent.innerHTML = generatePlanHTML(data.result, 'printModalArea');
                const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));
                historyModal.show();
            } else {
                alert('ไม่พบข้อมูลประวัตินี้ในเซิร์ฟเวอร์');
            }
        })
        .catch(err => {
            alert('เกิดข้อผิดพลาดในการดึงข้อมูลประวัติ: ' + err.message);
        });
}

// เปิดกล่องแก้ไข
function editHistory(id) {
    apiCall('get_assessment_by_id', { params: { id } })
        .then(data => {
            if (data.success) {
                const row = data.result;
                document.getElementById('edit_id').value = row.id || id;
                document.getElementById('edit_id_card').value = row.id_card;
                document.getElementById('edit_weight').value = row.weight;
                document.getElementById('edit_age').value = row.age;
                document.getElementById('edit_crcl').value = row.crcl;
                document.getElementById('edit_pps_score').value = row.pps_score;
                document.getElementById('edit_pain_score').value = row.pain_score;
                document.getElementById('edit_drug_type').value = row.drug_type;

                const compContainer = document.getElementById('editComplicationsContainer');
                compContainer.innerHTML = '';
                if (row.complications && row.complications.trim() !== '') {
                    const comps = row.complications.split(',');
                    comps.forEach(comp => addComplication('editComplicationsContainer', comp.trim()));
                } else {
                    addComplication('editComplicationsContainer', '');
                }

                const editModal = new bootstrap.Modal(document.getElementById('editModal'));
                editModal.show();
            } else {
                alert('ไม่พบข้อมูลสำหรับแก้ไข');
            }
        })
        .catch(err => {
            alert('เกิดข้อผิดพลาดในการดึงข้อมูลสำหรับแก้ไข: ' + err.message);
        });
}

// ลบข้อมูลประวัติ
function deleteHistory(id) {
    if (confirm('ยืนยันการลบรายการประวัติการรักษาชิ้นนี้หรือไม่?')) {
        apiCall('delete_assessment', { params: { id } })
            .then(data => {
                if (data.success) loadArchive();
                else alert('ล้มเหลวในการลบประวัติ: ' + (data.message || 'ไม่ทราบสาเหตุ'));
            });
    }
}

/* ============================================================
   ระบบจัดการผู้ใช้งาน (User Management) — เฉพาะผู้ดูแลระบบ (Admin)
   ============================================================ */

// แสดง/ซ่อนรหัสผ่านของช่อง input ตาม id ที่ระบุ (ใช้ร่วมกับปุ่มตา)
function togglePwField(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    const isHidden = input.getAttribute('type') === 'password';
    input.setAttribute('type', isHidden ? 'text' : 'password');
    icon.classList.toggle('bi-eye');
    icon.classList.toggle('bi-eye-slash');
}

// สร้าง badge สีตามสิทธิ์การใช้งาน
function roleBadgeHTML(role) {
    const r = (role || 'user').toLowerCase();
    if (r === 'admin') {
        return `<span class="badge role-badge-admin px-3 py-2 rounded-pill"><i class="bi bi-shield-fill-check"></i> Admin</span>`;
    }
    return `<span class="badge role-badge-user px-3 py-2 rounded-pill"><i class="bi bi-person-fill"></i> บุคลากร</span>`;
}

// สร้างวงกลม avatar ตัวอักษรแรกของชื่อ พร้อมสีที่ generate จากชื่อ
function userAvatarHTML(name) {
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="user-list-avatar text-white fw-bold d-flex align-items-center justify-content-center">${escapeHTML(initial)}</div>`;
}

// โหลดรายชื่อผู้ใช้งานทั้งหมด (รองรับค้นหา)
function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    const search = (document.getElementById('user_search') || {}).value || '';
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="bi bi-hourglass-split"></i> กำลังโหลดข้อมูล...</td></tr>';

    apiCall('list_users', { params: { search } })
        .then(data => {
            if (!data.success) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHTML(data.message || 'ไม่สามารถโหลดข้อมูลได้')}</td></tr>`;
                return;
            }

            if (!data.users || data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">ยังไม่มีผู้ใช้งานในระบบ</td></tr>';
                return;
            }

            let rows = '';
            data.users.forEach((u, idx) => {
                rows += `
                    <tr>
                        <td class="text-secondary">${idx + 1}</td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                ${userAvatarHTML(u.full_name)}
                                <span class="fw-medium text-dark">${escapeHTML(u.full_name)}</span>
                            </div>
                        </td>
                        <td><span class="badge bg-light text-secondary border">@${escapeHTML(u.username)}</span></td>
                        <td class="text-secondary small">${escapeHTML(u.email || '-')}</td>
                        <td class="text-secondary small">${escapeHTML(u.phone || '-')}</td>
                        <td>${roleBadgeHTML(u.role)}</td>
                        <td class="text-end">
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-primary" onclick="openEditUser('${u.id}')" title="แก้ไข"><i class="bi bi-pencil"></i></button>
                                <button class="btn btn-outline-danger" onclick="deleteUser('${u.id}', '${escapeHTML(u.full_name).replace(/'/g, "\\'")}')" title="ลบ"><i class="bi bi-trash"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = rows;
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${escapeHTML(err.message)}</td></tr>`;
        });
}

// จัดการการส่งฟอร์มเพิ่มผู้ใช้งานใหม่
const addUserForm = document.getElementById('addUserForm');
if (addUserForm) {
    addUserForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const alertBox = document.getElementById('addUserAlert');
        const successBox = document.getElementById('addUserSuccess');
        alertBox.classList.add('d-none');
        successBox.classList.add('d-none');

        const password = document.getElementById('add_password').value;
        const confirmPassword = document.getElementById('add_confirm_password').value;

        if (password.length < 6) {
            alertBox.textContent = 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
            alertBox.classList.remove('d-none');
            return;
        }
        if (password !== confirmPassword) {
            alertBox.textContent = 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน';
            alertBox.classList.remove('d-none');
            return;
        }

        const btn = document.getElementById('addUserBtn');
        const btnText = document.getElementById('addUserBtnText');
        const btnIcon = document.getElementById('addUserBtnIcon');
        const spinner = document.getElementById('addUserSpinner');
        btn.disabled = true;
        btnText.textContent = 'กำลังบันทึก...';
        btnIcon.classList.add('d-none');
        spinner.classList.remove('d-none');

        const formData = new URLSearchParams(new FormData(addUserForm));

        apiCall('add_user', { body: formData })
            .then(data => {
                btn.disabled = false;
                btnText.textContent = 'เพิ่มผู้ใช้งาน';
                btnIcon.classList.remove('d-none');
                spinner.classList.add('d-none');

                if (data.success) {
                    successBox.textContent = data.message || 'เพิ่มผู้ใช้งานสำเร็จ';
                    successBox.classList.remove('d-none');
                    addUserForm.reset();
                    loadUsers();
                } else {
                    alertBox.textContent = data.message || 'ไม่สามารถเพิ่มผู้ใช้งานได้';
                    alertBox.classList.remove('d-none');
                }
            })
            .catch(err => {
                btn.disabled = false;
                btnText.textContent = 'เพิ่มผู้ใช้งาน';
                btnIcon.classList.remove('d-none');
                spinner.classList.add('d-none');
                alertBox.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ' + err.message;
                alertBox.classList.remove('d-none');
            });
    });
}

// เปิดกล่องแก้ไขผู้ใช้งาน พร้อมดึงข้อมูลปัจจุบันมาแสดง
function openEditUser(id) {
    apiCall('list_users')
        .then(data => {
            if (!data.success) {
                alert(data.message || 'ไม่สามารถดึงข้อมูลผู้ใช้งานได้');
                return;
            }
            const user = data.users.find(u => String(u.id) === String(id));
            if (!user) {
                alert('ไม่พบข้อมูลผู้ใช้งานนี้');
                return;
            }

            document.getElementById('edit_user_id').value = user.id;
            document.getElementById('edit_user_full_name').value = user.full_name || '';
            document.getElementById('edit_user_email').value = user.email || '';
            document.getElementById('edit_user_username').value = user.username || '';
            document.getElementById('edit_user_phone').value = user.phone || '';
            document.getElementById('edit_user_role').value = (user.role || 'user').toLowerCase();
            document.getElementById('edit_user_password').value = '';
            document.getElementById('edit_user_confirm_password').value = '';
            document.getElementById('editUserAlert').classList.add('d-none');

            const editUserModal = new bootstrap.Modal(document.getElementById('editUserModal'));
            editUserModal.show();
        })
        .catch(err => {
            alert('เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้งาน: ' + err.message);
        });
}

// จัดการการส่งฟอร์มแก้ไขผู้ใช้งาน
const editUserForm = document.getElementById('editUserForm');
if (editUserForm) {
    editUserForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const alertBox = document.getElementById('editUserAlert');
        alertBox.classList.add('d-none');

        const password = document.getElementById('edit_user_password').value;
        const confirmPassword = document.getElementById('edit_user_confirm_password').value;

        if (password !== '' && password.length < 6) {
            alertBox.textContent = 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
            alertBox.classList.remove('d-none');
            return;
        }
        if (password !== confirmPassword) {
            alertBox.textContent = 'รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน';
            alertBox.classList.remove('d-none');
            return;
        }

        const formData = new URLSearchParams(new FormData(editUserForm));

        apiCall('update_user', { body: formData })
            .then(data => {
                if (data.success) {
                    const editUserModal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
                    if (editUserModal) editUserModal.hide();
                    loadUsers();
                } else {
                    alertBox.textContent = data.message || 'ไม่สามารถบันทึกการแก้ไขได้';
                    alertBox.classList.remove('d-none');
                }
            })
            .catch(err => {
                alertBox.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ' + err.message;
                alertBox.classList.remove('d-none');
            });
    });
}

// ลบผู้ใช้งาน
function deleteUser(id, name) {
    if (confirm(`ยืนยันการลบผู้ใช้งาน "${name}" ออกจากระบบหรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`)) {
        apiCall('delete_user', { params: { id } })
            .then(data => {
                if (data.success) {
                    loadUsers();
                } else {
                    alert('ล้มเหลวในการลบผู้ใช้งาน: ' + (data.message || 'ไม่ทราบสาเหตุ'));
                }
            })
            .catch(err => {
                alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ' + err.message);
            });
    }
}