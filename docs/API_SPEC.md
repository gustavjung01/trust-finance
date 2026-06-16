# API Spec - Finance lead gen

## 1. POST /api/finance-leads

Nhận lead từ landing, bottom bar, chatbot, Zalo redirect pre-form.

### Request JSON

```json
{
  "full_name": "Nguyễn Văn A",
  "phone": "0912345678",
  "product_type": "check_cic",
  "province": "TP.HCM",
  "loan_amount": "30000000",
  "message": "Em muốn check CIC, từng chậm thanh toán",
  "source": "facebook_group",
  "utm_source": "facebook",
  "utm_campaign": "group-post-001",
  "cta_position": "bottom_bar_check_cic",
  "page_url": "https://vieclamgannha.me/tin-dung-shbfinance",
  "chat_session_id": "optional-session-id"
}
```

### product_type enum

- `check_cic` - Check CIC / kiểm tra hồ sơ
- `cash_loan` - Vay tiền mặt
- `app_loan` - Vay online/app
- `credit_card` - Mở thẻ tín dụng
- `consulting` - Tư vấn chung

### source enum gợi ý

- `facebook_group`
- `facebook_ads`
- `zalo`
- `organic`
- `chatbot`
- `unknown`

### Response success

```json
{
  "success": true,
  "data": {
    "id": 123,
    "lead_code": "FIN-20260607-000123",
    "is_hot": true,
    "hot_reasons": ["phone", "keyword:cic"]
  }
}
```

### Validate

- `phone` bắt buộc, chuẩn hóa về số VN.
- `full_name` optional nhưng nếu trống lưu `Khách chưa để tên`.
- Không nhận CCCD ở endpoint public.
- `message` tối đa 1000 ký tự.
- `page_url` tối đa 500 ký tự.

## 2. GET /api/admin/finance-leads

Admin xem lead. Phải dùng auth admin hiện có của repo.

Query:

```text
?page=1&limit=50&product_type=check_cic&status=new&is_hot=1&search=0912
```

Response:

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 50, "total": 0, "total_pages": 0 }
}
```

## 3. PATCH /api/admin/finance-leads/:id/status

```json
{
  "status": "contacted",
  "note": "Đã gọi lần 1"
}
```

Status enum:

- `new`
- `contacted`
- `qualified`
- `sent_to_shb`
- `converted`
- `rejected`
- `spam`

## 4. POST /api/admin/finance-leads/test-telegram

Gửi thử Telegram theo config hiện tại. Không trả token trong response.

```json
{ "type": "hot_lead" }
```
