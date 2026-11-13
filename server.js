
'use strict';

// ============================================================
// 1. IMPORTS & CONFIGURATION
// ============================================================

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;

const WEBHOOK_DOMAIN = (
  process.env.WEBHOOK_DOMAIN || ''
).replace(/\/+$/, '');

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://jjrisfyotyryanhbsvlz.supabase.co';

// استخدم المفتاح السري للخادم فقط
// يدعم المفتاح الجديد SUPABASE_SECRET_KEY
// أو SUPABASE_KEY الذي يحتوي على service_role

const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY;

const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('STARTUP ERROR: BOT_TOKEN is missing!');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('STARTUP ERROR: Supabase credentials are missing!');
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in Render.');
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json({ limit: '2mb' }));

// ============================================================
// 2. GLOBAL STATE
// ============================================================

const userState = {};
const userLang = {};
const browsingSession = {};

const POPULAR_WILAYAS = [
  'الجزائر العاصمة',
  'وهران',
  'مستغانم',
  'قسنطينة',
  'عنابة',
  'البليدة',
  'تلمسان',
  'سطيف',
  'بجاية'
];

const PROPERTY_TYPES = [
  'شقة',
  'فيلا',
  'منزل',
  'قطعة أرض',
  'محل تجاري'
];

// ============================================================
// 3. TRANSLATIONS
// ============================================================

const STRINGS = {
  ar: {
    welcome: (name) =>
      `أهلاً بك يا <b>${name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:`,

    authPrompt: (name) =>
      `أهلاً بك يا <b>${name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`,

    browseTitle:
      '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>',

    noProperties:
      '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.',

    step1Type:
      '🏢 <b>معالج نشر عقار جديد (الخطوة 1 من 5)</b>\n\nاختر <b>نوع العقار</b> من الأزرار أسفل الشاشة:',

    step2State: (type) =>
      `✅ تم تحديد النوع: <b>${type}</b>\n\n📍 <b>الخطوة 2:</b> اختر الولاية من الأزرار أسفل الشاشة:`,

    step3Price: (state) =>
      `✅ الولاية: <b>${state}</b>\n\n💰 <b>الخطوة 3:</b> أرسل الآن <b>السعر المطلوب</b>:`,

    step4Phone: (price) =>
      `✅ السعر: <b>${price}</b>\n\n📞 <b>الخطوة 4:</b> أدخل <b>رقم الهاتف للتواصل</b>:`,

    step5Desc: (phone) =>
      `✅ رقم الهاتف: <b>${phone}</b>\n\n📝 <b>الخطوة 5:</b> أدخل <b>الوصف التفصيلي</b> للعقار:`,

    step6Media:
      '✅ تم تسجيل كافة البيانات!\n\n📸 <b>الخطوة الأخيرة:</b> أرسل الآن <b>صورة أو فيديو العقار</b> لإتمام النشر.',

    successPublish:
      '🎉 <b>تم نشر إعلان العقار بنجاح في المنصة!</b>',

    supportText:
      '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً.',

    aboutText:
      '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.',

    langChanged:
      '✅ تم اعتماد اللغة العربية.',

    errorMsg:
      '⚠️ حدث خطأ أثناء الحفظ، يرجى المحاولة مرة أخرى.',

    contactBtn:
      '📞 اتصال بالمالك',

    authBtnText:
      '📱 اضغط هنا لمشاركة رقم هاتفك والبدء'
  },

  fr: {
    welcome: (name) =>
      `Bienvenue <b>${name}</b> sur <b>Aqar Algérie</b> 🏠\n\nSystème numérique professionnel de gestion immobilière. Choisissez :`,

    authPrompt: (name) =>
      `Bienvenue <b>${name}</b> sur <b>Aqar Algérie</b> 🏠\n\n⚠️ <b>Sécurité:</b>\nVeuillez <b>confirmer votre numéro de téléphone</b> :`,

    browseTitle:
      "🔍 <b>Choisissez la wilaya en bas de l'écran :</b>",

    noProperties:
      '📭 Désolé, aucun bien enregistré.',

    step1Type:
      '🏢 <b>Assistant de publication (Étape 1 sur 5)</b>\n\nChoisissez le <b>type de bien</b> :',

    step2State: (type) =>
      `✅ Type sélectionné: <b>${type}</b>\n\n📍 <b>Étape 2:</b> Choisissez la wilaya :`,

    step3Price: (state) =>
      `✅ Wilaya: <b>${state}</b>\n\n💰 <b>Étape 3:</b> Envoyez le <b>prix demandé</b> :`,

    step4Phone: (price) =>
      `✅ Prix: <b>${price}</b>\n\n📞 <b>Étape 4:</b> Entrez votre <b>numéro de téléphone</b> :`,

    step5Desc: (phone) =>
      `📞 Téléphone: <b>${phone}</b>\n\n📝 <b>Étape 5:</b> Entrez la <b>description détaillée</b> :`,

    step6Media:
      '✅ Données enregistrées !\n\n📸 <b>Dernière étape:</b> Envoyez une <b>photo ou vidéo</b>.',

    successPublish:
      '🎉 <b>Le bien a été publié avec succès !</b>',

    supportText:
      '📞 <b>Support Technique - Aqar Algérie:</b>\n\nNous sommes à votre service.',

    aboutText:
      "🏛 <b>À propos d'Aqar Algérie:</b>\n\nSystème numérique intelligent.",

    langChanged:
      '✅ La langue française a été activée.',

    errorMsg:
      '⚠️ Une erreur est survenue.',

    contactBtn:
      '📞 Contacter le propriétaire',

    authBtnText:
      '📱 Partager mon numéro et commencer'
  }
};

// ============================================================
// 4. TRANSLATION FUNCTION
// ============================================================

function t(userId, key, ...args) {
  const lang = userLang[userId] || 'ar';

  const val =
    STRINGS[lang][key] ||
    STRINGS.ar[key];

  return typeof val === 'function'
    ? val(...args)
    : val;
}

// ============================================================
// 5. KEYBOARDS
// ============================================================

function chunkButtons(buttonsArray, chunkSize = 4) {
  const chunked = [];

  for (
    let i = 0;
    i < buttonsArray.length;
    i += chunkSize
  ) {
    chunked.push(
      buttonsArray.slice(i, i + chunkSize)
    );
  }

  return chunked;
}

function getMainMenuKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';

  return Markup.keyboard([
    [
      isAr
        ? '🔍 تصفح العقارات المتاحة'
        : '🔍 Parcourir les biens',

      isAr
        ? '➕ إضافة عقار جديد'
        : '➕ Ajouter un bien'
    ],
    [
      isAr
        ? '📞 الدعم والإدارة'
        : '📞 Support & Contact',

      isAr
        ? '🌐 تغيير اللغة / Langue'
        : '🌐 Langue / اللغة'
    ],
    [
      isAr
        ? 'ℹ️ عن المنصة'
        : 'ℹ️ À propos'
    ],
    [
      isAr
        ? '🌐 تصفح الموقع الرسمي (البروزر)'
        : '🌐 Site Officiel (Navigateur)'
    ]
  ]).resize();
}

function getBrowsingKeyboard(
  userId,
  currentIndex,
  totalCount
) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';

  const prevBtn = isAr
    ? '⬅️ السابق'
    : '⬅️ Précédent';

  const nextBtn = isAr
    ? 'التالي ➡️'
    : 'Suivant ➡️';

  const counterText =
    `📄 ${currentIndex + 1} / ${totalCount}`;

  const changeWilayaBtn = isAr
    ? '📍 تغيير الولاية'
    : '📍 Changer Wilaya';

  const homeBtn = isAr
    ? '🏠 القائمة الرئيسية'
    : '🏠 Menu principal';

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

function getCancelKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  const isAr = lang === 'ar';

  return Markup.keyboard([
    [
      isAr
        ? '🏠 القائمة الرئيسية'
        : '🏠 Menu principal'
    ],
    [
      isAr
        ? '❌ إلغاء العملية والعودة'
        : '❌ Annuler et quitter'
    ]
  ]).resize();
}

function getAuthKeyboard(userId) {
  const lang = userLang[userId] || 'ar';

  return Markup.keyboard([
    [
      Markup.button.contactRequest(
        STRINGS[lang].authBtnText
      )
    ]
  ]).resize().oneTime();
}

// ============================================================
// 6. SUPABASE USER VERIFICATION
// ============================================================

async function isUserVerified(telegramId) {
  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('id')
      .eq('price', `ID: ${telegramId}`)
      .limit(1);

    if (error) {
      console.error(
        'USER VERIFICATION ERROR:',
        error.message
      );

      return false;
    }

    return data && data.length > 0;

  } catch (err) {
    console.error(
      'USER VERIFICATION FAILURE:',
      err
    );

    return false;
  }
}

// ============================================================
// 7. DELETE USER MESSAGE
// ============================================================

async function safeDeleteUserMessage(ctx) {
  try {
    if (
      ctx.message &&
      ctx.message.message_id
    ) {
      await ctx.telegram
        .deleteMessage(
          ctx.chat.id,
          ctx.message.message_id
        )
        .catch(() => {});
    }
  } catch (e) {}
}

// ============================================================
// 8. GET UNIQUE WILAYAS
// ============================================================

async function getUniqueStatesList() {
  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('state_name');

    if (error) {
      console.error(
        'GET STATES ERROR:',
        error.message
      );

      return [];
    }

    if (!data) return [];

    return [
      ...new Set(
        data
          .map(item => item.state_name)
          .filter(Boolean)
      )
    ];

  } catch (e) {
    console.error(e);
    return [];
  }
}

// ============================================================
// 9. CENTRAL PROPERTY PUBLISH ENGINE
// ============================================================

async function publishProperty(
  state,
  userId,
  mediaType,
  buffer,
  contentType
) {
  let uploadedFileName = null;

  try {

    if (!state || !state.data) {
      throw new Error('PROPERTY_STATE_MISSING');
    }

    const p = state.data;

    // التحقق من البيانات

    if (!p.property_type) {
      throw new Error('PROPERTY_TYPE_MISSING');
    }

    if (!p.state_name) {
      throw new Error('PROPERTY_STATE_MISSING');
    }

    if (
      !p.price ||
      !p.phone ||
      !p.description
    ) {
      throw new Error('PROPERTY_DATA_INCOMPLETE');
    }

    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length === 0
    ) {
      throw new Error('INVALID_MEDIA_BUFFER');
    }

    // إنشاء اسم فريد للملف

    const extension =
      mediaType === 'photo' ? 'jpg' : 'mp4';

    uploadedFileName =
      `properties/${userId}/${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}.${extension}`;

    console.log(
      'AQAR: Starting media upload:',
      uploadedFileName
    );

    // رفع الملف

    const {
      data: uploadData,
      error: uploadError
    } = await supabase.storage
      .from('test_media')
      .upload(
        uploadedFileName,
        buffer,
        {
          contentType: contentType,
          upsert: false
        }
      );

    if (uploadError) {
      throw new Error(
        `STORAGE_UPLOAD_ERROR: ${uploadError.message}`
      );
    }

    if (!uploadData) {
      throw new Error(
        'STORAGE_UPLOAD_NO_DATA'
      );
    }

    console.log('AQAR: Media uploaded successfully.');

    // استخراج الرابط العام

    const { data: publicURLData } =
      supabase.storage
        .from('test_media')
        .getPublicUrl(uploadedFileName);

    const mediaURL =
      publicURLData?.publicUrl;

    if (!mediaURL) {
      throw new Error(
        'PUBLIC_URL_GENERATION_FAILED'
      );
    }

    // تجهيز سجل العقار

    const propertyRecord = {
      property_type: String(p.property_type),
      state_name: String(p.state_name),
      price: String(p.price),
      phone: String(p.phone),
      description: String(p.description),
      message: String(p.description),

      image_url:
        mediaType === 'photo'
          ? mediaURL
          : 'EMPTY',

      video_url:
        mediaType === 'video'
          ? mediaURL
          : 'EMPTY'
    };

    console.log(
      'AQAR: Inserting property into database...'
    );

    // تسجيل العقار في جدول Supabase

    const {
      data: insertedData,
      error: insertError
    } = await supabase
      .from('test_messages')
      .insert([propertyRecord])
      .select('id')
      .single();

    if (insertError) {
      throw new Error(
        `DATABASE_INSERT_ERROR: ${insertError.message}`
      );
    }

    if (
      !insertedData ||
      !insertedData.id
    ) {
      throw new Error(
        'DATABASE_INSERT_NOT_CONFIRMED'
      );
    }

    // نجاح النشر

    console.log('================================');
    console.log('AQAR PROPERTY PUBLISHED SUCCESSFULLY');
    console.log('Property ID:', insertedData.id);
    console.log('User ID:', userId);
    console.log('Media Type:', mediaType);
    console.log('File:', uploadedFileName);
    console.log('================================');

    return {
      success: true,
      propertyId: insertedData.id,
      mediaURL: mediaURL
    };

  } catch (error) {

    console.error(
      'AQAR PUBLISH ERROR:',
      error.message
    );

    // حذف الملف إذا فشل تسجيل العقار

    if (uploadedFileName) {
      try {
        const { error: cleanupError } =
          await supabase.storage
            .from('test_media')
            .remove([uploadedFileName]);

        if (cleanupError) {
          console.error(
            'STORAGE CLEANUP ERROR:',
            cleanupError.message
          );
        }

      } catch (cleanupError) {
        console.error(
          'STORAGE CLEANUP FAILURE:',
          cleanupError
        );
      }
    }

    throw error;
  }
}

// ============================================================
// 10. START COMMAND
// ============================================================

bot.start(async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');

  const userName =
    ctx.from.first_name || 'مستخدمنا الكريم';

  const userId = ctx.from.id;

  delete userState[userId];
  delete browsingSession[userId];

  userLang[userId] =
    userLang[userId] || 'ar';

  const verified =
    await isUserVerified(userId);

  if (verified) {

    await ctx.reply(
      t(userId, 'welcome', userName),
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );

  } else {

    await ctx.reply(
      t(userId, 'authPrompt', userName),
      {
        parse_mode: 'HTML',
        ...getAuthKeyboard(userId)
      }
    );
  }
});

// ============================================================
// 11. HOME & CANCEL
// ============================================================

bot.hears(
  [
    '❌ إلغاء العملية والعودة',
    '❌ Annuler et quitter',
    '🏠 القائمة الرئيسية',
    '🏠 Menu principal'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    delete userState[userId];
    delete browsingSession[userId];

    await ctx.reply(
      userLang[userId] === 'fr'
        ? '✅ Retour au menu principal :'
        : '✅ العودة إلى القائمة الرئيسية:',
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );
  }
);

// ============================================================
// 12. CONTACT VERIFICATION
// ============================================================

bot.on('contact', async (ctx) => {

  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');

  const contact = ctx.message.contact;

  const phoneNumber = contact.phone_number;

  const firstName =
    ctx.from.first_name || '';

  const userId = ctx.from.id;

  const lang =
    userLang[userId] || 'ar';

  // التأكد من أن رقم الهاتف يعود للمستخدم نفسه

  if (
    contact.user_id &&
    contact.user_id !== userId
  ) {
    return ctx.reply(
      lang === 'ar'
        ? '⚠️ يرجى مشاركة رقم هاتفك الشخصي.'
        : '⚠️ Veuillez partager votre propre numéro.'
    );
  }

  try {

    const { error } = await supabase
      .from('test_messages')
      .insert([
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

    if (error) {
      throw error;
    }

    await ctx.reply(
      lang === 'ar'
        ? '🎉 <b>تم توثيق حسابك بنجاح!</b>\n\nأصبح بإمكانك استخدام المنصة بكامل ميزاتها:'
        : '🎉 <b>Compte vérifié avec succès !</b>',
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );

  } catch (err) {

    console.error(
      'CONTACT VERIFICATION ERROR:',
      err
    );

    await ctx.reply(
      t(userId, 'errorMsg')
    );
  }
});

// ============================================================
// 13. OFFICIAL WEBSITE
// ============================================================

bot.hears(
  [
    '🌐 تصفح الموقع الرسمي (البروزر)',
    '🌐 Site Officiel (Navigateur)'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    await ctx.reply(
      '🌐 <b>رابط منصة عقار الجزائر (ويب):</b>\n\nانقر على الزر أدناه لفتح الموقع وتصفحه في متصفح الهاتف:',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url(
              '🚀 فتح الموقع الآن',
              'https://hosnihicham.github.io/testHTML'
            )
          ]
        ])
      }
    );
  }
);

// ============================================================
// 14. AUTHENTICATION MIDDLEWARE
// ============================================================

bot.use(async (ctx, next) => {

  if (
    ctx.message &&
    ctx.message.text &&
    ctx.message.text.startsWith('/')
  ) {
    return next();
  }

  if (
    ctx.from &&
    ctx.message &&
    (
      ctx.message.text?.includes('تصفح') ||
      ctx.message.text?.includes('إضافة') ||
      ctx.message.text?.includes('Parcourir') ||
      ctx.message.text?.includes('Ajouter')
    )
  ) {

    const verified =
      await isUserVerified(ctx.from.id);

    if (!verified) {

      return ctx.reply(
        '⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:',
        getAuthKeyboard(ctx.from.id)
      );
    }
  }

  return next();
});

// ============================================================
// 15. SHOW WILAYAS MENU
// ============================================================

async function showStatesMenu(ctx) {

  const userId = ctx.from.id;

  try {

    const { data, error } = await supabase
      .from('test_messages')
      .select('state_name');

    if (
      error ||
      !data ||
      data.length === 0
    ) {
      return ctx.reply(
        t(userId, 'noProperties'),
        getMainMenuKeyboard(userId)
      );
    }

    const uniqueStates = [
      ...new Set(
        data
          .map(item => item.state_name)
          .filter(Boolean)
      )
    ];

    if (uniqueStates.length === 0) {

      return ctx.reply(
        t(userId, 'noProperties'),
        getMainMenuKeyboard(userId)
      );
    }

    const stateButtons =
      uniqueStates.map(
        state => `📍 ${state}`
      );

    const chunkedStates =
      chunkButtons(stateButtons, 4);

    chunkedStates.push(['🌐 الكل']);
    chunkedStates.push(['🏠 القائمة الرئيسية']);

    await ctx.reply(
      t(userId, 'browseTitle'),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(chunkedStates).resize()
      }
    );

  } catch (err) {

    console.error(
      'FETCH STATES ERROR:',
      err
    );

    await ctx.reply(
      t(userId, 'errorMsg')
    );
  }
}

// ============================================================
// 16. BROWSE PROPERTIES
// ============================================================

bot.hears(
  [
    '🔍 تصفح العقارات المتاحة',
    '🔍 Parcourir les biens'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    delete browsingSession[userId];

    await showStatesMenu(ctx);
  }
);

bot.hears(
  [
    '📍 تغيير الولاية',
    '📍 Changer Wilaya',
    'تغيير الولاية'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    delete browsingSession[userId];

    await showStatesMenu(ctx);
  }
);

// ============================================================
// 17. SELECT WILAYA
// ============================================================

bot.hears(/^📍 (.+)/, async (ctx) => {

  await safeDeleteUserMessage(ctx);

  const userId = ctx.from.id;

  const selectedState =
    ctx.match[1].trim();

  const state = userState[userId];

  if (
    state &&
    state.step === 'waiting_for_state'
  ) {

    state.data.state_name =
      selectedState;

    state.step = 'waiting_for_price';

    return ctx.reply(
      t(userId, 'step3Price', selectedState),
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }

  const stateList =
    await getUniqueStatesList();

  if (stateList.includes(selectedState)) {

    browsingSession[userId] = {
      state: selectedState,
      page: 0
    };

    await renderPropertyPage(
      ctx,
      userId,
      0
    );
  }
});

// ============================================================
// 18. ALL PROPERTIES
// ============================================================

bot.hears(
  ['🌐 الكل', '🌐 Tous'],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    browsingSession[userId] = {
      state: 'ALL',
      page: 0
    };

    await renderPropertyPage(
      ctx,
      userId,
      0
    );
  }
);

// ============================================================
// 19. RENDER PROPERTY PAGE
// ============================================================

async function renderPropertyPage(
  ctx,
  userId,
  pageIndex
) {

  const session =
    browsingSession[userId];

  if (!session) return;

  const stateQuery = session.state;

  session.page = pageIndex;
  session.selectingPage = false;

  try {

    let query = supabase
      .from('test_messages')
      .select('*')
      .order('id', { ascending: false });

    if (stateQuery !== 'ALL') {
      query = query.eq(
        'state_name',
        stateQuery
      );
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {

      return ctx.reply(
        '📭 عذراً، لا توجد أي عقارات مسجلة.',
        getMainMenuKeyboard(userId)
      );
    }

    const validProperties = data.filter(
      item =>
        item.property_type !==
        '⭐ توثيق حساب اجباري'
    );

    if (validProperties.length === 0) {

      return ctx.reply(
        '📭 عذراً، لا توجد أي عقارات مسجلة.',
        getMainMenuKeyboard(userId)
      );
    }

    if (pageIndex < 0) {
      pageIndex = 0;
    }

    if (
      pageIndex >= validProperties.length
    ) {
      pageIndex =
        validProperties.length - 1;
    }

    session.page = pageIndex;

    const item =
      validProperties[pageIndex];

    const totalCount =
      validProperties.length;

    const caption =
      `🏛 <b>الولاية:</b> ${item.state_name || 'غير محدد'} (${pageIndex + 1}/${totalCount})\n\n` +
      `🏠 <b>العقار:</b> ${item.property_type || 'عقار'}\n` +
      `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
      `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
      `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

    const inlineKb =
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            t(userId, 'contactBtn'),
            'contact_admin'
          )
        ]
      ]);

    const replyKb =
      getBrowsingKeyboard(
        userId,
        pageIndex,
        totalCount
      );

    if (session.lastMessageId) {

      await ctx.telegram
        .deleteMessage(
          ctx.chat.id,
          session.lastMessageId
        )
        .catch(() => {});
    }

    let sentMsg;

    if (
      item.video_url &&
      item.video_url !== 'EMPTY'
    ) {

      sentMsg = await ctx.replyWithVideo(
        item.video_url,
        {
          caption,
          parse_mode: 'HTML',
          ...inlineKb,
          ...replyKb
        }
      );

    } else if (
      item.image_url &&
      item.image_url !== 'EMPTY'
    ) {

      sentMsg = await ctx.replyWithPhoto(
        item.image_url,
        {
          caption,
          parse_mode: 'HTML',
          ...inlineKb,
          ...replyKb
        }
      );

    } else {

      sentMsg = await ctx.reply(
        caption,
        {
          parse_mode: 'HTML',
          ...inlineKb,
          ...replyKb
        }
      );
    }

    if (sentMsg) {
      session.lastMessageId =
        sentMsg.message_id;
    }

  } catch (err) {

    console.error(
      'PAGINATION ERROR:',
      err
    );

    await ctx.reply(
      t(userId, 'errorMsg')
    );
  }
}

// ============================================================
// 20. PAGE NUMBER SELECTION
// ============================================================

bot.hears(
  /^📄 \d+ \/ \d+$/,
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    const session =
      browsingSession[userId];

    const lang =
      userLang[userId] || 'ar';

    const isAr = lang === 'ar';

    if (!session) return;

    let query = supabase
      .from('test_messages')
      .select('*')
      .order('id', { ascending: false });

    if (session.state !== 'ALL') {
      query = query.eq(
        'state_name',
        session.state
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      return;
    }

    const validProps = data
      ? data.filter(
          item =>
            item.property_type !==
            '⭐ توثيق حساب اجباري'
        )
      : [];

    const totalCount =
      validProps.length;

    if (totalCount === 0) return;

    session.selectingPage = true;

    const numberButtons = [];

    let row = [];

    for (
      let i = 1;
      i <= totalCount;
      i++
    ) {

      row.push(`${i}`);

      if (row.length === 5) {
        numberButtons.push(row);
        row = [];
      }
    }

    if (row.length > 0) {
      numberButtons.push(row);
    }

    numberButtons.push([
      isAr
        ? '🔙 رجوع للعقار'
        : '🔙 Retour au bien'
    ]);

    await ctx.reply(
      isAr
        ? `🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`
        : `🔢 <b>Choisissez le numéro du bien (1 à ${totalCount}) :</b>`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(numberButtons).resize()
      }
    );
  }
);

// ============================================================
// 21. SELECT NUMBER
// ============================================================

bot.hears(/^\d+$/, async (ctx) => {

  const userId = ctx.from.id;

  const session =
    browsingSession[userId];

  if (
    session &&
    session.selectingPage
  ) {

    await safeDeleteUserMessage(ctx);

    const selectedNumber =
      parseInt(
        ctx.message.text.trim(),
        10
      );

    session.selectingPage = false;

    await renderPropertyPage(
      ctx,
      userId,
      selectedNumber - 1
    );
  }
});

// ============================================================
// 22. BACK TO PROPERTY
// ============================================================

bot.hears(
  [
    '🔙 رجوع للعقار',
    '🔙 Retour au bien'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    const session =
      browsingSession[userId];

    if (session) {

      session.selectingPage = false;

      await renderPropertyPage(
        ctx,
        userId,
        session.page
      );
    }
  }
);

// ============================================================
// 23. PREVIOUS PAGE
// ============================================================

bot.hears(
  [
    '⬅️ السابق',
    '⬅️ Précédent'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    const session =
      browsingSession[userId];

    if (
      session &&
      session.page > 0
    ) {

      await renderPropertyPage(
        ctx,
        userId,
        session.page - 1
      );
    }
  }
);

// ============================================================
// 24. NEXT PAGE
// ============================================================

bot.hears(
  [
    'التالي ➡️',
    'Suivant ➡️'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    const session =
      browsingSession[userId];

    if (session) {

      await renderPropertyPage(
        ctx,
        userId,
        session.page + 1
      );
    }
  }
);

// ============================================================
// 25. START ADD PROPERTY
// ============================================================

bot.hears(
  [
    '➕ إضافة عقار جديد',
    '➕ Ajouter un bien'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    userState[userId] = {
      step: 'waiting_for_type',
      data: {}
    };

    const typeButtons =
      PROPERTY_TYPES.map(
        type => `${type}`
      );

    const chunkedTypes =
      chunkButtons(typeButtons, 3);

    chunkedTypes.push([
      '🏠 القائمة الرئيسية'
    ]);

    await ctx.reply(
      t(userId, 'step1Type'),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(chunkedTypes).resize()
      }
    );
  }
);

// ============================================================
// 26. SELECT PROPERTY TYPE
// ============================================================

bot.hears(PROPERTY_TYPES, async (ctx) => {

  await safeDeleteUserMessage(ctx);

  const userId = ctx.from.id;

  const state =
    userState[userId];

  if (
    state &&
    state.step === 'waiting_for_type'
  ) {

    const selectedType =
      ctx.message.text;

    state.data.property_type =
      selectedType;

    state.step = 'waiting_for_state';

    const stateButtons =
      POPULAR_WILAYAS.map(
        w => `📍 ${w}`
      );

    const chunkedStates =
      chunkButtons(stateButtons, 4);

    chunkedStates.push([
      '🏠 القائمة الرئيسية'
    ]);

    await ctx.reply(
      t(
        userId,
        'step2State',
        selectedType
      ),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(chunkedStates).resize()
      }
    );
  }
});

// ============================================================
// 27. CHANGE LANGUAGE
// ============================================================

bot.hears(
  [
    '🌐 تغيير اللغة / Langue',
    '🌐 Langue / اللغة'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    await ctx.reply(
      '🌐 <b>اختر لغة النظام / Choisir la langue:</b>',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🇩🇿 العربية',
              'set_lang_ar'
            ),

            Markup.button.callback(
              '🇫🇷 Français',
              'set_lang_fr'
            )
          ]
        ])
      }
    );
  }
);

// ============================================================
// 28. SET ARABIC
// ============================================================

bot.action(
  'set_lang_ar',
  async (ctx) => {

    await ctx.answerCbQuery();

    userLang[ctx.from.id] = 'ar';

    await ctx.deleteMessage()
      .catch(() => {});

    await ctx.reply(
      t(ctx.from.id, 'langChanged'),
      getMainMenuKeyboard(ctx.from.id)
    );
  }
);

// ============================================================
// 29. SET FRENCH
// ============================================================

bot.action(
  'set_lang_fr',
  async (ctx) => {

    await ctx.answerCbQuery();

    userLang[ctx.from.id] = 'fr';

    await ctx.deleteMessage()
      .catch(() => {});

    await ctx.reply(
      t(ctx.from.id, 'langChanged'),
      getMainMenuKeyboard(ctx.from.id)
    );
  }
);

// ============================================================
// 30. SUPPORT
// ============================================================

bot.hears(
  [
    '📞 الدعم والإدارة',
    '📞 Support & Contact'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    await ctx.reply(
      t(ctx.from.id, 'supportText'),
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(ctx.from.id)
      }
    );
  }
);

// ============================================================
// 31. ABOUT
// ============================================================

bot.hears(
  [
    'ℹ️ عن المنصة',
    'ℹ️ À propos'
  ],
  async (ctx) => {

    await safeDeleteUserMessage(ctx);

    const userId = ctx.from.id;

    await ctx.reply(
      t(userId, 'aboutText'),
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );
  }
);

// ============================================================
// 32. TEXT INPUT ENGINE
// ============================================================

bot.on('text', async (ctx) => {

  const userId = ctx.from.id;

  const userText =
    ctx.message.text
      ? ctx.message.text.trim()
      : '';

  if (userText.startsWith('/')) {
    return;
  }

  if (
    userText.startsWith('📍') ||
    userText === '🌐 الكل' ||
    PROPERTY_TYPES.includes(userText)
  ) {
    return;
  }

  const state =
    userState[userId];

  if (!state) return;

  // استقبال السعر

  if (state.step === 'waiting_for_price') {

    await safeDeleteUserMessage(ctx);

    state.data.price = userText;

    state.step = 'waiting_for_phone';

    return ctx.reply(
      t(userId, 'step4Phone', userText),
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }

  // استقبال الهاتف

  else if (
    state.step === 'waiting_for_phone'
  ) {

    await safeDeleteUserMessage(ctx);

    state.data.phone = userText;

    state.step = 'waiting_for_description';

    return ctx.reply(
      t(userId, 'step5Desc', userText),
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }

  // استقبال الوصف

  else if (
    state.step === 'waiting_for_description'
  ) {

    await safeDeleteUserMessage(ctx);

    state.data.description = userText;

    state.step = 'waiting_for_media';

    return ctx.reply(
      t(userId, 'step6Media'),
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }
});

// ============================================================
// 33. PHOTO UPLOAD & PUBLISH
// ============================================================

bot.on('photo', async (ctx) => {

  const userId = ctx.from.id;

  const state =
    userState[userId];

  if (
    !state ||
    state.step !== 'waiting_for_media'
  ) {
    return;
  }

  await safeDeleteUserMessage(ctx);

  await ctx.sendChatAction('upload_photo');

  const statusMessage =
    await ctx.reply(
      '⏳ جاري رفع الصورة وتسجيل العقار في قاعدة البيانات...'
    );

  try {

    const photo =
      ctx.message.photo[
        ctx.message.photo.length - 1
      ];

    const fileLink =
      await ctx.telegram.getFileLink(
        photo.file_id
      );

    const response =
      await fetch(fileLink.href);

    if (!response.ok) {
      throw new Error(
        `TELEGRAM_DOWNLOAD_ERROR: ${response.status}`
      );
    }

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (buffer.length === 0) {
      throw new Error('EMPTY_IMAGE_FILE');
    }

    // محرك النشر المركزي

    const result =
      await publishProperty(
        state,
        userId,
        'photo',
        buffer,
        'image/jpeg'
      );

    if (!result.success) {
      throw new Error(
        'PROPERTY_PUBLISH_FAILED'
      );
    }

    // حذف الحالة بعد نجاح قاعدة البيانات فقط

    delete userState[userId];

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        statusMessage.message_id
      )
      .catch(() => {});

    await ctx.reply(
      `${t(userId, 'successPublish')}\n\n🆔 رقم الإعلان: ${result.propertyId}`,
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );

  } catch (err) {

    console.error(
      'PHOTO PUBLISH FAILURE:',
      err
    );

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        statusMessage.message_id
      )
      .catch(() => {});

    await ctx.reply(
      `⚠️ تعذر نشر العقار.\n\nبيانات العقار محفوظة مؤقتاً.\n\nيرجى إعادة إرسال الصورة للمحاولة مجدداً.`,
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }
});

// ============================================================
// 34. VIDEO UPLOAD & PUBLISH
// ============================================================

bot.on('video', async (ctx) => {

  const userId = ctx.from.id;

  const state =
    userState[userId];

  if (
    !state ||
    state.step !== 'waiting_for_media'
  ) {
    return;
  }

  await safeDeleteUserMessage(ctx);

  await ctx.sendChatAction('upload_video');

  const statusMessage =
    await ctx.reply(
      '⏳ جاري رفع الفيديو وتسجيل العقار في قاعدة البيانات...'
    );

  try {

    const video =
      ctx.message.video;

    const fileLink =
      await ctx.telegram.getFileLink(
        video.file_id
      );

    const response =
      await fetch(fileLink.href);

    if (!response.ok) {
      throw new Error(
        `TELEGRAM_DOWNLOAD_ERROR: ${response.status}`
      );
    }

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (buffer.length === 0) {
      throw new Error('EMPTY_VIDEO_FILE');
    }

    // محرك النشر المركزي

    const result =
      await publishProperty(
        state,
        userId,
        'video',
        buffer,
        video.mime_type || 'video/mp4'
      );

    if (!result.success) {
      throw new Error(
        'PROPERTY_PUBLISH_FAILED'
      );
    }

    // حذف الحالة بعد نجاح التسجيل فقط

    delete userState[userId];

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        statusMessage.message_id
      )
      .catch(() => {});

    await ctx.reply(
      `${t(userId, 'successPublish')}\n\n🆔 رقم الإعلان: ${result.propertyId}`,
      {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(userId)
      }
    );

  } catch (err) {

    console.error(
      'VIDEO PUBLISH FAILURE:',
      err
    );

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        statusMessage.message_id
      )
      .catch(() => {});

    await ctx.reply(
      '⚠️ تعذر نشر العقار.\n\nبيانات العقار محفوظة مؤقتاً.\n\nيرجى إعادة إرسال الفيديو للمحاولة مجدداً.',
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard(userId)
      }
    );
  }
});

// ============================================================
// 35. CONTACT OWNER CALLBACK
// ============================================================

bot.action(
  'contact_admin',
  async (ctx) => {

    await ctx.answerCbQuery(
      'يمكنك التواصل مع المالك عبر رقم الهاتف الظاهر في الإعلان.'
    );
  }
);

// ============================================================
// 36. GLOBAL ERROR HANDLER
// ============================================================

bot.catch((err, ctx) => {

  console.error(
    'TELEGRAM BOT ERROR:',
    err
  );

  console.error(
    'UPDATE TYPE:',
    ctx.updateType
  );
});

// ============================================================
// 37. EXPRESS HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {

  res.status(200).send(
    'Aqar Algeria Complete System is online 🚀'
  );
});

app.get('/health', (req, res) => {

  res.status(200).json({
    status: 'online',
    service: 'Aqar Algeria',
    telegram: 'configured',
    database: 'configured',
    mode: WEBHOOK_DOMAIN
      ? 'webhook'
      : 'polling',
    time: new Date().toISOString()
  });
});

// ============================================================
// 38. WEBHOOK ENDPOINT
// ============================================================

if (WEBHOOK_DOMAIN) {

  app.post(
    `/bot${BOT_TOKEN}`,
    async (req, res) => {

      // تأكيد استقبال التحديث

      res.sendStatus(200);

      try {

        if (
          req.body &&
          req.body.update_id
        ) {

          await bot.handleUpdate(
            req.body
          );
        }

      } catch (err) {

        console.error(
          'WEBHOOK PROCESSING ERROR:',
          err
        );
      }
    }
  );
}

// ============================================================
// 39. SERVER STARTUP
// ============================================================

let server;

async function startServer() {

  try {

    console.log('================================');
    console.log('AQAR SYSTEM STARTING...');
    console.log('Telegram Token: OK');
    console.log('Supabase URL: OK');
    console.log('Supabase Credentials: OK');
    console.log(
      'Webhook Mode:',
      WEBHOOK_DOMAIN ? 'ON' : 'OFF'
    );
    console.log('Port:', PORT);
    console.log('================================');

    // تشغيل HTTP Server في جميع الحالات
    // هذا ضروري لـ Render Web Service

    await new Promise((resolve, reject) => {

      server = app.listen(
        PORT,
        '0.0.0.0',
        () => {

          console.log(
            `HTTP SERVER RUNNING ON PORT ${PORT}`
          );

          resolve();
        }
      );

      server.once('error', reject);
    });

    // اختيار وضع تشغيل Telegram

    if (WEBHOOK_DOMAIN) {

      console.log(
        'Starting Telegram Webhook...'
      );

      const webhookURL =
        `${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`;

      await bot.telegram.setWebhook(
        webhookURL
      );

      console.log(
        'WEBHOOK SET SUCCESSFULLY'
      );

      console.log(
        'Webhook URL:',
        `${WEBHOOK_DOMAIN}/bot[HIDDEN]`
      );

    } else {

      console.log(
        'Starting Telegram Polling...'
      );

      await bot.launch();

      console.log(
        'TELEGRAM POLLING STARTED SUCCESSFULLY'
      );
    }

    console.log('================================');
    console.log('AQAR SYSTEM IS ONLINE 🚀');
    console.log('================================');

  } catch (err) {

    console.error(
      'FATAL STARTUP ERROR:',
      err
    );

    if (server) {
      server.close();
    }

    process.exit(1);
  }
}

// ============================================================
// 40. GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {

  console.log(
    `${signal} RECEIVED. SHUTTING DOWN...`
  );

  try {
    if (!WEBHOOK_DOMAIN) {
      bot.stop(signal);
    }

    if (server) {
      server.close(() => {
        console.log(
          'HTTP SERVER CLOSED'
        );

        process.exit(0);
      });

      setTimeout(() => {
        process.exit(0);
      }, 10000).unref();

    } else {
      process.exit(0);
    }

  } catch (err) {

    console.error(
      'SHUTDOWN ERROR:',
      err
    );

    process.exit(1);
  }
}

process.once(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.once(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

// ============================================================
// 41. LAUNCH
// ============================================================

startServer();
