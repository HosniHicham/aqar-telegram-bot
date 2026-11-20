'use strict';

const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const { handleUserMessage } = require('./users');
const { handleAdminMessage } = require('./admin');

const PORT = process.env.PORT || 4000;
const BOT_TOKEN = process.env.FATHER_BOT_TOKEN || process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

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

bot.on('message', async (ctx) => {
  const senderId = ctx.from?.id;
  if (!senderId) return;

  const adminIds = await getAdminIdsFromAppSettings();
  const isAdmin = adminIds.includes(Number(senderId));

  if (isAdmin) {
    await handleAdminMessage(ctx);
  } else {
    await handleUserMessage(ctx);
  }
});

app.get('/', (req, res) => {
  res.send('Father Server is online');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Father Server running on port ${PORT}`);
});

bot.launch().catch(err => {
  console.error('Bot launch error:', err.message);
});
