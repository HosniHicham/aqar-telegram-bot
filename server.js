'use strict';

const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 4000;
const BOT_TOKEN = process.env.FATHER_BOT_TOKEN || process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is required for Father Server.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// كاش خفيف لمدة 10 ثوانٍ لتخفيف الضغط على app_settings أثناء الرسائل المتلاحقة
let cachedAdmins = { ids: [], expiresAt: 0 };

async function getAdminIdsFromAppSettings() {
  const now = Date.now();
  if (cachedAdmins.expiresAt > now) {
    return cachedAdmins.ids;
  }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_id')
      .single();

    if (error || !data || !data.value) {
      cachedAdmins = { ids: [], expiresAt: now + 5000 };
      return [];
    }

    const idsArray = String(data.value)
      .split(/[,،\s]+/)
      .map(v => Number(v.trim()))
      .filter(n => Number.isFinite(n) && n > 0);

    cachedAdmins = { ids: idsArray, expiresAt: now + 10000 };
    return idsArray;
  } catch (err) {
    return cachedAdmins.ids || [];
  }
}

async function checkIsAdmin(userId) {
  const numericId = Number(userId);
  if (!Number.isFinite(numericId) || numericId <= 0) return false;
  const adminArray = await getAdminIdsFromAppSettings();
  return adminArray.includes(numericId);
}

// =========================================================================
// استقبال رسائل التفاعل في سيرفر فادر (أدمن أو عميل)
// =========================================================================
bot.on('message', async (ctx) => {
  const senderId = ctx.from?.id;
  if (!senderId) return;

  const isAdmin = await checkIsAdmin(senderId);
  const greeting = isAdmin
    ? 'مرحباً بك أيها الأدمن'
    : 'مرحباً بك أيها العميل';

  await ctx.reply(greeting);
});

// =========================================================================
// نقطة فحص خفيفة عبر HTTP للتجربة السريعة
// =========================================================================
app.get('/', (req, res) => {
  res.send('Father Server is running');
});

app.post('/father/check', async (req, res) => {
  const { userId } = req.body || {};
  const isAdmin = await checkIsAdmin(userId);
  return res.json({
    ok: true,
    message: isAdmin ? 'مرحباً بك أيها الأدمن' : 'مرحباً بك أيها العميل'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Father Server listening on port ${PORT}`);
});

bot.launch().catch(err => {
  console.error('Father bot launch error:', err.message);
});
