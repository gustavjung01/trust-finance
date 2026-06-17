const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const leadStore = require('../services/leadStore');
const { scoreFinanceLead, isVietnamesePhone } = require('../services/financeLeadScoring');
const { formatFinanceLeadTelegram } = require('../services/telegramFinanceNotify');
const { detectFinanceChat, makeSessionId, buildFallbackReply } = require('../services/dialogflowFinanceChat');

const CHAT_CAPTURE_KEYWORDS = [
  'gấp',
  'gap',
  'vay',
  'giải ngân',
  'giai ngan',
  'cần tiền',
  'can tien',
  'mở thẻ',
  'mo the',
  'cic'
];

function makeLeadCode(idOrTime) {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `FIN-${ymd}-${String(idOrTime).padStart(6, '0')}`;
}

function cleanPayload(body = {}) {
  return {
    full_name: String(body.full_name || body.ho_ten || 'Khach chua de ten').trim().slice(0, 120),
    phone: String(body.phone || body.so_dien_thoai || '').trim().slice(0, 30),
    id_number: String(body.id_number || body.cccd || body.cccd_number || body.cmnd || '').trim().slice(0, 32),
    date_of_birth: String(body.date_of_birth || body.dob || '').trim().slice(0, 20),
    product_type: String(body.product_type || body.san_pham_quan_tam || 'consulting').trim().slice(0, 50),
    province: String(body.province || body.tinh_thanh || '').trim().slice(0, 120),
    loan_amount: String(body.loan_amount || body.so_tien_han_muc_mong_muon || '').trim().slice(0, 50),
    message: String(body.message || body.ghi_chu || '').trim().slice(0, 1000),
    source: String(body.source || 'landing').trim().slice(0, 80),
    utm_source: String(body.utm_source || '').trim().slice(0, 120),
    utm_medium: String(body.utm_medium || '').trim().slice(0, 120),
    utm_campaign: String(body.utm_campaign || '').trim().slice(0, 160),
    cta_position: String(body.cta_position || '').trim().slice(0, 120),
    page_url: String(body.page_url || '').trim().slice(0, 500),
    chat_session_id: String(body.chat_session_id || '').trim().slice(0, 120)
  };
}

function settingExists(settings = {}, key) {
  return Object.prototype.hasOwnProperty.call(settings, key);
}

function parseSoftBoolean(value, fallback = false) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'enabled'].includes(text);
}

function maskSettingValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function normalizeTelegramChatIds(input) {
  return String(input || '')
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function getDialogflowCredentialsJson(settings = {}) {
  return settings.AI_CREDENTIALS_JSON || process.env.AI_CREDENTIALS_JSON || process.env.DIALOGFLOW_CREDENTIALS_JSON || '';
}

function getPhoneFromMessage(message = '') {
  const text = String(message || '').replace(/[^0-9+]/g, '');
  const localMatch = text.match(/0[35789][0-9]{8}/);
  if (localMatch) return localMatch[0];
  const intlMatch = text.match(/(?:\+?84)([35789][0-9]{8})/);
  return intlMatch ? `0${intlMatch[1]}` : '';
}

function shouldCaptureChatMessage(message = '') {
  const text = String(message || '').toLowerCase();
  const noMark = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

  const hotKeywords = [
    'vay',
    'mo the',
    'mở thẻ',
    'the',
    'thẻ',
    'cic',
    'no xau',
    'nợ xấu',
    'lai suat',
    'lãi suất',
    'han muc',
    'hạn mức',
    'giai ngan',
    'giải ngân',
    'goi lai',
    'gọi lại',
    'can tien',
    'cần tiền',
    'gap',
    'gấp'
  ];

  return Boolean(getPhoneFromMessage(message)) || hotKeywords.some(keyword => text.includes(keyword) || noMark.includes(keyword));
}

function makeTelegramConfigDebug(settings = {}) {
  const token = String(settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatIds = normalizeTelegramChatIds(settings.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID);
  const hasNormalSetting = settingExists(settings, 'notify_finance_chat_lead');
  const hasHotSetting = settingExists(settings, 'notify_finance_hot_lead');
  const defaultNotify = Boolean(token && chatIds.length > 0 && !hasNormalSetting && !hasHotSetting);

  return {
    tokenConfigured: Boolean(token),
    tokenPreview: maskSettingValue(token),
    chatIdsCount: chatIds.length,
    chatIdPreview: chatIds.map(maskSettingValue).join(', '),
    notifyFinanceChatLeadRaw: settingExists(settings, 'notify_finance_chat_lead') ? settings.notify_finance_chat_lead : null,
    notifyFinanceHotLeadRaw: settingExists(settings, 'notify_finance_hot_lead') ? settings.notify_finance_hot_lead : null,
    notifyFinanceChatLeadEnabled: parseSoftBoolean(settings.notify_finance_chat_lead, defaultNotify),
    notifyFinanceHotLeadEnabled: parseSoftBoolean(settings.notify_finance_hot_lead, defaultNotify),
    defaultNotify
  };
}

function resolveTelegramConfig(settings = {}) {
  const token = String(settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatIds = normalizeTelegramChatIds(settings.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID);
  const debug = makeTelegramConfigDebug(settings);
  return { token, chatIds, ...debug };
}

function makeNotifyDebug(result = {}) {
  return {
    sent: Boolean(result.sent),
    reason: result.reason || null,
    results: Array.isArray(result.results)
      ? result.results.map(item => ({
          success: Boolean(item.success),
          reason: item.reason || null,
          error: item.error || null,
          chatId: item.chatId ? maskSettingValue(item.chatId) : ''
        }))
      : []
  };
}

function scoreChatCapture(message = '') {
  const scored = scoreFinanceLead(
    {
      phone: String(message || ''),
      message: String(message || ''),
      source: 'chatbot'
    },
    CHAT_CAPTURE_KEYWORDS
  );

  const phone = isVietnamesePhone(scored.normalizedPhone) ? scored.normalizedPhone : '';
  const keywordReasons = (scored.hotReasons || []).filter(reason => reason.startsWith('keyword:'));
  const shouldCapture = Boolean(phone || keywordReasons.length);

  return {
    shouldCapture,
    phoneDetected: Boolean(phone),
    phone,
    isHot: shouldCapture,
    hotReasons: Array.from(new Set([
      ...(phone ? ['phone'] : []),
      ...keywordReasons
    ]))
  };
}

function buildTelegramMessage(lead, type = 'normal', extraLines = []) {
  const base = formatFinanceLeadTelegram(lead, type);
  const notes = Array.isArray(extraLines) ? extraLines.filter(Boolean) : [];
  return notes.length ? `${base}\n${notes.join('\n')}` : base;
}

async function telegramSendMessage({ chatId, text, token }) {
  if (!token) {
    return { success: false, reason: 'missing_telegram_config' };
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: String(chatId).trim(),
      text
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      reason: error.response?.data?.description || error.message || 'telegram_send_failed',
      error: error.response?.data?.description || error.message || 'telegram_send_failed',
      response: error.response?.data || null
    };
  }
}

function normalizeLeadPhoneValue(lead = {}) {
  return String(lead.normalized_phone || lead.phone || '').trim();
}

function hasValidPhone(value) {
  return Boolean(getPhoneFromMessage(String(value || '')) || isVietnamesePhone(String(value || '').trim()));
}

function hasLeadContact(lead = {}) {
  return hasValidPhone(normalizeLeadPhoneValue(lead));
}

function getCurrentMessagePhone(payload = {}, lead = {}) {
  return String(
    getPhoneFromMessage(payload.message || '')
    || payload.phone
    || lead.normalized_phone
    || lead.phone
    || ''
  ).trim();
}

async function notifyLeadIfNeeded({
  lead,
  previousLead = null,
  settings,
  currentMessageHasPhone = false,
  phoneJustAdded = false,
  phoneChanged = false,
  extraLines = [],
  forceSend = false
}) {
  const telegram = resolveTelegramConfig(settings);
  if (!telegram.tokenConfigured || telegram.chatIdsCount === 0) {
    return {
      sent: false,
      reason: 'missing_telegram_config',
      results: [],
      config: telegram,
      phoneNotify: false,
      phoneJustAdded: Boolean(phoneJustAdded),
      phoneChanged: Boolean(phoneChanged),
      currentMessageHasPhone: Boolean(currentMessageHasPhone)
    };
  }

  const isHot = Boolean(lead.is_hot);
  const notifyNormalEnabled = telegram.notifyFinanceChatLeadEnabled;
  const notifyHotEnabled = telegram.notifyFinanceHotLeadEnabled;
  const currentPhone = normalizeLeadPhoneValue(lead);
  const previousPhone = normalizeLeadPhoneValue(previousLead || {});
  const phoneWasAddedNow = Boolean(previousLead && !hasLeadContact(previousLead) && hasLeadContact(lead));
  const phoneDidChange = Boolean(previousLead && previousPhone && currentPhone && previousPhone !== currentPhone);
  const shouldNotifyPhone = Boolean(
    notifyNormalEnabled
    && (currentMessageHasPhone || phoneWasAddedNow || phoneJustAdded || phoneDidChange || phoneChanged)
    && (!lead.telegram_phone_sent || phoneWasAddedNow || phoneJustAdded || phoneDidChange || phoneChanged)
  );
  const alreadyNotified = isHot ? Boolean(lead.telegram_hot_sent) : Boolean(lead.telegram_sent);
  const enabled = isHot ? notifyHotEnabled : notifyNormalEnabled;
  const shouldSend = forceSend || shouldNotifyPhone || (enabled && !alreadyNotified);

  if (!shouldSend) {
    return {
      sent: false,
      reason: 'already_notified_or_disabled',
      results: [],
      config: telegram,
      phoneNotify: false,
      phoneJustAdded: Boolean(phoneJustAdded || phoneWasAddedNow),
      phoneChanged: Boolean(phoneChanged || phoneDidChange),
      currentMessageHasPhone: Boolean(currentMessageHasPhone)
    };
  }

  const leadForTelegram = shouldNotifyPhone
    ? {
        ...lead,
        message: [String(lead.message || '').trim(), 'Khách vừa gửi/bổ sung SĐT trong chat.']
          .filter(Boolean)
          .join('\n')
      }
    : lead;

  const text = buildTelegramMessage(
    leadForTelegram,
    isHot ? 'hot' : 'normal',
    extraLines
  );

  const results = [];
  for (const chatId of telegram.chatIds) {
    const result = await telegramSendMessage({
      chatId,
      text,
      token: telegram.token
    });
    results.push({ chatId, ...result });
  }

  const sent = results.some(item => item.success);
  const hasChatNotFound = results.some(item => {
    const responseText = String(item?.response?.description || item?.response?.error || item?.error || item?.reason || '').toLowerCase();
    return responseText.includes('chat not found');
  });

  return {
    sent,
    reason: sent
      ? (shouldNotifyPhone ? 'phone_notified' : 'sent')
      : (hasChatNotFound ? 'telegram_chat_not_found' : 'telegram_send_failed'),
    results,
    config: telegram,
    phoneNotify: shouldNotifyPhone,
    phoneJustAdded: Boolean(phoneJustAdded || phoneWasAddedNow),
    phoneChanged: Boolean(phoneChanged || phoneDidChange),
    currentMessageHasPhone: Boolean(currentMessageHasPhone)
  };
}

async function sendTelegramLeadNotifications(options) {
  return notifyLeadIfNeeded(options);
}

async function upsertChatLead(payload, scored, settings, options = {}) {
  const sessionId = String(payload.chat_session_id || '').trim();
  const existingLead = sessionId ? await leadStore.findLeadByChatSessionId(sessionId) : null;
  const previousPhone = normalizeLeadPhoneValue(existingLead || {});
  const nextPhone = scored.normalizedPhone || existingLead?.normalized_phone || existingLead?.phone || '';
  const contactJustAdded = Boolean(existingLead && nextPhone && previousPhone !== nextPhone);
  const phoneJustAdded = Boolean(existingLead && !hasLeadContact(existingLead) && nextPhone);
  const currentPhoneChanged = Boolean(existingLead && previousPhone && nextPhone && previousPhone !== nextPhone);
  const messagePhoneDetected = Boolean(options.messageHasPhone || getPhoneFromMessage(payload.message || '') || payload.phone);
  const currentMessageHasPhone = Boolean(
    messagePhoneDetected
    || payload.phone
    || payload.normalized_phone
    || nextPhone
  );
  const now = new Date().toISOString();

  const mergedLead = {
    lead_code: existingLead?.lead_code || makeLeadCode(Date.now() % 1000000),
    full_name: payload.full_name || existingLead?.full_name || 'Khach tu chatbot',
    phone: payload.phone || existingLead?.phone || nextPhone || '',
    normalized_phone: nextPhone || '',
    id_number: payload.id_number || existingLead?.id_number || '',
    date_of_birth: payload.date_of_birth || existingLead?.date_of_birth || '',
    product_type: payload.product_type || existingLead?.product_type || 'consulting',
    province: payload.province || existingLead?.province || '',
    loan_amount: payload.loan_amount || existingLead?.loan_amount || '',
    message: payload.message || existingLead?.message || '',
    source: 'chatbot',
    utm_source: payload.utm_source || existingLead?.utm_source || '',
    utm_medium: payload.utm_medium || existingLead?.utm_medium || '',
    utm_campaign: payload.utm_campaign || existingLead?.utm_campaign || '',
    cta_position: payload.cta_position || existingLead?.cta_position || '',
    page_url: payload.page_url || existingLead?.page_url || '',
    chat_session_id: sessionId,
    is_hot: Boolean(scored.isHot || existingLead?.is_hot),
    hot_reasons: Array.from(new Set([
      ...String(existingLead?.hot_reasons || '').split(',').map(item => item.trim()).filter(Boolean),
      ...scored.hotReasons
    ])).join(', '),
    status: existingLead?.status || 'new',
    admin_note: existingLead?.admin_note || '',
    telegram_sent: existingLead?.telegram_sent || 0,
    telegram_hot_sent: existingLead?.telegram_hot_sent || 0,
    telegram_phone_sent: existingLead?.telegram_phone_sent || 0,
    created_at: existingLead?.created_at || now,
    updated_at: now
  };

  let lead;
  if (existingLead) {
    const updated = await leadStore.updateLead(existingLead.id, mergedLead);
    lead = updated.lead || mergedLead;
  } else {
    lead = await leadStore.createLead(mergedLead);
  }

  const capture = {
    captured: Boolean(scored.shouldCapture || existingLead),
    phoneDetected: scored.phone || '',
    leadId: lead.id,
    leadCode: lead.lead_code,
    leadPhone: lead.normalized_phone || lead.phone || '',
    isHot: Boolean(lead.is_hot),
    hotReasons: String(lead.hot_reasons || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    wasExistingLead: Boolean(existingLead),
    contactJustAdded,
    phoneJustAdded,
    phoneChanged: currentPhoneChanged,
    currentMessageHasPhone,
    telegramPhoneSent: lead.telegram_phone_sent ? 1 : 0,
    telegramConfig: makeTelegramConfigDebug(settings),
    telegram: {
      attempted: false,
      sent: false,
      reason: 'not_captured',
      results: []
    }
  };

  if (scored.shouldCapture || contactJustAdded) {
    const notification = await notifyLeadIfNeeded({
      lead,
      previousLead: existingLead,
      settings,
      currentMessageHasPhone: messagePhoneDetected,
      phoneJustAdded,
      phoneChanged: currentPhoneChanged,
      extraLines: [],
      forceSend: contactJustAdded
    });

    capture.telegram = {
      attempted: true,
      sent: notification.sent,
      reason: notification.reason,
      results: notification.results,
      phoneNotify: Boolean(notification.phoneNotify),
      phoneJustAdded: Boolean(notification.phoneJustAdded),
      phoneChanged: Boolean(notification.phoneChanged),
      currentMessageHasPhone: Boolean(notification.currentMessageHasPhone)
    };

    if (notification.sent) {
      try {
        await leadStore.updateLeadTelegramFlags(lead.id, {
          telegramSent: !lead.is_hot,
          telegramHotSent: lead.is_hot,
          telegramPhoneSent: notification.phoneNotify
        });
      } catch (flagErr) {
        console.error('[chatbot capture] update telegram flags failed:', flagErr.message);
      }
    }
  }

  return {
    lead,
    previousLead: existingLead,
    capture,
    phoneJustAdded,
    phoneChanged: currentPhoneChanged,
    currentMessageHasPhone,
    messagePhoneDetected
  };
}

async function saveFinanceLead(payload, scored) {
  const isChatLead = payload.source === 'chatbot' && !!payload.chat_session_id;
  if (!scored.normalizedPhone && !isChatLead) {
    const err = new Error('phone_required');
    err.code = 'phone_required';
    err.status = 400;
    throw err;
  }

  if (isChatLead) {
    const sessionId = String(payload.chat_session_id || '').trim();
    const existingLead = sessionId ? await leadStore.findLeadByChatSessionId(sessionId) : null;
    const contactJustAdded = Boolean(existingLead && scored.normalizedPhone && normalizeLeadPhoneValue(existingLead) !== scored.normalizedPhone);
    const now = new Date().toISOString();
    const mergedLead = {
      lead_code: existingLead?.lead_code || makeLeadCode(Date.now() % 1000000),
      full_name: payload.full_name || existingLead?.full_name || 'Khach tu chatbot',
      phone: payload.phone || existingLead?.phone || scored.normalizedPhone || '',
      normalized_phone: scored.normalizedPhone || existingLead?.normalized_phone || '',
      id_number: payload.id_number || existingLead?.id_number || '',
      date_of_birth: payload.date_of_birth || existingLead?.date_of_birth || '',
      product_type: payload.product_type || existingLead?.product_type || 'consulting',
      province: payload.province || existingLead?.province || '',
      loan_amount: payload.loan_amount || existingLead?.loan_amount || '',
      message: payload.message || existingLead?.message || '',
      source: payload.source || existingLead?.source || 'chatbot',
      utm_source: payload.utm_source || existingLead?.utm_source || '',
      utm_medium: payload.utm_medium || existingLead?.utm_medium || '',
      utm_campaign: payload.utm_campaign || existingLead?.utm_campaign || '',
      cta_position: payload.cta_position || existingLead?.cta_position || '',
      page_url: payload.page_url || existingLead?.page_url || '',
      chat_session_id: sessionId,
      is_hot: scored.isHot || existingLead?.is_hot || contactJustAdded,
      hot_reasons: Array.from(new Set([
        ...String(existingLead?.hot_reasons || '').split(',').map(item => item.trim()).filter(Boolean),
        ...scored.hotReasons
      ])).join(', '),
      status: existingLead?.status || 'new',
      admin_note: existingLead?.admin_note || '',
      telegram_sent: existingLead?.telegram_sent || 0,
      telegram_hot_sent: existingLead?.telegram_hot_sent || 0,
      telegram_phone_sent: existingLead?.telegram_phone_sent || 0,
      created_at: existingLead?.created_at || now,
      updated_at: now
    };

    let lead;
    if (existingLead) {
      const updated = await leadStore.updateLead(existingLead.id, mergedLead);
      lead = updated.lead || mergedLead;
    } else {
      lead = await leadStore.createLead(mergedLead);
    }

    return { lead, previousLead: existingLead, contactJustAdded };
  }

  const lead = await leadStore.createLead({
    lead_code: makeLeadCode(Date.now() % 1000000),
    ...payload,
    normalized_phone: scored.normalizedPhone,
    is_hot: scored.isHot,
    hot_reasons: scored.hotReasons.join(', '),
    status: 'new'
  });

  return { lead, previousLead: null, contactJustAdded: false };
}

router.post('/finance-leads', async (req, res) => {
  try {
    const payload = cleanPayload(req.body);
    const scored = scoreFinanceLead(payload);
    const { lead } = await saveFinanceLead(payload, scored);
    const settings = await leadStore.getSettings();
    const notification = await sendTelegramLeadNotifications({ lead, settings });

    if (notification.sent) {
      await leadStore.updateLeadTelegramFlags(lead.id, {
        telegramSent: !lead.is_hot,
        telegramHotSent: !!lead.is_hot
      });
    }

    return res.json({
      success: true,
      data: {
        id: lead.id,
        lead_code: lead.lead_code,
        is_hot: lead.is_hot,
        hot_reasons: scored.hotReasons,
        telegram: makeNotifyDebug(notification)
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.code || 'create_finance_lead_failed',
      message: err.message
    });
  }
});

router.post('/chatbot/message', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const sessionId = makeSessionId(req.body?.session_id || req.body?.chat_session_id || req.body?.conversation_id);
  const fallbackReply = buildFallbackReply(message);
  const scored = scoreChatCapture(message);
  const payload = cleanPayload({
    full_name: req.body?.full_name || '',
    phone: getPhoneFromMessage(message),
    id_number: req.body?.id_number || '',
    date_of_birth: req.body?.date_of_birth || '',
    product_type: req.body?.product_type || 'consulting',
    province: req.body?.province || '',
    loan_amount: req.body?.loan_amount || '',
    message,
    source: 'chatbot',
    chat_session_id: sessionId,
    page_url: req.body?.page_url || '',
    cta_position: req.body?.cta_position || ''
  });
  const messageHasPhone = Boolean(getPhoneFromMessage(message) || req.body?.phone);

  let settings = {};
  try {
    settings = await leadStore.getSettings();
  } catch (err) {
    console.error('[chatbot/message] get settings failed:', err.message);
    settings = {};
  }

  const credentialsJson = getDialogflowCredentialsJson(settings);
  const enabled = parseSoftBoolean(settings.enable_chatbot, false) || process.env.ENABLE_CHATBOT === 'true';

  let captureDebug = {
    captured: false,
    phoneDetected: scored.phone || '',
    leadId: null,
    leadCode: null,
    isHot: scored.isHot,
    hotReasons: scored.hotReasons,
    telegram: {
      attempted: false,
      sent: false,
      reason: 'not_attempted',
      results: []
    },
    error: null,
    message: null
  };

  try {
    const existingLead = await leadStore.findLeadByChatSessionId(sessionId);
    if (scored.shouldCapture || existingLead) {
      const upsert = await upsertChatLead(payload, scored, settings, {
        messageHasPhone
      });
      captureDebug = {
        captured: upsert.capture.captured,
        phoneDetected: upsert.capture.leadPhone || upsert.capture.phone || scored.phone || '',
        leadId: upsert.capture.leadId,
        leadCode: upsert.capture.leadCode,
        isHot: upsert.capture.isHot,
        hotReasons: upsert.capture.hotReasons,
        telegram: {
          attempted: Boolean(upsert.capture.telegram?.attempted),
          sent: Boolean(upsert.capture.telegram?.sent),
          reason: upsert.capture.telegram?.reason || null,
          results: Array.isArray(upsert.capture.telegram?.results) ? upsert.capture.telegram.results : []
        },
        phoneJustAdded: Boolean(upsert.phoneJustAdded),
        phoneChanged: Boolean(upsert.phoneChanged),
        currentMessageHasPhone: Boolean(upsert.currentMessageHasPhone),
        telegramPhoneSent: upsert.capture.telegramPhoneSent ? 1 : 0,
        error: null,
        message: null
      };
    }
  } catch (err) {
    console.error('[chatbot/message] capture failed:', err.message);
    captureDebug = {
      captured: false,
      phoneDetected: scored.phone || '',
      leadId: null,
      leadCode: null,
      isHot: scored.isHot,
      hotReasons: scored.hotReasons,
      telegram: {
        attempted: false,
        sent: false,
        reason: err.code || 'capture_failed',
        results: []
      },
      error: err.code || 'capture_failed',
      message: err.message
    };
  }

  let chatResult;
  try {
    chatResult = await detectFinanceChat({
      message,
      sessionId,
      settings,
      credentialsJson,
      fallbackOnly: !enabled
    });
  } catch (err) {
    console.error('[chatbot/message] dialogflow failed:', err.message);
    chatResult = {
      source: 'fallback',
      reply: fallbackReply,
      replies: [fallbackReply],
      sessionId,
      reason: err.message
    };
  }

  const dialogflowOk = Boolean(chatResult?.success && chatResult.source === 'dialogflow');
  const finalReply = dialogflowOk ? (chatResult.reply || fallbackReply) : fallbackReply;
  const finalReplies = dialogflowOk
    ? (chatResult.replies || [finalReply])
    : [finalReply];

  return res.json({
    success: true,
    source: dialogflowOk ? 'dialogflow' : 'fallback',
    reply: finalReply,
    replies: finalReplies,
    session_id: chatResult.sessionId || sessionId,
    fallback_reason: dialogflowOk ? null : (chatResult.reason || 'dialogflow_failed'),
    capture: captureDebug
  });
});

router.post('/leads', (req, res) => {
  res.redirect(307, '/api/finance-leads');
});

router.get('/admin/finance-leads', adminAuth, async (req, res) => {
  try {
    const rows = await leadStore.listLeads();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ success: false, error: 'db_error', message: err.message });
  }
});

router.patch('/admin/finance-leads/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await leadStore.updateLeadStatus(req.params.id, status);
    if (!result.changes) return res.status(404).json({ error: 'lead_not_found' });
    res.json({ success: true, updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/finance-leads/test-chat-lead', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const message = String(req.body?.message || 'em cần gấp, số của em 0902964685').trim();
    const sessionId = makeSessionId(req.body?.session_id || `admin-test-chat-${Date.now()}`);
    const scored = scoreChatCapture(message);
    const payload = cleanPayload({
      full_name: req.body?.full_name || 'Admin Test',
      phone: scored.phone,
      id_number: req.body?.id_number || '',
      date_of_birth: req.body?.date_of_birth || '',
      product_type: req.body?.product_type || 'consulting',
      province: req.body?.province || '',
      loan_amount: req.body?.loan_amount || '',
      message,
      source: 'chatbot',
      chat_session_id: sessionId,
      page_url: req.body?.page_url || '',
      cta_position: req.body?.cta_position || ''
    });
    const messageHasPhone = Boolean(getPhoneFromMessage(message) || req.body?.phone);

    const upsert = await upsertChatLead(payload, scored, settings, {
      messageHasPhone
    });

    return res.json({
      success: true,
      test: {
        shouldCapture: upsert.capture.captured,
        phoneDetected: upsert.capture.phoneDetected,
        leadId: upsert.capture.leadId,
        leadCode: upsert.capture.leadCode,
        leadPhone: upsert.capture.leadPhone,
        isHot: upsert.capture.isHot,
        hotReasons: upsert.capture.hotReasons,
        wasExistingLead: upsert.capture.wasExistingLead,
        contactJustAdded: upsert.capture.contactJustAdded,
        telegramPhoneSent: upsert.capture.telegramPhoneSent,
        phoneJustAdded: upsert.phoneJustAdded,
        phoneChanged: upsert.phoneChanged,
        currentMessageHasPhone: upsert.currentMessageHasPhone
      },
      telegramConfig: upsert.capture.telegramConfig,
      telegram: upsert.capture.telegram
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.code || 'test_chat_lead_failed',
      message: err.message
    });
  }
});

router.post('/admin/finance-leads/test-telegram', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const telegram = resolveTelegramConfig(settings);

    if (!telegram.tokenConfigured || telegram.chatIdsCount === 0) {
      return res.status(400).json({ success: false, error: 'missing_telegram_config' });
    }

    const results = [];
    for (const chatId of telegram.chatIds) {
      const result = await telegramSendMessage({
        chatId,
        text: 'Xin chao! Day la tin nhan test tu SHBFinance LeadGen.',
        token: telegram.token
      });
      results.push({ chatId, ...result });
    }

    return res.json({
      success: results.some(item => item.success),
      results
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.code || 'test_telegram_failed',
      message: err.message
    });
  }
});

router.post('/admin/finance-leads/test-ai', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const message = String(req.body?.message || 'Xin chao, em muon tu van vay tien mat').trim();
    const credentialsJson = getDialogflowCredentialsJson(settings);

    if (!credentialsJson) {
      return res.status(400).json({ success: false, error: 'missing_ai_credentials' });
    }

    const result = await detectFinanceChat({
      message,
      sessionId: `admin-test-${Date.now()}`,
      settings,
      credentialsJson,
      fallbackOnly: false
    });

    return res.json({
      success: true,
      source: result.source,
      reply: result.reply,
      replies: result.replies,
      fallback_reason: result.reason || null
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.code || 'test_ai_failed',
      message: err.message
    });
  }
});

router.post('/admin/ai/list-agents', adminAuth, async (req, res) => {
  try {
    const { credentials_json } = req.body;
    if (!credentials_json) {
      return res.status(400).json({ error: 'Thieu Google Cloud Credentials JSON' });
    }

    const credentials = JSON.parse(credentials_json);
    const projectId = credentials.project_id;
    if (!projectId) {
      return res.status(400).json({ error: 'JSON khong hop le (khong chua project_id)' });
    }

    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/dialogflow']
    });

    const client = await auth.getClient();
    const locationsToTry = ['global', 'asia-southeast1', 'us-central1'];
    let allAgents = [];

    for (const loc of locationsToTry) {
      const url = `https://${loc}-dialogflow.googleapis.com/v3/projects/${projectId}/locations/${loc}/agents`;
      try {
        const response = await client.request({ url });
        if (response.data && response.data.agents) {
          allAgents = allAgents.concat(response.data.agents.map(agent => ({
            name: agent.name,
            displayName: agent.displayName,
            defaultLanguageCode: agent.defaultLanguageCode,
            location: loc,
            projectId
          })));
        }
      } catch (err) {
        // Ignore missing location and continue
      }
    }

    if (allAgents.length === 0) {
      return res.json({ success: true, agents: [], message: `Khong tim thay Agent nao trong Project: ${projectId}` });
    }

    return res.json({ success: true, agents: allAgents, projectId });
  } catch (err) {
    return res.status(500).json({ error: 'Khong the ket noi Google Cloud: ' + err.message });
  }
});

module.exports = router;
