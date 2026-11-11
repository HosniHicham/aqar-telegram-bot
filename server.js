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

// 1. أمر الترحيب الرئيسي /start مع واجهة أزرار تفاعلية احترافية
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  
  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `المنصة الاحترافية الأولى للبحث عن العقارات، بيعها، وإدارتها بكل سهولة وسرعة.\n\n` +
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

// 2. أمر المساعدة /help
bot.help((ctx) => {
  ctx.reply(
    `🛠 <b>قائمة المساعدة - منصة عقار:</b>\n\n` +
    `/start - بدء استخدام البوت وعرض القائمة الرئيسية.\n` +
    `/services - عرض الخدمات المتاحة.\n` +
    `/about - نبذة عن المنصة.\n\n` +
    `يمكنك دائماً استخدام الأزرار التفاعلية لتجربة أسرع!`,
    { parse_mode: 'HTML' }
  );
});

// 3. أمر الخدمات /services
bot.command('services', (ctx) => {
  ctx.reply(
    `📋 <b>خدماتنا العقارية المتكاملة:</b>\n\n` +
    `1️⃣ تصفح العقارات المتاحة (شقق، أراضي، بيوت).\n` +
    `2️⃣ إضافة عقارات جديدة بعرضها للمستارين والمالكين.\n` +
    `3️⃣ ربط مباشر مع الملاك والوسطاء.\n` +
    `4️⃣ نظام إشعارات فوري للأدمن.`
  );
});

// 4. أمر التعريف بالمنصة /about
bot.command('about', (ctx) => {
  ctx.reply('🏢 منصة عقار الجزائر (Aqar) هي مساعدك الذكي لتنظيم وتسهيل معاملاتك العقارية بأمان وسرعة فائقة عبر تليجرام السحابي. 🚀');
});

// --- معالجة نقرات الأزرار التفاعلية (Inline Buttons) ---
bot.action('search_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🔍 <b>البحث عن عقار:</b>\n\n` +
    `قريباً سيتم ربط البحث بقاعدة البيانات حسب الولاية ونوع العقار. ` +
    `ما هي الولاية أو المدينة التي تبحث فيها حالياً؟`,
    { parse_mode: 'HTML' }
  );
});

bot.action('add_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🏠 <b>إضافة عقار جديد:</b>\n\n` +
    `لإضافة عقارك، يرجى إرسال تفاصيل الإعلان بالشكل التالي:\n` +
    `- نوع العقار (شقة، منزل، قطعة أرض)\n` +
    `- الولاية والمنطقة\n` +
    `- السعر المطلوب\n` +
    `- رقم الهاتف للتواصل`,
    { parse_mode: 'HTML' }
  );
});

bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 للاتصال المباشر بالإدارة أو الاستفسارات الخاصة، يترك طلبك هنا وسيقوم فريق الدعم بمراجعته والرد عليك قريباً.');
});

// إعداد خادم Express للتشغيل عبر الويب هوك (Webhook) على Render
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Telegram Bot is running smoothly via Webhook! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook enabled.`);
  });
} else {
  // للتشغيل المحلي (Polling) عند الحاجة للتطوير على جهازك
  bot.launch();
  console.log('Bot is running in polling mode.');
}

// الإيقاف الآمن للسيرفر
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
