# Đợt 1 - Backend full: SHBFinance lead gen + Telegram notify

Mục tiêu đợt 1: làm xong phần nhận lead, lưu lead, phân loại lead nóng, gửi Telegram, mở API cho landing/chatbot dùng.

Không làm frontend trong đợt này. Không đụng secret/key. Không git push.

## Scope bắt buộc

1. Thêm bảng/collection `finance_leads`.
2. Thêm API nhận lead từ landing và chatbot.
3. Thêm rule bắt lead nóng:
   - Có số điện thoại Việt Nam.
   - Có keyword nóng: cic, check cic, nợ xấu, no xau, vay, mở thẻ, mo the, hạn mức, han muc, lãi suất, lai suat, gọi lại, goi lai, cần tiền, can tien, cần vốn, can von.
4. Gửi Telegram theo 2 tùy chọn:
   - `notify_finance_chat_lead`: báo khi có lead mới từ chat/form.
   - `notify_finance_hot_lead`: báo khi có số điện thoại hoặc keyword nóng.
5. API admin xem lead, đổi trạng thái lead.
6. Test Telegram không in token ra log.

## Luồng đúng

Landing/form/chatbot -> POST `/api/finance-leads` -> validate -> lưu DB -> phân loại hot/normal -> gửi Telegram nếu bật -> trả response success.

## Không được làm

- Không tạo popup.
- Không sửa UI landing trong đợt backend.
- Không yêu cầu CCCD ở form đầu vào.
- Không hứa duyệt 100%.
- Không viết nội dung “xóa CIC”, “xóa nợ xấu”, “bao duyệt”.
- Không commit `.env`, bot token, service account JSON.

## Thứ tự làm

1. Kiểm tra repo và stack thật.
2. Tìm nơi đang có Telegram config hiện tại.
3. Thêm schema/migration.
4. Thêm service `financeLeadScoring`.
5. Thêm service `telegramFinanceNotify` dùng lại Telegram config có sẵn.
6. Thêm routes/API.
7. Test bằng curl.
8. Build/test pass thì commit local.

## API tối thiểu

- `POST /api/finance-leads`
- `GET /api/admin/finance-leads`
- `PATCH /api/admin/finance-leads/:id/status`
- `POST /api/admin/finance-leads/test-telegram`

Xem chi tiết trong `docs/API_SPEC.md` và `docs/DEV_TASK_BACKEND.md`.

## Chú ý khi triển khai production
- Nếu chạy trên nền tảng serverless, không nên trông vào file local để lưu dữ liệu.
- Production nên dùng `DATABASE_URL` trỏ tới database ngoài, ví dụ Heroku Postgres, Supabase Postgres, MySQL.
- Khi đã có database dùng chung, cấu hình admin, lead và Telegram sẽ bền giữa các trình duyệt và lần deploy.
