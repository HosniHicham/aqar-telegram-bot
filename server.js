const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

// إعداد روابط ومفاتيح Supabase المباشرة بشكل صحيح وبدون أخطاء
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is missing!');
  process.exit(1);
}

// تهيئة Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// الترحيب الرئيسي
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
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

// حفظ أي نص يرسله المستخدم في جدول Supabase (تجريبي)
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  
  // تجاهل الأوامر التي تبدأ بـ /
  if (userText.startsWith('/')) return;

  try {
    // إدخال البيانات في جدول test_messages
    const { data, error } = await supabase
      .from('test_messages')
      .insert([{ message: userText, image_url: 'EMPTY' }]);

    if (error) {
      console.error('Supabase Error:', error.message);
      await ctx.reply('⚠️ حدث خطأ أثناء حفظ رسالتك في قاعدة البيانات.');
    } else {
      await ctx.reply(`✅ تم استلام رسالتك وحفظها بنجاح في قاعدة البيانات:\n"${userText}"`);
    }
  } catch (err) {
    console.error('Server Error:', err);
  }
});

// أزرار التفاعل
bot.action('search_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🔍 ما هي الولاية أو المدينة التي تبحث فيها عن عقار؟');
});

bot.action('add_property', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏠 أرسل لي تفاصيل العقار (النوع، السعر، الولاية) وسيتم حفظه تلقائياً.');
});

bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 سيتم تحويل طلبك للإدارة قريباً.');
});

// إعداد خادم الويب هوك
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Telegram Bot with Supabase is running! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  bot.launch();
}
