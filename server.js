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

// ذاكرة مؤقتة لتتبع خطوات إدخال البيانات لكل مستخدم بدقة تامة
const userState = {};

// 1. الترحيب الرئيسي
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  delete userState[ctx.from.id];
  
  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `المنصة الاحترافية لإدارة وعرض العقارات ببيانات منظمة.\n\n` +
    `اختر إحدى الخدمات أدناه لنبدأ معاً:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 تصفح العقارات المتاحة', 'list_properties')],
        [Markup.button.callback('🏠 إضافة عقار جديد (بخطوات منظمة)', 'add_property_start')],
        [Markup.button.callback('📞 تواصل مع الإدارة', 'contact_admin')]
      ])
    }
  );
});

// 2. بدء عملية إضافة عقار (الخطوة 1: طلب نوع العقار)
bot.action('add_property_start', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  
  // تهيئة كائن بيانات العقار لهذا المستخدم وتحديد الخطوة الأولى
  userState[userId] = {
    step: 'waiting_for_type',
    data: {}
  };

  await ctx.reply(
    `🏠 <b>معالج إضافة عقار جديد (1/5)</b>\n\n` +
    `الرجاء إرسال <b>نوع العقار</b> (مثال: شقة F3، منزل مستقل، قطعة أرض، استوديو...):`,
    { parse_mode: 'HTML' }
  );
});

// 3. تصفح العقارات وجلب الأعمدة المنظمة من القاعدة
bot.action('list_properties', async (ctx) => {
  await ctx.answerCbQuery();
  
  try {
    const { data, error } = await supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(5);

    if (error || !data || data.length === 0) {
      return ctx.reply('𭭉 عذراً، لا توجد عقارات مسجلة حالياً في قاعدة البيانات.');
    }

    let responseText = `📋 <b>آخر العقارات المسجلة ببياناتها التفصيلية:</b>\n\n`;
    data.forEach((item, index) => {
      responseText += `<b>${index + 1}. النوع:</b> ${item.property_type || 'عقار'} | <b>الولاية:</b> ${item.state_name || 'غير محدد'}\n`;
      responseText += `💰 <b>السعر:</b> ${item.price || 'غير محدد'} | 📞 <b>الهاتف:</b> ${item.phone || 'غير مسجل'}\n`;
      responseText += `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون وصف'}\n`;
      if (item.image_url && item.image_url !== 'EMPTY') {
        responseText += `🖼 <a href="${item.image_url}">رابط صورة العقار</a>\n`;
      }
      responseText += `-----------------------------------\n`;
    });

    await ctx.reply(responseText, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب العقارات.');
  }
});

bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 يمكنك إرسال استفسارك وسيقوم فريق الدعم بمراجعته في أقرب وقت.');
});

// 4. معالجة المدخلات النصية خطوة بخطوة (State Machine)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();

  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) {
    return ctx.reply('💡 استخدم الأزرار التفاعلية بالأسفل أو اضغط /start للرجوع للقائمة الرئيسية.');
  }

  // الخطوة 1: استقبال نوع العقار والنتقل لطلب الولاية
  if (state.step === 'waiting_for_type') {
    state.data.property_type = userText;
    state.step = 'waiting_for_state';
    return ctx.reply(
      `✅ نوع العقار: <b>${userText}</b>\n\n` +
      `📍 <b>الخطوة (2/5):</b> أرسل الآن <b>اسم الولاية أو المدينة</b> التي يتواجد بها العقار:`,
      { parse_mode: 'HTML' }
    );
  }

  // الخطوة 2: استقبال الولاية والانتقال لطلب السعر
  else if (state.step === 'waiting_for_state') {
    state.data.state_name = userText;
    state.step = 'waiting_for_price';
    return ctx.reply(
      `✅ الولاية: <b>${userText}</b>\n\n` +
      `💰 <b>الخطوة (3/5):</b> أرسل الآن <b>السعر المطلوب</b> (مثال: 950 مليون، أو 8 ملايين سنتيم للكراء):`,
      { parse_mode: 'HTML' }
    );
  }

  // الخطوة 3: استقبال السعر والانتقال لطلب رقم الهاتف
  else if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(
      `✅ السعر: <b>${userText}</b>\n\n` +
      `📞 <b>الخطوة (4/5):</b> أرسل الآن <b>رقم الهاتف للتواصل</b> مع المالك أو الوسيط:`,
      { parse_mode: 'HTML' }
    );
  }

  // الخطوة 4: استقبال رقم الهاتف والانتقال لطلب الوصف التفصيلي
  else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(
      `✅ رقم الهاتف: <b>${userText}</b>\n\n` +
      `📝 <b>الخطوة (5/5 قبل الأخيرة):</b> أرسل الآن <b>وصفاً تفصيلياً أو ملاحظات إضافية</b> عن العقار:`,
      { parse_mode: 'HTML' }
    );
  }

  // الخطوة 5: استقبال الوصف والانتقال لمرحلة انتظار رفع الصورة
  else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_image';
    return ctx.reply(
      `✅ تم حفظ الوصف بنجاح!\n\n` +
      `📸 <b>المرحلة الأخيرة:</b> أرسل الآن <b>صورة العقار</b> (مرسلة كصورة Photo في المحادثة) ليتم رفعها وربط كافة البيانات معا في قاعدة البيانات.`,
      { parse_mode: 'HTML' }
    );
  }
});

// 5. استقبال الصورة، تجميع كافة البيانات المدخلة، وحفظها دفعة واحدة في الأعمدة المخصصة
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_image') {
    try {
      await ctx.reply('⏳ جاري رفع الصورة ومعالجة البيانات وحفظها في قاعدة البيانات...');

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      
      const response = await fetch(fileLink.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const fileName = `${Date.now()}_aqar_prop.jpg`;

      // رفع الصورة إلى Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('test_media')
        .upload(fileName, buffer, { contentType: 'image/jpeg' });

      if (uploadError) throw new Error(uploadError.message);

      const { data: publicURLData } = supabase.storage
        .from('test_media')
        .getPublicUrl(fileName);

      const mediaUrl = publicURLData.publicUrl;
      const propData = state.data;

      // إدخال البيانات الاحترافية في الأعمدة المنظمة بجدول Supabase
      const { error: dbError } = await supabase
        .from('test_messages')
        .insert([{ 
          property_type: propData.property_type,
          state_name: propData.state_name,
          price: propData.price,
          phone: propData.phone,
          description: propData.description,
          message: propData.description, // كاحتياط للتوافق مع الجدول القديم
          image_url: mediaUrl, 
          video_url: 'EMPTY' 
        }]);

      if (dbError) throw new Error(dbError.message);

      delete userState[userId];

      await ctx.reply(
        `🎉 <b>تم نشر العقار بنجاح وتخزين كافة البيانات في أعمدة قاعدة البيانات!</b>\n\n` +
        `🏠 <b>النوع:</b> ${propData.property_type}\n` +
        `📍 <b>الولاية:</b> ${propData.state_name}\n` +
        `💰 <b>السعر:</b> ${propData.price}\n` +
        `📞 <b>الهاتف:</b> ${propData.phone}\n` +
        `📝 <b>الوصف:</b> ${propData.description}\n` +
        `🖼 <b>الصورة:</b> تم ربطها بنجاح عبر السحابة.`,
        { parse_mode: 'HTML' }
      );

    } catch (err) {
      console.error('Error saving structured property:', err);
      await ctx.reply('⚠️ حدث خطأ أثناء المعالجة أو الحفظ. حاول مرة أخرى.');
      delete userState[userId];
    }
  } else {
    await ctx.reply('📸 أرسلت صورة، ولكن يرجى الضغط على زر "إضافة عقار جديد" لإدخال التفاصيل أولاً.');
  }
});

const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Professional Multi-Step Bot is running! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  bot.launch();
}
