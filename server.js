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

// الولايات المقترحة للإضافة السريعة (بالعربية فقط)
const POPULAR_WILAYAS = [
  'الجزائر العاصمة', 'وهران', 'مستغانم', 'قسنطينة', 
  'عنابة', 'البليدة', 'تلمسان', 'سطيف', 'بجاية'
];

// لوحة المفاتيح الرئيسية البسيطة (عربي 100%)
function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['📱 تأكيد رقم الهاتف', '📞 الدعم والإدارة'],
    ['ℹ️ عن المنصة']
  ]).resize();
}

bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];

  ctx.reply(
    `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠✨\n\nنظام ذكي متطور لإدارة وعروض العقارات.\n\nاستخدم الأزرار أسفل الشاشة للتنقل:`,
    {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard()
    }
  );
});

// 📱 زر مباشر ومبسط لتأكيد رقم الهاتف بضغطة واحدة
bot.hears('📱 تأكيد رقم الهاتف', async (ctx) => {
  await ctx.reply(
    'اضغط على الزر أدناه لمشاركة رقم هاتفك وتأكيد حسابك في المنصة:',
    Markup.keyboard([
      [Markup.button.contactRequest('📱 مشاركة رقم الهاتف')]
    ]).resize().oneTime()
  );
});

// استقبال رقم الهاتف وتخزينه في نفس جدول العقارات (test_messages) للتجربة السريعة
bot.on('contact', async (ctx) => {
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = contact.first_name || '';
  const lastName = contact.last_name || '';
  const username = ctx.from.username ? `@${ctx.from.username}` : 'لا يوجد';
  const userId = ctx.from.id;

  const fullName = `${firstName} ${lastName}`.trim();

  try {
    // إدراج البيانات في نفس جدول test_messages كصف تجريبي
    const { error } = await supabase.from('test_messages').insert([
      {
        property_type: 'تأكيد حساب (تجربة)',
        state_name: fullName,
        price: `ID: ${userId}`,
        phone: phoneNumber,
        description: `الاسم: ${fullName} | المعرّف: ${username} | الهاتف: ${phoneNumber}`,
        message: `بيانات مستخدم جديد: ${fullName}`,
        image_url: 'EMPTY',
        video_url: 'EMPTY'
      }
    ]);

    if (error) throw error;

    await ctx.reply(
      `✅ <b>تمت الإضافة بنجاح في الجدول (تجربة)!</b>\n\n` +
      `👤 <b>الاسم:</b> ${fullName}\n` +
      `📱 <b>الهاتف:</b> <code>${phoneNumber}</code>\n` +
      `🆔 <b>المعرّف:</b> ${userId}`,
      { 
        parse_mode: 'HTML', 
        ...getMainMenuKeyboard() 
      }
    );
  } catch (err) {
    console.error('Save contact to test_messages error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء الحفظ في الجدول.', getMainMenuKeyboard());
  }
});

// 🔍 تصفح العقارات (أزرار الولايات في 3 أعمدة)
bot.hears('🔍 تصفح العقارات المتاحة', async (ctx) => {
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

    chunkedButtons.push([Markup.button.callback('🌐 عرض كافة العقارات (الكل)', 'filter_state_ALL')]);

    await ctx.reply('🔍 <b>اختر الولاية أدناه لعرض العقارات المتوفرة فيها:</b>', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedButtons)
    });
  } catch (err) {
    console.error('Fetch states error:', err);
    ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
  }
});

bot.action(/filter_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
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

    await ctx.editMessageText(`🏛 <b>النتائج (الولاية: ${stateQuery === 'ALL' ? 'الكل' : stateQuery}):</b>`, { parse_mode: 'HTML' });

    for (const item of data) {
      const caption = 
        `🏠 <b>العقار:</b> ${item.property_type || 'عقار'}\n` +
        `📍 <b>الولاية:</b> ${item.state_name || 'غير محدد'}\n` +
        `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
        `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
        `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('📞 اتصال', 'contact_admin')]
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
    await ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
  }
});

// ➕ إضافة عقار جديد
bot.hears('➕ إضافة عقار جديد', async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(
    '🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\nاختر <b>نوع العقار</b> من الأزرار أدناه أو أكتبه يدوياً:',
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
    `✅ تم تحديد النوع: <b>${selectedType}</b>\n\n📍 <b>الخطوة 2:</b> اختر الولاية من الأزرار أو اكتبها يدوياً:`,
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
    `✅ الولاية: <b>${selectedState}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b> (مثال: 1.2 مليار):`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('📞 الدعم والإدارة', async (ctx) => {
  await ctx.reply(
    '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً لأي استفسار تقني أو إداري.',
    { parse_mode: 'HTML', ...getMainMenuKeyboard() }
  );
});

bot.hears('ℹ️ عن المنصة', async (ctx) => {
  await ctx.reply(
    '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات والعروض العقارية.',
    { parse_mode: 'HTML', ...getMainMenuKeyboard() }
  );
});

// معالج النصوص للخطوات
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
    return ctx.reply(`✅ السعر: <b>${userText}</b>\n\n📞 <b>الخطوة 4:</b> أدخل رقم الهاتف للتواصل:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(`✅ رقم الهاتف: <b>${userText}</b>\n\n📝 <b>الخطوة 5:</b> أدخل الوصف التفصيلي للعقار:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply('✅ تم تسجيل البيانات!\n\n📸 <b>الخطوة الأخيرة:</b> أرسل الآن صورة أو فيديو العقار لإتمام النشر.', { parse_mode: 'HTML' });
  }
});

// معالج الصور والفيديوهات
bot.on(['photo', 'video'], async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري الحفظ والنشر السحابي...');
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
      await ctx.reply('🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b>', { parse_mode: 'HTML', ...getMainMenuKeyboard() });
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
  app.get('/', (req, res) => res.send('Aqar Algeria Clean System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
