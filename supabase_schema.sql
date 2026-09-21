-- =====================================================================
--  Palliative Care Management — Supabase (PostgreSQL) schema
--  วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
--  (รันซ้ำได้อย่างปลอดภัย ใช้ IF NOT EXISTS / OR REPLACE)
--
--  หมายเหตุ: โครงสร้างตารางด้านล่าง "อนุมาน" จากโค้ด api.php เดิม
--  (ไม่มีไฟล์ dump ของ MySQL แนบมา) — ถ้าตารางเดิมมีคอลัมน์อื่นเพิ่ม
--  ให้เพิ่มในที่นี้ด้วย
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) ตาราง
-- ---------------------------------------------------------------------

-- ข้อมูลผู้ใช้งานระบบ (รหัสผ่านเก็บใน Supabase Auth ไม่ได้เก็บในตารางนี้)
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    username    text        not null,
    full_name   text        not null,
    email       text,
    phone       text,
    role        text        not null default 'user' check (role in ('user', 'admin')),
    is_active   boolean     not null default true,
    created_at  timestamptz not null default now(),
    last_login  timestamptz
);
create unique index if not exists profiles_username_lower_key
    on public.profiles (lower(username));

-- ข้อมูลผู้ป่วย (1 เลขบัตร = 1 แถว)
create table if not exists public.patients (
    id_card     text primary key,
    weight      numeric(6,2) not null,
    age         integer      not null,
    created_at  timestamptz  not null default now(),
    updated_at  timestamptz  not null default now()
);

-- ประวัติการประเมิน/แผนการรักษา (1 ผู้ป่วยมีได้หลายรอบ)
create table if not exists public.assessments (
    id                   bigint generated always as identity primary key,
    id_card              text        not null
                         references public.patients (id_card) on update cascade on delete cascade,
    crcl                 numeric     not null,
    pps_score            integer     not null,
    pain_score           integer     not null,
    drug_type            text        not null,
    care_location        text,
    complications        text,
    base_daily_dose      numeric,
    adjusted_daily_dose  numeric,
    prn_dose             numeric,
    treatment_plan       jsonb,
    created_by           uuid        default auth.uid()
                         references public.profiles (id) on delete set null,
    created_at           timestamptz not null default now()
);
create index if not exists assessments_id_card_created_idx
    on public.assessments (id_card, created_at desc);
create index if not exists assessments_created_at_idx
    on public.assessments (created_at desc);


-- ---------------------------------------------------------------------
-- 2) ฟังก์ชันช่วยตรวจสิทธิ์ (SECURITY DEFINER เพื่อไม่ให้ RLS วนซ้ำตัวเอง)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_active
    );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_active and p.role = 'admin'
    );
$$;

-- อัปเดตเวลา login ล่าสุดของตัวเอง (ผู้ใช้ทั่วไปแก้ตาราง profiles ตรงๆ ไม่ได้)
create or replace function public.touch_last_login()
returns void
language sql security definer
set search_path = public, pg_temp
as $$
    update public.profiles set last_login = now() where id = auth.uid();
$$;


-- ---------------------------------------------------------------------
-- 3) ฟังก์ชันบันทึก/แก้ไขการประเมิน (ทำเป็น transaction เดียว
--    เหมือน beginTransaction/commit ใน api.php เดิม)
--    SECURITY INVOKER = ยังถูกบังคับด้วย RLS ตามสิทธิ์ของผู้เรียก
-- ---------------------------------------------------------------------
create or replace function public.save_assessment(
    p_id_card             text,
    p_weight              numeric,
    p_age                 integer,
    p_crcl                numeric,
    p_pps_score           integer,
    p_pain_score          integer,
    p_drug_type           text,
    p_care_location       text,
    p_complications       text,
    p_base_daily_dose     numeric,
    p_adjusted_daily_dose numeric,
    p_prn_dose            numeric,
    p_treatment_plan      jsonb
)
returns bigint
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
    v_id bigint;
begin
    insert into public.patients (id_card, weight, age)
    values (p_id_card, p_weight, p_age)
    on conflict (id_card) do update
        set weight = excluded.weight,
            age = excluded.age,
            updated_at = now();

    insert into public.assessments (
        id_card, crcl, pps_score, pain_score, drug_type, care_location, complications,
        base_daily_dose, adjusted_daily_dose, prn_dose, treatment_plan
    ) values (
        p_id_card, p_crcl, p_pps_score, p_pain_score, p_drug_type, p_care_location, p_complications,
        p_base_daily_dose, p_adjusted_daily_dose, p_prn_dose, p_treatment_plan
    )
    returning id into v_id;

    return v_id;
end;
$$;

create or replace function public.update_assessment(
    p_id                  bigint,
    p_id_card             text,
    p_weight              numeric,
    p_age                 integer,
    p_crcl                numeric,
    p_pps_score           integer,
    p_pain_score          integer,
    p_drug_type           text,
    p_care_location       text,
    p_complications       text,
    p_base_daily_dose     numeric,
    p_adjusted_daily_dose numeric,
    p_prn_dose            numeric,
    p_treatment_plan      jsonb
)
returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
    update public.assessments
       set crcl = p_crcl,
           pps_score = p_pps_score,
           pain_score = p_pain_score,
           drug_type = p_drug_type,
           care_location = p_care_location,
           complications = p_complications,
           base_daily_dose = p_base_daily_dose,
           adjusted_daily_dose = p_adjusted_daily_dose,
           prn_dose = p_prn_dose,
           treatment_plan = p_treatment_plan
     where id = p_id;

    if not found then
        raise exception 'ไม่พบรายการประวัติที่ต้องการแก้ไข (id=%)', p_id;
    end if;

    update public.patients
       set weight = p_weight, age = p_age, updated_at = now()
     where id_card = p_id_card;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Row Level Security  (สำคัญมาก — publishable key อยู่ใน JS ที่ใครก็เห็นได้
--    ความปลอดภัยของข้อมูลจึงขึ้นอยู่กับส่วนนี้ทั้งหมด)
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.patients     enable row level security;
alter table public.assessments  enable row level security;

-- profiles: เห็นเฉพาะของตัวเอง (Admin เห็นทั้งหมด)
-- ไม่มี policy insert/update/delete → แก้ไขได้ผ่าน Edge Function (service role) เท่านั้น
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.is_admin());

-- patients / assessments: ผู้ใช้ที่ login แล้วและบัญชียังเปิดใช้งาน (is_active) ใช้งานได้ทั้งหมด
-- (เหมือนพฤติกรรมเดิมของ api.php ที่ทุกคนที่ login เห็นข้อมูลชุดเดียวกัน)
drop policy if exists patients_all on public.patients;
create policy patients_all on public.patients
    for all to authenticated
    using (public.is_active_user())
    with check (public.is_active_user());

drop policy if exists assessments_all on public.assessments;
create policy assessments_all on public.assessments
    for all to authenticated
    using (public.is_active_user())
    with check (public.is_active_user());


-- ---------------------------------------------------------------------
-- 5) สิทธิ์การเข้าถึง (defense in depth: ตัดสิทธิ์ผู้ที่ยังไม่ login ทั้งหมด)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from public, anon;

revoke all on public.profiles from authenticated;
grant  select on public.profiles to authenticated;
grant  select, insert, update, delete on public.patients, public.assessments to authenticated;

grant execute on function
    public.is_active_user(),
    public.is_admin(),
    public.touch_last_login(),
    public.save_assessment(text, numeric, integer, numeric, integer, integer, text, text, text, numeric, numeric, numeric, jsonb),
    public.update_assessment(bigint, text, numeric, integer, numeric, integer, integer, text, text, text, numeric, numeric, numeric, jsonb)
to authenticated;


-- ---------------------------------------------------------------------
-- 6) สร้างผู้ดูแลระบบคนแรก (ทำครั้งเดียว)
--    ขั้นที่ 1: Dashboard → Authentication → Users → Add user → Create new user
--               Email:    admin@palliative.local      (= <username>@<AUTH_EMAIL_DOMAIN>)
--               Password: (ตั้งเอง)      และติ๊ก "Auto Confirm User"
--    ขั้นที่ 2: เอา comment ด้านล่างออกแล้วรัน
-- ---------------------------------------------------------------------
-- insert into public.profiles (id, username, full_name, role)
-- select id, 'admin', 'ผู้ดูแลระบบ', 'admin'
-- from auth.users
-- where email = 'admin@palliative.local';
