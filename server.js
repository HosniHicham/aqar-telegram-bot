'use strict';
// =========================================================================
// 🧠 SERVER FATHER — العقل المدبّر (ربط كامل إرسال واستقبال مع HTML)
// =========================================================================

const { Telegraf, Markup, Composer } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// ------------------------- الإعدادات -------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN
  ? process.env.WEBHOOK_DOMAIN.trim().replace(/\/+$/, '')
  : '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const MAX_PROPERTY_IMAGES = 6;
const BACK_TO_ADMIN = '🔙 العودة لوضع الإدارة';

if (!BOT_TOKEN) {
  console.error('❌ Error: BOT_TOKEN environment variable is missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

// ------------------------- ترويسات CORS -------------------------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '15mb' }));

// ------------------------- الحالات المشتركة -------------------------
const userState = {};
const userLang = {};
const browsingSession = {};
const supportUserSession = {};
const botMessagesHistory = {};
const previewMode = {};
const lastKnownRole = {}; // 'admin' | 'user'

function resetSessions(userId) {
  if (!userId) return;
  delete userState[userId];
  delete browsingSession[userId];
  delete supportUserSession[userId];
}

// ------------------------- تنظيف رسائل البوت -------------------------
function trackBotMessage(userId, chatId, messageId) {
  if (!userId || !chatId || !messageId) return;
  if (!botMessagesHistory[userId]) {
    botMessagesHistory[userId] = { chatId, ids: [] };
  }
  botMessagesHistory[userId].chatId = chatId;
  if (!botMessagesHistory[userId].ids.includes(messageId)) {
    botMessagesHistory[userId].ids.push(messageId);
  }
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
  if (!history || !chatId || !Array.isArray(history.ids)) return;

  const remaining = [];
  for (const msgId of history.ids) {
    if (keepSet.has(msgId)) {
      remaining.push(msgId);
      continue;
    }
    try {
      await ctx.telegram.deleteMessage(chatId, msgId);
    } catch (e) {}
  }
  botMessagesHistory[userId].ids = remaining;
}

async function replyTracked(ctx, userId, text, extra = {}, cleanPrevious = false, keepIds = []) {
  if (cleanPrevious) {
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }
  const sent = await ctx.reply(text, extra);
  const chatId = ctx?.chat?.id || sent?.chat?.id;
  if (sent && sent.message_id && chatId) {
    trackBotMessage(userId, chatId, sent.message_id);
  }
  return sent;
}

async function safeDeleteUserMessage(ctx) {
  try {
    const chatId = ctx?.chat?.id;
    const msgId = ctx?.message?.message_id;
    if (chatId && msgId) {
      await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
    }
  } catch (e) {}
}

// ------------------------- Supabase مشترك -------------------------
async function getSetting(key, defaultValue = '') {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .limit(1);
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
  websiteUrl = v && /^https?:\/\//i.test(String(v).trim()) ? String(v).trim() : '';
  return websiteUrl;
}

function getWebsiteUrl() {
  return websiteUrl;
}

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
  if (!userId) return false;
  const ids = await getAdminIds();
  return ids.includes(Number(userId));
}

async function getUserRecord(telegramId) {
  try {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', telegramId)
      .limit(1);
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    return null;
  }
}

async function isUserVerified(telegramId) {
  if (!telegramId) return false;
  if (previewMode[telegramId]) return true;
  const user = await getUserRecord(telegramId);
  return !!user;
}

// ------------------------- أدوات التنسيق -------------------------
function chunkButtons(buttonsArray, chunkSize = 4) {
  const chunked = [];
  for (let i = 0; i < buttonsArray.length; i += chunkSize) {
    chunked.push(buttonsArray.slice(i, i + chunkSize));
  }
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
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    return target.toISOString().replace('T', ' ').slice(0, 16);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fitTelegramText(text, isMediaCaption = false) {
  const limit = isMediaCaption ? 1015 : 3950;
  const clean = String(text || '');
  return clean.length > limit ? clean.slice(0, limit - 3) + '…' : clean;
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
      if (Array.isArray(arr)) {
        return [...new Set(arr.map(normalizeMediaRef).filter(Boolean))];
      }
    } catch (e) {}
  }
  return [...new Set(trimmed.split('|').map(normalizeMediaRef).filter(Boolean))];
}

function parseImagesFromImageUrl(imageUrlField) {
  return parseMediaListFromField(imageUrlField);
}

function buildOrderedBrowsingMedia(item) {
  const videos = parseMediaListFromField(item.video_url)
    .slice(0, MAX_PROPERTY_IMAGES)
    .map(ref => ({ type: 'video', ref }));
  const photos = parseImagesFromImageUrl(item.image_url)
    .slice(0, MAX_PROPERTY_IMAGES)
    .map(ref => ({ type: 'photo', ref }));
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
  bot,
  app,
  supabase,
  Markup,
  WEBHOOK_DOMAIN,
  getWebsiteUrl,
  MAX_PROPERTY_IMAGES,
  BACK_TO_ADMIN,
  userState,
  userLang,
  browsingSession,
  supportUserSession,
  previewMode,
  resetSessions,
  trackBotMessage,
  untrackBotMessage,
  clearTrackedBotMessages,
  replyTracked,
  safeDeleteUserMessage,
  getSetting,
  getAdminIds,
  isAdmin,
  getUserRecord,
  isUserVerified,
  chunkButtons,
  sanitizeNumericPrice,
  formatMoney,
  formatDateTime,
  escapeHtml,
  fitTelegramText,
  normalizeMediaRef,
  parseMediaListFromField,
  parseImagesFromImageUrl,
  buildOrderedBrowsingMedia,
  getWebsiteButton,
  getMainMenuKeyboard,
  getAuthKeyboard,
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
    return {
      ...extra,
      reply_markup: {
        ...extra.reply_markup,
        keyboard: [...kb, [BACK_TO_ADMIN]]
      }
    };
  };

  for (const m of ['reply', 'replyWithPhoto', 'replyWithVideo']) {
    const orig = ctx[m].bind(ctx);
    ctx[m] = (first, extra, ...rest) => orig(first, addBack(extra), ...rest);
  }
}

const userMw = userComposer.middleware();
const adminMw = adminComposer.middleware();

// =========================================================================
// 🌐 واجهة الـ API (استقبال وإرسال بين صفحة HTML والسيرفر وقاعدة البيانات)
// =========================================================================

// 1) استقبال بيانات الواجهة الحية (إحصائيات + عقارات + استعلامات)
app.get('/api/dashboard', async (req, res) => {
  try {
    const userId = req.query.userId ? Number(String(req.query.userId).replace(/\D/g, '')) : null;
    const stateFilter = req.query.state ? String(req.query.state).trim() : '';

    let pubQuery = supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(100);
    if (stateFilter && stateFilter !== 'ALL' && stateFilter !== 'كل الولايات') {
      pubQuery = pubQuery.eq('state_name', stateFilter);
    }

    const [
      { data: publishedAds, error: pubErr },
      pendingCountRes,
      pubCountRes,
      inqCountRes,
      { data: allPendingAds }
    ] = await Promise.all([
      pubQuery,
      supabase.from('pending_properties').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('test_messages').select('*', { count: 'exact', head: true }),
      userId
        ? supabase.from('user_inquiries').select('*', { count: 'exact', head: true }).eq('user_id', userId)
        : supabase.from('user_inquiries').select('*', { count: 'exact', head: true }),
      supabase.from('pending_properties').select('*').order('id', { ascending: false }).limit(100)
    ]);

    if (pubErr) throw pubErr;

    const userPending = userId
      ? (allPendingAds || []).filter(r => Number(r.user_id) === userId)
      : (allPendingAds || []).filter(r => r.status === 'pending');

    let inquiriesList = [];
    if (userId) {
      const { data: uInq } = await supabase
        .from('user_inquiries')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false })
        .limit(50);
      inquiriesList = uInq || [];
    } else {
      const { data: aInq } = await supabase
        .from('user_inquiries')
        .select('*')
        .order('id', { ascending: false })
        .limit(50);
      inquiriesList = aInq || [];
    }

    const isUserAdmin = userId ? await isAdmin(userId) : false;

    res.json({
      ok: true,
      isAdmin: isUserAdmin,
      stats: {
        published: pubCountRes.count ?? 0,
        pending: pendingCountRes.count ?? 0,
        inquiries: inqCountRes.count ?? 0
      },
      ads: publishedAds || [],
      pendingAds: allPendingAds || [],
      userPending,
      inquiries: inquiriesList
    });
  } catch (err) {
    console.error('GET /api/dashboard error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Database error' });
  }
});

// 2) إرسال عقار جديد من صفحة HTML إلى pending_properties وإشعار الإدارة
app.post('/api/ads', async (req, res) => {
  try {
    const {
      user_id,
      property_type,
      state_name,
      price,
      phone,
      description,
      image_url,
      video_url,
      is_free
    } = req.body || {};

    if (!property_type || !state_name || !phone || !description) {
      return res.status(400).json({ ok: false, error: 'يرجى تعبئة نوع العقار، الولاية، الهاتف، والوصف.' });
    }

    const numericPrice = sanitizeNumericPrice(price);
    const cleanPhone = String(phone).replace(/\D/g, '').trim();
    const numericUserId = user_id ? Number(String(user_id).replace(/\D/g, '')) || null : null;

    const { data: inserted, error } = await supabase
      .from('pending_properties')
      .insert([{
        user_id: numericUserId,
        property_type: String(property_type).trim(),
        state_name: String(state_name).trim(),
        price: numericPrice,
        phone: cleanPhone,
        description: String(description).trim(),
        image_url: image_url && String(image_url).trim() ? String(image_url).trim() : 'EMPTY',
        video_url: video_url && String(video_url).trim() ? String(video_url).trim() : 'EMPTY',
        receipt_url: is_free ? 'FREE_NO_RECEIPT' : 'WEB_SUBMITTED',
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    const adminIds = await getAdminIds();
    const adminText =
      `🌐 <b>إعلان جديد مرسل من واجهة الويب (#${inserted.id})</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      (numericUserId ? `👤 <b>المُرسِل:</b> <code>${numericUserId}</code>\n` : '') +
      `🏠 <b>العقار:</b> ${escapeHtml(inserted.property_type)} — 📍 <b>${escapeHtml(inserted.state_name)}</b>\n` +
      `💰 <b>السعر:</b> ${formatMoney(numericPrice)} — 📞 <code>${escapeHtml(cleanPhone)}</code>\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(inserted.description)}`;

    const adminKb = Markup.inlineKeyboard([[
      Markup.button.callback(`❌ رفض (#${inserted.id})`, `reject_${inserted.id}`),
      Markup.button.callback(`✅ قبول ونشر (#${inserted.id})`, `approve_${inserted.id}`)
    ]]);

    for (const admId of adminIds) {
      await bot.telegram.sendMessage(admId, fitTelegramText(adminText, false), {
        parse_mode: 'HTML',
        ...adminKb
      }).catch(() => {});
    }

    res.json({ ok: true, id: inserted.id, data: inserted });
  } catch (err) {
    console.error('POST /api/ads error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to create ad' });
  }
});

// 3) إرسال استعلام جديد من صفحة HTML إلى user_inquiries وإشعار الإدارة
app.post('/api/inquiries', async (req, res) => {
  try {
    const { user_id, property_id, subject, message, target_role } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: 'نص الاستعلام مطلوب.' });
    }

    const numericUserId = user_id ? Number(String(user_id).replace(/\D/g, '')) : 0;
    const numericPropId = property_id ? Number(String(property_id).replace(/\D/g, '')) || null : null;

    const { data: inserted, error } = await supabase
      .from('user_inquiries')
      .insert([{
        user_id: numericUserId,
        property_id: numericPropId,
        property_source: numericPropId ? 'pending_properties' : null,
        inquiry_type: 'web_inquiry',
        target_role: target_role || 'general_support',
        subject: subject ? String(subject).trim() : 'استفسار من الواجهة الحية',
        message: String(message).trim(),
        status: 'open'
      }])
      .select()
      .single();

    if (error) throw error;

    const adminIds = await getAdminIds();
    const msgText =
      `🌐 <b>استعلام جديد من الواجهة الحية (#${inserted.id})</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>العميل:</b> <code>${numericUserId || 'زائر'}</code>\n` +
      (numericPropId ? `🏠 <b>الإعلان:</b> <code>#${numericPropId}</code>\n` : '') +
      `📌 <b>الموضوع:</b> ${escapeHtml(inserted.subject)}\n` +
      `📝 <b>الرسالة:</b> ${escapeHtml(inserted.message)}`;

    const kb = Markup.inlineKeyboard([[
      Markup.button.callback(`💬 الرد على الاستعلام (#${inserted.id})`, `inq_reply_${inserted.id}`)
    ]]);

    for (const admId of adminIds) {
      await bot.telegram.sendMessage(admId, fitTelegramText(msgText, false), {
        parse_mode: 'HTML',
        ...kb
      }).catch(() => {});
    }

    res.json({ ok: true, id: inserted.id, data: inserted });
  } catch (err) {
    console.error('POST /api/inquiries error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to submit inquiry' });
  }
});

// 4) تنفيذ إجراء إداري من واجهة الـ HTML (approve / reject / requeue / delete)
app.post('/api/admin/ads/:id/action', async (req, res) => {
  try {
    const adId = Number(req.params.id);
    const { action, adminId } = req.body || {};

    if (!adId || !action) {
      return res.status(400).json({ ok: false, error: 'Missing adId or action' });
    }

    if (adminId) {
      const okAdmin = await isAdmin(Number(adminId));
      if (!okAdmin) {
        return res.status(403).json({ ok: false, error: 'غير مصرح لك بهذا الإجراء الإداري.' });
      }
    }

    if (action === 'delete_published') {
      const { error } = await supabase.from('test_messages').delete().eq('id', adId);
      if (error) throw error;
      return res.json({ ok: true, action });
    }

    const { data: pendingItem, error: fetchErr } = await supabase
      .from('pending_properties')
      .select('*')
      .eq('id', adId)
      .single();

    if (fetchErr || !pendingItem) {
      return res.status(404).json({ ok: false, error: 'الإعلان غير موجود في قائمة الانتظار.' });
    }

    if (action === 'requeue') {
      const { error } = await supabase.from('pending_properties').update({ status: 'pending' }).eq('id', adId);
      if (error) throw error;
      return res.json({ ok: true, action });
    }

    if (action === 'approve') {
      const numericPrice = sanitizeNumericPrice(pendingItem.price);
      const cleanPhone = String(pendingItem.phone || '').replace(/\D/g, '').trim();
      const nowIso = new Date().toISOString();

      const { error: pubErr } = await supabase.from('test_messages').insert([{
        user_id: pendingItem.user_id,
        property_type: pendingItem.property_type,
        state_name: pendingItem.state_name,
        price: numericPrice,
        phone: cleanPhone,
        description: pendingItem.description,
        message: pendingItem.description,
        image_url: pendingItem.image_url || 'EMPTY',
        video_url: pendingItem.video_url || 'EMPTY',
        created_at: nowIso
      }]);

      if (pubErr) throw pubErr;

      await supabase.from('pending_properties').update({ status: 'approved' }).eq('id', adId);

      if (pendingItem.user_id) {
        await bot.telegram.sendMessage(
          pendingItem.user_id,
          `🎉 <b>تمت الموافقة على إعلانك (#${adId}) ونشره في المنصة.</b>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      return res.json({ ok: true, action });
    }

    if (action === 'reject') {
      await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', adId);
      if (pendingItem.user_id) {
        await bot.telegram.sendMessage(
          pendingItem.user_id,
          `❌ <b>نعتذر، لم تتم الموافقة على نشر إعلانك (#${adId}).</b>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
      return res.json({ ok: true, action });
    }

    res.status(400).json({ ok: false, error: 'إجراء غير معروف' });
  } catch (err) {
    console.error('POST /api/admin/ads/:id/action error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Action failed' });
  }
});

// 5) صفحة HTML متكاملة مدمجة ومربوطة مباشرة بنفس السيرفر (إرسال واستقبال)
function getLiveHtmlPage() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>عقار الجزائر • واجهة حية</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b1220;
      --card: #121c30;
      --card-2: #182540;
      --border: #253657;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --teal: #14b8a6;
      --cyan: #06b6d4;
      --gold: #eab308;
      --danger: #ef4444;
      --ok: #22c55e;
    }
    * { box-sizing: border-box; font-family: 'Cairo', sans-serif; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      padding: 16px; max-width: 920px; margin-inline: auto;
    }
    .top-bar {
      background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .title { font-size: 19px; font-weight: 800; margin: 0; }
    .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .btn {
      background: var(--teal); color: #062020; border: none; border-radius: 10px;
      padding: 9px 14px; font-weight: 700; cursor: pointer; font-size: 13px;
    }
    .btn-ghost {
      background: var(--card-2); color: var(--text); border: 1px solid var(--border);
      border-radius: 10px; padding: 9px 12px; font-weight: 700; cursor: pointer; font-size: 13px;
    }
    .btn-gold { background: var(--gold); color: #1a1200; }
    .btn-danger { background: var(--danger); color: #fff; }
    .row-link { display: flex; gap: 8px; margin-top: 12px; }
    input, select, textarea {
      width: 100%; background: var(--card-2); color: var(--text);
      border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; font-size: 14px;
    }
    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px;
    }
    .stat-box {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: 14px; text-align: center;
    }
    .stat-num { font-size: 22px; font-weight: 800; color: var(--cyan); }
    .stat-lbl { font-size: 12px; color: var(--muted); }
    .tabs {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px;
    }
    .tab-btn {
      background: var(--card); color: var(--muted); border: 1px solid var(--border);
      border-radius: 11px; padding: 10px 6px; font-weight: 700; cursor: pointer; font-size: 13px;
    }
    .tab-btn.active {
      background: var(--teal); color: #051d1c; border-color: var(--teal);
    }
    .panel {
      background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 16px; margin-top: 12px;
    }
    .err-box {
      background: #3b1117; border: 1px solid #7f1d1d; color: #fecaca;
      border-radius: 12px; padding: 12px; margin-top: 12px; display: none; font-size: 13px;
    }
    .ok-box {
      background: #0d2b1d; border: 1px solid #166534; color: #bbf7d0;
      border-radius: 12px; padding: 12px; margin-top: 12px; display: none; font-size: 13px;
    }
    .ad-card {
      background: var(--card-2); border: 1px solid var(--border); border-radius: 14px;
      padding: 14px; margin-bottom: 10px;
    }
    .ad-head { display: flex; justify-content: space-between; font-weight: 800; font-size: 15px; margin-bottom: 6px; }
    .ad-meta { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .form-grid { display: grid; gap: 10px; }
    .hidden { display: none; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div>
      <h1 class="title">عقار الجزائر • واجهة حية</h1>
      <div class="sub" id="statusSub">متصل بالسيرفر مباشرة (إرسال واستقبال)</div>
    </div>
    <button class="btn" onclick="loadDashboard()">↻ تحديث حي</button>
  </div>

  <div class="row-link">
    <input id="tgUserId" type="text" placeholder="أدخل Telegram User ID (اختياري)" />
    <button class="btn" onclick="saveUserId()">ربط</button>
  </div>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-num" id="stPublished">0</div>
      <div class="stat-lbl">منشورة</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" id="stPending">0</div>
      <div class="stat-lbl">معلقة</div>
    </div>
    <div class="stat-box">
      <div class="stat-num" id="stInquiries">0</div>
      <div class="stat-lbl">استعلامات</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" id="tab-ads" onclick="switchTab('ads')">🏠 العقارات</button>
    <button class="tab-btn" id="tab-add" onclick="switchTab('add')">+ إضافة</button>
    <button class="tab-btn" id="tab-inq" onclick="switchTab('inq')">📩 استعلام</button>
    <button class="tab-btn" id="tab-adm" onclick="switchTab('adm')">🛡 إدارة</button>
  </div>

  <div class="err-box" id="errBox"></div>
  <div class="ok-box" id="okBox"></div>

  <!-- تبويب العقارات -->
  <div class="panel" id="panel-ads">
    <select id="stateFilter" onchange="loadDashboard()" style="margin-bottom:12px;">
      <option value="ALL">كل الولايات</option>
      <option value="الجزائر العاصمة">الجزائر العاصمة</option>
      <option value="وهران">وهران</option>
      <option value="مستغانم">مستغانم</option>
      <option value="قسنطينة">قسنطينة</option>
      <option value="عنابة">عنابة</option>
      <option value="البليدة">البليدة</option>
      <option value="تلمسان">تلمسان</option>
      <option value="سطيف">سطيف</option>
      <option value="بجاية">بجاية</option>
    </select>
    <div id="adsList">جاري التحميل...</div>
  </div>

  <!-- تبويب إضافة عقار (إرسال إلى السيرفر) -->
  <div class="panel hidden" id="panel-add">
    <h3 style="margin-top:0">إرسال عقار جديد إلى السيرفر</h3>
    <div class="form-grid">
      <input id="adType" type="text" placeholder="نوع العقار (مثال: شقة، فيلا، قطعة أرض)" />
      <input id="adState" type="text" placeholder="الولاية (مثال: وهران، الجزائر العاصمة)" />
      <input id="adPrice" type="text" placeholder="السعر بالدينار الجزائري (مثال: 8500000)" />
      <input id="adPhone" type="text" placeholder="رقم الهاتف" />
      <input id="adImage" type="text" placeholder="رابط صورة (اختياري)" />
      <textarea id="adDesc" rows="3" placeholder="تفاصيل ومزايا العقار..."></textarea>
      <label style="font-size:13px; color:var(--muted);">
        <input id="adFree" type="checkbox" style="width:auto;" /> إرسال كإعلان مجاني
      </label>
      <button class="btn btn-gold" onclick="submitAd()">📤 إرسال العقار الآن</button>
    </div>
  </div>

  <!-- تبويب الاستعلامات (إرسال واستقبال) -->
  <div class="panel hidden" id="panel-inq">
    <h3 style="margin-top:0">إرسال استعلام جديد</h3>
    <div class="form-grid">
      <input id="inqPropId" type="text" placeholder="رقم الإعلان #ID (اختياري)" />
      <input id="inqSubject" type="text" placeholder="الموضوع (اختياري)" />
      <textarea id="inqMsg" rows="3" placeholder="اكتب استفسارك أو رسالتك هنا..."></textarea>
      <button class="btn" onclick="submitInquiry()">📨 إرسال الاستعلام</button>
    </div>
    <hr style="border-color:var(--border); margin:16px 0;" />
    <h4>سجل الاستعلامات</h4>
    <div id="inqList">لا توجد استعلامات معروضة.</div>
  </div>

  <!-- تبويب الإدارة -->
  <div class="panel hidden" id="panel-adm">
    <h3 style="margin-top:0">إدارة الإعلانات المعلقة</h3>
    <div id="adminPendingList">أدخل Telegram User ID الخاص بالمدير ثم اضغط تحديث.</div>
  </div>

  <script>
    const API_BASE = window.location.origin.startsWith('http')
      ? window.location.origin
      : '${WEBHOOK_DOMAIN || 'http://localhost:3000'}';

    let currentData = { ads: [], pendingAds: [], inquiries: [], isAdmin: false };

    const savedUid = localStorage.getItem('aqar_tg_uid') || '';
    if (savedUid) document.getElementById('tgUserId').value = savedUid;

    function showErr(msg) {
      const el = document.getElementById('errBox');
      document.getElementById('okBox').style.display = 'none';
      el.textContent = msg;
      el.style.display = 'block';
    }

    function showOk(msg) {
      const el = document.getElementById('okBox');
      document.getElementById('errBox').style.display = 'none';
      el.textContent = msg;
      el.style.display = 'block';
    }

    function clearAlerts() {
      document.getElementById('errBox').style.display = 'none';
      document.getElementById('okBox').style.display = 'none';
    }

    function saveUserId() {
      const uid = document.getElementById('tgUserId').value.trim();
      localStorage.setItem('aqar_tg_uid', uid);
      loadDashboard();
    }

    function switchTab(tab) {
      ['ads', 'add', 'inq', 'adm'].forEach(t => {
        document.getElementById('tab-' + t).classList.toggle('active', t === tab);
        document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
      });
    }

    function formatPrice(val) {
      const num = Number(String(val || 0).replace(/\\D/g, ''));
      return (num ? num.toLocaleString('en-US') : '0') + ' دج';
    }

    async function loadDashboard() {
      clearAlerts();
      const uid = document.getElementById('tgUserId').value.trim();
      const state = document.getElementById('stateFilter').value;
      const params = new URLSearchParams();
      if (uid) params.set('userId', uid);
      if (state) params.set('state', state);

      try {
        const res = await fetch(API_BASE + '/api/dashboard?' + params.toString());
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'فشل جلب البيانات');

        currentData = data;
        document.getElementById('stPublished').textContent = data.stats?.published ?? 0;
        document.getElementById('stPending').textContent = data.stats?.pending ?? 0;
        document.getElementById('stInquiries').textContent = data.stats?.inquiries ?? 0;

        renderAds(data.ads || []);
        renderInquiries(data.inquiries || []);
        renderAdminPending(data.pendingAds || []);
      } catch (e) {
        showErr('تعذر الاتصال بـ السيرفر: ' + e.message);
      }
    }

    function renderAds(list) {
      const box = document.getElementById('adsList');
      if (!list.length) {
        box.innerHTML = '<div class="sub">لا توجد عقارات منشورة حالياً.</div>';
        return;
      }
      box.innerHTML = list.map(ad => \`
        <div class="ad-card">
          <div class="ad-head">
            <span>\${ad.property_type || 'عقار'} • \${ad.state_name || ''}</span>
            <span style="color:var(--gold)">\${formatPrice(ad.price)}</span>
          </div>
          <div class="ad-meta">📞 \${ad.phone || '—'} • #\${ad.id}</div>
          <div>\${ad.description || ad.message || ''}</div>
        </div>
      \`).join('');
    }

    function renderInquiries(list) {
      const box = document.getElementById('inqList');
      if (!list.length) {
        box.innerHTML = '<div class="sub">لا توجد استعلامات حالياً.</div>';
        return;
      }
      box.innerHTML = list.map(item => \`
        <div class="ad-card">
          <div class="ad-head">
            <span>#\${item.id} • \${item.subject || 'استعلام'}</span>
            <span style="color:var(--cyan)">\${item.status || 'open'}</span>
          </div>
          <div>\${item.message || ''}</div>
        </div>
      \`).join('');
    }

    function renderAdminPending(list) {
      const box = document.getElementById('adminPendingList');
      const pendingOnly = list.filter(i => i.status === 'pending');
      if (!pendingOnly.length) {
        box.innerHTML = '<div class="sub">لا توجد إعلانات معلقة حالياً.</div>';
        return;
      }
      const adminId = document.getElementById('tgUserId').value.trim();
      box.innerHTML = pendingOnly.map(ad => \`
        <div class="ad-card">
          <div class="ad-head">
            <span>#\${ad.id} • \${ad.property_type || ''} (\${ad.state_name || ''})</span>
            <span style="color:var(--gold)">\${formatPrice(ad.price)}</span>
          </div>
          <div class="ad-meta">📞 \${ad.phone || ''} • \${ad.description || ''}</div>
          <div class="actions">
            <button class="btn" onclick="adminAction(\${ad.id}, 'approve', '\${adminId}')">✅ قبول ونشر</button>
            <button class="btn btn-danger" onclick="adminAction(\${ad.id}, 'reject', '\${adminId}')">❌ رفض</button>
          </div>
        </div>
      \`).join('');
    }

    async function submitAd() {
      clearAlerts();
      const payload = {
        user_id: document.getElementById('tgUserId').value.trim() || null,
        property_type: document.getElementById('adType').value.trim(),
        state_name: document.getElementById('adState').value.trim(),
        price: document.getElementById('adPrice').value.trim(),
        phone: document.getElementById('adPhone').value.trim(),
        image_url: document.getElementById('adImage').value.trim(),
        description: document.getElementById('adDesc').value.trim(),
        is_free: document.getElementById('adFree').checked
      };

      try {
        const res = await fetch(API_BASE + '/api/ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'فشل إرسال العقار');

        showOk('تم إرسال العقار بنجاح إلى قائمة المراجعة (# ' + data.id + ')');
        ['adType', 'adState', 'adPrice', 'adPhone', 'adImage', 'adDesc'].forEach(id => {
          document.getElementById(id).value = '';
        });
        loadDashboard();
      } catch (e) {
        showErr('خطأ أثناء الإرسال: ' + e.message);
      }
    }

    async function submitInquiry() {
      clearAlerts();
      const payload = {
        user_id: document.getElementById('tgUserId').value.trim() || null,
        property_id: document.getElementById('inqPropId').value.trim() || null,
        subject: document.getElementById('inqSubject').value.trim(),
        message: document.getElementById('inqMsg').value.trim()
      };

      try {
        const res = await fetch(API_BASE + '/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'فشل إرسال الاستعلام');

        showOk('تم إرسال الاستعلام بنجاح (# ' + data.id + ')');
        document.getElementById('inqSubject').value = '';
        document.getElementById('inqMsg').value = '';
        loadDashboard();
      } catch (e) {
        showErr('خطأ أثناء إرسال الاستعلام: ' + e.message);
      }
    }

    async function adminAction(adId, action, adminId) {
      clearAlerts();
      try {
        const res = await fetch(API_BASE + '/api/admin/ads/' + adId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, adminId })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'فشل تنفيذ الإجراء');

        showOk('تم تنفيذ الإجراء بنجاح على الإعلان #' + adId);
        loadDashboard();
      } catch (e) {
        showErr('خطأ في الإدارة: ' + e.message);
      }
    }

    loadDashboard();
  </script>
</body>
</html>`;
}

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
    }

    const verified = await isUserVerified(userId);
    if (verified) {
      return core.modules.user.openUserHome(ctx);
    }

    const userName = ctx.from.first_name || 'مستخدمنا الكريم';
    const authText = await getSetting(
      'auth_prompt_template',
      `أهلاً بك يا <b>${escapeHtml(userName)}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`
    );
    return replyTracked(
      ctx,
      userId,
      authText.replace(/\\n/g, '\n'),
      { parse_mode: 'HTML', ...getAuthKeyboard() },
      true
    );
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
    if (forceAdmin || !previewMode[userId]) {
      return await adminMw(ctx, next);
    }
    return await userMw(ctx, next);
  } catch (err) {
    console.error('Admin routing error:', err);
    await ctx.reply(
      `⚠️ تعذر إتمام العملية: ${escapeHtml(String(err.message || err).slice(0, 200))}`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

bot.catch((err, ctx) => {
  console.error(`Bot error (${ctx?.updateType}):`, err);
});

// ------------------------- 🚀 تشغيل السيرفر -------------------------
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.status(200).type('html').send(getLiveHtmlPage());
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

async function startServer() {
  await refreshWebsiteUrl();

  if (WEBHOOK_DOMAIN) {
    const webhookPath = `/bot${BOT_TOKEN}`;
    app.post(webhookPath, (req, res) => {
      res.sendStatus(200);
      if (req.body && req.body.update_id) {
        bot.handleUpdate(req.body).catch(err => console.error('handleUpdate error:', err));
      }
    });

    app.listen(PORT, '0.0.0.0', async () => {
      console.log(`✅ Server running on port ${PORT}`);
      try {
        await bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}${webhookPath}`);
        console.log(`🌐 Webhook registered at ${WEBHOOK_DOMAIN}${webhookPath}`);
      } catch (err) {
        console.error('❌ Failed to set webhook:', err.message);
      }
    });
  } else {
    bot.launch()
      .then(() => console.log('✅ Bot started in polling mode'))
      .catch(err => console.error('❌ Bot launch error:', err));
  }
}

startServer();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
