'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

// ⚙️ معرف الأدمن الخاص بك لاستقبال إشعارات الدفع والوصولات
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : 5883330772; 

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
    paymentPrompt: '💳 <b>رسوم نشر أو تمييز الإعلان:</b>\n\nيرجى تحويل مبلغ <b>500 دج</b> عبر بريدي موب أو CCP:\n📌 <b>رقم الحساب (RIP/CCP):</b> <code>0023456789 رقم الحساب هنا</code>\n\n📸 <b>بعد التحويل، أرسل هنا صورة وصل الدفع (Reçu) لمراجعته من طرف الإدارة:</b>',
    paymentPending: '⏳ <b>تم استلام وصل الدفع بنجاح!</b>\n\nالإعلان قيد المراجعة من طرف الإدارة وسيتم نشره فور تأكيد التحويل.',
    successPublish: '🎉 <b>تم قبول إعلانك ونشره بنجاح في المنصة!</b>',
    rejectPublish: '❌ <b>عذراً، تم رفض وصل الدفع من طرف الإدارة. يرجى التأكد من الوصل وإعادة المحاولة.</b>',
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
    step1Type: '🏢 <b>Assistant de publication</b>\n\nChoisissez le <b>type de bien</b> :',
    step2State: (type) => `✅ Type : <b>${type}</b>\n\n📍 <b>Étape 2:</b> Wilaya :`,
    step3Price: (state) => `✅ Wilaya : <b>${state}</b>\n\n💰 <b>Étape 3:</b> Prix :`,
    step4Phone: (price) => `✅ Prix : <b>${price}</b>\n\n📞 <b>Étape 4:</b> Téléphone :`,
    step5Desc: (phone) => `📞 Téléphone : <b>${phone}</b>\n\n📝 <b>Étape 5:</b> Description :`,
    step6Media: '✅ Données enregistrées !\n\n📸 <b>Dernière étape:</b> Envoyez une <b>photo ou vidéo</b>.',
    paymentPrompt: '💳 <b>Paiement requis:</b>\nEnvoyez la photo du reçu CCP/BaridiMob.',
    paymentPending: '⏳ <b>Reçu reçu !</b> En attente de validation.',
    successPublish: '🎉 <b>Annonce publiée avec succès !</b>',
    rejectPublish: '❌ <b>Reçu rejeté.</b>',
    supportText: '📞 <b>Support Technique:</b>',
    aboutText: '🏛 <b>À propos:</b>',
    langChanged: '✅ Langue changée.',
    errorMsg: '⚠️ Erreur survenue.',
    contactBtn: 'Contacter',
    authBtnText: 'Partager mon numéro'
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
  const prevBtn = isAr ? '⬅️ السابق' : '⬅️ Précédent';
  const nextBtn = isAr ? 'التالي ➡️' : 'Suivant ➡️';
  const counterText = `📄 ${currentIndex + 1} / ${totalCount}`;
  const changeWilayaBtn = isAr ? '📍 تغيير الولاية' : '📍 Changer Wilaya';
  const homeBtn = isAr ? '🏠 القائمة الرئيسية' : '🏠 Menu principal';

  const navRow = [];
  if (currentIndex > 0) navRow.push(prevBtn);
  navRow.push(counterText);
  if (currentIndex < totalCount - 1) navRow.push(nextBtn);

  return Markup.keyboard([navRow, [changeWilayaBtn, homeBtn]]).resize();
}

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
    const { data } = await supabase.from('users').select('*').eq('id', telegramId).limit(1);
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

const WIZ_STEPS = ['waiting_for_type', 'waiting_for_state', 'waiting_for_price', 'waiting_for_phone', 'waiting_for_description', 'waiting_for_media', 'waiting_for_payment_receipt'];
const WIZ_KEYS = ['property_type', 'state_name', 'price', 'phone', 'description', 'media_url', null];

const WIZ = {
  ar: {
    title: '🏢 <b>نشر عقار جديد وإتمام الدفع</b>',
    step: (n, total) => `الخطوة ${n} من ${total}`,
    labels: ['🏠 النوع', '📍 الولاية', '💰 السعر', '📞 الهاتف', '📝 الوصف', '📸 الوسائط', '💳 وصل الدفع'],
    prompts: [
      'اختر <b>نوع العقار</b> من الأزرار أدناه:',
      'اختر <b>الولاية</b> من الأزرار أدناه:',
      'أرسل الآن <b>السعر المطلوب</b>:',
      'أدخل <b>رقم الهاتف للتواصل</b>:',
      'أدخل <b>الوصف التفصيلي</b> للعقار:',
      'أرسل الآن <b>صورة أو فيديو العقار</b>:',
      'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:'
    ],
    back: '⬅️ رجوع',
    home: '🏠 القائمة الرئيسية',
    cancelBtn: '❌ إلغاء العملية والعودة',
    publishing: '⏳ جاري رفع الإعلان ووصل الدفع للإدارة...'
  },
  fr: {
    title: '🏢 <b>Nouvelle annonce & Paiement</b>',
    step: (n, total) => `Étape ${n} sur ${total}`,
    labels: ['🏠 Type', '📍 Wilaya', '💰 Prix', '📞 Téléphone', '📝 Description', '📸 Média', '💳 Reçu'],
    prompts: [
      'Choisissez le type :',
      'Choisissez la wilaya :',
      'Prix demandé :',
      'Téléphone :',
      'Description :',
      'Photo ou vidéo :',
      'Envoyez le reçu de paiement :'
    ],
    back: '⬅️ Retour',
    home: '🏠 Menu principal',
    cancelBtn: '❌ Annuler',
    publishing: '⏳ Envoi...'
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

  const desc = d.description ? (d.description.length > 200 ? d.description.slice(0, 200) + '…' : d.description) : null;
  const values = [d.property_type, d.state_name, d.price, d.phone, desc, d.media_label || opts.mediaText || null, d.receipt_label || null];

  const lines = values.map((val, i) => {
    let mark = val ? '✅' : (i === active ? '👉' : '▫️');
    return `${mark} ${W.labels[i]}: ${val ? '<b>' + escapeHtml(val) + '</b>' : '…'}`;
  });

  const footer = opts.footer !== undefined ? opts.footer : (active === 6 ? STRINGS[userLang[userId] || 'ar'].paymentPrompt : W.prompts[active]);
  return `${head}\n${bar}\n\n${lines.join('\n')}` + (footer ? `\n\n${footer}` : '');
}

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

async function renderWizard(ctx, userId, opts = {}) {
  const state = userState[userId];
  if (!state) return;

  const text = buildWizardText(userId, state, opts);

  if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
    try {
      await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {}
    return;
  }

  const keyboard = opts.noKeyboard ? getMainMenuKeyboard(userId) : getWizardKeyboard(userId, state);
  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });

  const oldId = state.wizardMsgId;
  state.wizardMsgId = sent.message_id;
  state.chatId = ctx.chat.id;

  if (oldId) {
    await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
  }
}

bot.hears(PROPERTY_TYPES, async (ctx, next) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_type') return next();

  await safeDeleteUserMessage(ctx);
  state.data.property_type = ctx.message.text;
  state.step = 'waiting_for_state';
  await renderWizard(ctx, userId);
});

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
    ctx.reply(t(userId, 'welcome', userName), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
  } else {
    ctx.reply(t(userId, 'authPrompt', userName), { parse_mode: 'HTML', ...getAuthKeyboard(userId) });
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

  ctx.reply(userLang[userId] === 'fr' ? '✅ Retour au menu principal :' : '✅ العودة إلى القائمة الرئيسية:', {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard(userId)
  });
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
    await supabase.from('users').insert([{ id: userId, first_name: firstName, phone_number: phoneNumber }]);
    ctx.reply(lang === 'ar' ? '🎉 <b>تم توثيق حسابك بنجاح!</b>' : '🎉 <b>Compte vérifié !</b>', {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userId)
    });
  } catch (err) {
    ctx.reply(t(userId, 'errorMsg'));
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
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
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
    const { data } = await supabase.from('test_messages').select('state_name');
    if (!data || data.length === 0) return ctx.reply(t(userId, 'noProperties'), getMainMenuKeyboard(userId));

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
    const stateButtons = uniqueStates.map(state => `📍 ${state}`);
    const chunkedStates = chunkButtons(stateButtons, 4);
    chunkedStates.push(['🌐 الكل'], ['🏠 القائمة الرئيسية']);

    ctx.reply(t(userId, 'browseTitle'), { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() });
  } catch (err) {
    ctx.reply(t(userId, 'errorMsg'));
  }
}

bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  delete browsingSession[ctx.from.id];
  showStatesMenu(ctx);
});

bot.hears(['📍 تغيير الولاية', '📍 Changer Wilaya', 'تغيير الولاية'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  delete browsingSession[ctx.from.id];
  showStatesMenu(ctx);
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
    renderPropertyPage(ctx, userId, 0);
  }
});

bot.hears(['🌐 الكل', '🌐 Tous'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  browsingSession[ctx.from.id] = { state: 'ALL', page: 0 };
  renderPropertyPage(ctx, ctx.from.id, 0);
});

async function renderPropertyPage(ctx, userId, pageIndex) {
  const session = browsingSession[userId];
  if (!session) return;

  session.page = pageIndex;
  session.selectingPage = false;

  try {
    let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
    if (session.state !== 'ALL') query = query.eq('state_name', session.state);

    const { data } = await query;
    if (!data || data.length === 0) return ctx.reply('📭 عذراً، لا توجد عقارات مسجلة.', getMainMenuKeyboard(userId));

    if (pageIndex < 0) pageIndex = 0;
    if (pageIndex >= data.length) pageIndex = data.length - 1;
    session.page = pageIndex;

    const item = data[pageIndex];
    const caption = `🏛 <b>الولاية:</b> ${item.state_name} (${pageIndex + 1}/${data.length})\n\n🏠 <b>العقار:</b> ${item.property_type}\n💰 <b>السعر:</b> ${item.price}\n📞 <b>الهاتف:</b> <code>${item.phone}</code>\n📝 <b>الوصف:</b> ${item.description || item.message}`;

    const inlineKb = Markup.inlineKeyboard([[Markup.button.callback(t(userId, 'contactBtn'), 'contact_admin')]]);
    const replyKb = getBrowsingKeyboard(userId, pageIndex, data.length);

    if (session.lastMessageId) await ctx.telegram.deleteMessage(ctx.chat.id, session.lastMessageId).catch(() => {});

    let sentMsg;
    const mediaRef = (v) => (v.startsWith('tg:')) ? v.slice(3) : v;
    if (item.video_url && item.video_url !== 'EMPTY') {
      sentMsg = await ctx.replyWithVideo(mediaRef(item.video_url), { caption, parse_mode: 'HTML', ...inlineKb, ...replyKb });
    } else if (item.image_url && item.image_url !== 'EMPTY') {
      sentMsg = await ctx.replyWithPhoto(mediaRef(item.image_url), { caption, parse_mode: 'HTML', ...inlineKb, ...replyKb });
    } else {
      sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...inlineKb, ...replyKb });
    }
    if (sentMsg) session.lastMessageId = sentMsg.message_id;
  } catch (err) {
    ctx.reply(t(userId, 'errorMsg'));
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
  if (session.state !== 'ALL') query = query.eq('state_name', session.state);
  const { data } = await query;
  const totalCount = data ? data.length : 0;

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

bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const old = userState[userId];
  if (old && old.wizardMsgId) await ctx.telegram.deleteMessage(old.chatId, old.wizardMsgId).catch(() => {});

  userState[userId] = { step: 'waiting_for_type', data: {}, chatId: ctx.chat.id, wizardMsgId: null };
  renderWizard(ctx, userId);
});

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
  renderWizard(ctx, userId);
});

// 📸 استلام صورة العقار ثم الانتقال لخطوة دفع الوصل
bot.on('photo', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    state.data.media_file_id = photo.file_id;
    state.data.media_type = 'photo';
    state.data.media_label = '🖼 تم إرفاق الصورة';

    state.step = 'waiting_for_payment_receipt';
    return renderWizard(ctx, userId);
  }

  // 💳 استلام وصل الدفع وإرساله للأدمن للمراجعة
  if (state && state.step === 'waiting_for_payment_receipt') {
    const receiptPhoto = ctx.message.photo[ctx.message.photo.length - 1];
    state.step = 'publishing';

    try {
      await renderWizard(ctx, userId, { footer: WIZ[userLang[userId] || 'ar'].publishing });

      let mediaUrl = `tg:${state.data.media_file_id}`;
      try {
        const fileLink = await ctx.telegram.getFileLink(state.data.media_file_id);
        const res = await fetch(fileLink.href);
        const buf = Buffer.from(await res.arrayBuffer());
        const fileName = `${Date.now()}_aqar.jpg`;
        await supabase.storage.from('test_media').upload(fileName, buf, { contentType: 'image/jpeg', upsert: true });
        const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
        mediaUrl = pubUrl.publicUrl;
      } catch (e) {}

      const adminCaption = 
        `🚨 <b>طلب إعلان عقاري جديد بانتظار المراجعة!</b>\n\n` +
        `👤 <b>المعرف (ID):</b> <code>${userId}</code>\n` +
        `🏠 <b>النوع:</b> ${state.data.property_type}\n` +
        `📍 <b>الولاية:</b> ${state.data.state_name}\n` +
        `💰 <b>السعر:</b> ${state.data.price}\n` +
        `📞 <b>الهاتف:</b> ${state.data.phone}\n` +
        `📝 <b>الوصف:</b> ${state.data.description}`;

      await ctx.telegram.sendPhoto(ADMIN_ID, receiptPhoto.file_id, {
        caption: adminCaption + `\n\n👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ قرار:</b>`,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ قبول ونشر', `approve_${userId}`),
            Markup.button.callback('❌ رفض', `reject_${userId}`)
          ]
        ])
      });

      global.pendingProperties = global.pendingProperties || {};
      global.pendingProperties[userId] = {
        property_type: state.data.property_type,
        state_name: state.data.state_name,
        price: String(state.data.price),
        phone: String(state.data.phone),
        description: state.data.description,
        message: state.data.description,
        image_url: mediaUrl,
        video_url: 'EMPTY'
      };

      await ctx.reply(t(userId, 'paymentPending'), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
      delete userState[userId];
    } catch (err) {
      ctx.reply(t(userId, 'errorMsg'), getMainMenuKeyboard(userId));
      delete userState[userId];
    }
  }
});

// 🎥 دعم الفيديو أيضاً في خطوة وسائط العقار
bot.on('video', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    const video = ctx.message.video;
    state.data.media_file_id = video.file_id;
    state.data.media_type = 'video';
    state.data.media_label = '🎥 تم إرفاق الفيديو';

    state.step = 'waiting_for_payment_receipt';
    return renderWizard(ctx, userId);
  }
});

// 🛠️ أزرار تفاعل الأدمن (قبول أو رفض الإعلان)
const handleAdminAction = async (ctx, action) => {
  const userIdStr = ctx.match[1];
  const targetUserId = Number(userIdStr);
  const lang = userLang[targetUserId] || 'ar';

  await ctx.answerCbQuery();

  if (action === 'approve') {
    const propData = global.pendingProperties && global.pendingProperties[targetUserId];
    if (propData) {
      // في حال كان الفيديو مرفوعاً كـ tg: نضعه في video_url
      if (propData.image_url && propData.image_url.startsWith('tg:') && propData.media_type === 'video') {
        propData.video_url = propData.image_url;
        propData.image_url = 'EMPTY';
      }
      const { error } = await supabase.from('test_messages').insert([propData]);
      if (!error) {
        await ctx.telegram.sendMessage(targetUserId, STRINGS[lang].successPublish, { parse_mode: 'HTML' });
        delete global.pendingProperties[targetUserId];
      }
    }
    await ctx.editMessageCaption(`✅ <b>تم قبول إعلان المستخدم (${targetUserId}) ونشره بنجاح.</b>`, { parse_mode: 'HTML' });
  } else {
    await ctx.telegram.sendMessage(targetUserId, STRINGS[lang].rejectPublish, { parse_mode: 'HTML' });
    if (global.pendingProperties) delete global.pendingProperties[targetUserId];
    await ctx.editMessageCaption(`❌ <b>تم رفض إعلان المستخدم (${targetUserId}).</b>`, { parse_mode: 'HTML' });
  }
};

bot.action(/^approve_(.+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
bot.action(/^reject_(.+)$/, (ctx) => handleAdminAction(ctx, 'reject'));

const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Payment System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
