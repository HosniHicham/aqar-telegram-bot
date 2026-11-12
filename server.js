'use strict';

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

const userState = {};

const POPULAR_WILAYAS = [
  'الجزائر العاصمة 🏛️', 'وهران 🌅', 'مستغانم 🌊', 
  'قسنطينة 🌉', 'عنابة ⚓', 'البليدة 🌹', 
  'تلمسان 🏰', 'سطيف ❄️', 'بجاية ⛰️'
];

// القائمة الرئيسية الكاملة (تظهر للمستخدمين الموثقين فقط، ومدمج فيها زر الموقع)
function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['🔍 تصفح العقارات المتاحة 🏠', '➕ إضافة عقار جديد 📝'],
    ['🌐 تصفح الموقع الرسمي 🌐'], // زر الموقع المدمج مع أزرار التحكم
    ['📞 الدعم الفني والإدارة 🛠️', 'ℹ️ عن المنصة الرقمية']
  ]).resize();
}

// زر إجباري لتأكيد الرقم للمستخدمين الجدد
function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 اضغط هنا لمشاركة رقم هاتفك والبدء')]
  ]).resize().oneTime();
}

// دالة التحقق من توثيق المستخدم مسبقاً في قاعدة البيانات
async function isUserVerified(telegramId) {
  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('*')
      .eq('price', `ID: ${telegramId}`)
      .limit(1);

    if (data && data.length > 0) return true;
    return false;
  } catch (err) {
    return false;
  }
}

// 🌟 نقطة البداية (التوثيق الإجباري أول مرة)
bot.start(async (ctx) => {
  await ctx.sendChatAction('typing');
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];

  const verified = await isUserVerified(userId);

  if (verified) {
    await ctx.reply(
      `أهلاً بعودتك يا <b>${userName}</b> من جديد في <b>منصة عقار الجزائر</b> 🏠✨\n\n` +
      `<i>حسابك موثق ومفعل. اختر ما يناسبك من القائمة أدناه:</i>`,
      { parse_mode: 'HTML', ...getMainMenuKeyboard() }
    );
  } else {
    await ctx.reply(
      `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
      `⚠️ <b>تنبيه أمني هامة:</b>\n` +
      `للاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً عبر الزر أدناه:`,
      { parse_mode: 'HTML', ...getAuthKeyboard() }
    );
  }
});

// استقبال وتوثيق رقم الهاتف أول مرة
bot.on('contact', async (ctx) => {
  await ctx.sendChatAction('typing');
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = contact.first_name || '';
  const lastName = contact.last_name || '';
  const username = ctx.from.username ? `@${ctx.from.username}` : 'بدون معرف';
  const userId = ctx.from.id;

  const fullName = `${firstName} ${lastName}`.trim();

  try {
    const { error } = await supabase.from('test_messages').insert([
      {
        property_type: '⭐ توثيق حساب اجباري',
        state_name: fullName,
        price: `ID: ${userId}`,
        phone: phoneNumber,
        description: `الاسم: ${fullName} | المعرّف: ${username} | الهاتف: ${phoneNumber}`,
        message: `تم توثيق مستخدم بنجاح: ${fullName}`,
        image_url: 'EMPTY',
        video_url: 'EMPTY'
      }
    ]);

    if (error) throw error;

    await ctx.reply(
      `🎉 <b>تم توثيق حسابك بنجاح تام!</b>\n\n` +
      `📱 الرقم المعتمد: <code>${phoneNumber}</code>\n\n` +
      `<i>أصبح بإمكانك الآن استخدام كافة مميزات المنصة وزيارة الموقع الرسمي عبر الأزرار أدناه:</i>`,
      { 
        parse_mode: 'HTML', 
        ...getMainMenuKeyboard() 
      }
    );
  } catch (err) {
    console.error('Save contact error:', err);
    await ctx.reply('⚠️ حدث خطأ تقني أثناء التوثيق، يرجى الضغط على /start للمحاولة لاحقاً.');
  }
});

// 🌐 معالج زر الموقع الرسمي (يفتح الرابط في المتصفح الخارجي مباشرة)
bot.hears('🌐 تصفح الموقع الرسمي 🌐', async (ctx) => {
  await ctx.reply(
    '🌐 <b>رابط منصة عقار الجزائر (ويب):</b>\n\n' +
    'انقر على الزر أدناه لفتح الموقع الكامل وتصفحه مباشرة في المتصفح الخارجي:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🚀 فتح الموقع في المتصفح', 'https://hosnihicham.github.io/testHTML')]
      ])
    }
  );
});

// حماية إضافية للتحقق من التوثيق قبل أي تفاعل
bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
    return next();
  }
  
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة'))) {
    const verified = await isUserVerified(ctx.from.id);
    if (!verified) {
      return ctx.reply('⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الضغط هنا:', getAuthKeyboard());
    }
  }
  return next();
});

// 🔍 تصفح العقارات المتاحة
bot.hears('🔍 تصفح العقارات المتاحة 🏠', async (ctx) => {
  await ctx.sendChatAction('typing');
  const userId = ctx.from.id;
  userState[userId] = { step: 'filtering_state' };

  try {
    const { data, error } = await supabase.from('test_messages').select('state_name');

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.');
    }

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
    if (uniqueStates.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.');
    }

    const buttons = uniqueStates.map(state => 
      Markup.button.callback(`📍 ${state}`, `filter_state_${state}`)
    );

    const chunkedButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
      chunkedButtons.push(buttons.slice(i, i + 3));
    }

    chunkedButtons.push([Markup.button.callback('🌐 عرض كافة العقارات في المنصة (الكل)', 'filter_state_ALL')]);

    await ctx.reply('🔍 <b>نظام التصفية الجغرافي الذكي:</b>\n\nاختر الولاية أدناه لعرض العقارات المتوفرة فيها فعلياً:', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedButtons)
    });
  } catch (err) {
    console.error('Fetch states error:', err);
    ctx.reply('⚠️ حدث خطأ في الاتصال بالسيرفر.');
  }
});

bot.action(/filter_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('جاري تحميل العقارات... ⚡');
  const stateQuery = decodeURIComponent(ctx.match[1]);
  const userId = ctx.from.id;

  try {
    let query = supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(10);
    if (stateQuery !== 'ALL') {
      query = query.eq('state_name', stateQuery);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return ctx.editMessageText('📭 عذراً، لا توجد أي عقارات مسجلة في هذه الولاية حالياً.');
    }

    await ctx.editMessageText(`🏛 <b>نتائج البحث (الولاية: ${stateQuery === 'ALL' ? 'جميع الولايات' : stateQuery}):</b>`, { parse_mode: 'HTML' });

    for (const item of data) {
      const caption = 
        `🏠 <b>نوع العقار:</b> ${item.property_type || 'عقار'}\n` +
        `📍 <b>الولاية:</b> ${item.state_name || 'غير محدد'}\n` +
        `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
        `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
        `📝 <b>التفاصيل:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('📞 الاتصال بالمالك', 'contact_admin')]
      ]);

      if (item.video_url && item.video_url !== 'EMPTY') {
        try {
          await ctx.replyWithVideo(item.video_url, { caption, parse_mode: 'HTML', ...kb });
        } catch (vErr) {
          await ctx.reply(caption, { parse_mode: 'HTML', ...kb });
        }
      } else if (item.image_url && item.image_url !== 'EMPTY') {
        try {
          await ctx.replyWithPhoto(item.image_url, { caption, parse_mode: 'HTML', ...kb });
        } catch (imgErr) {
          await ctx.reply(caption, { parse_mode: 'HTML', ...kb });
        }
      } else {
        await ctx.reply(caption, { parse_mode: 'HTML', ...kb });
      }
    }
    delete userState[userId];
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب النتائج.');
  }
});

// ➕ إضافة عقار جديد
bot.hears('➕ إضافة عقار جديد 📝', async (ctx) => {
  await ctx.sendChatAction('typing');
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(
    '🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\nاختر <b>نوع العقار</b> من الأزرار الذكية أدناه أو اكتبه يدوياً:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('شقة 🏢', 'type_شقة'), Markup.button.callback('فيلا 🏡', 'type_فيلا')],
        [Markup.button.callback('منزل 🏠', 'type_منزل'), Markup.button.callback('قطعة أرض 📐', 'type_قطعة أرض')],
        [Markup.button.callback('محل تجاري 🏪', 'type_محل تجاري')]
      ])
    }
  );
});

bot.action(/type_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const selectedType = ctx.match[1];

  if (!userState[userId]) userState[userId] = { data: {} };
  userState[userId].data.property_type = selectedType;
  userState[userId].step = 'waiting_for_state';

  const wilayaButtons = POPULAR_WILAYAS.map(w => Markup.button.callback(w, `sel_state_${w}`));
  const chunkedWilayas = [];
  for (let i = 0; i < wilayaButtons.length; i += 3) {
    chunkedWilayas.push(wilayaButtons.slice(i, i + 3));
  }

  await ctx.editMessageText(
    `✅ تم تحديد النوع: <b>${selectedType}</b>\n\n📍 <b>الخطوة 2:</b> اختر ولاية العقار من القائمة أدناه:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedWilayas)
    }
  );
});

bot.action(/sel_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const selectedState = ctx.match[1];

  if (!userState[userId]) userState[userId] = { data: {} };
  userState[userId].data.state_name = selectedState;
  userState[userId].step = 'waiting_for_price';

  await ctx.editMessageText(
    `✅ الولاية: <b>${selectedState}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b> (مثال: 1.2 مليار أو 5 ملايين/شهر):`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('📞 الدعم الفني والإدارة 🛠️', async (ctx) => {
  await ctx.reply(
    '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً للإجابة على استفساراتكم.',
    { parse_mode: 'HTML', ...getMainMenuKeyboard() }
  );
});

bot.hears('ℹ️ عن المنصة الرقمية', async (ctx) => {
  await ctx.reply(
    '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور مصمم خصيصاً لتسهيل عروض المعاملات العقارية في الجزائر.',
    { parse_mode: 'HTML', ...getMainMenuKeyboard() }
  );
});

// معالج خطوات النشر النصية
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();

  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  if (state.step === 'waiting_for_type') {
    state.data.property_type = userText;
    state.step = 'waiting_for_state';

    const wilayaButtons = POPULAR_WILAYAS.map(w => Markup.button.callback(w, `sel_state_${w}`));
    const chunkedWilayas = [];
    for (let i = 0; i < wilayaButtons.length; i += 3) {
      chunkedWilayas.push(wilayaButtons.slice(i, i + 3));
    }

    return ctx.reply(
      `✅ تم تحديد النوع: <b>${userText}</b>\n\n📍 <b>الخطوة 2:</b> اختر الولاية:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(chunkedWilayas) }
    );
  } else if (state.step === 'waiting_for_state') {
    state.data.state_name = userText;
    state.step = 'waiting_for_price';
    return ctx.reply(`✅ الولاية: <b>${userText}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن السعر المطلوب:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(`✅ السعر: <b>${userText}</b>\n\n📞 <b>الخطوة 4:</b> أدخل رقم الهاتف للتواصل مع المعلن:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(`✅ رقم الهاتف: <b>${userText}</b>\n\n📝 <b>الخطوة 5:</b> أدخل الوصف التفصيلي للعقار:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply('✅ تم حفظ كافة البيانات!\n\n📸 <b>الخطوة الأخيرة:</b> أرسل الآن <b>صورة أو فيديو العقار</b> لإتمام النشر.', { parse_mode: 'HTML' });
  }
});

// معالج الميديا (صور وفيديوهات العقار)
bot.on(['photo', 'video'], async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.sendChatAction('upload_photo');
      await ctx.reply('⏳ جاري رفع الملفات والنشر السحابي الآمن...');
      let fileLink, fileExt, contentType, isVideo = false;

      if (ctx.message.video) {
        isVideo = true;
        const video = ctx.message.video;
        fileLink = await ctx.telegram.getFileLink(video.file_id);
        fileExt = 'mp4';
        contentType = 'video/mp4';
      } else {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileLink = await ctx.telegram.getFileLink(photo.file_id);
        fileExt = 'jpg';
        contentType = 'image/jpeg';
      }

      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = `${Date.now()}_aqar.${fileExt}`;

      await supabase.storage.from('test_media').upload(fileName, buffer, { contentType });
      const { data: publicURLData } = supabase.storage.from('test_media').getPublicUrl(fileName);

      const p = state.data;
      await supabase.from('test_messages').insert([{ 
        property_type: p.property_type,
        state_name: p.state_name,
        price: p.price,
        phone: p.phone,
        description: p.description,
        message: p.description,
        image_url: isVideo ? 'EMPTY' : publicURLData.publicUrl, 
        video_url: isVideo ? publicURLData.publicUrl : 'EMPTY'
      }]);

      delete userState[userId];
      await ctx.reply('🎉 <b>مبروك! تم نشر إعلان العقار بنجاح في المنصة وأصبح متاحاً للجميع!</b>', { parse_mode: 'HTML', ...getMainMenuKeyboard() });
    } catch (err) {
      console.error(err);
      delete userState[userId];
      await ctx.reply('⚠️ حدث خطأ أثناء النشر، يرجى المحاولة مرة أخرى.');
    }
  }
});

const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    try {
      if (req.body && req.body.update_id) {
        await bot.handleUpdate(req.body);
      }
    } catch (err) {
      console.error(err);
    }
  });

  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Integrated System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
