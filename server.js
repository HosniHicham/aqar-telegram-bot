'use strict';

const http = require('node:http');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'aqar_secret_token';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'properties';
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN || !WEBHOOK_DOMAIN) {
  console.error('Error: BOT_TOKEN or WEBHOOK_DOMAIN environment variable is missing!');
  process.exit(1);
}

const WEBHOOK_PATH = '/telegram/webhook';
const WEBHOOK_URL = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// ذاكرة مؤقتة لحفظ حالات المستخدمين أثناء النشر
const userStates = {};

const WILAYAS = [
  'الجزائر', 'وهران', 'قسنطينة', 'عنابة', 'البليدة', 'مستغانم', 
  'سطيف', 'تلمسان', 'باتنة', 'بجاية', 'تيزي وزو', 'الشلف'
];

// لوحة التحكم الرئيسية
function getMainMenu() {
  return Markup.keyboard([
    ['🏠 نشر عقار جديد', '🔎 تصفح العقارات'],
    ['⭐ مفضلتي', '📞 الدعم والإدارة']
  ]).resize();
}

// 1. أمر البداية
bot.start((ctx) => {
  delete userStates[ctx.from.id];
  ctx.reply(
    `أهلاً بك في <b>منصة عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `النظام الذكي لإدارة العقارات. اختر ما تحب من الأزرار بالأسفل:`,
    { parse_mode: 'HTML', ...getMainMenu() }
  );
});

// 2. تصفح العقارات
bot.hears('🔎 تصفح العقارات', async (ctx) => {
  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('*')
      .order('id', { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 لا توجد عقارات مسجلة حالياً في المنصة.');
    }

    await ctx.reply('🔎 <b>أحدث العقارات المتاحة:</b>', { parse_mode: 'HTML' });

    for (const p of data) {
      const caption = 
        `🏠 <b>النوع:</b> ${p.property_type}\n` +
        `📍 <b>الولاية:</b> ${p.state_name}\n` +
        `💰 <b>السعر:</b> ${p.price}\n` +
        `📞 <b>الهاتف:</b> <code>${p.phone}</code>\n` +
        `📝 <b>الوصف:</b> ${p.description}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⭐ حفظ في المفضلة', `fav_${p.id}`)]
      ]);

      if (p.image_url && p.image_url !== 'EMPTY') {
        await ctx.replyWithPhoto(p.image_url, { caption, parse_mode: 'HTML', ...keyboard });
      } else {
        await ctx.reply(caption, { parse_mode: 'HTML', ...keyboard });
      }
    }
  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ حدث خطأ أثناء جلب العقارات.');
  }
});

// 3. بدء عملية نشر عقار (خطوات مبسطة وآمنة)
bot.hears('🏠 نشر عقار جديد', async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { step: 'type', data: {} };

  await ctx.reply(
    `🏢 <b>الخطوة 1:</b> اختر نوع العقار أو اكتبه يدوياً:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('شقة 🏢', 'type_شقة'), Markup.button.callback('فيلا 🏡', 'type_فيلا')],
        [Markup.button.callback('منزل 🏠', 'type_منزل'), Markup.button.callback('أرض 📐', 'type_قطعة أرض')]
      ])
    }
  );
});

bot.action(/type_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  if (!userStates[userId]) userStates[userId] = { step: 'state', data: {} };

  userStates[userId].data.property_type = ctx.match[1];
  userStates[userId].step = 'state';

  // إرسال أزرار الولايات السريعة
  const wilayaButtons = WILAYAS.map(w => Markup.button.callback(w, `wilaya_${w}`));
  const chunked = [];
  for (let i = 0; i < wilayaButtons.length; i += 2) {
    chunked.push(wilayaButtons.slice(i, i + 2));
  }

  await ctx.editMessageText(
    `📍 <b>الخطوة 2:</b> اختر الولاية المستهدفة:`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(chunked) }
  );
});

bot.action(/wilaya_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  if (!userStates[userId]) return;

  userStates[userId].data.state_name = ctx.match[1];
  userStates[userId].step = 'price';

  await ctx.editMessageText(
    `💰 <b>الخطوة 3:</b> أرسل السعر المطلوب (مثال: 1.2 مليار أو 900 مليون):`,
    { parse_mode: 'HTML' }
  );
});

// معالجة المدخلات النصية للخطوات
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const state = userStates[userId];

  if (!state) return;

  if (state.step === 'price') {
    state.data.price = text;
    state.step = 'phone';
    return ctx.reply('📞 <b>الخطوة 4:</b> أرسل رقم هاتفك للتواصل:', { parse_mode: 'HTML' });
  }

  if (state.step === 'phone') {
    state.data.phone = text;
    state.step = 'description';
    return ctx.reply('📝 <b>الخطوة 5:</b> أكتب وصفاً تفصيلياً للعقار (المساحة، الوثائق...):', { parse_mode: 'HTML' });
  }

  if (state.step === 'description') {
    state.data.description = text;
    state.step = 'photo';
    return ctx.reply('📸 <b>الخطوة الأخيرة:</b> أرسل صورة للعقار (أو اضغط زر إلغاء للرجوع):', {
      parse_mode: 'HTML',
      ...Markup.keyboard([['❌ إلغاء']]).resize()
    });
  }
});

// معالجة الصور والنشر النهائي
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];

  if (!state || state.step !== 'photo') return;

  try {
    await ctx.reply('⏳ جاري رفع الصورة وحفظ الإعلان...');
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    
    const res = await fetch(fileLink.href);
    const buffer = Buffer.from(await res.arrayBuffer());
    const fileName = `${userId}_${Date.now()}.jpg`;

    await supabase.storage.from(STORAGE_BUCKET).upload(fileName, buffer, { contentType: 'image/jpeg' });
    const { data: pubUrl } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);

    const p = state.data;
    await supabase.from('test_messages').insert([{
      property_type: p.property_type,
      state_name: p.state_name,
      price: p.price,
      phone: p.phone,
      description: p.description,
      message: p.description,
      image_url: pubUrl.publicUrl,
      video_url: 'EMPTY'
    }]);

    delete userStates[userId];
    await ctx.reply('🎉 <b>تم نشر العقار بنجاح في المنصة!</b>', { parse_mode: 'HTML', ...getMainMenu() });
  } catch (err) {
    console.error(err);
    delete userStates[userId];
    await ctx.reply('⚠️ حدث خطأ أثناء الحفظ، يرجى المحاولة لاحقاً.', getMainMenu());
  }
});

bot.hears('❌ إلغاء', (ctx) => {
  delete userStates[ctx.from.id];
  ctx.reply('تم إلغاء العملية.', getMainMenu());
});

// المفضلة
bot.action(/fav_(.+)/, async (ctx) => {
  const propertyId = ctx.match[1];
  const userId = ctx.from.id;
  try {
    await supabase.from('user_favorites').insert([{ user_id: userId, property_id: propertyId }]);
    await ctx.answerCbQuery('⭐ تمت إضافة العقار إلى مفضلتك بنجاح!');
  } catch (e) {
    await ctx.answerCbQuery('⭐ العقار موجود مسبقاً في مفضلتك.');
  }
});

bot.hears('⭐ مفضلتي', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const { data: favs } = await supabase.from('user_favorites').select('property_id').eq('user_id', userId);
    if (!favs || favs.length === 0) return ctx.reply('⭐ قائمة مفضلاتك فارغة حالياً.');

    const pIds = favs.map(f => f.property_id);
    const { data: properties } = await supabase.from('test_messages').select('*').in('id', pIds);

    if (!properties || properties.length === 0) return ctx.reply('📭 لا توجد عقارات في المفضلة.');

    await ctx.reply('⭐ <b>عقاراتك المفضلة المحفوظة:</b>', { parse_mode: 'HTML' });
    for (const p of properties) {
      const text = `🏠 ${p.property_type} - ${p.state_name}\n💰 ${p.price}\n📞 ${p.phone}\n📝 ${p.description}`;
      if (p.image_url && p.image_url !== 'EMPTY') {
        await ctx.replyWithPhoto(p.image_url, { caption: text });
      } else {
        await ctx.reply(text);
      }
    }
  } catch (err) {
    ctx.reply('⚠️ حدث خطأ أثناء جلب المفضلة.');
  }
});

bot.hears('📞 الدعم والإدارة', (ctx) => {
  ctx.reply('مركز الدعم التقني - منصة عقار الجزائر 🇩🇿\nلأي استفسار نحن في الخدمة.', getMainMenu());
});

// -----------------------------------------------------------------------------
// Express & Webhook Setup
// -----------------------------------------------------------------------------

app.get('/health', (req, res) => res.status(200).send('OK'));

app.post(WEBHOOK_PATH, async (req, res, next) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const server = http.createServer(app);

async function start() {
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Aqar Server running smoothly on port ${PORT}`);
    try {
      await bot.telegram.setWebhook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET });
      console.log('Webhook successfully set!');
    } catch (e) {
      console.error('Webhook set error:', e);
    }
  });
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
