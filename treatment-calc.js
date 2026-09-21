/* =========================================================================
   treatment-calc.js
   พอร์ตตรงตัวจากฟังก์ชัน calculateTreatmentPlan() ใน api.php (PHP) มาเป็น JavaScript
   เพราะเมื่อย้ายไป Supabase จะไม่มี PHP ฝั่งเซิร์ฟเวอร์แล้ว
   (ตรรกะ/ตัวเลข/ข้อความคำสั่งยา ทุกอย่างเหมือนเดิม และผ่านการเทียบผลกับ PHP เดิมแล้ว)
   ========================================================================= */
(function (root) {
    'use strict';

    // PHP round(): ปัดครึ่งออกจากศูนย์ (ต่างจาก Math.round กรณีค่าติดลบ) + กันค่าคลาดเคลื่อนของทศนิยม
    function phpRound(value, places) {
        const f = Math.pow(10, places || 0);
        const sign = value < 0 ? -1 : 1;
        return sign * Math.round(Math.abs(value) * f + 1e-9) / f;
    }

    // PHP htmlspecialchars() แบบพื้นฐาน
    function htmlspecialchars(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * ฟังก์ชันคำนวณปรับปรุงโดสยา (Titration) และสัดส่วน MEDD ตามสภาวะผู้ป่วยจริง
     */
    function calculateTreatmentPlan(
        id_card, weight, age, crcl, pps_score, pain_score, drug_type, care_location, complications_arr,
        adjustment_mode = 'auto', titrate_action = '', prev_dose = 0, prev_drug_type = ''
    ) {
        complications_arr = Array.isArray(complications_arr) ? complications_arr : [];

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
                    base_daily_oral_morphine = phpRound(prev_medd * 1.3, 1);
                    break;
                case 'increase_50':
                    base_daily_oral_morphine = phpRound(prev_medd * 1.5, 1);
                    break;
                case 'decrease_25':
                    base_daily_oral_morphine = phpRound(prev_medd * 0.75, 1);
                    break;
                case 'decrease_50':
                    base_daily_oral_morphine = phpRound(prev_medd * 0.50, 1);
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
        let renal_status = 'การทำงานของไตปกติ (GFR > 50 mL/min)';

        if (crcl > 50) {
            renal_percent = 100;
            renal_status = 'GFR > 50 mL/min (ใช้ยาได้ 100%)';
        } else if (crcl >= 10 && crcl <= 50) {
            if (String(drug_type).indexOf('fentanyl') !== -1) {
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
            renal_status = 'GFR < 10 mL/min (ห้ามใช้ Morphine เด็ดขาด / ระบบเปลี่ยนเป็น Fentanyl ลดขนาดลงเหลือ 50%)';
        }

        let adjusted_dose = phpRound((base_daily_oral_morphine * renal_percent) / 100, 0);
        const prn_dose = phpRound(adjusted_dose * 0.15, 1);

        let atc_instruction = '';
        let prn_instruction = '';
        let drug_name = '';
        let unit = 'mg';

        switch (drug_type) {
            case 'morphine_oral':
                drug_name = 'Morphine ชนิดรับประทาน (Oral)';
                if (adjusted_dose <= 20) {
                    atc_instruction = '- MST 10 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 1 แคปซูล ทุก 24 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup (10mg/5ml) ทาน 2 cc (4 mg) ทุก 2-4 ชั่วโมง เมื่อมีอาการปวดเฉียบพลัน';
                } else if (adjusted_dose <= 30) {
                    atc_instruction = '- MST 10 mg ทาน 1 เม็ด ทุก 8 ชั่วโมง';
                    prn_instruction = '- Morphine Syrup ทาน 2.5 cc (5 mg) หรือ Mo IR 10 mg ทานครึ่งเม็ด (5 mg) ทุก 2-4 ชั่วโมง';
                } else if (adjusted_dose <= 40) {
                    atc_instruction = '- MST 10 mg ทาน 2 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 1 แคปซูล ทุก 12 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup ทาน 3.5 cc (7 mg) หรือ Mo IR 10 mg ทานครึ่งเม็ด ทุก 2-4 ชั่วโมง';
                } else if (adjusted_dose <= 60) {
                    atc_instruction = '- MST 30 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ Kapanol 20 mg ทาน 3 แคปซูล ทุก 24 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup ทาน 5 cc (10 mg) หรือ Mo IR 10 mg ทาน 1 เม็ด (10 mg) ทุก 2-4 ชั่วโมง';
                } else if (adjusted_dose <= 80) {
                    atc_instruction = '- Kapanol 20 mg ทาน 2 แคปซูล ทุก 12 ชั่วโมง (หรือ MST 10 mg ทาน 4 เม็ด ทุก 12 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup ทาน 6.5 cc (13 mg) หรือ Mo IR 10 mg ทาน 1 เม็ด ทุก 2-4 ชั่วโมง';
                } else if (adjusted_dose <= 90) {
                    atc_instruction = '- MST 30 mg ทาน 1 เม็ด ทุก 8 ชั่วโมง (หรือ MST 10 mg ทาน 3 เม็ด ทุก 8 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup ทาน 7.5 cc (15 mg) หรือ Mo IR 10 mg ทาน 1.5 เม็ด ทุก 2-4 ชั่วโมง';
                } else {
                    atc_instruction = '- MST 60 mg ทาน 1 เม็ด ทุก 12 ชั่วโมง (หรือ MST 30 mg ทาน 2 เม็ด ทุก 12 ชั่วโมง)';
                    prn_instruction = '- Morphine Syrup ทาน 10 cc (20 mg) หรือ Mo IR 10 mg ทาน 2 เม็ด ทุก 2-4 ชั่วโมง';
                }
                break;

            case 'morphine_iv': {
                drug_name = 'Morphine ชนิดฉีด (IV/SC Infusion)';
                const iv_daily_dose = phpRound(adjusted_dose / 3, 1);
                const iv_hourly = phpRound(iv_daily_dose / 24, 2);
                const prn_iv = phpRound(iv_daily_dose * 0.15, 1);

                atc_instruction = `- Morphine IV/SC continuous infusion อัตรา ${iv_hourly} mg/hr (ปริมาณรวม ${iv_daily_dose} mg ในรอบ 24 ชั่วโมง)`;
                prn_instruction = `- Morphine ${prn_iv} mg IV/SC prn สำหรับอาการปวดปะทุเฉียบพลัน (Breakthrough pain) ทุก 2-4 ชั่วโมง`;
                adjusted_dose = iv_daily_dose;
                break;
            }

            case 'fentanyl_iv': {
                drug_name = 'Fentanyl ชนิดฉีด (IV/SC Infusion)';
                unit = 'mcg';
                const fentanyl_mcg_hr = phpRound((adjusted_dose / 60) * 20, 1);
                const prn_fentanyl = phpRound(fentanyl_mcg_hr * 1.5, 1);

                atc_instruction = `- Fentanyl IV/SC continuous infusion อัตรา ${fentanyl_mcg_hr} mcg/hr`;
                prn_instruction = `- Fentanyl ${prn_fentanyl} mcg IV/SC prn สำหรับอาการปวดปะทุเฉียบพลัน ทุก 1-2 ชั่วโมง`;
                adjusted_dose = fentanyl_mcg_hr * 24;
                break;
            }

            case 'fentanyl_patch': {
                drug_name = 'Fentanyl ชนิดแผ่นแปะผิวหนัง (Transdermal Patch)';
                unit = 'mcg/hr';
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
                prn_instruction = '- กรณีปวดเฉียบพลันระหว่างใช้อุปกรณ์แผ่นแปะ ให้ใช้ยาบรรเทาปวดเสริม Fentanyl IV prn หรือ Morphine Syrup/IR (หากค่าไต GFR > 10)';
                adjusted_dose = patch_size;
                break;
            }
        }

        let clinical_advice = '• การควบคุมความปวดได้ดีคือ ปวดน้อยเกือบตลอดเวลา (Pain score ≤ 3)<br>';
        clinical_advice += '• มีความปวดเฉียบพลันปะทุไม่เกิน 2 ครั้งต่อวัน และเมื่อได้รับประทานยาสำรอง PRN แล้วสามารถลดอาการลงมาได้รวดเร็ว';
        if (adjustment_mode === 'titrate') {
            clinical_advice += '<br>• <strong>[ปรับปรุงแผนยา]:</strong> คำนวณปริมาณยาเทียบเท่ารอบก่อนด้วย MEDD เพื่อดำเนินการ: <strong>' + htmlspecialchars(titrate_action) + '</strong>';
        }

        return {
            id_card: id_card,
            weight: weight,
            age: age,
            crcl: crcl,
            pps_score: pps_score,
            pain_score: pain_score,
            care_location: care_location,
            complications: complications_arr.filter(Boolean).join(','),
            renal_status: renal_status,
            renal_percent: renal_percent,
            drug_name: drug_name,
            unit: unit,
            base_daily_dose: base_daily_oral_morphine,
            adjusted_daily_dose: adjusted_dose,
            prn_dose: prn_dose,
            atc_instruction: atc_instruction,
            prn_instruction: prn_instruction,
            clinical_advice: clinical_advice
        };
    }

    root.calculateTreatmentPlan = calculateTreatmentPlan;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { calculateTreatmentPlan: calculateTreatmentPlan };
    }
})(typeof window !== 'undefined' ? window : globalThis);
