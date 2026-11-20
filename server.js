'use strict';

const { Telegraf } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  handleUserStart,
  handleUserContact,
  handleUserCallbackQuery,
  handleUserText,
  handleUserPhoto,
  handleUserVideo
} = require('./users');
const {
  handleAdminCallbackQuery,
  handleAdminText,
  handleAdminPhoto,
  handleAdminVideo
} = require('./admin');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: Required environment variables are missing!');
  process.exit(1);
}

const fatherSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

let cachedAdminIds = { ids: [], expiresAt: 0 };
const adminPreviewMode = {};

async function resolveAdminIds() {
  const now = Date.now();
  if (cachedAdminIds.expiresAt > now) {
    return cachedAdminIds.ids;
  }

  try {
    const { data } = await fatherSupabase.from('app_settings').select('value').eq('key', 'admin_id').single();
    const ids = data && data.value
      ? data.value.split(/[,،\s]+/).map(id => Number(id.trim())).filter(Boolean)
      : [5883330772];
    cachedAdminIds = { ids, expiresAt: now + 10000 };
    return ids;
  } catch (e) {
    return cachedAdminIds.ids && cachedAdminIds.ids.length > 0 ? cachedAdminIds.ids : [5883330772];
  }
}

async function getFatherSetting(key, defaultValue = '') {
  try {
    const { data } = await fatherSupabase.from('app_settings').select('value').eq('key', key).single();
    return data ? data.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

async function resolveRole(userId) {
  if (!userId) return 'user';
  const adminIds = await resolveAdminIds();
  if (adminIds.includes(Number(userId))) {
    return adminPreviewMode[Number(userId)] ? 'user_preview' : 'admin';
  }
  return 'user';
}

// ⏳ مديولوير ذكي لحل مشكلة وضع النوم (Cold Start)
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

    if (waitMsgId) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsgId).catch(() => {});
      } catch (e) {}
    }
  }
});

// 🎬 صفحة الويب المصغرة لربح النقاط
app.get('/watch-ad', async (req, res) => {
  const userId = req.query.uid || '';
  const rewardPoints = await getFatherSetting('ad_reward_points', '25');

  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مشاهدة إعلان وربح نقاط</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src='//libtl.com/sdk.js' data-zone='12268522' data-sdk='show_12268522'></script>
  <style>
    body {
      background: #0F172A; color: #F8FAFC; font-family: system-ui, -apple-system, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 20px; text-align: center; box-sizing: border-box;
    }
    .card {
      background: #1E293B; border: 1px solid #334155; border-radius: 16px;
      padding: 24px; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    .alert-box {
      background: #7F1D1D; color: #FCA5A5; border: 1px solid #991B1B;
      padding: 12px; border-radius: 8px; font-size: 13px; font-weight: bold;
      margin-bottom: 15px; display: none; line-height: 1.5;
    }
    button {
      background: #D4AF37; color: #0F172A; border: none; padding: 14px 24px;
      border-radius: 10px; font-size: 16px; font-weight: bold; width: 100%;
      cursor: pointer; margin-top: 15px;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🎁 ربح نقاط عقار الجزائر</h2>
    <p style="color:#94A3B8; font-size:14px;">اضغط على الزر أدناه لبدء مشاهدة الإعلان وربح +${rewardPoints} نقطة.</p>
    <div id="alertBox" class="alert-box">
      ⚠️ <b>تنبيه هام جداً:</b><br>يرجى الانتظار وعدم إغلاق الصفحة حتى ينتهي الإعلان بالكامل لكي يتم احتساب نقاطك تلقائياً!
    </div>
    <button id="adBtn" onclick="triggerAd()">▶️ عرض الإعلان الآن</button>
  </div>
  <script>
    const tg = window.Telegram.WebApp;
    tg.expand();
    const btnEl = document.getElementById('adBtn');
    const alertBox = document.getElementById('alertBox');

    function triggerAd() {
      btnEl.disabled = true;
      btnEl.textContent = '⏳ جاري عرض الإعلان... يرجى الانتظار';
      alertBox.style.display = 'block';

      if (typeof show_12268522 === 'function') {
        show_12268522().then(() => {
          claimReward();
        }).catch((e) => {
          alert('تعذر عرض الإعلان حالياً، حاول مجدداً.');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ عرض الإعلان الآن';
          alertBox.style.display = 'none';
        });
      } else {
        setTimeout(() => { claimReward(); }, 4000);
      }
    }

    async function claimReward() {
      try {
        const res = await fetch('/api/claim-ad-reward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '${userId}' })
        });
        const data = await res.json();
        if (data.ok) {
          alert('🎉 مبروك! تمت إضافة النقاط بنجاح.');
          tg.close();
        } else {
          alert('حدث خطأ، حاول مجدداً');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ عرض الإعلان الآن';
          alertBox.style.display = 'none';
        }
      } catch (e) {
        alert('خطأ في الاتصال بالسيرفر');
        btnEl.disabled = false;
        btnEl.textContent = '▶️ عرض الإعلان الآن';
        alertBox.style.display = 'none';
      }
    }
  </script>
</body>
</html>`);
});

app.post('/api/claim-ad-reward', async (req, res) => {
  const userId = Number(req.body.userId);
  if (!userId) return res.status(400).json({ ok: false });

  try {
    const { data: rows } = await fatherSupabase.from('users').select('*').eq('id', userId).limit(1);
    const user = rows && rows.length > 0 ? rows[0] : null;
    if (!user) return res.status(404).json({ ok: false });

    const rewardPoints = Number(await getFatherSetting('ad_reward_points', '25'));
    const newPoints = (user.points || 0) + rewardPoints;
    await fatherSupabase.from('users').update({ points: newPoints }).eq('id', userId);

    await bot.telegram.sendMessage(
      userId,
      `🎉 <b>مبروك! تمت إضافة +${rewardPoints} نقطة إلى رصيدك بعد مشاهدة الإعلان.</b>\n🪙 <b>رصيدك الحالي:</b> ${newPoints} نقطة.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    res.json({ ok: true, points: newPoints });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// 🎯 التوجيه الصارم حسب الصلاحية (أدمن <-> يوزرز)
bot.start(async (ctx) => {
  return handleUserStart(ctx, WEBHOOK_DOMAIN);
});

bot.on('contact', async (ctx) => {
  return handleUserContact(ctx);
});

bot.on('callback_query', async (ctx) => {
  const role = await resolveRole(ctx.from?.id);
  if (role === 'admin') {
    await handleAdminCallbackQuery(ctx);
    return;
  }
  await handleUserCallbackQuery(ctx);
});

bot.on('text', async (ctx) => {
  const role = await resolveRole(ctx.from?.id);
  if (role === 'admin') {
    await handleAdminText(ctx);
    return;
  }
  await handleUserText(ctx, WEBHOOK_DOMAIN);
});

bot.on('photo', async (ctx) => {
  const role = await resolveRole(ctx.from?.id);
  if (role === 'admin') {
    await handleAdminPhoto(ctx);
    return;
  }
  await handleUserPhoto(ctx);
});

bot.on('video', async (ctx) => {
  const role = await resolveRole(ctx.from?.id);
  if (role === 'admin') {
    await handleAdminVideo(ctx);
    return;
  }
  await handleUserVideo(ctx);
});

const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Father Router System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
