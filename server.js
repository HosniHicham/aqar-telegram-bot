'use strict';
// =========================================================================
// 🧠 SERVER FATHER — العقل المدبّر
// =========================================================================

const { Telegraf, Markup, Composer } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// ------------------------- الإعدادات -------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const MAX_PROPERTY_IMAGES = 6;
const BACK_TO_ADMIN = '🔙 العودة لوضع الإدارة';

if (!BOT_TOKEN) {
  console.error('Error: Required environment variables are missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ------------------------- الحالات المشتركة -------------------------
const userState = {};
const userLang = {};
const browsingSession = {};
const supportUserSession = {};
const botMessagesHistory = {};
const previewMode = {};
const lastKnownRole = {}; // 'admin' | 'user'

function resetSessions(userId) {
  delete userState[userId];
  delete browsingSession[userId];
  delete supportUserSession[userId];
}

// ------------------------- تنظيف رسائل البوت -------------------------
function trackBotMessage(userId, chatId, messageId) {
  if (!userId || !chatId || !messageId) return;
  if (!botMessagesHistory[userId]) botMessagesHistory[userId] = { chatId, ids: [] };
  botMessagesHistory[userId].chatId = chatId;
  if (!botMessagesHistory[userId].ids.includes(messageId)) botMessagesHistory[userId].ids.push(messageId);
}

function untrackBotMessage(userId, messageId) {
  const history = botMessagesHistory[userId];
  if (!history || !messageId) return;
  history.ids = history.ids.filter(id => id !== messageId);
}

async function clearTrackedBotMessages(ctx, userId, keepMessageIds = []) {
  const history = botMessagesHistory[userId];
  const keepSet = new Set(Array.isArray(keepMessageIds) ? keepMessageIds : [keepMessageIds].filter(Boolean));
  const chatId = ctx?.chat?.id || history?.chatId;
  if (!history || !chatId) return;

  const remaining = [];
  for (const msgId of history.ids) {
    if (keepSet.has(msgId)) { remaining.push(msgId); continue; }
    try { await ctx.telegram.deleteMessage(chatId, msgId); } catch (e) {}
  }
  botMessagesHistory[userId].ids = remaining;
}

async function replyTracked(ctx, userId, text, extra = {}, cleanPrevious = false, keepIds = []) {
  if (cleanPrevious) await clearTrackedBotMessages(ctx, userId, keepIds);
  const sent = await ctx.reply(text, extra);
  if (sent && sent.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
  return sent;
}

async function safeDeleteUserMessage(ctx) {
  try {
    if (ctx.message && ctx.message.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    }
  } catch (e) {}
}

// ------------------------- Supabase مشترك -------------------------
async function getSetting(key, defaultValue = '') {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).limit(1);
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.value !== undefined && row.value !== null ? String(row.value) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

let websiteUrl = '';
let websiteUrlAt = 0;
async function refreshWebsiteUrl() {
  if (Date.now() - websiteUrlAt < 15000) return websiteUrl;
  websiteUrlAt = Date.now();
  const v = await getSetting('website_url', '');
  websiteUrl = v && /^https:\/\//i.test(String(v).trim()) ? String(v).trim() : '';
  return websiteUrl;
}
function getWebsiteUrl() { return websiteUrl; }

// قراءة مباشرة من قاعدة البيانات في كل استعلام لضمان التبديل الفوري بدون /start
async function getAdminIds() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_id')
      .limit(1);

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.value === undefined || row.value === null) {
      return [];
    }

    return String(row.value)
      .split(/[,،\s]+/)
      .map(id => Number(String(id).replace(/\D/g, '').trim()))
      .filter(id => Number.isSafeInteger(id) && id > 0);
  } catch (e) {
    return [];
  }
}

async function isAdmin(userId) {
  const ids = await getAdminIds();
  return ids.includes(Number(userId));
}

async function getUserRecord(telegramId) {
  try {
    const { data } = await supabase.from('users').select('*').eq('id', telegramId).limit(1);
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    return null;
  }
}

async function isUserVerified(telegramId) {
  if (previewMode[telegramId]) return true;
  const user = await getUserRecord(telegramId);
  return !!user;
}

// ------------------------- أدوات التنسيق -------------------------
function chunkButtons(buttonsArray, chunkSize = 4) {
  const chunked = [];
  for (let i = 0; i < buttonsArray.length; i += chunkSize) chunked.push(buttonsArray.slice(i, i + chunkSize));
  return chunked;
}

function sanitizeNumericPrice(val) {
  if (val === null || val === undefined) return 0;
  const digitsOnly = String(val).replace(/\D/g, '');
  if (!digitsOnly) return 0;
  const num = Number(digitsOnly);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(val) {
  if (!val) return '0 دج';
  const str = String(val).trim();
  if (/[ا-يa-zA-Z]/.test(str)) return str;
  const clean = str.replace(/\D/g, '');
  if (!clean) return '0 دج';
  return Number(clean).toLocaleString('en-US') + ' دج';
}

function formatDateTime(dateInput) {
  const target = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(target.getTime())) return String(dateInput || 'غير محدد');
  try {
    return target.toLocaleString('fr-DZ', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  } catch (e) {
    return target.toISOString().replace('T', ' ').slice(0, 16);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeMediaRef(v) {
  if (typeof v !== 'string') return null;
  const clean = v.trim();
  if (!clean || clean === 'EMPTY' || clean === 'FREE_NO_RECEIPT') return null;
  return clean.startsWith('tg:') ? clean.slice(3) : clean;
}

function parseMediaListFromField(fieldVal) {
  if (!fieldVal || typeof fieldVal !== 'string') return [];
  const trimmed = fieldVal.trim();
  if (!trimmed || trimmed === 'EMPTY') return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return [...new Set(arr.map(normalizeMediaRef).filter(Boolean))];
    } catch (e) {}
  }
  return [...new Set(trimmed.split('|').map(normalizeMediaRef).filter(Boolean))];
}

function parseImagesFromImageUrl(imageUrlField) {
  return parseMediaListFromField(imageUrlField);
}

function buildOrderedBrowsingMedia(item) {
  const videos = parseMediaListFromField(item.video_url)
    .slice(0, MAX_PROPERTY_IMAGES).map(ref => ({ type: 'video', ref }));
  const photos = parseImagesFromImageUrl(item.image_url)
    .slice(0, MAX_PROPERTY_IMAGES).map(ref => ({ type: 'photo', ref }));
  return [...videos, ...photos];
}

// ------------------------- لوحات المفاتيح المشتركة -------------------------
function getWebsiteButton() {
  return websiteUrl ? Markup.button.webApp('🌐 تصفح الموقع الرسمي', websiteUrl) : null;
}

function getMainMenuKeyboard(userId) {
  const rows = [
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['🎁 رصيدي وجمع النقاط', '📞 الدعم والإدارة'],
    ['🌐 تغيير اللغة / Langue', 'ℹ️ عن المنصة']
  ];
  const webBtn = getWebsiteButton();
  if (webBtn) rows.push([webBtn]);
  if (userId && previewMode[userId]) rows.push([BACK_TO_ADMIN]);
  return Markup.keyboard(rows).resize();
}

function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 مشاركة رقم الهاتف لتفعيل الحساب')]
  ]).resize().oneTime();
}

// ------------------------- بناء الـ core وتسجيل الوحدتين -------------------------
const core = {
  bot, app, supabase, Markup,
  WEBHOOK_DOMAIN, getWebsiteUrl, MAX_PROPERTY_IMAGES, BACK_TO_ADMIN,
  userState, userLang, browsingSession, supportUserSession, previewMode, resetSessions,
  trackBotMessage, untrackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
  getSetting, getAdminIds, isAdmin, getUserRecord, isUserVerified,
  chunkButtons, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml,
  normalizeMediaRef, parseMediaListFromField, parseImagesFromImageUrl, buildOrderedBrowsingMedia,
  getWebsiteButton, getMainMenuKeyboard, getAuthKeyboard,
  modules: {}
};

core.enterPreview = async (ctx) => {
  const id = ctx.from.id;
  previewMode[id] = true;
  resetSessions(id);
  await core.modules.user.openUserHome(
    ctx,
    `👁 <b>وضع معاينة المنصة</b> — تتصفح الآن بصلاحية مستخدم عادي.\nللعودة إلى الإدارة اضغط <b>${BACK_TO_ADMIN}</b>\n\n`
  );
};

core.exitPreview = async (ctx) => {
  const id = ctx.from.id;
  delete previewMode[id];
  resetSessions(id);
  await core.modules.admin.openAdminHome(ctx);
};

const userComposer = new Composer();
const adminComposer = new Composer();
core.modules.admin = require('./admin')(adminComposer, core);
core.modules.user = require('./users')(userComposer, core);

function injectBackButton(ctx) {
  const addBack = (extra) => {
    const kb = extra && extra.reply_markup && extra.reply_markup.keyboard;
    if (!Array.isArray(kb)) return extra;
    const hasBack = kb.some(row => Array.isArray(row) && row.includes(BACK_TO_ADMIN));
    if (hasBack) return extra;
    return { ...extra, reply_markup: { ...extra.reply_markup, keyboard: [...kb, [BACK_TO_ADMIN]] } };
  };
  for (const m of ['reply', 'replyWithPhoto', 'replyWithVideo']) {
    const orig = ctx[m].bind(ctx);
    ctx[m] = (first, extra, ...rest) => orig(first, addBack(extra), ...rest);
  }
}

const userMw = userComposer.middleware();
const adminMw = adminComposer.middleware();

// ------------------------- ميدلوير الاستجابة السلسة -------------------------
bot.use(async (ctx, next) => {
  let waitMsgId = null;
  let isResponded = false;
  let shouldAbortWaitMsg = false;

  const chatId = ctx.chat?.id || ctx.from?.id;
  const userId = ctx.from?.id;

  if (chatId && ctx.message) {
    ctx.sendChatAction('typing').catch(() => {});
  }

  const timer = setTimeout(async () => {
    if (isResponded || shouldAbortWaitMsg || !chatId || !ctx.message?.text) return;
    try {
      const waitMsg = await ctx.telegram.sendMessage(
        chatId,
        '⏳ <i>جاري تحميل البيانات، لحظات من فضلك...</i>',
        { parse_mode: 'HTML' }
      );
      if (isResponded || shouldAbortWaitMsg) {
        await ctx.telegram.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
        return;
      }
      waitMsgId = waitMsg.message_id;
      if (userId) trackBotMessage(userId, chatId, waitMsgId);
    } catch (e) {}
  }, 2200);

  try {
    await next();
  } finally {
    isResponded = true;
    shouldAbortWaitMsg = true;
    clearTimeout(timer);
    if (waitMsgId && chatId) {
      if (userId) untrackBotMessage(userId, waitMsgId);
      await ctx.telegram.deleteMessage(chatId, waitMsgId).catch(() => {});
    }
  }
});

// ------------------------- 🧭 كشف تلقائي لتبدّل الوضع (بدون /start) -------------------------
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  const text = ctx.message?.text?.trim() || '';
  const cbData = ctx.callbackQuery?.data || '';

  await refreshWebsiteUrl();

  const userIsAdmin = await isAdmin(userId);
  const newRole = userIsAdmin ? 'admin' : 'user';
  const prevRole = lastKnownRole[userId];
  const roleChanged = prevRole && prevRole !== newRole;

  lastKnownRole[userId] = newRole;

  // إذا تغيّر وضعه من أدمن إلى يوزر أو من يوزر إلى أدمن بأي استعلام/رسالة بدون /start:
  if (roleChanged) {
    delete previewMode[userId];
    resetSessions(userId);
    await safeDeleteUserMessage(ctx);
    await clearTrackedBotMessages(ctx, userId, []);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔄 تم تحديث صلاحيتك').catch(() => {});
    }

    if (newRole === 'admin') {
      return core.modules.admin.openAdminHome(ctx);
    } else {
      const verified = await isUserVerified(userId);
      if (verified) {
        return core.modules.user.openUserHome(ctx);
      }
      const userName = ctx.from.first_name || 'مستخدمنا الكريم';
      const authText = await getSetting(
        'auth_prompt_template',
        `أهلاً بك يا <b>${escapeHtml(userName)}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`
      );
      return replyTracked(ctx, userId, authText.replace(/\\n/g, '\n'), {
        parse_mode: 'HTML',
        ...getAuthKeyboard()
      }, true);
    }
  }

  if (!userIsAdmin) {
    delete previewMode[userId];
    return userMw(ctx, next);
  }

  if (text === BACK_TO_ADMIN || text === '/admin') {
    await safeDeleteUserMessage(ctx);
    return core.exitPreview(ctx);
  }

  const forceAdmin =
    /^(approve_|reject_|requeue_|del_pub_|support_reply_|inq_reply_|inq_status_)/.test(cbData) ||
    ['replying_to_support_user', 'replying_to_inquiry', 'searching_admin_ads'].includes(userState[userId]?.step);

  if (previewMode[userId]) injectBackButton(ctx);
  try {
    if (forceAdmin || !previewMode[userId]) return await adminMw(ctx, next);
    return await userMw(ctx, next);
  } catch (err) {
    console.error('Admin routing error:', err);
    await ctx.reply(`⚠️ تعذر إتمام العملية: ${escapeHtml(String(err.message || err).slice(0, 200))}`, { parse_mode: 'HTML' }).catch(() => {});
  }
});

bot.catch((err, ctx) => {
  console.error(`Bot error (${ctx?.updateType}):`, err);
});

// ------------------------- 🚀 تشغيل السيرفر -------------------------
const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Production System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
