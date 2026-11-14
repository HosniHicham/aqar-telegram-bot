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

// أزرار التصفح مع توفير زر تغيير الولاية وزر العودة للقائمة الرئيسية
function getBrowsingKeyboard(userId, currentIndex, totalCount) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  const prevBtn = isAr ? '⬅️ السابق' : '⬅️ Précédent';
  const nextBtn = isAr ? 'التالي ➡️' : 'Suivant ➡️';
  const counterText = `📄 ${currentIndex + 1} / ${totalCount}`;
  const changeWilayaBtn = isAr ? '📍 تغيير الولاية' : '📍 Changer Wilaya';
  const homeBtn = isAr ? '🏠 القائمة الرئيسية' : '🏠 Menu principal';

  const navRow = [];
  if (currentIndex > 0) {
    navRow.push(prevBtn);
  }
  navRow.push(counterText);
  if (currentIndex < totalCount - 1) {
    navRow.push(nextBtn);
  }

  return Markup.keyboard([
    navRow,
    [changeWilayaBtn, homeBtn]
  ]).resize();
}

// أزرار الإلغاء والعودة أثناء معالج النشر
function getCancelKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🏠 القائمة الرئيسية' : '🏠 Menu principal'],
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
    const { data } = await supabase.from('test_messages').select('state_name').neq('property_type', '⭐ توثيق حساب اجباري');
    if (!data) return [];
    return [...new Set(data.map(item => item.state_name).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

// ================= معالج نشر العقار: رسالة واحدة تتحدّث مع كل مرحلة =================
const WIZ_STEPS = ['waiting_for_type', 'waiting_for_state', 'waiting_for_price', 'waiting_for_phone', 'waiting_for_description', 'waiting_for_media'];
const WIZ_KEYS = ['property_type', 'state_name', 'price', 'phone', 'description', null];

const WIZ = {
  ar: {
    title: '🏢 <b>نشر عقار جديد</b>',
    step: (n, total) => `الخطوة ${n} من ${total}`,
    labels: ['🏠 النوع', '📍 الولاية', '💰 السعر', '📞 الهاتف', '📝 الوصف', '📸 الوسائط'],
    prompts: [
      'اختر <b>نوع العقار</b> من الأزرار أدناه:',
      'اختر <b>الولاية</b> من الأزرار أدناه:',
      'أرسل الآن <b>السعر المطلوب</b>:',
      'أدخل <b>رقم الهاتف للتواصل</b>:',
      'أدخل <b>الوصف التفصيلي</b> للعقار:',
      'أرسل الآن <b>صورة أو فيديو</b> العقار لإتمام النشر.'
    ],
    back: '⬅️ رجوع',
    home: '🏠 القائمة الرئيسية',
    cancelBtn: '❌ إلغاء العملية والعودة',
    publishing: '⏳ جاري الحفظ والنشر السحابي...',
    success: '🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b>',
    failed: '⚠️ <b>حدث خطأ أثناء النشر</b>',
    cancelled: '❌ <b>تم إلغاء عملية النشر.</b>',
    expired: 'انتهت صلاحية هذه الرسالة',
    photo: '🖼 صورة',
    video: '🎥 فيديو',
    mediaLocal: 'محفوظة داخل البوت فقط',
    mediaWarn: '⚠️ تم النشر، لكن تعذّر رفع الملف للسحابة وسيظهر داخل البوت فقط.\nالسبب:'
  },
  fr: {
    title: '🏢 <b>Nouvelle annonce</b>',
    step: (n, total) => `Étape ${n} sur ${total}`,
    labels: ['🏠 Type', '📍 Wilaya', '💰 Prix', '📞 Téléphone', '📝 Description', '📸 Média'],
    prompts: [
      'Choisissez le <b>type de bien</b> :',
      'Choisissez la <b>wilaya</b> :',
      'Envoyez le <b>prix demandé</b> :',
      'Entrez votre <b>numéro de téléphone</b> :',
      'Entrez la <b>description détaillée</b> :',
      'Envoyez une <b>photo ou vidéo</b> pour publier.'
    ],
    back: '⬅️ Retour',
    home: '🏠 Menu principal',
    cancelBtn: '❌ Annuler et quitter',
    publishing: '⏳ Enregistrement et publication...',
    success: '🎉 <b>Le bien a été publié avec succès !</b>',
    failed: '⚠️ <b>Erreur lors de la publication</b>',
    cancelled: '❌ <b>Publication annulée.</b>',
    expired: 'Ce message a expiré',
    photo: '🖼 Photo',
    video: '🎥 Vidéo',
    mediaLocal: 'visible dans le bot uniquement',
    mediaWarn: '⚠️ Publié, mais le fichier n\'a pas pu être envoyé au cloud (visible dans le bot uniquement).\nCause :'
  }
};

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildWizardText(userId, state, opts = {}) {
  const W = WIZ[userLang[userId] || 'ar'];
  const last = WIZ_STEPS.length - 1;
  const active = state.step === 'publishing' ? last : Math.max(WIZ_STEPS.indexOf(state.step), 0);
  const d = state.data;

  const head = opts.header || `${W.title}  •  ${W.step(active + 1, WIZ_STEPS.length)}`;
  if (opts.onlyHeader) return head;

  const filled = opts.complete ? WIZ_STEPS.length : active + 1;
  const bar = '▰'.repeat(filled) + '▱'.repeat(WIZ_STEPS.length - filled);

  const desc = d.description ? (d.description.length > 300 ? d.description.slice(0, 300) + '…' : d.description) : null;
  const values = [d.property_type, d.state_name, d.price, d.phone, desc, opts.mediaText || null];

  const lines = values.map((val, i) => {
    let mark = val ? '✅' : (i === active ? '👉' : '▫️');
    if (i === last && val && opts.mediaMark) mark = opts.mediaMark;
    return `${mark} ${W.labels[i]}: ${val ? '<b>' + escapeHtml(val) + '</b>' : '…'}`;
  });

  const footer = opts.footer !== undefined ? opts.footer : W.prompts[active];
  return `${head}\n${bar}\n\n${lines.join('\n')}` + (footer ? `\n\n${footer}` : '');
}

// لوحة الأزرار أسفل مربع الكتابة (تتغيّر حسب المرحلة)
function getWizardKeyboard(userId, state) {
  const W = WIZ[userLang[userId] || 'ar'];
  const rows = [];

  if (state.step === 'waiting_for_type') {
    rows.push(...chunkButtons(PROPERTY_TYPES.map(tp => `${tp}`), 3));
    rows.push([W.home]);
  } else if (state.step === 'waiting_for_state') {
    rows.push(...chunkButtons(POPULAR_WILAYAS.map(w => `📍 ${w}`), 4));
    rows.push([W.back, W.home]);
  } else {
    rows.push([W.back, W.home]);
    rows.push([W.cancelBtn]);
  }

  return Markup.keyboard(rows).resize();
}

// يعرض رسالة المعالج: كل مرحلة = رسالة جديدة تحمل الأزرار السفلية الخاصة بها،
// ثم تُحذف الرسالة السابقة (فتبدو للمستخدم رسالة واحدة تتحدّث).
// ملاحظة: تيليجرام يخفي الأزرار السفلية إذا حُذفت الرسالة التي تحملها،
// لذلك نرسل الجديدة أولاً ثم نحذف القديمة.
async function renderWizard(ctx, userId, opts = {}) {
  const state = userState[userId];
  if (!state) return;

  const text = buildWizardText(userId, state, opts);

  // أثناء الرفع: تعديل نفس الرسالة فقط (الأزرار السفلية تبقى كما هي)
  if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
    try {
      await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {
      if (!String(e.message || '').includes('not modified')) {
        console.error('Wizard edit error:', e.message);
      }
    }
    return;
  }

  const keyboard = opts.noKeyboard
    ? getMainMenuKeyboard(userId)
    : getWizardKeyboard(userId, state);

  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });

  const oldId = state.wizardMsgId;
  state.wizardMsgId = sent.message_id;
  state.chatId = ctx.chat.id;

  if (oldId) {
    await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
  }
}

// اختيار نوع العقار (أزرار أسفل الشاشة)
bot.hears(PROPERTY_TYPES, async (ctx, next) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_type') return next();

  await safeDeleteUserMessage(ctx);
  state.data.property_type = ctx.message.text;
  state.step = 'waiting_for_state';
  await renderWizard(ctx, userId);
});

// زر الرجوع للمرحلة السابقة
bot.hears(['⬅️ رجوع', '⬅️ Retour'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step === 'publishing') return;

  const idx = WIZ_STEPS.indexOf(state.step);
  if (idx <= 0) return;

  const prevKey = WIZ_KEYS[idx - 1];
  if (prevKey) delete state.data[prevKey];
  state.step = WIZ_STEPS[idx - 1];
  await renderWizard(ctx, userId);
});

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
  const oldWizard = userState[userId];
  if (oldWizard && oldWizard.wizardMsgId) {
    await ctx.telegram.deleteMessage(oldWizard.chatId, oldWizard.wizardMsgId).catch(() => {});
  }
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

async function showStatesMenu(ctx) {
  const userId = ctx.from.id;
  try {
    const { data, error } = await supabase.from('test_messages').select('state_name').neq('property_type', '⭐ توثيق حساب اجباري');

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
    chunkedStates.push(['🏠 القائمة الرئيسية']);

    await ctx.reply(t(userId, 'browseTitle'), {
      parse_mode: 'HTML',
      ...Markup.keyboard(chunkedStates).resize()
    });
  } catch (err) {
    console.error('Fetch states error:', err);
    ctx.reply(t(userId, 'errorMsg'));
  }
}

bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  delete browsingSession[userId];
  await showStatesMenu(ctx);
});

bot.hears(['📍 تغيير الولاية', '📍 Changer Wilaya', 'تغيير الولاية'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  delete browsingSession[userId];
  await showStatesMenu(ctx);
});

bot.hears(/^📍 (.+)/, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const selectedState = ctx.match[1].trim();
  const state = userState[userId];

  if (state && state.step === 'waiting_for_state') {
    state.data.state_name = selectedState;
    state.step = 'waiting_for_price';
    return renderWizard(ctx, userId);
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
      [Markup.button.callback(t(userId, 'contactBtn'), 'contact_admin')]
    ]);

    const replyKb = getBrowsingKeyboard(userId, pageIndex, totalCount);

    if (session.lastMessageId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, session.lastMessageId).catch(() => {});
    }

    const sendOpts = { caption, parse_mode: 'HTML', ...inlineKb, ...replyKb };
    // الوسائط المحفوظة كـ file_id من تيليجرام تبدأ بـ tg:
    const mediaRef = (v) => (typeof v === 'string' && v.startsWith('tg:')) ? v.slice(3) : v;

    let sentMsg;
    try {
      if (item.video_url && item.video_url !== 'EMPTY') {
        sentMsg = await ctx.replyWithVideo(mediaRef(item.video_url), sendOpts);
      } else if (item.image_url && item.image_url !== 'EMPTY') {
        sentMsg = await ctx.replyWithPhoto(mediaRef(item.image_url), sendOpts);
      } else {
        sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...inlineKb, ...replyKb });
      }
    } catch (mediaSendErr) {
      console.error('Media send error:', mediaSendErr.message);
      sentMsg = await ctx.reply(caption + '\n\n⚠️ تعذّر عرض الصورة/الفيديو', { parse_mode: 'HTML', ...inlineKb, ...replyKb });
    }

    if (sentMsg) {
      session.lastMessageId = sentMsg.message_id;
    }
  } catch (err) {
    console.error('Pagination error:', err);
    await ctx.reply(t(userId, 'errorMsg'));
  }
}

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

// ✅ الإصلاح الرئيسي: تمرير الرسالة (السعر/الهاتف) لمعالج النصوص إذا لم يكن المستخدم في وضع اختيار الصفحة
bot.hears(/^\d+$/, async (ctx, next) => {
  const userId = ctx.from.id;
  const session = browsingSession[userId];

  if (session && session.selectingPage) {
    await safeDeleteUserMessage(ctx);
    const selectedNumber = parseInt(ctx.message.text.trim(), 10);
    session.selectingPage = false;
    return renderPropertyPage(ctx, userId, selectedNumber - 1);
  }

  return next();
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

bot.hears(['⬅️ السابق', '⬅️ Précédent'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session && session.page > 0) {
    await renderPropertyPage(ctx, userId, session.page - 1);
  }
});

bot.hears(['التالي ➡️', 'Suivant ➡️'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session) {
    await renderPropertyPage(ctx, userId, session.page + 1);
  }
});

bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;

  const old = userState[userId];
  if (old && old.wizardMsgId) {
    await ctx.telegram.deleteMessage(old.chatId, old.wizardMsgId).catch(() => {});
  }

  userState[userId] = { step: 'waiting_for_type', data: {}, chatId: ctx.chat.id, wizardMsgId: null };
  await renderWizard(ctx, userId);
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

// معالج النصوص (السعر، الهاتف، الوصف) - يحدّث رسالة المعالج نفسها
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text ? ctx.message.text.trim() : '';

  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  await safeDeleteUserMessage(ctx);

  if (state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
  } else if (state.step === 'waiting_for_phone') {
    state.data.phone = userText;
    state.step = 'waiting_for_description';
  } else if (state.step === 'waiting_for_description') {
    state.data.description = userText;
    state.step = 'waiting_for_media';
  } else {
    return;
  }

  await renderWizard(ctx, userId);
});

// 📸🎥 دالة موحدة للنشر وحفظ السطر الجديد في قاعدة البيانات
async function publishProperty(ctx, userId, kind) {
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_media') return;
  state.step = 'publishing'; // يمنع تكرار النشر إذا وصلت عدة صور

  const W = WIZ[userLang[userId] || 'ar'];
  const isVideo = kind === 'video';
  const media = isVideo ? ctx.message.video : ctx.message.photo[ctx.message.photo.length - 1];
  const fileId = media.file_id;
  const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // حد تيليجرام لتحميل الملفات عبر البوت
  const mediaLabel = isVideo ? W.video : W.photo;

  try {
    await renderWizard(ctx, userId, { mediaText: mediaLabel, mediaMark: '⏳', footer: W.publishing });

    let mediaUrl;
    let failReason = '';

    try {
      if (media.file_size && media.file_size > TG_DOWNLOAD_LIMIT) {
        throw new Error('حجم الملف أكبر من 20MB');
      }

      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const fileName = `${Date.now()}_aqar.${isVideo ? 'mp4' : 'jpg'}`;
      const { error: uploadError } = await supabase.storage
        .from('test_media')
        .upload(fileName, buffer, { contentType: isVideo ? 'video/mp4' : 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicURLData } = supabase.storage.from('test_media').getPublicUrl(fileName);
      mediaUrl = publicURLData.publicUrl;
    } catch (mediaErr) {
      console.error('Media upload error:', mediaErr);
      failReason = mediaErr.message || String(mediaErr);
      // احتياطي: نحفظ file_id الخاص بتيليجرام ليظهر داخل البوت
      mediaUrl = `tg:${fileId}`;
    }

    const p = state.data;
    const { error: insertError } = await supabase.from('test_messages').insert([{
      property_type: p.property_type || 'عقار',
      state_name: p.state_name || 'غير محدد',
      price: String(p.price || 'حسب الاتفاق'),
      phone: String(p.phone || 'غير مسجل'),
      description: p.description || 'بدون وصف',
      message: p.description || 'بدون وصف',
      image_url: isVideo ? 'EMPTY' : mediaUrl,
      video_url: isVideo ? mediaUrl : 'EMPTY'
    }]);

    if (insertError) throw insertError;

    await renderWizard(ctx, userId, {
      header: W.success,
      complete: true,
      noKeyboard: true,
      mediaText: failReason ? `${mediaLabel} (${W.mediaLocal})` : mediaLabel,
      mediaMark: failReason ? '⚠️' : '✅',
      footer: failReason ? `${W.mediaWarn} ${escapeHtml(failReason)}` : ''
    });
    delete userState[userId];
  } catch (err) {
    console.error('Publish Error:', err);
    await renderWizard(ctx, userId, {
      header: W.failed,
      noKeyboard: true,
      footer: escapeHtml(err.message || 'unknown')
    }).catch(() => {});
    delete userState[userId];
  }
}

bot.on('photo', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await publishProperty(ctx, ctx.from.id, 'photo');
});

bot.on('video', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await publishProperty(ctx, ctx.from.id, 'video');
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
  app.get('/', (req, res) => res.send('Aqar Algeria Complete System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
