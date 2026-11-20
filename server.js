'use strict';
// =========================================================================
// 🧠 SERVER FATHER — العقل المدبّر
// - يحمّل الأدوات المشتركة (Supabase, حالات المستخدمين, دوال التنسيق)
// - يفصل بين المستخدم والأدمن حسب الـ ID
// - يمنح الأدمن زر "معاينة كمستخدم" (يستدعي users.js) وزر "العودة لوضع الأدمن"
// - يشغّل السيرفر / الـ Webhook
// =========================================================================

const { Telegraf, Markup, Composer } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// ------------------------- الإعدادات -------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const DEFAULT_WEBSITE_URL = process.env.WEBSITE_URL || 'https://hosnihicham.github.io/testHTML';
const MAX_PROPERTY_IMAGES = 6;
const BACK_TO_ADMIN = '🔙 العودة لوضع الأدمن';

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
const previewMode = {}; // adminId -> true عندما يعاين الأدمن المنصة كمستخدم

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
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
    return data ? data.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// 🌐 رابط الموقع من جدول app_settings (key = website_url) مع كاش 30 ثانية
let websiteUrl = DEFAULT_WEBSITE_URL;
let websiteUrlAt = 0;
async function refreshWebsiteUrl() {
  if (Date.now() - websiteUrlAt < 30000) return websiteUrl;
  websiteUrlAt = Date.now();
  const v = await getSetting('website_url', '');
  if (v && /^https:\/\//i.test(String(v).trim())) websiteUrl = String(v).trim();
  return websiteUrl;
}
function getWebsiteUrl() { return websiteUrl; }

let adminCache = { ids: null, at: 0 };
async function getAdminIds() {
  if (adminCache.ids && Date.now() - adminCache.at < 30000) return adminCache.ids;
  let ids = [5883330772];
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_id').single();
    if (data && data.value) {
      const parsed = data.value.split(/[,،\s]+/).map(id => Number(id.trim())).filter(Boolean);
      if (parsed.length) ids = parsed;
    }
  } catch (e) {}
  adminCache = { ids, at: Date.now() };
  return ids;
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
  if (previewMode[telegramId]) return true; // الأدمن في وضع المعاينة لا يحتاج توثيق
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

// الفيديوهات أولاً ثم الصور
function buildOrderedBrowsingMedia(item) {
  const videos = parseMediaListFromField(item.video_url)
    .slice(0, MAX_PROPERTY_IMAGES).map(ref => ({ type: 'video', ref }));
  const photos = parseImagesFromImageUrl(item.image_url)
    .slice(0, MAX_PROPERTY_IMAGES).map(ref => ({ type: 'photo', ref }));
  return [...videos, ...photos];
}

// ------------------------- لوحات المفاتيح المشتركة -------------------------
// 🌐 زر الموقع: WebApp => يفتح الموقع مباشرة داخل تيليجرام بدون إظهار أي رابط في المحادثة
function getWebsiteButton() {
  return Markup.button.webApp('🌐 تصفح الموقع الرسمي', websiteUrl);
}

function getMainMenuKeyboard(userId) {
  const rows = [
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['🎁 رصيدي وجمع النقاط', '📞 الدعم والإدارة'],
    ['🌐 تغيير اللغة / Langue', 'ℹ️ عن المنصة'],
    [getWebsiteButton()]
  ];
  if (userId && previewMode[userId]) rows.push([BACK_TO_ADMIN]);
  return Markup.keyboard(rows).resize();
}

function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 اضغط هنا لمشاركة رقم هاتفك والبدء')]
  ]).resize().oneTime();
}

// ------------------------- بناء الـ core وتسجيل الوحدتين -------------------------
const core = {
  bot, app, supabase, Markup,
  WEBHOOK_DOMAIN, getWebsiteUrl, MAX_PROPERTY_IMAGES, BACK_TO_ADMIN,
  userState, userLang, browsingSession, supportUserSession, previewMode, resetSessions,
  trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
  getSetting, getAdminIds, isAdmin, getUserRecord, isUserVerified,
  chunkButtons, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml,
  normalizeMediaRef, parseMediaListFromField, parseImagesFromImageUrl, buildOrderedBrowsingMedia,
  getWebsiteButton, getMainMenuKeyboard, getAuthKeyboard,
  modules: {}
};

// 👁 الدخول لوضع المعاينة (الأدمن يرى المنصة كمستخدم)
core.enterPreview = async (ctx) => {
  const id = ctx.from.id;
  previewMode[id] = true;
  resetSessions(id);
  await core.modules.user.openUserHome(
    ctx,
    `👁 <b>وضع المعاينة:</b> أنت الآن ترى المنصة كمستخدم عادي.\nللرجوع اضغط <b>${BACK_TO_ADMIN}</b> أو أرسل /admin\n\n`
  );
};

// 🔙 الخروج من وضع المعاينة
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

// 🔙 أثناء المعاينة: نضيف زر "العودة لوضع الأدمن" تلقائياً لكل لوحة مفاتيح يرسلها البوت
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

// ------------------------- ميدلوير وضع النوم (Cold Start) -------------------------
bot.use(async (ctx, next) => {
  let waitMsgId = null;
  let isResponded = false;
  const timer = setTimeout(async () => {
    if (!isResponded && ctx.message && ctx.message.text) {
      try {
        const waitMsg = await ctx.reply('⏳ <b>جاري إيقاظ الخادم والاتصال... يرجى الانتظار لحظة.</b>', { parse_mode: 'HTML' });
        waitMsgId = waitMsg.message_id;
      } catch (e) {}
    }
  }, 1500);

  try {
    await next();
  } finally {
    isResponded = true;
    clearTimeout(timer);
    if (waitMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, waitMsgId).catch(() => {});
  }
});

// ------------------------- 🧭 توزيع الأدوار حسب الـ ID -------------------------
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  await refreshWebsiteUrl();

  // مستخدم عادي => serverUsers
  if (!(await isAdmin(userId))) return userMw(ctx, next);

  // أدمن
  const text = ctx.message?.text;
  const cbData = ctx.callbackQuery?.data || '';

  // العودة لوضع الأدمن (من أي مكان)
  if (text === BACK_TO_ADMIN || text === '/admin') {
    await safeDeleteUserMessage(ctx);
    return core.exitPreview(ctx);
  }

  // أفعال الإدارة تبقى للأدمن حتى لو كان في وضع المعاينة
  const forceAdmin =
    /^(approve_|reject_|support_reply_)\d+$/.test(cbData) ||
    userState[userId]?.step === 'replying_to_support_user';

  if (previewMode[userId]) injectBackButton(ctx);
  if (forceAdmin || !previewMode[userId]) return adminMw(ctx, next);
  return userMw(ctx, next);
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
