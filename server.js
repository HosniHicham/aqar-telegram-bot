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

// 📱 لوحة المفاتيح الرئيسية: زر الموقع في الأسفل تماماً وبشكل مباشر ومريح
function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['🔍 تصفح العقارات المتاحة 🏠', '➕ إضافة عقار جديد 📝'],
    ['📞 الدعم الفني والإدارة 🛠️', 'ℹ️ عن المنصة الرقمية'],
    ['🌐 تصفح الموقع الرسمي (البروزر)'] // الزر في الأسفل تماماً كما طلبت
  ]).resize();
}

// زر إجباري لتأكيد الرقم للمستخدمين الجدد
function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 اضغط هنا لمشاركة رقم هاتفك والبدء')]
  ]).resize().oneTime();
}

// دالة التحقق من توثيق المستخدم مسبقاً
async function isUserVerified(telegramId) {
  try {
    const { data } = await supabase
      .from('test_messages')
      .select('*')
      .eq('price', `ID: ${telegramId}`)
      .limit(1);

    return data && data.length > 0;
  } catch (err) {
    return false;
  }
}

// 🌟 نقطة البداية
bot.start(async (ctx) => {
  await ctx.sendChatAction('typing');
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];

  const verified = await isUserVerified(userId);

  if (verified) {
    await ctx.reply(
      `أهلاً بعودتك يا <b>${userName}</b> في <b>منصة عقار الجزائر</b> 🏠✨`,
      { parse_mode: 'HTML', ...getMainMenuKeyboard() }
    );
  } else {
    await ctx.reply(
      `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر</b> 🏠✨\n\n` +
      `للبدء والاستفادة من خدمات المنصة، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`,
      { parse_mode: 'HTML', ...getAuthKeyboard() }
    );
  }
});

// استقبال وتوثيق رقم الهاتف
bot.on('contact', async (ctx) => {
  await ctx.sendChatAction('typing');
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = ctx.from.first_name || '';
  const userId = ctx.from.id;

  try {
    await supabase.from('test_messages').insert([
      {
        property_type: '⭐ توثيق حساب اجباري',
        state_name: firstName,
        price: `ID: ${userId}`,
        phone: phoneNumber,
        description: `هاتف موثق: ${phoneNumber}`,
        message: `تم توثيق مستخدم: ${firstName}`,
        image_url: 'EMPTY',
        video_url: 'EMPTY'
      }
    ]);

    await ctx.reply(
      `🎉 <b>تم توثيق حسابك بنجاح!</b>\n\nأصبح بإامكك استخدام المنصة بكامل ميزاتها الآن:`,
      { parse_mode: 'HTML', ...getMainMenuKeyboard() }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء التوثيق، يرجى المحاولة لاحقاً.');
  }
});

// 🌐 زر الموقع الرسمي في الأسفل (يفتح الرابط في البروزر بضغطة زر واحدة مباشرة بدون تعقيد)
bot.hears('🌐 تصفح الموقع الرسمي (البروزر)', async (ctx) => {
  await ctx.reply(
    '🌐 <b>اضغط على الزر أدناه لفتح المنصة في متصفح الهاتف (Browser):</b>',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🚀 فتح الموقع الآن', 'https://hosnihicham.github.io/testHTML')]
      ])
    }
  );
});

// حماية التحقق من التوثيق
bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
    return next();
  }
  
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة'))) {
    const verified = await isUserVerified(ctx.from.id);
    if (!verified) {
      return ctx.reply('⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:', getAuthKeyboard());
    }
  }
  return next();
});

// 🔍 تصفح العقارات
bot.hears('🔍 تصفح العقارات المتاحة 🏠', async (ctx) => {
  await ctx.sendChatAction('typing');
  const userId = ctx.from.id;
  userState[userId] = { step: 'filtering_state' };

  try {
    const { data } = await supabase.from('test_messages').select('state_name');
    if (!data || data.length === 0) {
      return ctx.reply('📭 لا توجد أي عقارات مسجلة حالياً.');
    }

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
    const buttons = uniqueStates.map(state => Markup.button.callback(`📍 ${state}`, `filter_state_${state}`));
    
    const chunkedButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
      chunkedButtons.push(buttons.slice(i, i + 3));
    }
    chunkedButtons.push([Markup.button.callback('🌐 عرض كافة العقارات (الكل)', 'filter_state_ALL')]);

    await ctx.reply('🔍 <b>اختر الولاية لعرض العقارات:</b>', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedButtons)
    });
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ حدث خطأ في الاتصال.');
  }
});

bot.action(/filter_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('جاري التحميل... ⚡');
  const stateQuery = decodeURIComponent(ctx.match[1]);

  try {
    let query = supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(10);
    if (stateQuery !== 'ALL') query = query.eq('state_name', stateQuery);

    const { data } = await query;
    if (!data || data.length === 0) {
      return ctx.editMessageText('📭 لا توجد عقارات في هذه الولاية حالياً.');
    }

    await ctx.editMessageText(`🏛 <b>النتائج (${stateQuery === 'ALL' ? 'الكل' : stateQuery}):</b>`, { parse_mode: 'HTML' });

    for (const item of data) {
      if (item.property_type === '⭐ توثيق حساب اجباري') continue; // تخطي رسائل التوثيق في العرض

      const caption = 
        `🏠 <b>العقار:</b> ${item.property_type}\n` +
        `📍 <b>الولاية:</b> ${item.state_name}\n` +
        `💰 <b>السعر:</b> ${item.price}\n` +
        `📞 <b>الهاتف:</b> <code>${item.phone}</code>\n` +
        `📝 <b>التفاصيل:</b> ${item.description}`;

      await ctx.reply(caption, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ حدث خطأ أثناء جلب النتائج.');
  }
});

// ➕ إضافة عقار جديد
bot.hears('➕ إضافة عقار جديد 📝', async (ctx) => {
  await ctx.sendChatAction('typing');
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(
    '🏢 <b>معالج نشر عقار (الخطوة 1):</b>\nاختر نوع العقار:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('شقة 🏢', 'type_شقة'), Markup.button.callback('فيلا 🏡', 'type_فيلا')],
        [Markup.button.callback('منزل 🏠', 'type_منزل'), Markup.button.callback('قطعة أرض 📐', 'type_قطعة أرض')]
      ])
    }
  );
});

bot.action(/type_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userState[userId].data.property_type = ctx.match[1];
  userState[userId].step = 'waiting_for_state';

  const wilayaButtons = POPULAR_WILAYAS.map(w => Markup.button.callback(w, `sel_state_${w}`));
  const chunked = [];
  for (let i = 0; i < wilayaButtons.length; i += 3) chunked.push(wilayaButtons.slice(i, i + 3));

  await ctx.editMessageText('📍 <b>الخطوة 2:</b> اختر الولاية:', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(chunked)
  });
});

bot.action(/sel_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userState[userId].data.state_name = ctx.match[1];
  userState[userId].step = 'waiting_for_price';

  await ctx.editMessageText('💰 <b>الخطوة 3:</b> أرسل الآن السعر المطلوب:', { parse_mode: 'HTML' });
});

bot.hears('📞 الدعم الفني والإدارة 🛠️', async (ctx) => {
  await ctx.reply('📞 مركز الدعم التقني في خدمتكم دائماً.', { ...getMainMenuKeyboard() });
});

bot.hears('ℹ️ عن المنصة الرقمية', async (ctx) => {
  await ctx.reply('🏛 منصة عقار الجزائر لإدارة العروض العقارية بكل احترافية.', { ...getMainMenuKeyboard() });
});

// معالج النصوص للخطوات
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  if (state.step === 'waiting_for_state') {
    state.data.state_name = text;
    state.step = 'waiting_for_price';
    return ctx.reply('💰 أرسل السعر المطلوب:');
  } else if (state.step === 'waiting_for_price') {
    state.data.price = text;
    state.step = 'waiting_for_phone';
    return ctx.reply('📞 أدخل رقم الهاتف للتواصل:');
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = text;
    state.step = 'waiting_for_description';
    return ctx.reply('📝 أدخل الوصف التفصيلي للعقار:');
  } else if (state.step === 'waiting_for_description') {
    state.data.description = text;
    state.step = 'waiting_for_media';
    return ctx.reply('📸 أرسل صورة أو فيديو العقار لإتمام النشر النهائي.');
  }
});

// معالج الميديا والنشر
bot.on(['photo', 'video'], async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري النشر...');
      const file = ctx.message.video || ctx.message.photo[ctx.message.photo.length - 1];
      const link = await ctx.telegram.getFileLink(file.file_id);
      const res = await fetch(link.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const name = `${Date.now()}_aqar.${ctx.message.video ? 'mp4' : 'jpg'}`;

      await supabase.storage.from('test_media').upload(name, buf);
      const { data: urlData } = supabase.storage.from('test_media').getPublicUrl(name);

      const p = state.data;
      await supabase.from('test_messages').insert([{
        property_type: p.property_type,
        state_name: p.state_name,
        price: p.price,
        phone: p.phone,
        description: p.description,
        message: p.description,
        image_url: ctx.message.video ? 'EMPTY' : urlData.publicUrl,
        video_url: ctx.message.video ? urlData.publicUrl : 'EMPTY'
      }]);

      delete userState[userId];
      await ctx.reply('🎉 <b>تم نشر الإعلان بنجاح!</b>', { parse_mode: 'HTML', ...getMainMenuKeyboard() });
    } catch (e) {
      console.error(e);
      delete userState[userId];
      await ctx.reply('⚠️ حدث خطأ أثناء النشر.');
    }
  }
});

const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body?.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Bot is running 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server on port ${PORT}`));
} else {
  bot.launch();
}
