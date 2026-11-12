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

// الولايات المقترحة للإضافة السريعة مع دعم اللغتين
const POPULAR_WILAYAS = [
  'الجزائر العاصمة', 'وهران', 'مستغانم', 'قسنطينة', 
  'عنابة', 'البليدة', 'تلمسان', 'سطيف', 'بجاية'
];

// 🌐 نظام النصوص متعدد اللغات (عربي / فرنسي) شامل لكل البيانات
const STRINGS = {
  ar: {
    welcome: (name) => `أهلاً بك يا <b>${name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠✨\n\nنظام ذكي متطور لإدارة وعروض العقارات بخوارزميات سحابية عالية الأداء.\n\nاستخدم الأزرار أسفل الشاشة للتنقل:`,
    publishBtn: '➕ إضافة عقار جديد',
    browseBtn: '🔍 تصفح العقارات المتاحة',
    supportBtn: '📞 الدعم والإدارة',
    langBtn: '🌐 تغيير اللغة / Langue',
    aboutBtn: 'ℹ️ عن المنصة',
    browseTitle: '🔍 <b>نظام التصفية الذكي (مصنف في 3 أعمدة):</b>\n\nاختر الولاية أدناه لعرض العقارات المتوفرة فيها فعلياً:',
    noProperties: '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.',
    allStates: '🌐 عرض كافة العقارات (الكل)',
    step1Type: '🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\nاختر <b>نوع العقار</b> من الأزرار أدناه أو أكتبه يدوياً:',
    step2State: (type) => `✅ تم تحديد النوع: <b>${type}</b>\n\n📍 <b>الخطوة 2:</b> اختر الولاية من الأزرار أو اكتبها يدوياً بالرسالة:`,
    step3Price: (state) => `✅ الولاية: <b>${state}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b> (مثال: 1.2 مليار، أو 6 ملايين/شهر):`,
    step4Phone: (price) => `✅ السعر: <b>${price}</b>\n\n📞 <b>الخطوة 4:</b> أدخل <b>رقم الهاتف للتواصل</b>:`,
    step5Desc: (phone) => `✅ رقم الهاتف: <b>${phone}</b>\n\n📝 <b>الخطوة 5:</b> أدخل <b>الوصف التفصيلي</b> للعقار:`,
    step6Media: '✅ تم تسجيل كافة البيانات بنجاح!\n\n📸 <b>الخطوة الأخيرة:</b> أرسل الآن <b>صورة أو فيديو العقار</b> لإتمام النشر.',
    successPublish: '🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b>',
    supportText: '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً لأي استفسار تقني أو إداري.',
    aboutText: '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات والعروض العقارية.',
    langChanged: '✅ تم اعتماد اللغة العربية لنظام البوت.',
    errorMsg: '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.',
    contactBtn: '📞 طلب التواصل',
    testPhoneBtn: '📞 عرض رقم الهاتف (تجربة)'
  },
  fr: {
    welcome: (name) => `Bienvenue <b>${name}</b> sur <b>Aqar Algérie</b> 🏠✨\n\nSystème intelligent de gestion immobilière à haute performance.\n\nUtilisez les boutons ci-dessous pour naviguer :`,
    publishBtn: '➕ Ajouter un bien',
    browseBtn: '🔍 Parcourir les biens',
    supportBtn: '📞 Support & Contact',
    langBtn: '🌐 Langue / اللغة',
    aboutBtn: 'ℹ️ À propos',
    browseTitle: '🔍 <b>Système de filtrage intelligent (3 colonnes):</b>\n\nChoisissez la wilaya ci-dessous pour voir les biens disponibles :',
    noProperties: '📭 Désolé, aucun bien enregistré pour le moment.',
    allStates: '🌐 Afficher tous les biens (Tous)',
    step1Type: '🏢 <b>Assistant de publication (Étape 1 sur 5)</b>\n\nChoisissez le <b>type de bien</b> ci-dessous ou écrivez-le manuellement :',
    step2State: (type) => `✅ Type sélectionné: <b>${type}</b>\n\n📍 <b>Étape 2:</b> Choisissez la wilaya ou écrivez-la par message :`,
    step3Price: (state) => `✅ Wilaya: <b>${state}</b>\n\n💰 <b>Étape 3:</b> Envoyez le <b>prix demandé</b> (ex: 12000000 DZD) :`,
    step4Phone: (price) => `✅ Prix: <b>${price}</b>\n\n📞 <b>Étape 4:</b> Entrez votre <b>numéro de téléphone</b> :`,
    step5Desc: (phone) => `✅ Téléphone: <b>${phone}</b>\n\n📝 <b>Étape 5:</b> Entrez la <b>description détaillée</b> :`,
    step6Media: '✅ Données enregistrées avec succès !\n\n📸 <b>Dernière étape:</b> Envoyez maintenant <b>une photo ou une vidéo</b> du bien.',
    successPublish: '🎉 <b>Le bien a été publié avec succès sur la plateforme !</b>',
    supportText: '📞 <b>Support Technique - Aqar Algérie:</b>\n\nNous sommes toujours à votre service pour toute assistance.',
    aboutText: '🏛 <b>À propos d\'Aqar Algérie:</b>\n\nSystème numérique intelligent de gestion des transactions immobilières.',
    langChanged: '✅ La langue française a été activée.',
    errorMsg: '⚠️ Une erreur est survenue, veuillez réessayer.',
    contactBtn: '📞 Demander contact',
    testPhoneBtn: '📞 Partager mon numéro (Test)'
  }
};

function t(userId, key, ...args) {
  const lang = userLang[userId] || 'ar';
  const val = STRINGS[lang][key] || STRINGS['ar'][key];
  return typeof val === 'function' ? val(...args) : val;
}

function getMainMenuKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🔍 تصفح العقارات المتاحة' : '🔍 Parcourir les biens', isAr ? '➕ إضافة عقار جديد' : '➕ Ajouter un bien'],
    [isAr ? '📞 عرض رقم الهاتف (تجربة)' : '📞 Partager mon numéro (Test)'], // زر التجربة المضاف
    [isAr ? '📞 الدعم والإدارة' : '📞 Support & Contact', isAr ? '🌐 تغيير اللغة / Langue' : '🌐 Langue / اللغة'],
    [isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos']
  ]).resize();
}

bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];
  userLang[userId] = userLang[userId] || 'ar';

  ctx.reply(t(userId, 'welcome', userName), {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(userId)
  });
});

// 🔍 تصفح العقارات الديناميكي (أزرار الولايات في 3 أعمدة بناءً على قاعدة البيانات)
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'filtering_state' };

  try {
    const { data, error } = await supabase.from('test_messages').select('state_name');

    if (error || !data || data.length === 0) {
      return ctx.reply(t(userId, 'noProperties'));
    }

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];

    if (uniqueStates.length === 0) {
      return ctx.reply(t(userId, 'noProperties'));
    }

    const buttons = uniqueStates.map(state => 
      Markup.button.callback(`📍 ${state}`, `filter_state_${state}`)
    );

    const chunkedButtons = [];
    for (let i = 0; i < buttons.length; i += 3) {
      chunkedButtons.push(buttons.slice(i, i + 3));
    }

    chunkedButtons.push([Markup.button.callback(t(userId, 'allStates'), 'filter_state_ALL')]);

    await ctx.reply(t(userId, 'browseTitle'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedButtons)
    });
  } catch (err) {
    console.error('Fetch states error:', err);
    ctx.reply(t(userId, 'errorMsg'));
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
      return ctx.editMessageText(t(userId, 'noProperties'));
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
        [Markup.button.callback(t(userId, 'contact_btn') || '📞 اتصال', 'contact_admin')]
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
    await ctx.reply(t(userId, 'errorMsg'));
  }
});

// ➕ معالج إضافة عقار جديد مع الأزرار المساعدة للنوع والولاية
bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  await ctx.reply(t(userId, 'step1Type'), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('شقة 🏢', 'type_شقة'), Markup.button.callback('فيلا 🏡', 'type_فيلا')],
      [Markup.button.callback('منزل 🏠', 'type_منزل'), Markup.button.callback('قطعة أرض 📐', 'type_قطعة أرض')],
      [Markup.button.callback('محل تجاري 🏪', 'type_محل تجاري')]
    ])
  });
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

  await ctx.editMessageText(t(userId, 'step2State', selectedType), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(chunkedWilayas)
  });
});

bot.action(/sel_state_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const selectedState = ctx.match[1];

  if (!userState[userId]) userState[userId] = { data: {} };
  userState[userId].data.state_name = selectedState;
  userState[userId].step = 'waiting_for_price';

  await ctx.editMessageText(t(userId, 'step3Price', selectedState), { parse_mode: 'HTML' });
});

// 🧪 معالج زر تجربة مشاركة رقم الهاتف
bot.hears(['📞 عرض رقم الهاتف (تجربة)', '📞 Partager mon numéro (Test)'], async (ctx) => {
  await ctx.reply(
    'اضغط على الزر أدناه في لوحة المفاتيح لمشاركة رقم هاتفك الحقيقي مع البوت للتجربة:',
    Markup.keyboard([
      [Markup.button.contactRequest('📱 مشاركة رقم الهاتف الآن')]
    ]).resize().oneTime()
  );
});

// 📱 معالج استقبال رقم الهاتف المرسل من تليغرام (تجربة)
bot.on('contact', async (ctx) => {
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = contact.first_name;
  const userId = ctx.from.id;

  console.log(`[TEST] تم استلام رقم الهاتف بنجاح: ${phoneNumber} للمستخدم ID: ${userId}`);

  await ctx.reply(
    `✅ <b>تم استلام رقم هاتفك بنجاح (تجربة ناجحة)!</b>\n\n📱 الرقم: <code>${phoneNumber}</code>\n👤 الاسم: ${firstName}\n🆔 المعرّف: ${userId}`,
    { 
      parse_mode: 'HTML', 
      ...getMainMenuKeyboard(userId) 
    }
  );
});

// دعم واجهة تغيير اللغة
bot.hears(['🌐 تغيير اللغة / Langue', '🌐 Langue / اللغة'], async (ctx) => {
  ctx.reply(`🌐 <b>اختر لغة النظام / Choisir la langue:</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🇩🇿 العربية', 'set_lang_ar'), Markup.button.callback('🇫🇷 Français', 'set_lang_fr')]
    ])
  });
});

bot.action('set_lang_ar', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'ar';
  await ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.action('set_lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  await ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.hears(['📞 الدعم والإدارة', '📞 Support & Contact'], async (ctx) => {
  await ctx.reply(t(ctx.from.id, 'supportText'), {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(ctx.from.id)
  });
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], async (ctx) => {
  await ctx.reply(t(ctx.from.id, 'aboutText'), {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(ctx.from.id)
  });
});

// معالج النصوص اليدوية أثناء خطوات النشر
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

    return ctx.reply(t(userId, 'step2State', userText), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(chunkedWilayas)
    });
  } else if (state.step === 'waiting_for_state') {
    state.data.state_name = userText;
    state.step = 'waiting_for_price';
    return ctx.reply(t(userId, 'step3Price', userText), { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(t(userId, 'step4Phone', userText), { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(t(userId, 'step5Desc', userText), { parse_mode: 'HTML' });
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply(t(userId, 'step6Media'), { parse_mode: 'HTML' });
  }
});

// 📸 معالج استلام الصور
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
      await ctx.reply(t(userId, 'successPublish'), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
    } catch (err) {
      console.error(err);
      delete userState[userId];
      await ctx.reply(t(userId, 'errorMsg'));
    }
  }
});

// 🎥 معالج استلام الفيديوهات
bot.on('video', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    try {
      await ctx.reply('⏳ جاري رفع الفيديو والنشر السحابي...');
      const video = ctx.message.video;
      const fileLink = await ctx.telegram.getFileLink(video.file_id);
      
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = `${Date.now()}_aqar.mp4`;

      await supabase.storage.from('test_media').upload(fileName, buffer, { contentType: 'video/mp4' });
      const { data: publicURLData } = supabase.storage.from('test_media').getPublicUrl(fileName);

      const p = state.data;
      await supabase.from('test_messages').insert([{ 
        property_type: p.property_type,
        state_name: p.state_name,
        price: p.price,
        phone: p.phone,
        description: p.description,
        message: p.description,
        image_url: 'EMPTY', 
        video_url: publicURLData.publicUrl 
      }]);

      delete userState[userId];
      await ctx.reply(t(userId, 'successPublish'), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
    } catch (err) {
      console.error(err);
      delete userState[userId];
      await ctx.reply(t(userId, 'errorMsg'));
    }
  }
});

const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  // مسار الـ Webhook المقاوم للنوم على Render (مع الاستجابة الفورية 200 لتفادي ضياع الرسائل وقت الاستيقاظ)
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    try {
      if (req.body && req.body.update_id) {
        await bot.handleUpdate(req.body);
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  });

  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Complete Production System with Phone Test is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
