const { Telegraf } = require('telegraf');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const bot = new Telegraf(process.env.BOT_TOKEN);

// رسالة ترحيبية بسيطة للتأكد أن البوت يعمل
bot.start((ctx) => {
  ctx.reply('مرحباً بك في منصة عقار (Aqar) - البوت يعمل بنجاح على السحابة! 🚀');
});

// إعداد الـ Webhook ليعمل على Render بدلاً من الاستماع المحلي
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
  const webhookPath = `/webhook/${bot.secretPathComponent()}`;
  bot.createWebhook({ domain: WEBHOOK_DOMAIN, path: webhookPath }).then((webhookCallback) => {
    app.use(webhookCallback);
    console.log(`Webhook configured at ${WEBHOOK_DOMAIN}${webhookPath}`);
  });
} else {
  bot.launch();
  console.log('Bot started in polling mode');
}

app.get('/', (req, res) => {
  res.send('Aqar Telegram Bot is alive and running on Cloud! 🇩🇿');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
