-- 036: Vị trí trường trên bản đồ (bản đồ độ phủ STEM ở Dashboard toàn Sở).
--   1. organizations.lat / lng (WGS84). Giới hạn trong vùng Việt Nam kể cả biển đảo.
--   2. set_school_location(trường, lat, lng): KDI; Sở/Phòng/Tỉnh cấp trên của trường; quản trị (Hiệu trưởng, QTV) của chính
--      trường đó. Truyền null để xoá vị trí. Ghi nhật ký qua audit_organizations (021).
--   3. Toạ độ GẦN ĐÚNG cho 23 trường demo (Hưng Yên, Bắc Ninh) để bản đồ có số liệu trình diễn: khớp cả mã lẫn tên trường,
--      chỉ đặt khi chưa có vị trí. CSDL không có các trường demo này thì không đổi gì.

alter table organizations add column if not exists lat double precision;
alter table organizations add column if not exists lng double precision;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_location_check') then
    alter table organizations add constraint organizations_location_check check (
      (lat is null and lng is null) or (lat between 7 and 24 and lng between 102 and 118));
  end if;
end $$;

create or replace function public.set_school_location(p_org uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select type from organizations where id = p_org) is distinct from 'school' then
    raise exception 'Chỉ đặt vị trí cho trường học' using errcode = '22023';
  end if;
  if not (public.is_platform_admin()
          or (public.is_authority() and p_org in (select public.my_org_tree()))
          or (p_org = public.my_org_id() and public.is_admin())) then
    raise exception 'Không có quyền đặt vị trí trường này' using errcode = '42501';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Cần cả vĩ độ và kinh độ' using errcode = '22023';
  end if;
  update organizations set lat = p_lat, lng = p_lng where id = p_org;
end $$;
revoke all on function public.set_school_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_school_location(uuid, double precision, double precision) to authenticated;

-- Toạ độ gần đúng cho trường demo: nằm trong ranh giới xã/phường mới cùng tên (public/geo, scripts/build-geo.mjs);
-- trường ghi theo tên huyện cũ (Kim Động, Văn Lâm) đặt ở xã mới theo địa danh trong tên trường (Lương Bằng, Hiệp Cường, Lạc Đạo, Đại Đồng).
update organizations o set lat = v.lat, lng = v.lng
  from (values
    ('THCS-PH',  'Trường THCS Phố Hiến',                 20.6560, 106.0560),
    ('THPT-CHY', 'Trường THPT Chuyên Hưng Yên',          20.6670, 106.0737),
    ('THPT-NH',  'Trường THPT Nguyễn Huệ',               20.6515, 106.0625),
    ('THCS-LQD', 'Trường THCS Lê Quý Đôn',               20.6625, 106.0610),
    ('TH-DTD',   'Trường Tiểu học Đoàn Thị Điểm',        20.6500, 106.0520),
    ('THCS-AT',  'Trường THCS Ân Thi',                   20.8140, 106.0920),
    ('THPT-PNL', 'Trường THPT Phạm Ngũ Lão',             20.8205, 106.0855),
    ('TH-KCA',   'Trường Tiểu học Khoái Châu A',         20.8350, 105.9760),
    ('THCS-NTT', 'Trường THCS Nguyễn Thiện Thuật',       20.8168, 105.9739),
    ('THCS-HC',  'Trường THCS Hiệp Cường',               20.7370, 106.0320),
    ('TH-LB',    'Trường Tiểu học Lương Bằng',           20.7546, 106.0666),
    ('TH-MH',    'Trường Tiểu học Mỹ Hào',               20.9531, 106.0781),
    ('MN-HS',    'Trường Mầm non Hoa Sen',               20.9345, 106.0745),
    ('THCS-TH',  'Trường THCS Tô Hiệu',                  20.6720, 106.1310),
    ('THCS-CMT', 'Trường THCS Chu Mạnh Trinh',           20.9320, 105.9310),
    ('THPT-VG',  'Trường THPT Văn Giang',                20.9385, 105.9250),
    ('THPT-TV',  'Trường THPT Trưng Vương',              20.9260, 105.9380),
    ('THCS-DD',  'Trường THCS Đại Đồng',                 20.9813, 106.0964),
    ('TH-LD',    'Trường Tiểu học Lạc Đạo',              20.9785, 106.0368),
    ('TH-HTLO',  'Trường Tiểu học Hải Thượng Lãn Ông',   20.8727, 106.0549),
    ('THPT-TQP', 'Trường THPT Triệu Quang Phục',         20.8915, 106.0330),
    ('THCS-KB',  'Trường THCS Kinh Bắc',                 21.1860, 106.0760),
    ('THPT-HT',  'Trường THPT Hàn Thuyên',               21.1950, 106.0950)
  ) as v(code, name, lat, lng)
 where o.code = v.code and o.name = v.name and o.type = 'school' and o.lat is null;
