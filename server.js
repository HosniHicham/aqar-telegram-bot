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

// ذاكرة تتبع الجلسات واللغة
const userState = {};
const userLang = {};

// 🎛 لوحة الأزرار الثابتة بأسفل الشاشة (لا تختفي أبداً)
function getMainMenuKeyboard(lang = 'ar') {
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🔍 تصفح العقارات المتاحة' : '🔍 Parcourir les biens', isAr ? '➕ إضافة عقار جديد' : '➕ Ajouter un bien'],
    [isAr ? '📞 الدعم والإدارة' : '📞 Support & Contact', isAr ? '🌐 تغيير اللغة / Langue' : '🌐 Langue / اللغة'],
    [isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos']
  ]).resize();
}

// 1. أمر الترحيب /start
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];
  userLang[userId] = userLang[userId] || 'ar';

  ctx.reply(
    `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر الذكية (Aqar)</b> 🏠✨\n\n` +
    `النظام المستقل والأول من نوعه لإدارة المعاملات والعروض العقارية بسرعة فائقة ومعالجة آمنة للبيانات.\n\n` +
    `استخدم الأزرار المثبتة أسفل الشاشة للتنقل في أي وقت:`,
    {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userLang[userId])
    }
  );
});

// 2. تصفح العقارات المسجلة
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  const userId = ctx.from.id;
  delete userState[userId];

  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('*')
      .order('id', { ascending: false })
      .limit(6);

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد عقارات مسجلة حالياً في النظام.');
    }

    let responseText = `🏛 <b>أحدث العروض العقارية المنشورة:</b>\n\n`;
    data.forEach((item, index) => {
      responseText += `<b>${index + 1}. ${item.property_type || 'عقار'} - ${item.state_name || 'الجزائر'}</b>\n`;
      responseText += `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n`;
      responseText += `📞 <b>التواصل:</b> ${item.phone || 'متوفر عبر الإدارة'}\n`;
      responseText += `📝 <b>التفاصيل:</b> ${item.description || item.message || 'بدون تفاصيل إضافية'}\n`;
      
      if (item.image_url && item.image_url !== 'EMPTY') {
        responseText += `🖼 <a href="${item.image_url}">معاينة الصورة المرفقة</a>\n`;
      }
      if (item.video_url && item.video_url !== 'EMPTY') {
        responseText += `🎬 <a href="${item.video_url}">معاينة الفيديو المرفق</a>\n`;
      }
      responseText += `-----------------------------------\n`;
    });

    await ctx.reply(responseText, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب العروض، يرجى إعادة المحاولة.');
  }
});

// 3. بدء إضافة عقار جديد
bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  const userId = ctx.from.id;
  
  userState[userId] = {
    step: 'waiting_for_type',
    data: {}
  };

  await ctx.reply(
    `🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 6)</b>\n\n` +
    `اختر أو أكتب <b>نوع العقار</b> (مثال: شقة F3، فيلا، محل تجاري، قطعة أرض...):`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('شقة 🏢', 'type_apartment'), Markup.button.callback('فيلا 🏡', 'type_villa')],
        [Markup.button.callback('قطعة أرض 📐', 'type_land'), Markup.button.callback('محل تجاري 🏪', 'type_store')]
      ])
    }
  );
});

// اختيار النوع عبر الأزرار السريعة
bot.action(/type_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const typesMap = {
    apartment: 'شقة',
    villa: 'فيلا',
    land: 'قطعة أرض',
    store: 'محل تجاري'
  };
  const selectedType = typesMap[ctx.match[1]] || 'عقار';

  if (!userState[userId]) userState[userId] = { data: {} };
  userState[userId].data.property_type = selectedType;
  userState[userId].step = 'waiting_for_state';

  await ctx.reply(
    `✅ تم تحديد النوع: <b>${selectedType}</b>\n\n` +
    `📍 <b>الخطوة (2 من 6):</b> حدد أو أكتب <b>اسم الولاية أو البلدية</b>:`,
    { parse_mode: 'HTML' }
  );
});

// 4. تغيير اللغة
bot.hears(['🌐 تغيير اللغة / Langue', '🌐 Langue / اللغة'], async (ctx) => {
  ctx.reply(
    `🌐 <b>اختر لغة النظام / Choisir la langue:</b>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🇩🇿 العربية', 'set_lang_ar'), Markup.button.callback('🇫🇷 Français', 'set_lang_fr')]
      ])
    }
  );
});

bot.action('set_lang_ar', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'ar';
  await ctx.reply('✅ تم اعتمادات اللغة العربية لنظام البوت.', getMainMenuKeyboard('ar'));
});

bot.action('set_lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  await ctx.reply('✅ la langue française a été activée.', getMainMenuKeyboard('fr'));
});

// 5. الدعم وحول المنصة
bot.hears(['📞 الدعم والإدارة', '📞 Support & Contact'], async (ctx) => {
  await ctx.reply(
    `📞 <b>مركز التواصل والدعم الفني:</b>\n\n` +
    `فريق تطوير منصة عقار الجزائر في خدمتك لتقديم والاستفسارات أو الدعم المباشر.\n` +
    `تواصل معنا مباشرة عبر المعرف الرسمية للاستفسارات الفنية.`,
    { parse_mode: 'HTML' }
  );
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], async (ctx) => {
  await ctx.reply(
    `🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\n` +
    `نظام رقمي ذكي مطور بأحدث المعايير البرمجية لتسهيل وتنظيم المعاملات العقارية وإدارة العروض بسرعة فائقة وتخزين سحابي آمن.`,
    { parse_mode: 'HTML' }
  );
});

// 6. محرك معالجة النصوص للخطوات المتتالية
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();

  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  // خطوة 1: النوع (إذا كتبه بدلاً من الضغط على الأزرار)
  if (state.step === 'waiting_for_type') {
    state.data.property_type = userText;
    state.step = 'waiting_for_state';
    return ctx.reply(
      `✅ نوع العقار: <b>${userText}</b>\n\n` +
      `📍 <b>الخطوة (2 من 6):</b> أدخل <b>اسم الولاية أو المدينة</b>:`,
      { parse_mode: 'HTML' }
    );
  }

  // خطوة 2: الولاية
  else if (state.step === 'waiting_for_state') {
    state.data.state_name = userText;
    state.step = 'waiting_for_price';
    return ctx.reply(
      `✅ الموقع: <b>${userText}</b>\n\n` +
      `💰 <b>الخطوة (3 من 6):</b> أدخل <b>السعر المطلوب</b> (مثال: 1.2 مليار، أو 6 ملايين/شهر):`,
      { parse_mode: 'HTML' }
    );
  }

  // خطوة 3: السعر
  else if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(
      `✅ السعر: <b>${userText}</b>\n\n` +
      `📞 <b>الخطوة (4 من 6):</b> أدخل <b>رقم الهاتف للتواصل</b>:`,
      { parse_mode: 'HTML' }
    );
  }

  // خطوة 4: الهاتف
  else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(
      `✅ رقم الهاتف: <b>${userText}</b>\n\n` +
      `📝 <b>الخطوة (5 من 6):</b> أدخل <b>الوصف التفصيلي للعقار</b> (المساحة، الوثائق، المميزات...):`,
      { parse_mode: 'HTML' }
    );
  }

  // خطوة 5: الوصف
  else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply(
      `✅ تم تسجيل كافة البيانات بنجاح!\n\n` +
      `📸 <b>الخطوة الأخيرة (6 من 6):</b> أرسل الآن <b>صورة أو فيديو العقار</b> لإتمام النشر.`,
      { parse_mode: 'HTML' }
    );
  }
});

// 7. معالجة رفع الصور
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري رفع الوسائط ومعالجة وتوثيق البيانات في النظام...');

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());

      const fileName = `${Date.now()}_aqar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('test_media')
        .upload(fileName, buffer, { contentType: 'image/jpeg' });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicURLData } = supabase.storage
        .from('test_media')
        .getPublicUrl(fileName);

      const propData = state.data;

      const { error: dbError } = await supabase
        .from('test_messages')
        .insert([{ 
          property_type: propData.property_type,
          state_name: propData.state_name,
          price: propData.price,
          phone: propData.phone,
          description: propData.description,
          message: propData.description,
          image_url: publicURLData.publicUrl, 
          video_url: 'EMPTY' 
        }]);

      if (dbError) throw new Error(dbError.message);

      delete userState[userId];

      await ctx.reply(
        `🎉 <b>تم نشر وثيقة العقار بنجاح في المنصة!</b>\n\n` +
        `🏠 <b>النوع:</b> ${propData.property_type}\n` +
        `📍 <b>الولاية:</b> ${propData.state_name}\n` +
        `💰 <b>السعر:</b> ${propData.price}\n` +
        `📞 <b>الهاتف:</b> ${propData.phone}\n` +
        `📝 <b>الوصف:</b> ${propData.description}\n` +
        `🖼 <b>الوسائط:</b> تم الربط والتخزين السحابي بنجاح.`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard(userLang[userId] || 'ar') }
      );

    } catch (err) {
      console.error('Save Error:', err);
      await ctx.reply('⚠️ حدث خطأ أثناء معالجة الوسائط، يرجى المحاولة مرة أخرى.');
      delete userState[userId];
    }
  } else {
    await ctx.reply('📸 أرسلت صورة، يمكنك استخدام قائمة الأزرار بالأسفل لتشغيل خدمات المنصة.');
  }
});

// 8. معالجة رفع الفيديوهات
bot.on('video', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري رفع الفيديو وتخزينه في المعالجة السحابية...');

      const video = ctx.message.video;
      const fileLink = await ctx.telegram.getFileLink(video.file_id);
      
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());

      const fileName = `${Date.now()}_aqar.mp4`;

      const { error: uploadError } = await supabase.storage
        .from('test_media')
        .upload(fileName, buffer, { contentType: 'video/mp4' });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicURLData } = supabase.storage
        .from('test_media')
        .getPublicUrl(fileName);

      const propData = state.data;

      const { error: dbError } = await supabase
        .from('test_messages')
        .insert([{ 
          property_type: propData.property_type,
          state_name: propData.state_name,
          price: propData.price,
          phone: propData.phone,
          description: propData.description,
          message: propData.description,
          image_url: 'EMPTY',
          video_url: publicURLData.publicUrl 
        }]);

      if (dbError) throw new Error(dbError.message);

      delete userState[userId];

      await ctx.reply(
        `🎉 <b>تم نشر العقار ومقطع الفيديو بنجاح!</b>\n\n` +
        `🏠 <b>النوع:</b> ${propData.property_type}\n` +
        `📍 <b>الولاية:</b> ${propData.state_name}\n` +
        `💰 <b>السعر:</b> ${propData.price}\n` +
        `📞 <b>الهاتف:</b> ${propData.phone}\n` +
        `🎬 <b>الفيديو:</b> تم الربط والتخزين بنجاح.`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard(userLang[userId] || 'ar') }
      );

    } catch (err) {
      console.error('Save Video Error:', err);
      await ctx.reply('⚠️ حدث خطأ أثناء معالجة مقطع الفيديو.');
      delete userState[userId];
    }
  }
});

// تشغيل خادم الويب
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Algeria Private System is online 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  bot.launch();
}
