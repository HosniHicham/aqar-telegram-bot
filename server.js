'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { createUsersHandler } = require('./users');
const { createAdminHandler } = require('./admin');

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

const previewMode = {};

async function getAdminIds() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_id').limit(1);
    const raw = data && data[0] ? data[0].value : '';
    if (!raw) return [];
    return String(raw).split(/[,،\s]+/).map(id => Number(id.trim())).filter(n => Number.isFinite(n) && n > 0);
  } catch (e) {
    return [];
  }
}

async function isAdmin(userId) {
  if (!userId) return false;
  const ids = await getAdminIds();
  return ids.includes(Number(userId));
}

function getPreviewKeyboard(isPreview) {
  return Markup.keyboard([
    [isPreview ? '🛡️ العودة لوضع الأدمن' : '👁 معاينة كـ يوزر'],
    ['🏠 القائمة الرئيسية']
  ]).resize();
}

const users = createUsersHandler({ bot, app, supabase, WEBHOOK_DOMAIN, getAdminIds });
const admin = createAdminHandler({ bot, supabase, getAdminIds });

bot.on('callback_query', async (ctx) => {
  const userId = ctx.from?.id;
  const adminUser = await isAdmin(userId);
  if (adminUser && !previewMode[userId]) {
    return admin.handleCallback(ctx);
  }
  return users.handleCallback(ctx);
});

bot.on('contact', async (ctx) => {
  const userId = ctx.from?.id;
  if (await isAdmin(userId) && !previewMode[userId]) {
    return admin.handleStart(ctx, getPreviewKeyboard(false));
  }
  return users.handleContact(ctx);
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from?.id;
  if (await isAdmin(userId) && !previewMode[userId]) {
    return admin.handlePhoto(ctx, getPreviewKeyboard(false));
  }
  return users.handlePhoto(ctx);
});

bot.on('video', async (ctx) => {
  const userId = ctx.from?.id;
  if (await isAdmin(userId) && !previewMode[userId]) {
    return admin.handleVideo(ctx, getPreviewKeyboard(false));
  }
  return users.handleVideo(ctx);
});

bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  const text = (ctx.message?.text || '').trim();
  const adminUser = await isAdmin(userId);

  if (adminUser && (text === '👁 معاينة كـ يوزر' || text === '🛡️ العودة لوضع الأدمن')) {
    await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    const enable = text === '👁 معاينة كـ يوزر';
    previewMode[userId] = enable;

    if (enable) {
      await ctx.reply('👁 <b>تم تفعيل وضع المعاينة كـ يوزر.</b>', {
        parse_mode: 'HTML',
        ...getPreviewKeyboard(true)
      });
      return users.handleStart(ctx);
    }
    return admin.handleStart(ctx, getPreviewKeyboard(false));
  }

  if (text === '/start') {
    if (adminUser && !previewMode[userId]) {
      return admin.handleStart(ctx, getPreviewKeyboard(false));
    }
    return users.handleStart(ctx);
  }

  if (adminUser && !previewMode[userId]) {
    return admin.handleText(ctx, getPreviewKeyboard(false));
  }
  return users.handleText(ctx);
});

const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) {
      bot.handleUpdate(req.body).catch(err => console.error('handleUpdate error:', err));
    }
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`).catch(err => console.error('setWebhook error:', err));
  app.get('/', (req, res) => res.send('Aqar Algeria Production System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
