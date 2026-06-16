const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');

const DIALOGFLOW_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/dialogflow'
];

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim();
}

function normalizeText(value) {
  return safeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeBaseUrl(baseUrl, location) {
  const provided = safeString(baseUrl);
  if (provided) return provided.replace(/\/+$/, '');

  const loc = safeString(location, 'global');
  if (!loc || loc === 'global') return 'https://dialogflow.googleapis.com/v3';
  return `https://${loc}-dialogflow.googleapis.com/v3`;
}

function parseAgentResource(agentValue) {
  const value = safeString(agentValue);
  if (!value) return null;

  const fullMatch = value.match(/^projects\/([^/]+)\/locations\/([^/]+)\/agents\/([^/]+)$/);
  if (fullMatch) {
    return {
      projectId: fullMatch[1],
      location: fullMatch[2],
      agentId: fullMatch[3],
      agentPath: value
    };
  }

  return {
    projectId: null,
    location: null,
    agentId: value,
    agentPath: null
  };
}

function buildFallbackReply(message, reason = '') {
  const reasonText = safeString(reason);
  if (reasonText === 'missing_credentials' || reasonText === 'missing_agent_config' || reasonText === 'chatbot_disabled') {
    return 'Chatbot AI chưa được cấu hình đầy đủ. Vui lòng kiểm tra cấu hình AI trong trang quản trị.';
  }
  if (reasonText === 'empty_ai_response') {
    return 'AI chưa có phản hồi phù hợp. Vui lòng thử lại.';
  }
  return 'AI đang gặp lỗi xử lý. Vui lòng thử lại sau.';
}

function extractReplies(responseData) {
  const queryResult = responseData?.queryResult || {};
  const responseMessages = queryResult.responseMessages || queryResult.response_messages || [];
  const replies = [];

  for (const message of responseMessages) {
    const textMessage = message?.text?.text;
    if (Array.isArray(textMessage)) {
      textMessage.forEach(item => {
        const value = safeString(item);
        if (value) replies.push(value);
      });
    } else if (typeof textMessage === 'string') {
      const value = safeString(textMessage);
      if (value) replies.push(value);
    }

    const outputAudioText = safeString(message?.outputAudioText?.text);
    if (outputAudioText) replies.push(outputAudioText);
  }

  const queryText = safeString(queryResult.text);
  if (!replies.length && queryText) replies.push(queryText);

  return [...new Set(replies)].filter(Boolean);
}

function makeSessionId(rawSessionId) {
  const cleaned = safeString(rawSessionId)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 36);

  if (cleaned) return cleaned;
  return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
}

async function createDialogflowClient(credentialsJson) {
  const credentials = typeof credentialsJson === 'string'
    ? JSON.parse(credentialsJson)
    : credentialsJson;

  const auth = new GoogleAuth({
    credentials,
    scopes: DIALOGFLOW_SCOPES
  });

  const client = await auth.getClient();
  return { client, credentials };
}

async function detectFinanceChat({
  message,
  sessionId,
  settings = {},
  credentialsJson,
  queryParams = {},
  fallbackOnly = false
}) {
  const userMessage = safeString(message);
  if (!userMessage) {
    throw new Error('missing_message');
  }

  if (fallbackOnly) {
    const reply = buildFallbackReply(userMessage, 'chatbot_disabled');
    return {
      success: false,
      source: 'not_configured',
      reply,
      replies: [reply],
      reason: 'chatbot_disabled'
    };
  }

  try {
    const credentialsString = safeString(credentialsJson);
    if (!credentialsString) {
      const reply = buildFallbackReply(userMessage, 'missing_credentials');
      return {
        success: false,
        source: 'not_configured',
        reply,
        replies: [reply],
        reason: 'missing_credentials'
      };
    }

    const { client, credentials } = await createDialogflowClient(credentialsString);
    const agentInfo = parseAgentResource(settings.AI_AGENT_ID);
    const projectId = safeString(settings.AI_PROJECT_ID || agentInfo?.projectId || credentials.project_id);
    const location = safeString(settings.AI_LOCATION || agentInfo?.location || 'global') || 'global';
    const languageCode = safeString(settings.AI_LANGUAGE_CODE || 'vi') || 'vi';
    const baseUrl = normalizeBaseUrl(settings.AI_BASE_URL, location);
    const agentPath = agentInfo?.agentPath
      || (projectId && agentInfo?.agentId
        ? `projects/${projectId}/locations/${location}/agents/${agentInfo.agentId}`
        : null);

    if (!projectId || !agentPath) {
      const reply = buildFallbackReply(userMessage, 'missing_agent_config');
      return {
        success: false,
        source: 'not_configured',
        reply,
        replies: [reply],
        reason: 'missing_agent_config'
      };
    }

    const session = `${agentPath}/sessions/${makeSessionId(sessionId)}`;
    const url = `${baseUrl}/${session}:detectIntent`;

    const response = await client.request({
      url,
      method: 'POST',
      data: {
        queryInput: {
          text: {
            text: userMessage
          },
          languageCode
        },
        ...(Object.keys(queryParams || {}).length ? { queryParams } : {})
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const replies = extractReplies(response.data);
    const reply = replies.length ? replies.join('\n') : buildFallbackReply(userMessage, 'empty_ai_response');

    return {
      success: true,
      source: 'dialogflow',
      reply,
      replies: replies.length ? replies : [reply],
      sessionId: makeSessionId(sessionId),
      agentPath,
      baseUrl,
      languageCode
    };
  } catch (error) {
    const reply = buildFallbackReply(userMessage, error.message);
    return {
      success: false,
      source: 'ai_error',
      reply,
      replies: [reply],
      reason: error.message
    };
  }
}

module.exports = {
  buildFallbackReply,
  detectFinanceChat,
  extractReplies,
  makeSessionId,
  normalizeBaseUrl,
  parseAgentResource
};
