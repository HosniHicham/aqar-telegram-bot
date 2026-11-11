const { Telegraf, Markup } = require('telegraf');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is missing!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// رسالة الترحيب الاحترافية مع الأزرار التفاعلية
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  
  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `المنصة الأولى للبحث عن العقارات وعرضها بكل سهولة وسرعة.\n\n` +
    `اختر إحدى الخدمات أدناه لنبدأ معاً:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 البحث عن عقار', 'search_property')],
        [Markup.button.callback('🏠 إضافة عقار جديد', 'add_property')],
        [Markup.button.callback('📞 تواصل مع الإدارة', 'contact_admin')]
      ])
    }
  );
});

// التعامل مع نقرات الأزرار التفاعلية
bot.action('search_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🔍 عظيم! قريباً سنضيف مفاصل البحث حسب الولاية والنوع. ما هي المدينة التي تبحث فيها عن عقار؟');
});

bot.action('add_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏠 لإضافة عقار جديد، يرجى إرسال تفاصيل العقار (النوع، الواية، السعر، ورقم الهاتف للتواصل).');
});

bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 يمكنك مراسلة الإدارة مباشرة عبر هذا البريد أو الحساب الرسمي للاستفسارات.');
});

// إعداد الويب هوك (Webhook) أو التشغيل المحلي
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Telegram Bot is running via Webhook! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  // للتشغيل والتطوير المحلي عند الحاجة
  bot.launch();
  console.log('Bot is running in polling mode.');
}

// إيقاف آمن للسيرفر
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
