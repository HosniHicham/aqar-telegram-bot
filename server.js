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

// قائمة الولايات المقترحة للأزرار المساعدة أثناء الإضافة
const POPULAR_WILAYAS = [
  'الجزائر العاصمة', 'وهران', 'مستغانم', 'قسنطينة', 
  'عنابة', 'البليدة', 'تلمسان', 'سطيف', 'بجاية'
];

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

// 🔍 تصفح العقارات الديناميكي (أزرار الولايات في 3 أعمدة بناءً على قاعدة البيانات)
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'filtering_state' };

  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('state_name');

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً. كن أول من يضيف عقاراً!');
    }

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];

    if (uniqueStates.length === 0) {
      return ctx.reply('📭 لا توجد ولايات مسجلة حالياً.');
    }

    const buttons = uniqueStates.map(state => 
      Markup.button.callback(`📍 ${state}`, `filter_state_${state}`)
    );

    // تنظيم الأزرار في 3 أعمدة
    const chunkedButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
      chunkedButtons.push(buttons.slice(i, i + 3));
    }

    chunkedButtons.push([Markup.button.callback('🌐 عرض كافة العقارات (الكل)', 'filter_state_ALL')]);

    await ctx.reply(
      `🔍 <b>نظام التصفية الذكي (مصنف في 3 أعمدة):</b>\n\n` +
      `اختر الولاية أدناه لعرض العقارات المتوفرة فيها فعلياً:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(chunkedButtons)
      }
    );
  } catch (err) {
    console.error('Fetch states error:', err);
    await ctx.reply('⚠️ حدث خطأ أثناء استعلام الولايات المتاحة.');
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

// ➕ معالج إضافة عقار جديد مع الأزرار المساعدة للنوع والولاية
bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(
    `🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\n` +
    `اختر <b>نوع العقار</b> من الأزرار أدناه أو أكتبه يدوياً:`,
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

  // إنشاء أزرار الولايات المساعدة في 3 أعمدة
  const wilayaButtons = POPULAR_WILAYAS.map(w => Markup.button.callback(w, `sel_state_${w}`));
  const chunkedWilayas = [];
  for (let i = 0; i < wilayaButtons.length; i += 3) {
    chunkedWilayas.push(wilayaButtons.slice(i, i + 3));
  }

  await ctx.editMessageText(
    `✅ تم تحديد النوع: <b>${selectedType}</b>\n\n` +
    `📍 <b>الخطوة 2:</b> اختر الولاية من الأزرار أو اكتبها يدوياً بالرسالة:`,
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
    `✅ الولاية: <b>${selectedState}</b>\n\n` +
    `💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b> (مثال: 1.2 مليار، أو 6 ملايين/شهر):`,
    { parse_mode: 'HTML' }
  );
});

// دعم واجهة اللغات والدعم وعن المنصة
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
  await ctx.reply('✅ تم اعتماد اللغة العربية لنظام البوت.', getMainMenuKeyboard('ar'));
});

bot.action('set_lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  await ctx.reply('✅ la langue française a été activée.', getMainMenuKeyboard('fr'));
});

bot.hears(['📞 الدعم والإدارة', '📞 Support & Contact'], async (ctx) => {
  await ctx.reply(
    `📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\n` +
    `نحن في خدمتك دائماً لأي استفسار تقني أو إداري. تواصل معنا عبر القنوات الرسمية للمنصة.`,
    { parse_mode: 'HTML', ...getMainMenuKeyboard(userLang[ctx.from.id] || 'ar') }
  );
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], async (ctx) => {
  await ctx.reply(
    `🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\n` +
    `نظام رقمي ذكي ومتطور لإدارة المعاملات والعروض العقارية، مطور بأعلى معايير الهندسة البرمجية والذكاء السحابي لخدمة السوق الجزائري.`,
    { parse_mode: 'HTML', ...getMainMenuKeyboard(userLang[ctx.from.id] || 'ar') }
  );
});

// معالج النصوص اليدوية أثناء معالج النشر
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
      `✅ النوع: <b>${userText}</b>\n\n📍 اختر الولاية من الأزرار أو اكتبها يدوياً:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(chunkedWilayas) }
    );
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
      await ctx.reply('🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b> الأزرار ستتحدث تلقائياً.', { parse_mode: 'HTML', ...getMainMenuKeyboard('ar') });
    } catch (err) {
      console.error(err);
      delete userState[userId];
      await ctx.reply('⚠️ حدث خطأ أثناء الحفظ.');
    }
  }
});

const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  // مسار الـ Webhook المقاوم للنوم على Render
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
  app.get('/', (req, res) => res.send('Aqar Algeria Perfect System is online 🚀'));
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
