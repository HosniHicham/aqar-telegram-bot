'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { initUsersServer } = require('./users');
const { initAdminServer } = require('./admin');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: Required environment variables are missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

const previewMode = {}; // وضع معاينة الأدمن كـ يوزر

async function getAdminIds() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_id').single();
    if (!data || !data.value) return [];
    return data.value.split(/[,،\s]+/).map(id => Number(id.trim())).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function isAdmin(userId) {
  if (!userId) return false;
  const ids = await getAdminIds();
  return ids.includes(Number(userId));
}

function getPreviewToggleKeyboard(isPreview) {
  return Markup.keyboard([
    [isPreview ? '🛡️ العودة لوضع الأدمن' : '👁 معاينة كـ يوزر'],
    ['🏠 القائمة الرئيسية']
  ]).resize();
}

const usersHandler = initUsersServer({ bot, app, supabase, WEBHOOK_DOMAIN });
const adminHandler = initAdminServer({ bot, supabase });

// تبديل المعاينة للأدمن فقط
bot.hears(['👁 معاينة كـ يوزر', '🛡️ العودة لوضع الأدمن'], async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!(await isAdmin(userId))) return next();

  await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  const enablePreview = ctx.message.text.trim() === '👁 معاينة كـ يوزر';
  previewMode[userId] = enablePreview;

  if (enablePreview) {
    await ctx.reply('👁 <b>تم تفعيل وضع المعاينة كـ يوزر.</b> يمكنك الآن تجربة واجهة اليوزر.', {
      parse_mode: 'HTML',
      ...getPreviewToggleKeyboard(true)
    });
    return usersHandler.onStart(ctx);
  } else {
    return adminHandler.onStart(ctx, getPreviewToggleKeyboard(false));
  }
});

// توجيه حسب الصلاحية (أدمن <-> يوزر)
bot.start(async (ctx) => {
  const userId = ctx.from?.id;
  if (await isAdmin(userId) && !previewMode[userId]) {
    return adminHandler.onStart(ctx, getPreviewToggleKeyboard(false));
  }
  return usersHandler.onStart(ctx);
});

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (await isAdmin(userId) && !previewMode[userId]) {
    return adminHandler.route(ctx, next);
  }
  return usersHandler.route(ctx, next);
});

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
