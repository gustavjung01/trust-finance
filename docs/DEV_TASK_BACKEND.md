# Lệnh giao dev - Đợt 1 backend SHBFinance lead gen

Repo local dự kiến: `F:\1_A_Disk_D\Web-Tuyen-Dung`

## Gửi dev

Trước khi sửa, kiểm tra repo/local hiện tại:

```powershell
git status --short
git branch --show-current
git log -1 --oneline
```

Yêu cầu đợt 1:

Làm backend cho landing thu lead tín dụng SHBFinance/CTV, chưa làm frontend.

### Việc cần làm

1. Tìm backend hiện tại và cách route/API đang được khai báo.
2. Tìm cấu hình Telegram hiện có trong admin/web-support/chatbot nếu có.
3. Thêm bảng/collection `finance_leads` theo file `docs/DB_SCHEMA_SQLITE.sql` hoặc chuyển sang DB hiện tại nếu repo không dùng SQLite.
4. Thêm API:
   - `POST /api/finance-leads`
   - `GET /api/admin/finance-leads`
   - `PATCH /api/admin/finance-leads/:id/status`
   - `POST /api/admin/finance-leads/test-telegram`
5. Thêm rule lead nóng:
   - Có số điện thoại hợp lệ.
   - Hoặc message/note chứa keyword nóng: cic, check cic, nợ xấu, no xau, vay, mở thẻ, mo the, hạn mức, han muc, lãi suất, lai suat, gọi lại, goi lai, cần tiền, can tien, cần vốn, can von.
6. Thêm 2 tùy chọn cấu hình Telegram nếu admin settings hiện tại có chỗ lưu:
   - `notify_finance_chat_lead`
   - `notify_finance_hot_lead`
7. Telegram message phải có: tên, sđt, sản phẩm, nguồn, CTA, nội dung, hot reason, thời gian.
8. Không in token Telegram, không in service account JSON, không commit secret.
9. Chạy test/build phù hợp. Nếu pass thì commit local.

### Nguyên tắc nội dung

- Không nói “bao duyệt”.
- Không nói “duyệt 100%”.
- Không nói “xóa CIC/xóa nợ xấu”.
- Chỉ dùng câu: “Hỗ trợ kiểm tra sơ bộ điều kiện hồ sơ, kết quả phụ thuộc thẩm định.”
- Form đầu vào không bắt CCCD.

### Báo cáo cuối cần có

- Files changed.
- API đã thêm.
- DB migration đã chạy/chưa chạy.
- Test curl result.
- Telegram test result.
- Commit hash nếu có.
- Chưa push Git.
