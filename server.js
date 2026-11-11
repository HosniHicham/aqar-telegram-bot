const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// تخزين لغة المستخدم المؤقتة (افتراضياً العربية)
const userLang = {};

// 1. أمر البداية /start مع اختيار اللغة
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  userLang[ctx.from.id] = 'ar'; // اللغة الافتراضية

  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `المنصة الأولى لإدارة وعرض العقارات عبر السحابة.\n` +
    `الرجاء اختيار لغة التفضيل لنبدأ معاً:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🇩🇿 العربية', 'lang_ar'),
          Markup.button.callback('🇫🇷 Français', 'lang_fr')
        ]
      ])
    }
  );
});

// تغيير اللغة إلى العربية وعرض القائمة الاحترافية الكبرى
bot.action('lang_ar', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'ar';
  showMainMenu(ctx, 'ar');
});

// تغيير اللغة إلى الفرنسية وعرض القائمة
bot.action('lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  showMainMenu(ctx, 'fr');
});

// دالة عرض القائمة الرئيسية بأزرار عديدة واحترافية
function showMainMenu(ctx, lang) {
  const isAr = lang === 'ar';
  
  const text = isAr 
    ? `🏠 <b>القائمة الرئيسية - منصة عقار الجزائر</b>\n\nاختر الخدمة المطلوبة أدناه:`
    : `🏠 <b>Menu Principal - Aqar Algérie</b>\n\nSélectionnez un service ci-dessous:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(isAr ? '🔍 تصفح العقارات المسجلة' : '🔍 Parcourir les biens', 'list_properties')],
    [Markup.button.callback(isAr ? '📸 إضافة عقار بصورة/فيديو' : '📸 Ajouter un bien (Médias)', 'info_add')],
    [Markup.button.callback(isAr ? '🌍 تغيير اللغة / Changer Langue' : '🌍 Changer Langue / تغيير اللغة', 'change_lang')],
    [Markup.button.callback(isAr ? 'ℹ️ حول المنصة' : 'ℹ️ À propos', 'about_platform'),
     Markup.button.callback(isAr ? '📞 تواصل مع الإدارة' : '📞 Contact Support', 'contact_admin')]
  ]);

  // التحقق مما إذا كان الطلب ناتجاً عن ضغطة زر (callback) أو رسالة عادية
  if (ctx.callbackQuery) {
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// العودة للقائمة الرئيسية عبر الأزرار
bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const lang = userLang[ctx.from.id] || 'ar';
  showMainMenu(ctx, lang);
});

// زر تغيير اللغة
bot.action('change_lang', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageText(
    `🌍 <b>اختر لغة العرض / Choisir la langue:</b>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🇩🇿 العربية', 'lang_ar'),
          Markup.button.callback('🇫🇷 Français', 'lang_fr')
        ],
        [Markup.button.callback('🔙 رجوع للقائمة', 'main_menu')]
      ])
    }
  );
});

// معلومات الإضافة
bot.action('info_add', async (ctx) => {
  await ctx.answerCbQuery();
  const lang = userLang[ctx.from.id] || 'ar';
  const msg = lang === 'ar'
    ? `📸 <b>طريقة الإضافة المباشرة:</b>\n\nقم ببساطة بإرسال **صورة أو فيديو مع كتابة التفاصيل في تعليق (Caption)**، وسيتم رفع الوسائط وحجز سطر فوري لها في قاعدة بيانات Supabase!`
    : `📸 <b>Mode d'ajout direct:</b>\n\nEnvoyez simplement une **photo ou vidéo avec une description en légende**, et le système l'enregistrera instantanément dans Supabase!`;
  
  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback(lang === 'ar' ? '🔙 رجوع للقائمة' : '🔙 Retour', 'main_menu')]])
  });
});

// حول المنصة
bot.action('about_platform', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🏢 <b>منصة عقار الجزائر (Aqar)</b>\n\n` +
    `نظام ذكي متكامل مدعوم بقواعد بيانات سحابية (Supabase) وربط فوري للوسائط والبيانات لخدمة الوسطاء والمواطنين بأعلى معايير الأمان والسرعة. 🚀`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للقائمة', 'main_menu')]])
    }
  );
});

// تواصل مع الإدارة
bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `📞 للإتصال المباشر بالإدارة:\nالبريد الإلكتروني: support@aqar-algeria.dz\nأو ترقبوا إطلاق الدعم المباشر قريباً.`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للقائمة', 'main_menu')]])
    }
  );
});

// 2. تصفح العقارات من Supabase
bot.action('list_properties', async (ctx) => {
  await ctx.answerCbQuery();
  
  try {
    const { data, error } = await supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(5);

    if (error || !data || data.length === 0) {
      return ctx.reply('𭭉 عذراً، لا توجد سجلات مسجلة حالياً في قاعدة البيانات.');
    }

    let responseText = `📋 <b>آخر العقارات والسجلات المسجلة:</b>\n\n`;
    data.forEach((item, index) => {
      responseText += `<b>${index + 1}. الوصف:</b> ${item.message || 'بدون وصف'}\n`;
      if (item.image_url && item.image_url !== 'EMPTY') {
        responseText += `🖼 <a href="${item.image_url}">رابط الصورة</a>\n`;
      }
      if (item.video_url && item.video_url !== 'EMPTY') {
        responseText += `🎬 <a href="${item.video_url}">رابط الفيديو</a>\n`;
      }
      responseText += `-----------------------------------\n`;
    });

    await ctx.reply(responseText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للقائمة', 'main_menu')]])
    });
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب البيانات.');
  }
});

// 3. معالجة النصوص وحجز سطر
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  if (userText.startsWith('/')) return;

  try {
    const { error } = await supabase
      .from('test_messages')
      .insert([{ message: userText, image_url: 'EMPTY', video_url: 'EMPTY' }]);

    if (error) throw new Error(error.message);

    await ctx.reply(`✅ تم حجز سطر جديد في قاعدة البيانات بنجاح للنص:\n"${userText}"`);
  } catch (err) {
    console.error('DB Error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء الحفظ في قاعدة البيانات.');
  }
});

// 4. معالجة الصور وحجز سطر مع رفع السحابة
bot.on('photo', async (ctx) => {
  try {
    await ctx.reply('⏳ جاري رفع الصورة وحجز سطر جديد في القاعدة...');

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || 'صورة بدون وصف';
    
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());

    const fileName = `${Date.now()}_img.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('test_media')
      .upload(fileName, buffer, { contentType: 'image/jpeg' });

    if (uploadError) throw new Error(uploadError.message);

    const { data: publicURLData } = supabase.storage
      .from('test_media')
      .getPublicUrl(fileName);

    const { error: dbError } = await supabase
      .from('test_messages')
      .insert([{ message: caption, image_url: publicURLData.publicUrl, video_url: 'EMPTY' }]);

    if (dbError) throw new Error(dbError.message);

    await ctx.reply(`🎉 تم رفع الصورة وحجز سطر جديد في قاعدة البيانات بنجاح!\n📝 <b>الوصف:</b> ${caption}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Photo Error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء رفع الصورة.');
  }
});

// 5. معالجة الفيديوهات وحجز سطر مع رفع السحابة
bot.on('video', async (ctx) => {
  try {
    await ctx.reply('⏳ جاري رفع الفيديو وحجز سطر جديد في القاعدة...');

    const video = ctx.message.video;
    const caption = ctx.message.caption || 'فيديو بدون وصف';
    
    const fileLink = await ctx.telegram.getFileLink(video.file_id);
    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());

    const fileName = `${Date.now()}_vid.mp4`;

    const { error: uploadError } = await supabase.storage
      .from('test_media')
      .upload(fileName, buffer, { contentType: 'video/mp4' });

    if (uploadError) throw new Error(uploadError.message);

    const { data: publicURLData } = supabase.storage
      .from('test_media')
      .getPublicUrl(fileName);

    const { error: dbError } = await supabase
      .from('test_messages')
      .insert([{ message: caption, image_url: 'EMPTY', video_url: publicURLData.publicUrl }]);

    if (dbError) throw new Error(dbError.message);

    await ctx.reply(`🎉 تم رفع الفيديو وحجز سطر جديد في قاعدة البيانات بنجاح!\n📝 <b>الوصف:</b> ${caption}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Video Error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء رفع الفيديو.');
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Multi-Language Bot is running! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  bot.launch();
}
