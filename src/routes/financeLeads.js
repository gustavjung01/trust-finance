const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const leadStore = require('../services/leadStore');
const { scoreFinanceLead } = require('../services/financeLeadScoring');
const { notifyFinanceLead } = require('../services/telegramFinanceNotify');
const { detectFinanceChat, makeSessionId, buildFallbackReply } = require('../services/dialogflowFinanceChat');

function makeLeadCode(idOrTime) {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `FIN-${ymd}-${String(idOrTime).padStart(6, '0')}`;
}

function cleanPayload(body = {}) {
  return {
    full_name: String(body.full_name || body.họ_tên || 'Khách chưa để tên').trim().slice(0, 120),
    phone: String(body.phone || body.số_điện_thoại || '').trim().slice(0, 30),
    id_number: String(body.id_number || body.cccd || body.cccd_number || body.cmnd || '').trim().slice(0, 32),
    date_of_birth: String(body.date_of_birth || body.dob || '').trim().slice(0, 20),
    product_type: String(body.product_type || body.sản_phẩm_quan_tâm || 'consulting').trim().slice(0, 50),
    province: String(body.province || body.tỉnh_thành || '').trim().slice(0, 120),
    loan_amount: String(body.loan_amount || body.số_tiền_hạn_mức_mong_muốn || '').trim().slice(0, 50),
    message: String(body.message || body.ghi_chú || '').trim().slice(0, 1000),
    source: String(body.source || 'landing').trim().slice(0, 80),
    utm_source: String(body.utm_source || '').trim().slice(0, 120),
    utm_medium: String(body.utm_medium || '').trim().slice(0, 120),
    utm_campaign: String(body.utm_campaign || '').trim().slice(0, 160),
    cta_position: String(body.cta_position || '').trim().slice(0, 120),
    page_url: String(body.page_url || '').trim().slice(0, 500),
    chat_session_id: String(body.chat_session_id || '').trim().slice(0, 120)
  };
}

function getDialogflowCredentialsJson(settings = {}) {
  return settings.AI_CREDENTIALS_JSON || process.env.AI_CREDENTIALS_JSON || process.env.DIALOGFLOW_CREDENTIALS_JSON || '';
}

function normalizeTelegramChatIds(input) {
  return String(input || '')
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function settingExists(settings = {}, key) {
  return Object.prototype.hasOwnProperty.call(settings, key) && String(settings[key] || '').trim() !== '';
}

function settingEnabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 1) return true;
  const text = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'enabled'].includes(text);
}

function hasLeadContact(lead = {}) {
  return Boolean(String(lead.normalized_phone || lead.phone || '').trim());
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
    'vay', 'mo the', 'mở thẻ', 'the', 'thẻ', 'cic', 'no xau', 'nợ xấu',
    'lai suat', 'lãi suất', 'han muc', 'hạn mức', 'giai ngan', 'giải ngân',
    'goi lai', 'gọi lại', 'can tien', 'cần tiền', 'gap', 'gấp'
  ];
  return Boolean(getPhoneFromMessage(message)) || hotKeywords.some(keyword => text.includes(keyword) || noMark.includes(keyword));
}

function maskSettingValue(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function makeTelegramConfigDebug(settings = {}) {
  const botToken = settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = normalizeTelegramChatIds(settings.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID);
  const hasNormalSetting = settingExists(settings, 'notify_finance_chat_lead');
  const hasHotSetting = settingExists(settings, 'notify_finance_hot_lead');
  const defaultNotify = !hasNormalSetting && !hasHotSetting;

  return {
    tokenConfigured: Boolean(botToken),
    tokenPreview: botToken ? maskSettingValue(botToken) : '',
    chatIdsCount: chatIds.length,
    chatIdPreview: chatIds.map(maskSettingValue),
    notifyFinanceChatLeadRaw: settings.notify_finance_chat_lead ?? null,
    notifyFinanceHotLeadRaw: settings.notify_finance_hot_lead ?? null,
    notifyFinanceChatLeadEnabled: settingEnabled(settings.notify_finance_chat_lead, defaultNotify),
    notifyFinanceHotLeadEnabled: settingEnabled(settings.notify_finance_hot_lead, defaultNotify || settingEnabled(settings.notify_finance_chat_lead, defaultNotify)),
    defaultNotify
  };
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
          chatId: maskSettingValue(item.chatId || '')
        }))
      : []
  };
}

async function telegramSendMessage({ chatId, text, token }) {
  if (!token) return { success: false, reason: 'no_token' };
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, {
      chat_id: String(chatId).trim(),
      text
    });
    return { success: true };
  } catch (error) {
    console.error('Telegram error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.description || error.message };
  }
}

async function notifyLeadIfNeeded({ lead, previousLead, settings }) {
  const botToken = settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = normalizeTelegramChatIds(settings.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID);

  if (!botToken || chatIds.length === 0) {
    return { sent: false, reason: 'missing_telegram_config' };
  }

  const hasNormalSetting = settingExists(settings, 'notify_finance_chat_lead');
  const hasHotSetting = settingExists(settings, 'notify_finance_hot_lead');
  const defaultNotify = !hasNormalSetting && !hasHotSetting;
  const notifyNormalEnabled = settingEnabled(settings.notify_finance_chat_lead, defaultNotify);
  const notifyHotEnabled = settingEnabled(settings.notify_finance_hot_lead, defaultNotify || notifyNormalEnabled);
  const contactJustAdded = previousLead && !hasLeadContact(previousLead) && hasLeadContact(lead);

  const shouldNotifyNormal = notifyNormalEnabled && !lead.is_hot && !lead.telegram_sent;
  const shouldNotifyHot = notifyHotEnabled && !!lead.is_hot && !lead.telegram_hot_sent;
  const shouldNotifyContactUpdate = (notifyNormalEnabled || notifyHotEnabled) && contactJustAdded && !lead.telegram_sent;

  if (!shouldNotifyNormal && !shouldNotifyHot && !shouldNotifyContactUpdate) {
    return { sent: false, reason: 'already_notified_or_disabled' };
  }

  const notifyResult = await notifyFinanceLead({
    lead: shouldNotifyContactUpdate
      ? { ...lead, message: `${lead.message || ''}\nKhách vừa bổ sung SĐT trong chat.`.trim() }
      : lead,
    settings: {
      notify_finance_chat_lead: shouldNotifyNormal || shouldNotifyContactUpdate,
      notify_finance_hot_lead: shouldNotifyHot,
      telegram_default_channel: chatIds
    },
    telegramSendMessage: ({ chatId, text }) => telegramSendMessage({ chatId, text, token: botToken })
  });

  if (notifyResult && notifyResult.sent) {
    await leadStore.updateLeadTelegramFlags(lead.id, {
      telegramSent: shouldNotifyNormal || shouldNotifyContactUpdate,
      telegramHotSent: shouldNotifyHot
    });
  }

  return notifyResult || { sent: false, reason: 'notify_failed' };
}

async function saveFinanceLead(payload, scored) {
  const isChatLead = payload.source === 'chatbot' && !!payload.chat_session_id;

  if (!scored.normalizedPhone && !isChatLead) {
    const err = new Error('phone_required');
    err.code = 'phone_required';
    err.status = 400;
    throw err;
  }

  const lead_code = makeLeadCode(Date.now() % 1000000);
  let lead = null;
  let previousLead = null;

  if (isChatLead) {
    const existingLead = await leadStore.findLeadByChatSessionId(payload.chat_session_id);
    if (existingLead) {
      previousLead = existingLead;
      const updatedLead = await leadStore.updateLead(existingLead.id, {
        ...payload,
        full_name: payload.full_name || existingLead.full_name,
        phone: payload.phone || existingLead.phone,
        normalized_phone: scored.normalizedPhone || existingLead.normalized_phone || '',
        product_type: payload.product_type || existingLead.product_type,
        province: payload.province || existingLead.province,
        loan_amount: payload.loan_amount || existingLead.loan_amount,
        message: payload.message || existingLead.message,
        source: payload.source || existingLead.source,
        utm_source: payload.utm_source || existingLead.utm_source,
        utm_medium: payload.utm_medium || existingLead.utm_medium,
        utm_campaign: payload.utm_campaign || existingLead.utm_campaign,
        cta_position: payload.cta_position || existingLead.cta_position,
        page_url: payload.page_url || existingLead.page_url,
        chat_session_id: payload.chat_session_id || existingLead.chat_session_id,
        is_hot: scored.isHot || existingLead.is_hot,
        hot_reasons: scored.hotReasons.length ? scored.hotReasons.join(', ') : existingLead.hot_reasons
      });
      lead = updatedLead.lead;
    } else {
      lead = await leadStore.createLead({
        lead_code,
        ...payload,
        normalized_phone: scored.normalizedPhone || '',
        is_hot: scored.isHot,
        hot_reasons: scored.hotReasons.join(', '),
        status: 'new'
      });
    }
  } else {
    lead = await leadStore.createLead({
      lead_code,
      ...payload,
      normalized_phone: scored.normalizedPhone,
      is_hot: scored.isHot,
      hot_reasons: scored.hotReasons.join(', '),
      status: 'new'
    });
  }

  return { lead, previousLead };
}

router.post('/finance-leads', async (req, res) => {
  try {
    const payload = cleanPayload(req.body);
    const scored = scoreFinanceLead(payload);
    const { lead, previousLead } = await saveFinanceLead(payload, scored);
    const settings = await leadStore.getSettings();
    const notifyResult = await notifyLeadIfNeeded({ lead, previousLead, settings });

    return res.json({
      success: true,
      data: {
        id: lead.id,
        lead_code: lead.lead_code,
        is_hot: lead.is_hot,
        hot_reasons: scored.hotReasons,
        telegram: makeNotifyDebug(notifyResult)
      }
    });
  } catch (err) {
    console.error('[finance-leads] create failed:', err.message);
    return res.status(err.status || 500).json({
      success: false,
      error: err.code || 'create_finance_lead_failed',
      message: err.message
    });
  }
});

router.post('/chatbot/message', async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const message = String(req.body?.message || '').trim();
    const sessionId = makeSessionId(req.body?.session_id || req.body?.chat_session_id || req.body?.conversation_id);
    const credentialsJson = getDialogflowCredentialsJson(settings);
    const enabled = settings.enable_chatbot === 'true' || settings.enable_chatbot === true || process.env.ENABLE_CHATBOT === 'true';
    let captureDebug = null;

    if (shouldCaptureChatMessage(message)) {
      try {
        const payload = cleanPayload({
          phone: getPhoneFromMessage(message),
          message,
          source: 'chatbot',
          chat_session_id: sessionId,
          page_url: req.body?.page_url || '',
          product_type: req.body?.product_type || 'consulting'
        });
        const scored = scoreFinanceLead(payload);
        const { lead, previousLead } = await saveFinanceLead(payload, scored);
        const notifyResult = await notifyLeadIfNeeded({ lead, previousLead, settings });
        captureDebug = {
          captured: true,
          leadId: lead.id,
          leadCode: lead.lead_code,
          phone: lead.normalized_phone || lead.phone || '',
          isHot: Boolean(lead.is_hot),
          hotReasons: scored.hotReasons,
          telegram: makeNotifyDebug(notifyResult)
        };
      } catch (captureErr) {
        console.error('[chatbot/message] lead capture failed:', captureErr.message);
        captureDebug = {
          captured: false,
          error: captureErr.code || 'capture_failed',
          message: captureErr.message
        };
      }
    }

    const result = await detectFinanceChat({
      message,
      sessionId,
      settings,
      credentialsJson,
      fallbackOnly: !enabled
    });

    return res.json({
      success: true,
      source: result.source,
      reply: result.reply,
      replies: result.replies,
      session_id: result.sessionId || sessionId,
      fallback_reason: result.reason || null,
      capture: captureDebug
    });
  } catch (err) {
    console.error('[chatbot/message] failed:', err.message);
    return res.status(500).json({
      success: false,
      error: 'chatbot_failed',
      reply: buildFallbackReply(req.body?.message || '')
    });
  }
});

router.post('/leads', (req, res) => {
  res.redirect(307, '/api/finance-leads');
});

router.get('/admin/finance-leads', adminAuth, async (req, res) => {
  try {
    const rows = await leadStore.listLeads();
    res.json(rows);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'db_error', message: err.message });
  }
});

router.patch('/admin/finance-leads/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await leadStore.updateLeadStatus(req.params.id, status);
    if (!result.changes) return res.status(404).json({ error: 'lead_not_found' });
    res.json({ success: true, updated: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/finance-leads/test-chat-lead', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const message = String(req.body?.message || 'em cần gấp, số của em 0902964685').trim();
    const sessionId = String(req.body?.session_id || `admin-test-chat-${Date.now()}`).trim();
    const payload = cleanPayload({
      phone: getPhoneFromMessage(message) || req.body?.phone || '',
      message,
      source: 'chatbot',
      chat_session_id: sessionId,
      page_url: req.body?.page_url || 'admin-test',
      product_type: req.body?.product_type || 'consulting'
    });
    const scored = scoreFinanceLead(payload);
    const { lead, previousLead } = await saveFinanceLead(payload, scored);
    const notifyResult = await notifyLeadIfNeeded({ lead, previousLead, settings });

    return res.json({
      success: true,
      test: {
        message,
        sessionId,
        shouldCapture: shouldCaptureChatMessage(message),
        phoneDetected: getPhoneFromMessage(message),
        leadId: lead.id,
        leadCode: lead.lead_code,
        leadPhone: lead.normalized_phone || lead.phone || '',
        isHot: Boolean(lead.is_hot),
        hotReasons: scored.hotReasons,
        wasExistingLead: Boolean(previousLead),
        contactJustAdded: Boolean(previousLead && !hasLeadContact(previousLead) && hasLeadContact(lead))
      },
      telegramConfig: makeTelegramConfigDebug(settings),
      telegram: makeNotifyDebug(notifyResult)
    });
  } catch (err) {
    console.error('[test-chat-lead] failed:', err.message);
    return res.status(err.status || 500).json({
      success: false,
      error: err.code || 'test_chat_lead_failed',
      message: err.message
    });
  }
});

router.post('/admin/finance-leads/test-telegram', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const botToken = req.body.token || settings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatIdInput = req.body.chatId || settings.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID;
    const chatIds = normalizeTelegramChatIds(chatIdInput);

    if (!botToken || chatIds.length === 0) {
      return res.status(400).json({ success: false, error: 'missing_token_or_chat_id' });
    }

    const results = [];
    for (const chatId of chatIds) {
      results.push({
        chatId,
        ...(await telegramSendMessage({
          chatId,
          text: '🔔 Xin chào! Đây là tin nhắn test từ hệ thống Admin SHBFinance LeadGen.',
          token: botToken
        }))
      });
    }

    res.json({
      success: results.some(item => item.success),
      results
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.code || 'test_telegram_failed',
      message: err.message
    });
  }
});

router.post('/admin/finance-leads/test-ai', adminAuth, async (req, res) => {
  try {
    const settings = await leadStore.getSettings();
    const message = String(req.body?.message || 'Xin chào, em muốn tư vấn vay tiền mặt').trim();
    const credentialsJson = getDialogflowCredentialsJson(settings);

    if (!credentialsJson) {
      return res.status(400).json({
        success: false,
        error: 'missing_ai_credentials'
      });
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
    return res.status(500).json({
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
      return res.status(400).json({ error: 'Thiếu Google Cloud Credentials JSON' });
    }

    const credentials = JSON.parse(credentials_json);
    const projectId = credentials.project_id;

    if (!projectId) {
      return res.status(400).json({ error: 'JSON không hợp lệ (không chứa project_id)' });
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
            projectId: projectId
          })));
        }
      } catch (err) {
        // Ignore missing location and continue
      }
    }

    if (allAgents.length === 0) {
      return res.json({ success: true, agents: [], message: `Không tìm thấy Agent nào trong Project: ${projectId}` });
    }

    return res.json({ success: true, agents: allAgents, projectId });
  } catch (err) {
    console.error('Error fetching agents:', err);
    return res.status(500).json({ error: 'Không thể kết nối Google Cloud: ' + err.message });
  }
});

module.exports = router;
