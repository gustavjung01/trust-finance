# Telegram rules - Finance lead gen

## 2 nút tích cần có trong admin

1. `notify_finance_chat_lead`
   - Bật: gửi Telegram khi có lead mới từ form/chatbot.
   - Tắt: chỉ lưu DB, không gửi thông báo thường.

2. `notify_finance_hot_lead`
   - Bật: gửi Telegram khi phát hiện lead mạnh.
   - Lead mạnh = có số điện thoại hoặc có keyword nóng.

## Keyword nóng mặc định

```text
cic, check cic, nợ xấu, no xau, vay, mở thẻ, mo the, hạn mức, han muc, lãi suất, lai suat, gọi lại, goi lai, cần tiền, can tien, cần vốn, can von
```

## Mẫu tin Telegram thường

```text
[LEAD TÀI CHÍNH MỚI]
Mã: FIN-20260607-000123
Tên: Nguyễn Văn A
SĐT: 0912345678
Sản phẩm: Check CIC
Nguồn: facebook_group
CTA: bottom_bar_check_cic
Nội dung: Em muốn kiểm tra hồ sơ trước khi vay
Thời gian: 07/06/2026 10:35
```

## Mẫu tin Telegram hot

```text
[LEAD NÓNG - CẦN GỌI NHANH]
Mã: FIN-20260607-000123
Tên: Nguyễn Văn A
SĐT: 0912345678
Sản phẩm: Check CIC
Lý do nóng: phone, keyword:cic, keyword:nợ xấu
Nguồn: facebook_group
Nội dung: Em nợ xấu nhóm cũ, muốn check CIC
```

## Bảo mật

- Không gửi CCCD qua Telegram.
- Không log bot token.
- Nếu gửi lỗi, lưu `telegram_sent=0` nhưng vẫn trả success cho lead để tránh mất lead.
