-- 169: Thẻ giới thiệu gói STEM do KDI tự soạn (phương án 3 trang Gói STEM).
-- color: màu đầu thẻ (#rrggbb), trống = màu mặc định theo thứ tự gói.
-- card_tagline: câu giới thiệu; card_highlights: các dòng nổi bật (có dấu tick); card_footer: dòng cuối thẻ (VD giá, ghi chú).
-- Gói chưa soạn thẻ (cả ba trống) thì trang hiển thị như cũ. Quyền đọc/sửa giữ như bảng program_packages (148).
alter table program_packages add column if not exists color text;
alter table program_packages add column if not exists card_tagline text not null default '';
alter table program_packages add column if not exists card_highlights text[] not null default '{}';
alter table program_packages add column if not exists card_footer text not null default '';
alter table program_packages drop constraint if exists program_packages_color_chk;
alter table program_packages add constraint program_packages_color_chk check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
alter table program_packages drop constraint if exists program_packages_card_chk;
alter table program_packages add constraint program_packages_card_chk check (
  char_length(card_tagline) <= 300 and char_length(card_footer) <= 200 and coalesce(array_length(card_highlights, 1), 0) <= 8);
comment on column program_packages.color is 'Màu đầu thẻ gói (169)';
comment on column program_packages.card_tagline is 'Câu giới thiệu trên thẻ gói (169)';
comment on column program_packages.card_highlights is 'Các dòng nổi bật trên thẻ gói (169)';
comment on column program_packages.card_footer is 'Dòng cuối thẻ gói (169)';
