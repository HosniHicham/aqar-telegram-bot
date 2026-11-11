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

// ذاكرة مؤقتة لتتبع حالة المستخدم (لمعرفة هل هو في مرحلة إضافة عقار أم لا)
const userState = {};

// 1. الترحيب الرئيسي
bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  delete userState[ctx.from.id]; // إعادة ضبط الحالة
  
  ctx.reply(
    `مرحباً بك يا <b>${userName}</b> في منصة <b>عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `المنصة الاحترافية لإدارة وعرض العقارات بكل ذكاء.\n\n` +
    `اختر إحدى الخدمات أدناه لنبدأ معاً:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔍 تصفح العقارات المتاحة', 'list_properties')],
        [Markup.button.callback('🏠 إضافة عقار جديد', 'add_property')],
        [Markup.button.callback('📞 تواصل مع الإدارة', 'contact_admin')]
      ])
    }
  );
});

// 2. زر بدء إضافة عقار (الخطوة 1: طلب تفاصيل العقار)
bot.action('add_property', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  
  // تسجيل حالة المستخدم أنه بدأ إضافة عقار
  userState[userId] = { step: 'waiting_for_details' };

  await ctx.reply(
    `🏠 <b>بدء إضافة عقار جديد:</b>\n\n` +
    `الرجاء إرسال تفاصيل العقار الآن (مثال: شقة للبيع في الجزائر العاصمة، السعر، المواصفات...):`,
    { parse_mode: 'HTML' }
  );
});

// 3. زر تصفح العقارات (جلب البيانات من قاعدة البيانات)
bot.action('list_properties', async (ctx) => {
  await ctx.answerCbQuery();
  
  try {
    const { data, error } = await supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(5);

    if (error || !data || data.length === 0) {
      return ctx.reply('𭭉 عذراً، لا توجد عقارات مسجلة حالياً في قاعدة البيانات.');
    }

    let responseText = `📋 <b>آخر العقارات المسجلة في المنصة:</b>\n\n`;
    data.forEach((item, index) => {
      responseText += `<b>${index + 1}. التفاصيل:</b> ${item.message || 'بدون وصف'}\n`;
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

// 4. تواصل مع الإدارة
bot.action('contact_admin', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📞 يمكنك إرسال استفسارك وسيقوم فريق الدعم بمراجعته في أقرب وقت.');
});

// 5. نظام الذكاء والتفاعل مع المدخلات (النصوص والصور) بناءً على حالة المستخدم
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;

  if (userText.startsWith('/')) return;

  // إذا كان المستخدم في مرحلة إضافة تفاصيل العقار
  if (userState[userId] && userState[userId].step === 'waiting_for_details') {
    userState[userId].details = userText;
    userState[userId].step = 'waiting_for_image'; // الانتقال لمرحلة طلب الصورة

    return ctx.reply(
      `✅ تم حفظ التفاصيل بنجاح!\n\n` +
      `الآن، <b>أرسل صورة العقار</b> (قم برفعها وإرسالها كصورة في المحادثة) لربطها مباشرة بالإعلان:`,
      { parse_mode: 'HTML' }
    );
  }

  // إذا أرسل نصاً عادياً وليس في حالة إضافة عقار
  await ctx.reply('💡 استخدم الأزرار التفاعلية بالأسفل أو أرسل /start للرجوع للقائمة الرئيسية.');
});

// 6. التعامل مع الصور المرسلة (وربطها بقاعدة البيانات و Supabase Storage)
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;

  // التحقق هل المستخدم في خطوة انتظار الصورة
  if (userState[userId] && userState[userId].step === 'waiting_for_image') {
    try {
      await ctx.reply('⏳ جاري رفع الصورة وحفظ الإعلان في قاعدة البيانات...');

      // الحصول على أعلى جودة للصورة المرسلة
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;
      
      // جلب رابط ملف الصورة من تليجرام
      const fileLink = await ctx.telegram.getFileLink(fileId);
      
      // تحميل الصورة كـ Buffer من تليجرام
      const response = await fetch(fileLink.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const fileName = `${Date.now()}_aqar_image.jpg`;

      // رفع الصورة إلى Supabase Storage (Bucket: test_media)
      const { error: uploadError } = await supabase.storage
        .from('test_media')
        .upload(fileName, buffer, { contentType: 'image/jpeg' });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // جلب الرابط العام للصورة
      const { data: publicURLData } = supabase.storage
        .from('test_media')
        .getPublicUrl(fileName);

      const mediaUrl = publicURLData.publicUrl;
      const propertyDetails = userState[userId].details;

      // إدخال البيانات نهائياً في جدول test_messages
      const { error: dbError } = await supabase
        .from('test_messages')
        .insert([{ 
          message: propertyDetails, 
          image_url: mediaUrl, 
          video_url: 'EMPTY' 
        }]);

      if (dbError) {
        throw new Error(dbError.message);
      }

      // مسح حالة المستخدم بعد الانتهاء بنجاح
      delete userState[userId];

      await ctx.reply(
        `🎉 <b>تم نشر العقار بنجاح وتم ربطه بالصورة في قاعدة البيانات!</b>\n\n` +
        `📝 <b>الوصف:</b> ${propertyDetails}\n` +
        `🖼 تم تخزين الصورة بنجاح. يمكنك معاينتها عبر تصفح العقارات.`,
        { parse_mode: 'HTML' }
      );

    } catch (err) {
      console.error('Error saving property:', err);
      await ctx.reply('⚠️ حدث خطأ أثناء رفع الصورة أو حفظ البيانات. حاول مرة أخرى.');
      delete userState[userId];
    }
  } else {
    await ctx.reply('📸 أرسلت صورة، ولكن لرفعها كعقار يرجى النقر على زر "إضافة عقار جديد" أولاً.');
  }
});

// إعداد خادم الويب هوك
const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Smart Bot with Supabase Storage is running! 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook.`);
  });
} else {
  bot.launch();
}
