# Curl tests backend

Chạy sau khi dev đã gắn route thật.

```powershell
curl.exe -X POST "http://localhost:3900/api/finance-leads" `
  -H "Content-Type: application/json" `
  -d "{"full_name":"Test CIC","phone":"0912345678","product_type":"check_cic","message":"muon check CIC va no xau","source":"facebook_group","cta_position":"bottom_bar_check_cic"}"
```

Kỳ vọng:

```json
{"success":true,"data":{"is_hot":true}}
```

Admin list:

```powershell
curl.exe "http://localhost:3900/api/admin/finance-leads?page=1&limit=20&is_hot=1"
```
