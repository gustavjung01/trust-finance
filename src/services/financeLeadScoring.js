// Reference only. Dev adapt to actual backend style.

const DEFAULT_HOT_KEYWORDS = [
  'cic', 'check cic', 'nợ xấu', 'no xau', 'vay', 'mở thẻ', 'mo the',
  'hạn mức', 'han muc', 'lãi suất', 'lai suat', 'gọi lại', 'goi lai',
  'cần tiền', 'can tien', 'cần vốn', 'can von'
];

function normalizeVietnamesePhone(input = '') {
  const raw = String(input).replace(/[^0-9+]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+84')) return '0' + raw.slice(3);
  if (raw.startsWith('84') && raw.length >= 11) return '0' + raw.slice(2);
  return raw;
}

function isVietnamesePhone(phone = '') {
  const p = normalizeVietnamesePhone(phone);
  return /^(0)(3|5|7|8|9)[0-9]{8}$/.test(p);
}

function stripVietnameseMarks(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function scoreFinanceLead(payload = {}, keywords = DEFAULT_HOT_KEYWORDS) {
  const reasons = [];
  const normalizedPhone = normalizeVietnamesePhone(payload.phone || '');
  if (isVietnamesePhone(normalizedPhone)) reasons.push('phone');

  const haystackRaw = [
    payload.message,
    payload.product_type,
    payload.source,
    payload.cta_position
  ].filter(Boolean).join(' ').toLowerCase();
  const haystackNoMark = stripVietnameseMarks(haystackRaw);

  for (const kw of keywords) {
    const rawKw = String(kw).toLowerCase().trim();
    const noMarkKw = stripVietnameseMarks(rawKw);
    if (!rawKw) continue;
    if (haystackRaw.includes(rawKw) || haystackNoMark.includes(noMarkKw)) {
      reasons.push(`keyword:${kw}`);
    }
  }

  return {
    normalizedPhone,
    isHot: reasons.length > 0,
    hotReasons: Array.from(new Set(reasons))
  };
}

module.exports = {
  DEFAULT_HOT_KEYWORDS,
  normalizeVietnamesePhone,
  isVietnamesePhone,
  scoreFinanceLead
};
