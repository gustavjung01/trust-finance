// Reference only. Dev adapt to actual Telegram service/config in repo.
// Do not log bot token.

const PRODUCT_LABELS = {
  check_cic: 'Check CIC / kiểm tra hồ sơ',
  cash_loan: 'Vay tiền mặt',
  app_loan: 'Vay online/app',
  credit_card: 'Mở thẻ tín dụng',
  consulting: 'Tư vấn chung'
};

function safeText(value, fallback = '-') {
  const text = value == null || value === '' ? fallback : String(value);
  return text.slice(0, 1000);
}

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map(item => String(item).trim()).filter(Boolean);
  }

  return String(input || '')
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatFinanceLeadTelegram(lead, type = 'normal') {
  const title = type === 'hot'
    ? '[LEAD NÓNG - CẦN GỌI NHANH]'
    : '[LEAD TÀI CHÍNH MỚI]';

  const lines = [
    title,
    `Mã: ${safeText(lead.lead_code)}`,
    `Tên: ${safeText(lead.full_name, 'Khách chưa để tên')}`,
    `SĐT: ${safeText(lead.normalized_phone || lead.phone)}`,
    ...(lead.product_type === 'check_cic'
      ? [
          `CCCD/CMND: ${safeText(lead.id_number, 'chưa có')}`,
          `Ngày sinh: ${safeText(lead.date_of_birth, 'chưa có')}`
        ]
      : []),
    `Sản phẩm: ${PRODUCT_LABELS[lead.product_type] || lead.product_type || 'Tư vấn chung'}`,
    `Nguồn: ${safeText(lead.source)}`,
    `CTA: ${safeText(lead.cta_position)}`,
  ];

  if (type === 'hot') lines.push(`Lý do nóng: ${safeText(lead.hot_reasons)}`);
  lines.push(`Nội dung: ${safeText(lead.message)}`);
  lines.push(`Thời gian: ${safeText(lead.created_at || new Date().toISOString())}`);

  return lines.join('\n');
}

async function notifyFinanceLead({ lead, settings, telegramSendMessage }) {
  // settings expected:
  // notify_finance_chat_lead, notify_finance_hot_lead, telegram_default_channel
  const recipients = normalizeRecipients(settings?.telegram_default_channel);
  if (!telegramSendMessage || recipients.length === 0) return { sent: false, reason: 'missing_telegram_config' };

  const results = [];

  if (settings.notify_finance_chat_lead) {
    for (const chatId of recipients) {
      results.push(await telegramSendMessage({
        chatId,
        text: formatFinanceLeadTelegram(lead, 'normal')
      }));
    }
  }

  if (settings.notify_finance_hot_lead && lead.is_hot) {
    for (const chatId of recipients) {
      results.push(await telegramSendMessage({
        chatId,
        text: formatFinanceLeadTelegram(lead, 'hot')
      }));
    }
  }

  return { sent: results.length > 0, results };
}

module.exports = { formatFinanceLeadTelegram, notifyFinanceLead, PRODUCT_LABELS };
