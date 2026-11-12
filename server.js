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
const userLang = {};

function getMainMenuKeyboard(lang = 'ar') {
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🔍 تصفح العقارات المتاحة' : '🔍 Parcourir les biens', isAr ? '➕ إضافة عقار جديد' : '➕ Ajouter un bien'],
    [isAr ? '📞 الدعم والإدارة' : '📞 Support & Contact', isAr ? '🌐 تغيير اللغة / Langue' : '🌐 Langue / اللغة'],
    [isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos']
  ]).resize();
}

bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];
  userLang[userId] = userLang[userId] || 'ar';

  ctx.reply(
    `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠✨\n\n` +
    `نظام ذكي متطور لإدارة وعروض العقارات بخوارزميات سحابية عالية الأداء.\n\n` +
    `استخدم الأزرار المثبتة أسفل الشاشة للتنقل بكل مرونة:`,
    {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userLang[userId])
    }
  );
});

// 🔍 تصفح العقارات الذكي (يجلب الولايات المسجلة فعلياً في القاعدة دون عشوائية)
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'filtering_state' };

  try {
    // جلب الولايات التي تحتوي على عقارات مسجلة حقيقية فقط من القاعدة
    const { data, error } = await supabase
      .from('test_messages')
      .select('state_name');

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً. كن أول من يضيف عقاراً!');
    }

    // استخراج أسماء الولايات الفريدة بدون تكرار
    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];

    if (uniqueStates.length === 0) {
      return ctx.reply('📭 لا توجد ولايات مسجلة حالياً.');
    }

    // بناء الأزرار ديناميكياً بناءً على ما هو موجود في قاعدة البيانات فقط
    const buttons = uniqueStates.map(state => [
      Markup.button.callback(`📍 ${state}`, `filter_state_${state}`)
    ]);

    // إضافة زر لعرض الكل
    buttons.push([Markup.button.callback('🌐 عرض كافة العقارات (الكل)', 'filter_state_ALL')]);

    await ctx.reply(
      `🔍 <b>نظام التصفية الذكي (محدث تلقائياً من قاعدة البيانات):</b>\n\n` +
      `اختر الولاية أدناه لعرض العقارات المتوفرة فيها فعلياً:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  } catch (err) {
    console.error('Fetch states error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء استعلام الولايات المتاحة.');
  }
});

// معالجة اختيار الولاية وعرض العقارات المتاحة بدقة
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
      return ctx.editMessageText('📭 عذراً، لا توجد عقارات مطابقة في هذا البحث.');
    }

    await ctx.editMessageText(`🏛 <b>نتائج العقارات المتاحة (الولاية: ${stateQuery === 'ALL' ? 'الكل' : stateQuery}):</b>`, { parse_mode: 'HTML' });

    for (const item of data) {
      const caption = 
        `🏠 <b>العقار:</b> ${item.property_type || 'عقار'}\n` +
        `📍 <b>الولاية:</b> ${item.state_name || 'غير محدد'}\n` +
        `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
        `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
        `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

      if (item.image_url && item.image_url !== 'EMPTY') {
        try {
          await ctx.replyWithPhoto(item.image_url, {
            caption: caption,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 طلب التواصل', 'contact_admin')]
            ])
          });
        } catch (imgErr) {
          await ctx.reply(caption, { parse_mode: 'HTML' });
        }
      } else {
        await ctx.reply(caption, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📞 طلب التواصل', 'contact_admin')]
          ])
        });
      }
    }
    delete userState[userId];
  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب العروض.');
  }
});

// باقي معالج النشر والإضافات كما هو...
bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(
    `🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\n` +
    `أدخل أو اختر <b>نوع العقار</b> (مثال: شقة، فيلا، قطعة أرض...):`,
    { parse_mode: 'HTML' }
  );
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();

  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  if (state.step === 'waiting_for_type') {
    state.data.property_type = userText;
    state.step = 'waiting_for_state';
    return ctx.reply(`✅ النوع: <b>${userText}</b>\n\n📍 اكتب اسم <b>الولاية</b> الموجود فيها العقار:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_state') {
    state.data.state_name = userText;
    state.step = 'waiting_for_price';
    return ctx.reply(`✅ الولاية: <b>${userText}</b>\n\n💰 أدخل <b>السعر المطلوب</b>:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(`✅ السعر: <b>${userText}</b>\n\n📞 أدخل <b>رقم الهاتف للتواصل</b>:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(`✅ رقم الهاتف: <b>${userText}</b>\n\n📝 أدخل <b>الوصف التفصيلي</b> للعقار:`, { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply(`✅ ممتاز!\n\n📸 أرسل الآن <b>صورة العقار</b> لإتمام النشر نهائياً.`, { parse_mode: 'HTML' });
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري الحفظ والنشر السحابي...');
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = `${Date.now()}_aqar.jpg`;

      await supabase.storage.from('test_media').upload(fileName, buffer, { contentType: 'image/jpeg' });
      const { data: publicURLData } = supabase.storage.from('test_media').getPublicUrl(fileName);

      const p = state.data;
      await supabase.from('test_messages').insert([{ 
        property_type: p.property_type,
        state_name: p.state_name,
        price: p.price,
        phone: p.phone,
        description: p.description,
        message: p.description,
        image_url: publicURLData.publicUrl, 
        video_url: 'EMPTY' 
      }]);

      delete userState[userId];
      await ctx.reply('🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b> الأزرار ستتحدث تلقائياً لتشمل ولايتك.', { parse_mode: 'HTML', ...getMainMenuKeyboard('ar') });
    } catch (err) {
      console.error(err);
      delete userState[userId];
      await ctx.reply('⚠️ حدث خطأ أثناء الحفظ.');
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
  app.get('/', (req, res) => res.send('Aqar Algeria Dynamic System is online 🚀'));
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
