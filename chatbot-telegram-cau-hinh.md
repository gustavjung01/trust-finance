# Cau hinh Chatbot ngoai website + Telegram

Tai lieu nay chi mo ta phan cau hinh chatbot ngoai website va Telegram trong trang admin.
Khong nhac den ten nhan khac, chi tap trung vao 2 phan:
- Chatbot tu van ngoai website
- Telegram

## 1. Chatbot tu van ngoai website

Nhom nay la chatbot chinh dang duoc dung tren web.
Trong UI, chon loai:
- `Conversation / Google Chat / Doi tu van`

### Cac truong can nhap
- `Base URL`: `https://dialogflow.googleapis.com/v3`
- `Project ID`: project chua agent that
- `Location`: chon dung location cua agent, thuong la `global`
- `Language Code`: thuong la `vi`
- `Agent ID`: lay dung ID cua agent trong URL `/agents/{agentId}`
- `Google Cloud Credentials JSON`: file service account JSON

### Cach lay dung thong tin
Tu URL agent, vi du:

```text
https://conversational-agents.cloud.google.com/projects/support-498415/locations/global/agents/94419253-a766-4984-bfab-f9c1ff48f96c
```

Lay ra:
- `Project ID` = `support-498415`
- `Location` = `global`
- `Agent ID` = `94419253-a766-4984-bfab-f9c1ff48f96c`

### Cach nap file JSON
- Bam `Chon file JSON`.
- Nap file service account JSON vao o `Google Cloud Credentials JSON`.
- He thong se tu doc `project_id` trong file neu `Project ID` dang trong.
- Day la cach nhanh nhat de load agent trong admin.

### Dieu kien de test thanh cong
- Service account trong JSON phai duoc grant quyen tren **dung project chua agent**.
- Neu agent nam o project khac, cap quyen o project khac se van loi.
- Quyen can co:
  - `Dialogflow API Client`
  - `Dialogflow API Admin`
  - Neu can test nhanh, co the tam cap `Owner` tren dung project do

### Loi thuong gap
- `Service account không có quyền Dialogflow`: thuong do sai project, sai location, chua grant IAM, hoac API chua enable.
- `404`: thuong do sai `Agent ID` hoac sai `Location`.

## 2. Telegram

Phan nay dung de gui thong bao don ung tuyen va lead tu chatbot.

### Cac truong can cau hinh
- `Bot Token`: token lay tu Telegram BotFather
- `Default Channel`: kenh Telegram mac dinh de nhan thong bao
- `Notify on Application`: bat neu muon gui thong bao khi co don ung tuyen
- `Notify on Lead`: bat neu muon gui thong bao khi chatbot bat duoc lead moi

### Nut thao tac
- `Test Telegram`: gui thu de kiem tra bot token va channel
- `Lưu Telegram`: luu cau hinh vao he thong

### Ghi nho
- Neu bot token doi, can test lai ngay.
- Neu default channel sai, thong bao se khong den dung noi.
- Khong can dong vai tro vao chatbot; Telegram la phan thong bao rieng.

## 3. Thu tu cau hinh nhanh

1. Chon `Conversation / Google Chat / Doi tu van`.
2. Nap file JSON service account.
3. Dien dung `Project ID`, `Location`, `Agent ID`.
4. Bam `Kiem tra ket noi` de load agent.
5. Cau hinh `Telegram`.
6. Bam `Test Telegram`.
7. Neu ca hai ok thi bam `Lưu cấu hình`.

## 4. Mau cau hinh nhanh

```text
Chatbot:
- Base URL: https://dialogflow.googleapis.com/v3
- Project ID: support-498415
- Location: global
- Language Code: vi
- Agent ID: 94419253-a766-4984-bfab-f9c1ff48f96c
- Credentials JSON: support-vieclamgannha-4cb170c0b995.json

Telegram:
- Bot Token: lay tu BotFather
- Default Channel: kenh nhan thong bao
- Notify on Application: bat/tat tuy nhu cau
- Notify on Lead: bat/tat tuy nhu cau
```

## 5. Luu y cuoi

- Chatbot va Telegram la hai phan rieng.
- Chatbot dung service account JSON de goi Google API.
- Telegram dung bot token rieng cua Telegram.
- Khong tron `Agent ID` voi `Engine / App ID`.
- Khong dung ten hien thi cua agent, chi dung ID that.
