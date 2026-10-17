-- 038: Nhập toạ độ trường hàng loạt từ Excel (bản đồ độ phủ STEM) — cho Sở/Phòng (trường trực thuộc) và quản trị nền tảng.
--   • import_school_locations(rows): mỗi dòng {code, lat, lng} hoặc {code, coord: "20.6560, 106.0560"} (dán từ Google Maps).
--     Dòng trống toạ độ được bỏ qua; ngoài phạm vi quyền, sai mã, ngoài vùng Việt Nam → báo lỗi theo dòng. Nhật ký qua audit_organizations.
--   • platform_import_schools (032) nhận thêm cột toạ độ khi tạo trường mới.

-- Đọc toạ độ: hai cột riêng (chấp nhận dấu phẩy thập phân) hoặc một ô "vĩ độ, kinh độ". Trả về {lat, lng}, null nếu trống.
create or replace function public.parse_latlng(p_lat text, p_lng text, p_coord text) returns double precision[]
language plpgsql immutable set search_path = public as $$
declare m text[]; a text := btrim(coalesce(p_lat, '')); b text := btrim(coalesce(p_lng, '')); c text := btrim(coalesce(p_coord, ''));
begin
  if a <> '' or b <> '' then
    if a = '' or b = '' then raise exception 'Thiếu vĩ độ hoặc kinh độ'; end if;
    a := replace(a, ',', '.'); b := replace(b, ',', '.');
    if a !~ '^-?\d+(\.\d+)?$' or b !~ '^-?\d+(\.\d+)?$' then raise exception 'Toạ độ không phải số: %, %', p_lat, p_lng; end if;
    return array[a::double precision, b::double precision];
  end if;
  if c = '' then return null; end if;
  m := regexp_match(c, '^\(?\s*(-?\d+\.\d+)\s*[,; ]\s*(-?\d+\.\d+)\s*\)?$');
  if m is null then raise exception 'Ô toạ độ cần dạng "20.6560, 106.0560": %', c; end if;
  return array[m[1]::double precision, m[2]::double precision];
end $$;

create or replace function public.import_school_locations(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_ll double precision[]; updated int := 0; blank int := 0; bad jsonb := '[]'::jsonb; v_msg text;
  v_platform boolean := public.is_platform_admin();
begin
  if not (v_platform or public.is_authority()) then raise exception 'Chỉ Sở/Phòng hoặc quản trị nền tảng' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'Tối đa 5000 dòng một lần' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_ll := public.parse_latlng(r->>'lat', r->>'lng', r->>'coord');
      if v_ll is null then blank := blank + 1; continue; end if;
      select id into v_id from organizations where code = btrim(r->>'code') and type = 'school';
      if v_id is null then raise exception 'Không có trường mã %', coalesce(nullif(btrim(r->>'code'), ''), '(trống)'); end if;
      if not (v_platform or v_id in (select public.my_org_tree())) then raise exception 'Trường % không thuộc đơn vị của bạn', r->>'code'; end if;
      if not (v_ll[1] between 7 and 24 and v_ll[2] between 102 and 118) then
        raise exception 'Toạ độ % , % ngoài Việt Nam (vĩ độ 7–24, kinh độ 102–118 — có thể bị đảo cột)', v_ll[1], v_ll[2];
      end if;
      update organizations set lat = v_ll[1], lng = v_ll[2] where id = v_id and (lat is distinct from v_ll[1] or lng is distinct from v_ll[2]);
      updated := updated + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      bad := bad || jsonb_build_object('line', r->'line', 'code', r->>'code', 'reason', v_msg);
    end;
  end loop;
  return jsonb_build_object('updated', updated, 'blank', blank, 'skipped', bad);
end $$;
revoke all on function public.import_school_locations(jsonb) from public, anon;
grant execute on function public.import_school_locations(jsonb) to authenticated;

-- 032 + toạ độ
create or replace function public.platform_import_schools(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_parent uuid; v_level text; v_ll double precision[]; created int := 0; bad jsonb := '[]'::jsonb; v_msg text;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Tối đa 2000 dòng một lần' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      if nullif(btrim(r->>'code'), '') is null or nullif(btrim(r->>'name'), '') is null then raise exception 'Thiếu mã hoặc tên trường'; end if;
      if exists (select 1 from organizations where code = btrim(r->>'code')) then raise exception 'Mã % đã có', btrim(r->>'code'); end if;
      select id into v_parent from organizations where code = btrim(r->>'parent_code') and type in ('department','district','province');
      if v_parent is null then raise exception 'Không tìm thấy Sở/Phòng có mã %', coalesce(r->>'parent_code', '(trống)'); end if;
      v_level := case lower(public.act_norm(r->>'level'))
        when 'mamnon' then 'mamnon' when 'mầm non' then 'mamnon' when 'tieuhoc' then 'tieuhoc' when 'tiểu học' then 'tieuhoc' when 'th' then 'tieuhoc'
        when 'thcs' then 'thcs' when 'trung học cơ sở' then 'thcs' when 'thpt' then 'thpt' when 'trung học phổ thông' then 'thpt'
        when '' then null else 'x' end;
      if v_level = 'x' then raise exception 'Cấp học "%" không hợp lệ (Mầm non / Tiểu học / THCS / THPT)', r->>'level'; end if;
      v_ll := public.parse_latlng(r->>'lat', r->>'lng', r->>'coord');
      if v_ll is not null and not (v_ll[1] between 7 and 24 and v_ll[2] between 102 and 118) then
        raise exception 'Toạ độ % , % ngoài Việt Nam (có thể bị đảo cột)', v_ll[1], v_ll[2];
      end if;
      insert into organizations (type, parent_id, code, name, level, ward, address, contact_name, contact_phone, contact_email, lat, lng)
        values ('school', v_parent, btrim(r->>'code'), btrim(r->>'name'), v_level, nullif(btrim(r->>'ward'), ''), nullif(btrim(r->>'address'), ''),
                nullif(btrim(r->>'contact_name'), ''), nullif(btrim(r->>'contact_phone'), ''), nullif(btrim(r->>'contact_email'), ''), v_ll[1], v_ll[2]);
      created := created + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      bad := bad || jsonb_build_object('line', r->'line', 'code', r->>'code', 'reason', v_msg);
    end;
  end loop;
  return jsonb_build_object('created', created, 'skipped', bad);
end $$;
revoke all on function public.platform_import_schools(jsonb) from public, anon;
grant execute on function public.platform_import_schools(jsonb) to authenticated;
