-- 150: Sản phẩm của chủ đề trong khung chương trình (VD: "Mô hình ngôi nhà mơ ước bằng bìa giấy"), hiện cạnh Yêu cầu cần đạt.
alter table program_topics add column if not exists product text not null default '';
comment on column program_topics.product is 'Sản phẩm học sinh làm ra trong chủ đề';
notify pgrst, 'reload schema';
