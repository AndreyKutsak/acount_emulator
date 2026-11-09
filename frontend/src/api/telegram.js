import api from './client';

const chatPath = (accountId, chatId) =>
  `/telegram/accounts/${accountId}/chats/${encodeURIComponent(chatId)}`;

export const fetchTelegramAccounts = () => api.get('/telegram/accounts').then((res) => res.data);

export const createTelegramAccount = (data) =>
  api.post('/telegram/accounts', data).then((res) => res.data);

export const deleteTelegramAccount = (id) =>
  api.delete(`/telegram/accounts/${id}`).then((res) => res.data);

export const sendTelegramCode = (id) =>
  api.post(`/telegram/accounts/${id}/send-code`).then((res) => res.data);

export const signInTelegram = (id, data) =>
  api.post(`/telegram/accounts/${id}/sign-in`, data).then((res) => res.data);

// Login steps. Each answers { next, account[, qr] } where next is one of
// code | email_setup | email_code | password | recovery_code | qr | done.
const loginStep = (id, step, data, method = 'post') =>
  api[method](`/telegram/accounts/${id}/${step}`, data).then((res) => res.data);

export const resendTelegramCode = (id) => loginStep(id, 'resend-code');
export const checkTelegramPassword = (id, password) => loginStep(id, 'password', { password });
export const sendTelegramLoginEmail = (id, email) => loginStep(id, 'login-email', { email });
export const verifyTelegramLoginEmail = (id, code) => loginStep(id, 'login-email/verify', { code });
export const requestTelegramPasswordRecovery = (id) => loginStep(id, 'password-recovery');
export const confirmTelegramPasswordRecovery = (id, code) =>
  loginStep(id, 'password-recovery/confirm', { code });
export const startTelegramQrLogin = (id) => loginStep(id, 'qr-login');
export const pollTelegramQrLogin = (id) => loginStep(id, 'qr-login', undefined, 'get');
export const importTelegramSession = (id, session) => loginStep(id, 'import-session', { session });
export const cancelTelegramLogin = (id) => loginStep(id, 'cancel-login');

export const logOutTelegram = (id) =>
  api.post(`/telegram/accounts/${id}/logout`).then((res) => res.data);

export const refreshTelegramProfile = (id) =>
  api.post(`/telegram/accounts/${id}/refresh`).then((res) => res.data);

export const fetchTelegramChats = (id) =>
  api.get(`/telegram/accounts/${id}/chats`).then((res) => res.data);

export const fetchTelegramChat = (id, chatId) =>
  api.get(chatPath(id, chatId)).then((res) => res.data);

// Both return { items, nextOffsetId }; pass nextOffsetId back as offsetId for the
// next (older) page. nextOffsetId is null once the history is exhausted.
export const fetchTelegramPosts = (id, chatId, { limit, offsetId } = {}) =>
  api.get(`${chatPath(id, chatId)}/posts`, { params: { limit, offsetId } }).then((res) => res.data);

export const fetchTelegramComments = (id, chatId, postId, { limit, offsetId } = {}) =>
  api
    .get(`${chatPath(id, chatId)}/posts/${postId}/comments`, { params: { limit, offsetId } })
    .then((res) => res.data);

export const sendTelegramComment = (id, chatId, postId, text) =>
  api.post(`${chatPath(id, chatId)}/posts/${postId}/comments`, { text }).then((res) => res.data);

// ---------- comment templates ----------

export const fetchCommentTemplates = (params = {}) =>
  api.get('/telegram/templates', { params }).then((res) => res.data);

export const fetchTemplateLanguages = () =>
  api.get('/telegram/templates/languages').then((res) => res.data);

// data: { language, category, text } or { language, category, texts: [...] }
export const createCommentTemplates = (data) =>
  api.post('/telegram/templates', data).then((res) => res.data);

export const updateCommentTemplate = (templateId, data) =>
  api.put(`/telegram/templates/${templateId}`, data).then((res) => res.data);

export const deleteCommentTemplate = (templateId) =>
  api.delete(`/telegram/templates/${templateId}`).then((res) => res.data);

export const previewCommentTemplate = (text) =>
  api.post('/telegram/templates/preview', { text }).then((res) => res.data.samples);

// ---------- auto-comment tasks ----------

export const fetchAutoCommentStatus = () =>
  api.get('/telegram/auto-comment/status').then((res) => res.data);

export const fetchAutoCommentTasks = (accountId) =>
  api.get(`/telegram/accounts/${accountId}/auto-comment`).then((res) => res.data);

export const createAutoCommentTask = (accountId, data) =>
  api.post(`/telegram/accounts/${accountId}/auto-comment`, data).then((res) => res.data);

export const updateAutoCommentTask = (taskId, data) =>
  api.put(`/telegram/auto-comment/${taskId}`, data).then((res) => res.data);

export const deleteAutoCommentTask = (taskId) =>
  api.delete(`/telegram/auto-comment/${taskId}`).then((res) => res.data);

export const runAutoCommentTask = (taskId) =>
  api.post(`/telegram/auto-comment/${taskId}/run`).then((res) => res.data);

export const replanAutoCommentTask = (taskId) =>
  api.post(`/telegram/auto-comment/${taskId}/replan`).then((res) => res.data);

export const fetchAutoCommentLogs = (taskId, limit = 30) =>
  api.get(`/telegram/auto-comment/${taskId}/logs`, { params: { limit } }).then((res) => res.data);

export const clearTelegramFloodWait = (accountId) =>
  api.post(`/telegram/accounts/${accountId}/clear-flood-wait`).then((res) => res.data);

// ---------- auto-replies to private messages ----------

export const fetchAutoReplyRules = (accountId) =>
  api.get('/telegram/auto-reply/rules', { params: { accountId } }).then((res) => res.data);

export const createAutoReplyRule = (data) =>
  api.post('/telegram/auto-reply/rules', data).then((res) => res.data);

export const updateAutoReplyRule = (ruleId, data) =>
  api.put(`/telegram/auto-reply/rules/${ruleId}`, data).then((res) => res.data);

export const deleteAutoReplyRule = (ruleId) =>
  api.delete(`/telegram/auto-reply/rules/${ruleId}`).then((res) => res.data);

// How `text` is classified and which rule would answer, with a sample reply;
// nothing is sent. Resolves to { category, candidates, match }.
export const testAutoReply = (data) =>
  api.post('/telegram/auto-reply/test', data).then((res) => res.data);

export const fetchAutoReplySettings = (accountId) =>
  api.get(`/telegram/accounts/${accountId}/auto-reply`).then((res) => res.data);

export const updateAutoReplySettings = (accountId, data) =>
  api.put(`/telegram/accounts/${accountId}/auto-reply`, data).then((res) => res.data);

export const fetchAutoReplyLogs = (accountId, params = {}) =>
  api.get(`/telegram/accounts/${accountId}/auto-reply/logs`, { params }).then((res) => res.data);

// Incoming private messages per category over the last `days` days.
export const fetchAutoReplyStats = (accountId, days = 7) =>
  api.get(`/telegram/accounts/${accountId}/auto-reply/stats`, { params: { days } }).then((res) => res.data);

// ---------- activity limits (anti-spam) ----------

export const fetchTelegramLimits = (accountId) =>
  api.get(`/telegram/accounts/${accountId}/limits`).then((res) => res.data);

export const updateTelegramLimits = (accountId, data) =>
  api.put(`/telegram/accounts/${accountId}/limits`, data).then((res) => res.data);

// what: 'flood' | 'spam' | 'frozen'
export const clearTelegramLimitBlock = (accountId, what) =>
  api.post(`/telegram/accounts/${accountId}/limits/clear`, { what }).then((res) => res.data);

// chat: @username, t.me link or invite link. Resolves to { status, chat }.
export const joinTelegramChat = (accountId, chat) =>
  api.post(`/telegram/accounts/${accountId}/join`, { chat }).then((res) => res.data);

// Login diagnostics: Telegram's answers to every login step (no codes or passwords).
export const fetchTelegramAuthLog = (id, limit = 50) =>
  api.get(`/telegram/accounts/${id}/auth-log`, { params: { limit } }).then((res) => res.data);

// ---------- comment topics ----------

// Topics with templateCounts: { [language]: number } of enabled comments.
export const fetchCommentTopics = () => api.get('/telegram/topics').then((res) => res.data);

export const createCommentTopic = (data) => api.post('/telegram/topics', data).then((res) => res.data);

export const updateCommentTopic = (topicId, data) =>
  api.put(`/telegram/topics/${topicId}`, data).then((res) => res.data);

export const deleteCommentTopic = (topicId, withTemplates = false) =>
  api
    .delete(`/telegram/topics/${topicId}`, { params: withTemplates ? { withTemplates: true } : {} })
    .then((res) => res.data);

// Which topic a post text gets and a sample comment for it; nothing is sent.
export const classifyPostText = (text, language) =>
  api.post('/telegram/topics/classify', { text, language }).then((res) => res.data);
