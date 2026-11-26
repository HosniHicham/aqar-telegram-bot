'use strict';
// =========================================================================
// 🚀 SERVER.JS — الملف الرئيسي (الأب) لمنصة عقار الجزائر (Aqar System)
// يربط Express + Telegraf + Supabase + طبقة الخدمات (service.js) + وحدات البوت
// =========================================================================

require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const createServiceLayer = require('./service');
const registerUsers = require('./server_users');

// تحميل الوحدات الإضافية إن وجدت في المشروع
let registerAdmin = null;
let createMessenger = null;
try { registerAdmin = require('./server_admin'); } catch (_) {}
try { createMessenger = require('./messenger'); } catch (_) {}

// -------------------------------------------------------------------------
// 1. التهيئة والمتغيرات البيئية
// -------------------------------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_DOMAIN = (process.env.WEBHOOK_DOMAIN || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const MAX_PROPERTY_IMAGES = Number(process.env.MAX_PROPERTY_IMAGES || 10);
const WAIT_BTN_TEXT = '⏳ يرجى الانتظار...';

if (!BOT_TOKEN) throw new Error('❌ BOT_TOKEN غير معرف في متغيرات البيئة');
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('❌ SUPABASE_URL أو SUPABASE_KEY غير معرف');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------------------------
// 2. الجلسات المشتركة في الذاكرة
// -------------------------------------------------------------------------
const userState = {};
const userLang = {};
const browsingSession = {};
const supportUserSession = {};
const trackedBotMessages = new Map(); // userId -> Array<{ chatId, messageId }>

// -------------------------------------------------------------------------
// 3. إدارة الأدمن (من البيئة ومن جدول app_settings)
// -------------------------------------------------------------------------
async function getAdminIds() {
  const ids = new Set();

  const envAdmins = String(process.env.ADMIN_IDS || process.env.ADMIN_ID || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
  for (const id of envAdmins) ids.add(id);

  try {
    const dbAdminVal = await services.getSetting('admin_id', '');
    const dbAdmins = String(dbAdminVal || '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0);
    for (const id of dbAdmins) ids.add(id);
  } catch (_) {}

  return [...ids];
}

// -------------------------------------------------------------------------
// 4. إنشاء طبقة الخدمات المشتركة (service.js)
// -------------------------------------------------------------------------
const services = createServiceLayer({
  supabase,
  Markup,
  MAX_PROPERTY_IMAGES,
  getAdminIds
});

// -------------------------------------------------------------------------
// 5. دوال إدارة الرسائل المتتبعة وحذف رسائل المستخدم بأمان
// -------------------------------------------------------------------------
function trackBotMessage(userId, chatId, messageId) {
  if (!userId || !chatId || !messageId) return;
  const key = String(userId);
  const list = trackedBotMessages.get(key) || [];
  list.push({ chatId, messageId });
  if (list.length > 25) list.splice(0, list.length - 25);
  trackedBotMessages.set(key, list);
}

async function clearTrackedBotMessages(ctx, userId, keepMessageIds = []) {
  const key = String(userId);
  const list = trackedBotMessages.get(key) || [];
  if (!list.length) return;

  const keepSet = new Set((keepMessageIds || []).map(Number));
  const remaining = [];

  for (const item of list) {
    if (keepSet.has(Number(item.messageId))) {
      remaining.push(item);
      continue;
    }
    await ctx.telegram.deleteMessage(item.chatId, item.messageId).catch(() => {});
  }

  trackedBotMessages.set(key, remaining);
}

async function replyTracked(ctx, userId, text, extra = {}, clearPrevious = false) {
  const sent = await ctx.reply(text, extra).catch(() => null);
  const keepIds = sent?.message_id ? [sent.message_id] : [];
  if (sent?.message_id && ctx.chat?.id) {
    trackBotMessage(userId, ctx.chat.id, sent.message_id);
  }
  if (clearPrevious) {
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }
  return sent;
}

async function safeDeleteUserMessage(ctx) {
  try {
    if (ctx.chat?.id && ctx.message?.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    }
  } catch (_) {}
}

// -------------------------------------------------------------------------
// 6. لوحات المفاتيح الرئيسية وروابط الموقع
// -------------------------------------------------------------------------
function getWebsiteUrl() {
  return String(process.env.WEBSITE_URL || '').trim();
}

function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 مشاركة وتأكيد رقم الهاتف')]
  ]).resize();
}

async function getMainMenuKeyboard(userId, unreadCount = 0, unreadRepliesCount = 0) {
  const supportLabel = unreadRepliesCount > 0
    ? `📞 الدعم والإدارة (${unreadRepliesCount})`
    : '📞 الدعم والإدارة';

  const rows = [
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['🎁 رصيدي وجمع النقاط', supportLabel],
    ['🌐 تصفح الموقع الرسمي (البروزر)', 'ℹ️ عن المنصة']
  ];

  const adminIds = await getAdminIds();
  if (adminIds.includes(Number(userId))) {
    rows.push(['⚙️ لوحة الإدارة']);
  }

  return Markup.keyboard(rows).resize();
}

// -------------------------------------------------------------------------
// 7. كائن النواة المشترك (core) وتمريره إلى الوحدات
// -------------------------------------------------------------------------
const core = {
  bot,
  app,
  supabase,
  Markup,
  services,
  WEBHOOK_DOMAIN,
  MAX_PROPERTY_IMAGES,
  WAIT_BTN_TEXT,

  // Sessions
  userState,
  userLang,
  browsingSession,
  supportUserSession,

  // Message tracking & UI helpers
  trackBotMessage,
  clearTrackedBotMessages,
  replyTracked,
  safeDeleteUserMessage,
  getMainMenuKeyboard,
  getAuthKeyboard,
  getWebsiteUrl,

  // Service shortcuts
  getSetting: services.getSetting,
  getTextSetting: services.getTextSetting,
  setSetting: services.setSetting,
  clearSettingsCache: services.clearSettingsCache,
  getTopupAmountsList: services.getTopupAmountsList,
  getDynamicTopupAmountButtons: services.getDynamicTopupAmountButtons,
  getAdminIds,
  getUserRecord: services.getUserRecord,
  isUserVerified: services.isUserVerified,
  chunkButtons: services.chunkButtons,
  sanitizeNumericPrice: services.sanitizeNumericPrice,
  formatMoney: services.formatMoney,
  formatDateTime: services.formatDateTime,
  escapeHtml: services.escapeHtml,
  fitTelegramText: services.fitTelegramText,
  normalizeMediaRef: services.normalizeMediaRef,
  parseMediaListFromField: services.parseMediaListFromField,
  parseImagesFromImageUrl: services.parseImagesFromImageUrl,
  buildOrderedBrowsingMedia: services.buildOrderedBrowsingMedia,
  messenger: null
};

// تهيئة نظام المراسلة بين المالك والمشتري إن وجد
if (typeof createMessenger === 'function') {
  core.messenger = createMessenger(bot, core);
}

// تسجيل وحدة الإدارة أولاً (حتى تلتقط أوامر الإدارة قبل تنبيهات الأزرار العامة للمستخدم)
let adminModule = null;
if (typeof registerAdmin === 'function') {
  adminModule = registerAdmin(bot, core);
}

// تسجيل وحدة المستخدمين
const usersModule = registerUsers(bot, core);
core.users = usersModule;
core.admin = adminModule;

// -------------------------------------------------------------------------
// 8. مسارات الصحة والويب هوك وتشغيل الخادم
// -------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Aqar DZ Telegram Bot Server',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// معالجة الأخطاء غير المتوقعة في Telegraf لمنع توقف السيرفر
bot.catch((err, ctx) => {
  console.error(`Telegraf error for ${ctx.updateType}:`, err);
});

async function startServer() {
  if (WEBHOOK_DOMAIN) {
    const secretPath = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(secretPath));
    await bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}${secretPath}`);
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} with Webhook: ${WEBHOOK_DOMAIN}${secretPath}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`🚀 Express running on port ${PORT}`);
    });
    await bot.launch();
    console.log('🤖 Bot launched in Long-Polling mode');
  }
}

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
