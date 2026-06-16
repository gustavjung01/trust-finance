-- Finance lead gen schema - SQLite version
-- Nếu backend dùng PostgreSQL/MySQL thì dev chuyển tương ứng.

CREATE TABLE IF NOT EXISTS finance_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_code TEXT UNIQUE,
  full_name TEXT,
  phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'consulting',
  province TEXT,
  loan_amount TEXT,
  message TEXT,
  source TEXT DEFAULT 'unknown',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  cta_position TEXT,
  page_url TEXT,
  chat_session_id TEXT,
  is_hot INTEGER DEFAULT 0,
  hot_reasons TEXT,
  status TEXT DEFAULT 'new',
  admin_note TEXT,
  telegram_sent INTEGER DEFAULT 0,
  telegram_hot_sent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_leads_phone ON finance_leads(normalized_phone);
CREATE INDEX IF NOT EXISTS idx_finance_leads_status ON finance_leads(status);
CREATE INDEX IF NOT EXISTS idx_finance_leads_product ON finance_leads(product_type);
CREATE INDEX IF NOT EXISTS idx_finance_leads_hot ON finance_leads(is_hot);
CREATE INDEX IF NOT EXISTS idx_finance_leads_created ON finance_leads(created_at);

-- Nếu có bảng settings/admin_settings hiện có, thêm key cấu hình:
-- notify_finance_chat_lead = true/false
-- notify_finance_hot_lead = true/false
-- finance_hot_keywords = cic,check cic,nợ xấu,no xau,vay,mở thẻ,mo the,hạn mức,han muc,lãi suất,lai suat,gọi lại,goi lai,cần tiền,can tien,cần vốn,can von
