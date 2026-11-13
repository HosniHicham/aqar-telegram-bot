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
const browsingSession = {};

const POPULAR_WILAYAS = [
  'الجزائر العاصمة', 'وهران', 'مستغانم', 'قسنطينة', 
  'عنابة', 'البليدة', 'تلمسان', 'سطيف', 'بجاية'
];

const PROPERTY_TYPES = ['شقة', 'فيلا', 'منزل', 'قطعة أرض', 'محل تجاري'];

const STRINGS = {
  ar: {
    welcome: (name) => `أهلاً بك يا <b>${name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:`,
    authPrompt: (name) => `أهلاً بك يا <b>${name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`,
    browseTitle: '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>',
    noProperties: '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.',
    step1Type: '🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\nاختر <b>نوع العقار</b> من الأزرار أسفل الشاشة:',
    step2State: (type) => `✅ تم تحديد النوع: <b>${type}</b>\n\n📍 <b>الخطوة 2:</b> اختر الولاية من الأزرار أسفل الشاشة:`,
    step3Price: (state) => `✅ الولاية: <b>${state}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b>:`,
    step4Phone: (price) => `✅ السعر: <b>${price}</b>\n\n📞 <b>الخطوة 4:</b> أدخل <b>رقم الهاتف للتواصل</b>:`,
    step5Desc: (phone) => `✅ رقم الهاتف: <b>${phone}</b>\n\n📝 <b>الخطوة 5:</b> أدخل <b>الوصف التفصيلي</b> للعقار:`,
    step6Media: '✅ تم تسجيل كافة البيانات!\n\n📸 <b>الخطوة الأخيرة:</b> أرسل الآن <b>صورة أو فيديو العقار</b> لإتمام النشر.',
    successPublish: '🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b>',
    supportText: '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً.',
    aboutText: '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.',
    langChanged: '✅ تم اعتماد اللغة العربية.',
    errorMsg: '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.',
    contactBtn: '📞 اتصال بالمالك',
    authBtnText: '📱 اضغط هنا لمشاركة رقم هاتفك والبدء'
  },
  fr: {
    welcome: (name) => `Bienvenue <b>${name}</b> sur <b>Aqar Algérie</b> 🏠\n\nSystème numérique professionnel de gestion immobilière. Choisissez :`,
    authPrompt: (name) => `Bienvenue <b>${name}</b> sur <b>Aqar Algérie</b> 🏠\n\n⚠️ <b>Sécurité:</b>\nVeuillez <b>confirmer votre numéro de téléphone</b> :`,
    browseTitle: '🔍 <b>Choisissez la wilaya en bas de l\'écran :</b>',
    noProperties: '📭 Désolé, aucun bien enregistré.',
    step1Type: '🏢 <b>Assistant de publication (Étape 1 sur 5)</b>\n\nChoisissez le <b>type de bien</b> :',
    step2State: (type) => `✅ Type sélectionné: <b>${type}</b>\n\n📍 <b>Étape 2:</b> Choisissez la wilaya :`,
    step3Price: (state) => `✅ Wilaya: <b>${state}</b>\n\n💰 <b>Étape 3:</b> Envoyez le <b>prix demandé</b> :`,
    step4Phone: (price) => `✅ Prix: <b>${price}</b>\n\n📞 <b>Étape 4:</b> Entrez votre <b>numéro de téléphone</b> :`,
    step5Desc: (phone) => `📞 Téléphone: <b>${phone}</b>\n\n📝 <b>Étape 5:</b> Entrez la <b>description détaillée</b> :`,
    step6Media: '✅ Données enregistrées !\n\n📸 <b>Dernière étape:</b> Envoyez une <b>photo ou vidéo</b>.',
    successPublish: '🎉 <b>Le bien a été publié avec succès !</b>',
    supportText: '📞 <b>Support Technique - Aqar Algérie:</b>\n\nNous sommes à votre service.',
    aboutText: '🏛 <b>À propos d\'Aqar Algérie:</b>\n\nSystème numérique intelligent.',
    langChanged: '✅ La langue française a été activée.',
    errorMsg: '⚠️ Une erreur est survenue.',
    contactBtn: '📞 Contacter le propriétaire',
    authBtnText: '📱 Partager mon numéro et commencer'
  }
};

function t(userId, key, ...args) {
  const lang = userLang[userId] || 'ar';
  const val = STRINGS[lang][key] || STRINGS['ar'][key];
  return typeof val === 'function' ? val(...args) : val;
}

function chunkButtons(buttonsArray, chunkSize = 4) {
  const chunked = [];
  for (let i = 0; i < buttonsArray.length; i += chunkSize) {
    chunked.push(buttonsArray.slice(i, i + chunkSize));
  }
  return chunked;
}

function getMainMenuKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🔍 تصفح العقارات المتاحة' : '🔍 Parcourir les biens', isAr ? '➕ إضافة عقار جديد' : '➕ Ajouter un bien'],
    [isAr ? '📞 الدعم والإدارة' : '📞 Support & Contact', isAr ? '🌐 تغيير اللغة / Langue' : '🌐 Langue / اللغة'],
    [isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos'],
    [isAr ? '🌐 تصفح الموقع الرسمي (البروزر)' : '🌐 Site Officiel (Navigateur)']
  ]).resize();
}

function getBrowsingKeyboard(userId, currentIndex, totalCount) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [
      isAr ? '⬅️ السابق' : '⬅️ Précédent',
      `📄 ${currentIndex + 1} / ${totalCount}`,
      isAr ? 'التالي ➡️' : 'Suivant ➡️'
    ],
    [isAr ? '📍 تغيير الولاية' : '📍 Changer Wilaya', isAr ? '🏠 القائمة الرئيسية' : '🏠 Menu principal']
  ]).resize();
}

function getCancelKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '❌ إلغاء العملية والعودة' : '❌ Annuler et quitter']
  ]).resize();
}

function getAuthKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  return Markup.keyboard([
    [Markup.button.contactRequest(STRINGS[lang]['authBtnText'])]
  ]).resize().oneTime();
}

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

async function safeDeleteUserMessage(ctx) {
  try {
    if (ctx.message && ctx.message.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    }
  } catch (e) {}
}

async function getUniqueStatesList() {
  try {
    const { data } = await supabase.from('test_messages').select('state_name');
    if (!data) return [];
    return [...new Set(data.map(item => item.state_name).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

bot.start(async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;
  
  delete userState[userId];
  delete browsingSession[userId];
  userLang[userId] = userLang[userId] || 'ar';

  const verified = await isUserVerified(userId);

  if (verified) {
    ctx.reply(t(userId, 'welcome', userName), {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userId)
    });
  } else {
    ctx.reply(t(userId, 'authPrompt', userName), {
      parse_mode: 'HTML',
      ...getAuthKeyboard(userId)
    });
  }
});

bot.hears(['❌ إلغاء العملية والعودة', '❌ Annuler et quitter', '🏠 القائمة الرئيسية', '🏠 Menu principal'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  delete userState[userId];
  delete browsingSession[userId];

  await ctx.reply(
    userLang[userId] === 'fr' ? '✅ Retour au menu principal :' : '✅ العودة إلى القائمة الرئيسية:',
    {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userId)
    }
  );
});

bot.on('contact', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = ctx.from.first_name || '';
  const userId = ctx.from.id;
  const lang = userLang[userId] || 'ar';

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
      lang === 'ar' ? '🎉 <b>تم توثيق حسابك بنجاح!</b>\n\nأصبح بإمكانك استخدام المنصة بكامل ميزاتها:' : '🎉 <b>Compte vérifié avec succès !</b>',
      { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply(t(userId, 'errorMsg'));
  }
});

bot.hears(['🌐 تصفح الموقع الرسمي (البروزر)', '🌐 Site Officiel (Navigateur)'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.reply(
    '🌐 <b>رابط منصة عقار الجزائر (ويب):</b>\n\nانقر على الزر أدناه لفتح الموقع وتصفحه في متصفح الهاتف:',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🚀 فتح الموقع الآن', 'https://hosnihicham.github.io/testHTML')]
      ])
    }
  );
});

bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
    return next();
  }
  
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('Parcourir') || ctx.message.text?.includes('Ajouter'))) {
    const verified = await isUserVerified(ctx.from.id);
    if (!verified) {
      return ctx.reply('⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:', getAuthKeyboard(ctx.from.id));
    }
  }
  return next();
});

// دالة مشتركة لعرض قائمة الولايات ديناميكياً من قاعدة البيانات
async function showStatesMenu(ctx) {
  const userId = ctx.from.id;
  try {
    const { data, error } = await supabase.from('test_messages').select('state_name');

    if (error || !data || data.length === 0) {
      return ctx.reply(t(userId, 'noProperties'), getMainMenuKeyboard(userId));
    }

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
    if (uniqueStates.length === 0) {
      return ctx.reply(t(userId, 'noProperties'), getMainMenuKeyboard(userId));
    }

    const stateButtons = uniqueStates.map(state => `📍 ${state}`);
    const chunkedStates = chunkButtons(stateButtons, 4);
    chunkedStates.push(['🌐 الكل']);

    await ctx.reply(t(userId, 'browseTitle'), {
      parse_mode: 'HTML',
      ...Markup.keyboard(chunkedStates).resize()
    });
  } catch (err) {
    console.error('Fetch states error:', err);
    ctx.reply(t(userId, 'errorMsg'));
  }
}

// 🔍 تصفح العقارات
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  delete browsingSession[userId];
  await showStatesMenu(ctx);
});

// 🎯 معالج زر الولاية (يدعم الإضافة أو اختيار ولاية التصفح)
bot.hears(/^📍 (.+)/, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const selectedState = ctx.match[1].trim();
  const state = userState[userId];

  if (state && state.step === 'waiting_for_state') {
    state.data.state_name = selectedState;
    state.step = 'waiting_for_price';

    return ctx.reply(t(userId, 'step3Price', selectedState), {
      parse_mode: 'HTML',
      ...getCancelKeyboard(userId)
    });
  }

  const stateList = await getUniqueStatesList();
  if (stateList.includes(selectedState)) {
    browsingSession[userId] = { state: selectedState, page: 0 };
    await renderPropertyPage(ctx, userId, 0);
  }
});

bot.hears(['🌐 الكل', '🌐 Tous'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  browsingSession[userId] = { state: 'ALL', page: 0 };
  await renderPropertyPage(ctx, userId, 0);
});

// 📄 دالة عرض العقار الواحد
async function renderPropertyPage(ctx, userId, pageIndex) {
  const session = browsingSession[userId];
  if (!session) return;

  const stateQuery = session.state;
  session.page = pageIndex;
  session.selectingPage = false;

  try {
    let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
    if (stateQuery !== 'ALL') {
      query = query.eq('state_name', stateQuery);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة.', getMainMenuKeyboard(userId));
    }

    const validProperties = data.filter(item => item.property_type !== '⭐ توثيق حساب اجباري');

    if (validProperties.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة.', getMainMenuKeyboard(userId));
    }

    if (pageIndex < 0) pageIndex = 0;
    if (pageIndex >= validProperties.length) pageIndex = validProperties.length - 1;
    session.page = pageIndex;

    const item = validProperties[pageIndex];
    const totalCount = validProperties.length;

    const caption = 
      `🏛 <b>الولاية:</b> ${item.state_name || 'غير محدد'} (${pageIndex + 1}/${totalCount})\n\n` +
      `🏠 <b>العقار:</b> ${item.property_type || 'عقار'}\n` +
      `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
      `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
      `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

    const inlineKb = Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'contact_btn') || '📞 اتصال بالمالك', 'contact_admin')]
    ]);

    const replyKb = getBrowsingKeyboard(userId, pageIndex, totalCount);

    if (session.lastMessageId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, session.lastMessageId).catch(() => {});
    }

    let sentMsg;
    if (item.video_url && item.video_url !== 'EMPTY') {
      sentMsg = await ctx.replyWithVideo(item.video_url, { caption, parse_mode: 'HTML', ...inlineKb, ...replyKb });
    } else if (item.image_url && item.image_url !== 'EMPTY') {
      sentMsg = await ctx.replyWithPhoto(item.image_url, { caption, parse_mode: 'HTML', ...inlineKb, ...replyKb });
    } else {
      sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...inlineKb, ...replyKb });
    }

    if (sentMsg) {
      session.lastMessageId = sentMsg.message_id;
    }
  } catch (err) {
    console.error('Pagination error:', err);
    await ctx.reply(t(userId, 'errorMsg'));
  }
}

// 🔢 معالج زر العداد المتغير لفتح الفهرس
bot.hears(/^📄 \d+ \/ \d+$/, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';

  if (!session) return;

  let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
  if (session.state !== 'ALL') {
    query = query.eq('state_name', session.state);
  }
  const { data } = await query;
  const validProps = data ? data.filter(item => item.property_type !== '⭐ توثيق حساب اجباري') : [];
  const totalCount = validProps.length;

  if (totalCount === 0) return;

  session.selectingPage = true;

  const numberButtons = [];
  let row = [];
  for (let i = 1; i <= totalCount; i++) {
    row.push(`${i}`);
    if (row.length === 5) {
      numberButtons.push(row);
      row = [];
    }
  }
  if (row.length > 0) numberButtons.push(row);
  numberButtons.push([isAr ? '🔙 رجوع للعقار' : '🔙 Retour au bien']);

  await ctx.reply(
    isAr
      ? `🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`
      : `🔢 <b>Choisissez le numéro du bien (1 à ${totalCount}) :</b>`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard(numberButtons).resize()
    }
  );
});

bot.hears(/^\d+$/, async (ctx) => {
  const userId = ctx.from.id;
  const session = browsingSession[userId];

  if (session && session.selectingPage) {
    await safeDeleteUserMessage(ctx);
    const selectedNumber = parseInt(ctx.message.text.trim(), 10);
    session.selectingPage = false;
    await renderPropertyPage(ctx, userId, selectedNumber - 1);
  }
});

bot.hears(['🔙 رجوع للعقار', '🔙 Retour au bien'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];

  if (session) {
    session.selectingPage = false;
    await renderPropertyPage(ctx, userId, session.page);
  }
});

// معالج زر السابق بدون تعقيد أو تنبيهات
bot.hears(['⬅️ السابق', '⬅️ Précédent'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session && session.page > 0) {
    await renderPropertyPage(ctx, userId, session.page - 1);
  }
});

// معالج زر التالي بدون تعقيد أو تنبيهات
bot.hears(['التالي ➡️', 'Suivant ➡️'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session) {
    await renderPropertyPage(ctx, userId, session.page + 1);
  }
});

// 📍 زر تغيير الولاية (يعمل بكل مرونة ودقة مطلقة)
bot.hears(['📍 تغيير الولاية', '📍 Changer Wilaya', 'تغيير الولاية'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  delete browsingSession[userId];
  await showStatesMenu(ctx);
});

// ➕ معالج إضافة عقار جديد
bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  userState[userId] = { step: 'waiting_for_type', data: {} };

  const typeButtons = PROPERTY_TYPES.map(type => `${type}`);
  const chunkedTypes = chunkButtons(typeButtons, 3);
  chunkedTypes.push(['❌ إلغاء العملية والعودة']);

  await ctx.reply(t(userId, 'step1Type'), {
    parse_mode: 'HTML',
    ...Markup.keyboard(chunkedTypes).resize()
  });
});

bot.hears(PROPERTY_TYPES, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_type') {
    const selectedType = ctx.message.text;
    state.data.property_type = selectedType;
    state.step = 'waiting_for_state';

    const stateButtons = POPULAR_WILAYAS.map(w => `📍 ${w}`);
    const chunkedStates = chunkButtons(stateButtons, 4);
    chunkedStates.push(['❌ إلغاء العملية والعودة']);

    await ctx.reply(t(userId, 'step2State', selectedType), {
      parse_mode: 'HTML',
      ...Markup.keyboard(chunkedStates).resize()
    });
  }
});

bot.hears(['🌐 تغيير اللغة / Langue', '🌐 Langue / اللغة'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
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
  await ctx.deleteMessage().catch(() => {});
  await ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.action('set_lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  await ctx.deleteMessage().catch(() => {});
  await ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.hears(['📞 الدعم والإدارة', '📞 Support & Contact'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.reply(t(ctx.from.id, 'supportText'), {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(ctx.from.id)
  });
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  await ctx.reply(t(userId, 'aboutText'), {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(userId)
  });
});

// معالج النصوص أثناء خطوات النشر
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text.trim();

  if (userText.startsWith('/')) return;
  if (userText.startsWith('📍') || userText === '🌐 الكل' || PROPERTY_TYPES.includes(userText) || /^\d+$/.test(userText)) return;

  const state = userState[userId];
  if (!state) return;

  await safeDeleteUserMessage(ctx);

  if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
    return ctx.reply(t(userId, 'step4Phone', userText), { parse_mode: 'HTML', ...getCancelKeyboard(userId) });
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
    return ctx.reply(t(userId, 'step5Desc', userText), { parse_mode: 'HTML', ...getCancelKeyboard(userId) });
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
    return ctx.reply(t(userId, 'step6Media'), { parse_mode: 'HTML', ...getCancelKeyboard(userId) });
  }
});

// 📸 استلام الصور
bot.on('photo', async (ctx) => {
  await safeDeleteUserMessage(ctx);
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
      await ctx.reply(t(userId, 'errorMsg'), getMainMenuKeyboard(userId));
    }
  }
});

// 🎥 استلام الفيديوهات
bot.on('video', async (ctx) => {
  await safeDeleteUserMessage(ctx);
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
      await ctx.reply(t(userId, 'errorMsg'), getMainMenuKeyboard(userId));
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
      console.error('Webhook processing error:', err);
    }
  });

  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Clean System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
