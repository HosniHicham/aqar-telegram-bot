'use strict';

/**
 * Aqar Algeria — Production Telegram Real-Estate Bot
 *
 * Stack:
 * - Node.js
 * - Express
 * - Telegraf
 * - Supabase Database and Storage
 */

const http = require('node:http');
const crypto = require('node:crypto');

const express = require('express');
const helmet = require('helmet');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// -----------------------------------------------------------------------------
// Configuration & Hardcoded Supabase Credentials Fallback
// -----------------------------------------------------------------------------

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeHttpsOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path or query`);
  }
  return url.origin;
}

const config = Object.freeze({
  botToken: requiredEnv('BOT_TOKEN'),
  webhookDomain: normalizeHttpsOrigin(requiredEnv('WEBHOOK_DOMAIN'), 'WEBHOOK_DOMAIN'),
  supabaseUrl: process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co',
  supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h',
  webhookSecret: requiredEnv('WEBHOOK_SECRET'),
  storageBucket: process.env.STORAGE_BUCKET || 'properties',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  trustProxy: Number(process.env.TRUST_PROXY_HOPS || 0)
});

const WEBHOOK_PATH = '/telegram/webhook';
const WEBHOOK_URL = `${config.webhookDomain}${WEBHOOK_PATH}`;

const PROPERTY_TYPES = Object.freeze({
  apartment: { ar: 'شقة', fr: 'Appartement' },
  house: { ar: 'منزل', fr: 'Maison' },
  villa: { ar: 'فيلا', fr: 'Villa' },
  land: { ar: 'أرض', fr: 'Terrain' },
  commercial: { ar: 'عقار تجاري', fr: 'Local commercial' }
});

const WILAYAS = Object.freeze([
  'أدرار', 'الشلف', 'الأغواط', 'أم البواقي', 'باتنة', 'بجاية',
  'بسكرة', 'بشار', 'البليدة', 'البويرة', 'تمنراست', 'تبسة',
  'تلمسان', 'تيارت', 'تيزي وزو', 'الجزائر', 'الجلفة', 'جيجل',
  'سطيف', 'سعيدة', 'سكيكدة', 'سيدي بلعباس', 'عنابة', 'قالمة',
  'قسنطينة', 'المدية', 'مستغانم', 'المسيلة', 'معسكر', 'ورقلة',
  'وهران', 'البيض', 'إليزي', 'برج بوعريريج', 'بومرداس', 'الطارف',
  'تندوف', 'تيسمسيلت', 'الوادي', 'خنشلة', 'سوق أهراس', 'تيبازة',
  'ميلة', 'عين الدفلى', 'النعامة', 'عين تموشنت', 'غرداية', 'غليزان',
  'تيميمون', 'برج باجي مختار', 'أولاد جلال', 'بني عباس',
  'إن صالح', 'إن قزام', 'تقرت', 'جانت', 'المغير', 'المنيعة'
]);

const WILAYA_CODES = Object.freeze(
  WILAYAS.reduce((accumulator, wilaya, index) => {
    accumulator[String(index + 1)] = wilaya;
    return accumulator;
  }, {})
);

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_MEDIA_SIZE = 20 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

function log(level, event, details = {}) {
  const payload = { timestamp: new Date().toISOString(), level, event, ...details };
  if (level === 'error') {
    console.error(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload));
}

class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

// -----------------------------------------------------------------------------
// Supabase data access
// -----------------------------------------------------------------------------

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

async function assertDatabaseReady() {
  const { error: propertyError } = await supabase.from('test_messages').select('id').limit(1);
  if (propertyError) {
    throw new Error(`Supabase properties table check failed: ${propertyError.message}`);
  }
  const { error: favoriteError } = await supabase.from('user_favorites').select('id').limit(1);
  if (favoriteError) {
    throw new Error(`Supabase favorites table check failed: ${favoriteError.message}`);
  }
}

async function insertProperty(payload) {
  const { data, error } = await supabase.from('test_messages').insert(payload).select('id').single();
  if (error) {
    log('error', 'supabase_insert_property_failed', { code: error.code, message: error.message });
    throw new AppError('Could not save the property. Please try again.', 503);
  }
  return data;
}

async function fetchRecentProperties(limit = 5) {
  const { data, error } = await supabase
    .from('test_messages')
    .select('id, property_type, state_name, price, description, image_url, video_url')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log('error', 'supabase_fetch_recent_failed', { code: error.code, message: error.message });
    throw new AppError('Could not load properties. Please try again.', 503);
  }
  return data || [];
}

async function fetchPropertiesByState(stateName, limit = 5) {
  const { data, error } = await supabase
    .from('test_messages')
    .select('id, property_type, state_name, price, description, image_url, video_url')
    .eq('state_name', stateName)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log('error', 'supabase_fetch_filtered_failed', { code: error.code, message: error.message });
    throw new AppError('Could not load properties. Please try again.', 503);
  }
  return data || [];
}

async function fetchFavoriteProperties(userId) {
  const { data, error } = await supabase
    .from('user_favorites')
    .select('property_id, property:test_messages!inner(id, property_type, state_name, price, description, image_url, video_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    log('error', 'supabase_fetch_favorites_failed', { code: error.code, message: error.message });
    throw new AppError('Could not load favorites. Please try again.', 503);
  }
  return (data || []).map((row) => row.property);
}

async function propertyExists(propertyId) {
  const { data, error } = await supabase.from('test_messages').select('id').eq('id', propertyId).maybeSingle();
  if (error) {
    log('error', 'supabase_property_lookup_failed', { code: error.code, message: error.message });
    throw new AppError('Could not verify the property. Please try again.', 503);
  }
  return Boolean(data);
}

async function addFavorite(userId, propertyId) {
  const exists = await propertyExists(propertyId);
  if (!exists) {
    throw new AppError('This property is no longer available.', 404);
  }
  const { error } = await supabase.from('user_favorites').upsert(
    { user_id: userId, property_id: propertyId },
    { onConflict: 'user_id,property_id', ignoreDuplicates: true }
  );
  if (error) {
    log('error', 'supabase_add_favorite_failed', { code: error.code, message: error.message });
    throw new AppError('Could not save the favorite. Please try again.', 503);
  }
}

async function removeFavorite(userId, propertyId) {
  const { error } = await supabase.from('user_favorites').delete().eq('user_id', userId).eq('property_id', propertyId);
  if (error) {
    log('error', 'supabase_remove_favorite_failed', { code: error.code, message: error.message });
    throw new AppError('Could not remove the favorite. Please try again.', 503);
  }
}

async function uploadMedia(fileId, mediaKind, userId) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  if (!response.ok) {
    throw new AppError('Could not download the uploaded media.', 502);
  }
  const contentType = response.headers.get('content-type') || '';
  const allowedTypes = mediaKind === 'image' ? ALLOWED_IMAGE_TYPES : ALLOWED_VIDEO_TYPES;
  if (!allowedTypes.has(contentType)) {
    throw new AppError('Unsupported media type.', 415);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_MEDIA_SIZE) {
    throw new AppError('Media file is too large. Maximum size is 20 MB.', 413);
  }
  const extension = contentType.split('/')[1].replace(/[^a-z0-9]/gi, '') || 'bin';
  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(config.storageBucket).upload(objectPath, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: false
  });

  if (error) {
    log('error', 'supabase_upload_failed', { code: error.name, message: error.message });
    throw new AppError('Could not upload the media. Please try again.', 503);
  }

  const { data } = supabase.storage.from(config.storageBucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

// -----------------------------------------------------------------------------
// Localization
// -----------------------------------------------------------------------------

const STRINGS = Object.freeze({
  ar: {
    welcome: 'مرحبًا بك في **أقار الجزائر**.\nاختر إجراءً من القائمة أدناه.',
    publish: '🏠 نشر عقار',
    browse: '🔎 تصفح العقارات',
    filter: '🗺️ تصفية حسب الولاية',
    favorites: '⭐ المفضلة',
    language: '🌐 تغيير اللغة',
    cancel: '❌ إلغاء',
    chooseLanguage: 'اختر لغة الواجهة:',
    languageChanged: 'تم تغيير اللغة إلى العربية.',
    publishIntro: 'لنبدأ نشر عقارك.\nاختر نوع العقار:',
    chooseState: 'اختر الولاية:',
    enterPrice: 'أدخل السعر بالدينار الجزائري، مثال: 25000000',
    enterPhone: 'أدخل رقم هاتف جزائري صحيح، مثال: 0555123456',
    enterDescription: 'أدخل وصفًا تفصيليًا للعقار (20 إلى 4000 حرف).',
    sendImage: 'أرسل صورة للعقار، أو اضغط “تخطي”.',
    sendVideo: 'أرسل فيديو للعقار، أو اضغط “تخطي”.',
    skip: '⏭️ تخطي',
    published: 'تم نشر العقار بنجاح.',
    cancelled: 'تم إلغاء العملية.',
    noProperties: 'لا توجد عقارات متاحة حاليًا.',
    noFavorites: 'لا توجد عقارات في المفضلة.',
    favoriteAdded: 'تمت إضافة العقار إلى المفضلة.',
    favoriteRemoved: 'تمت إزالة العقار من المفضلة.',
    invalidProperty: 'عقار غير صالح.',
    genericError: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقًا.',
    chooseWilaya: 'اختر ولاية لعرض العقارات:'
  },
  fr: {
    welcome: 'Bienvenue sur **Aqar Algérie**.\nChoisissez une action ci-dessous.',
    publish: '🏠 Publier un bien',
    browse: '🔎 Parcourir les biens',
    filter: '🗺️ Filtrer par wilaya',
    favorites: '⭐ Favoris',
    language: '🌐 Changer de langue',
    cancel: '❌ Annuler',
    chooseLanguage: 'Choisissez la langue de l’interface :',
    languageChanged: 'La langue a été changée en français.',
    publishIntro: 'Commençons la publication de votre bien.\nChoisissez le type de bien :',
    chooseState: 'Choisissez la wilaya :',
    enterPrice: 'Entrez le prix en DZD, par exemple : 25000000',
    enterPhone: 'Entrez un numéro mobile algérien valide, par exemple : 0555123456',
    enterDescription: 'Entrez une description détaillée (20 à 4000 caractères).',
    sendImage: 'Envoyez une photo du bien, ou appuyez sur « Ignorer ».',
    sendVideo: 'Envoyez une vidéo du bien, ou appuyez sur « Ignorer ».',
    skip: '⏭️ Ignorer',
    published: 'Le bien a été publié avec succès.',
    cancelled: 'L’opération a été annulée.',
    noProperties: 'Aucun bien disponible pour le moment.',
    noFavorites: 'Aucun bien dans les favoris.',
    favoriteAdded: 'Le bien a été ajouté aux favoris.',
    favoriteRemoved: 'Le bien a été retiré des favoris.',
    invalidProperty: 'Bien invalide.',
    genericError: 'Une erreur inattendue est survenue. Veuillez réessayer.',
    chooseWilaya: 'Choisissez une wilaya pour voir les biens :'
  }
});

function t(ctx, key) {
  const language = ctx.session?.language === 'fr' ? 'fr' : 'ar';
  return STRINGS[language][key] || STRINGS.ar[key] || key;
}

function mainKeyboard(ctx) {
  return Markup.keyboard([
    [t(ctx, 'publish'), t(ctx, 'browse')],
    [t(ctx, 'filter'), t(ctx, 'favorites')],
    [t(ctx, 'language')]
  ]).resize().persistent();
}

function cancelKeyboard(ctx) {
  return Markup.keyboard([[t(ctx, 'cancel')]]).resize().persistent();
}

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('العربية', 'lang:ar'), Markup.button.callback('Français', 'lang:fr')]
  ]);
}

function wilayaKeyboard(prefix, page = 0) {
  const perPage = 12;
  const start = page * perPage;
  const slice = WILAYAS.slice(start, start + perPage);

  const buttons = slice.map((wilaya, index) => [
    Markup.button.callback(wilaya, `${prefix}:${start + index + 1}`)
  ]);

  const navigation = [];
  if (page > 0) {
    navigation.push(Markup.button.callback('◀️', `${prefix}:page:${page - 1}`));
  }
  if (start + perPage < WILAYAS.length) {
    navigation.push(Markup.button.callback('▶️', `${prefix}:page:${page + 1}`));
  }
  if (navigation.length) {
    buttons.push(navigation);
  }

  return Markup.inlineKeyboard(buttons);
}

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

function sanitizeText(value, maxLength = 4000) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.normalize('NFC').replace(/[\b\u000B\f\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[\s().-]/g, '').trim();
  if (/^0[5-7]\d{8}$/.test(digits)) {
    return `+213${digits.slice(1)}`;
  }
  if (/^\+213[5-7]\d{8}$/.test(digits)) {
    return digits;
  }
  return null;
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '';
  }
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 2
  }).format(amount);
}

// -----------------------------------------------------------------------------
// Property publishing wizard
// -----------------------------------------------------------------------------

const publishWizard = new Scenes.WizardScene(
  'publish-property',
  async (ctx) => {
    ctx.session.wizard = {
      propertyType: null, stateName: null, price: null,
      phone: null, description: null, imageUrl: null, videoUrl: null
    };
    await ctx.reply(
      t(ctx, 'publishIntro'),
      Markup.inlineKeyboard([
        [Markup.button.callback('شقة / Appartement', 'ptype:apartment'), Markup.button.callback('منزل / Maison', 'ptype:house')],
        [Markup.button.callback('فيلا / Villa', 'ptype:villa'), Markup.button.callback('أرض / Terrain', 'ptype:land')],
        [Markup.button.callback('تجاري / Commercial', 'ptype:commercial')]
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply(t(ctx, 'publishIntro'));
      return;
    }
    const propertyType = ctx.callbackQuery.data.replace('ptype:', '');
    if (!PROPERTY_TYPES[propertyType]) {
      await ctx.answerCbQuery(t(ctx, 'invalidProperty'), { show_alert: true });
      return;
    }
    ctx.session.wizard.propertyType = propertyType;
    await ctx.answerCbQuery();
    await ctx.reply(t(ctx, 'chooseState'), wilayaKeyboard('wstate'));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('wstate:page:')) {
        const page = Number(data.split(':')[2]);
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(wilayaKeyboard('wstate', page).reply_markup);
        return;
      }
      const code = data.replace('wstate:', '');
      const stateName = WILAYA_CODES[code];
      if (!stateName) {
        await ctx.answerCbQuery(t(ctx, 'invalidProperty'), { show_alert: true });
        return;
      }
      ctx.session.wizard.stateName = stateName;
      await ctx.answerCbQuery();
      await ctx.reply(t(ctx, 'enterPrice'), cancelKeyboard(ctx));
      return ctx.wizard.next();
    }
    await ctx.reply(t(ctx, 'chooseState'), wilayaKeyboard('wstate'));
  },
  async (ctx) => {
    const rawPrice = sanitizeText(ctx.message?.text, 20).replace(/[^\d.]/g, '');
    const price = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(price) || price <= 0 || price > 999999999999) {
      await ctx.reply(t(ctx, 'enterPrice'));
      return;
    }
    ctx.session.wizard.price = price;
    await ctx.reply(t(ctx, 'enterPhone'), cancelKeyboard(ctx));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const phone = normalizePhone(ctx.message?.text);
    if (!phone) {
      await ctx.reply(t(ctx, 'enterPhone'));
      return;
    }
    ctx.session.wizard.phone = phone;
    await ctx.reply(t(ctx, 'enterDescription'), cancelKeyboard(ctx));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const description = sanitizeText(ctx.message?.text, MAX_DESCRIPTION_LENGTH);
    if (description.length < 20) {
      await ctx.reply(t(ctx, 'enterDescription'));
      return;
    }
    ctx.session.wizard.description = description;
    await ctx.reply(t(ctx, 'sendImage'), Markup.keyboard([[t(ctx, 'skip')], [t(ctx, 'cancel')]]).resize().persistent());
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = sanitizeText(ctx.message?.text, 20);
    if (text === t(ctx, 'skip')) {
      await ctx.reply(t(ctx, 'sendVideo'));
      return ctx.wizard.next();
    }
    const photo = ctx.message?.photo?.at(-1);
    if (!photo) {
      await ctx.reply(t(ctx, 'sendImage'));
      return;
    }
    try {
      ctx.session.wizard.imageUrl = await uploadMedia(photo.file_id, 'image', ctx.from.id);
      await ctx.reply(t(ctx, 'sendVideo'));
      return ctx.wizard.next();
    } catch (error) {
      log('error', 'wizard_image_upload_failed', { userId: ctx.from.id, message: error.message });
      await ctx.reply(t(ctx, 'genericError'));
    }
  },
  async (ctx) => {
    const text = sanitizeText(ctx.message?.text, 20);
    if (text === t(ctx, 'skip')) {
      return finishPublishing(ctx);
    }
    const video = ctx.message?.video;
    if (!video) {
      await ctx.reply(t(ctx, 'sendVideo'));
      return;
    }
    try {
      ctx.session.wizard.videoUrl = await uploadMedia(video.file_id, 'video', ctx.from.id);
      return finishPublishing(ctx);
    } catch (error) {
      log('error', 'wizard_video_upload_failed', { userId: ctx.from.id, message: error.message });
      await ctx.reply(t(ctx, 'genericError'));
    }
  }
);

async function finishPublishing(ctx) {
  const wizard = ctx.session.wizard;
  const payload = {
    property_type: wizard.propertyType,
    state_name: wizard.stateName,
    price: wizard.price,
    phone: wizard.phone,
    description: wizard.description,
    message: sanitizeText(`${PROPERTY_TYPES[wizard.propertyType]?.ar || ''} — ${wizard.stateName}`),
    image_url: wizard.imageUrl || null,
    video_url: wizard.videoUrl || null
  };
  const inserted = await insertProperty(payload);
  await ctx.reply(`${t(ctx, 'published')}\n\nID: ${inserted.id}`, mainKeyboard(ctx));
  ctx.session.wizard = null;
  return ctx.scene.leave();
}

publishWizard.command('cancel', async (ctx) => {
  ctx.session.wizard = null;
  await ctx.reply(t(ctx, 'cancelled'), mainKeyboard(ctx));
  return ctx.scene.leave();
});

publishWizard.hears(t('ar', 'cancel'), async (ctx) => {
  ctx.session.wizard = null;
  await ctx.reply(t(ctx, 'cancelled'), mainKeyboard(ctx));
  return ctx.scene.leave();
});

publishWizard.hears(t('fr', 'cancel'), async (ctx) => {
  ctx.session.wizard = null;
  await ctx.reply(t(ctx, 'cancelled'), mainKeyboard(ctx));
  return ctx.scene.leave();
});

const stage = new Scenes.Stage([publishWizard]);

// -----------------------------------------------------------------------------
// Telegram bot
// -----------------------------------------------------------------------------

const bot = new Telegraf(config.botToken, {
  handlerTimeout: 30000,
  telegram: { webhookReply: false }
});

bot.use(session({ defaultSession: () => ({ language: 'ar', wizard: null }) }));
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    return;
  }
  await next();
});

bot.start(async (ctx) => {
  await ctx.reply(t(ctx, 'welcome'), { parse_mode: 'Markdown', reply_markup: mainKeyboard(ctx).reply_markup });
});

bot.help(async (ctx) => {
  await ctx.reply(t(ctx, 'welcome'), { parse_mode: 'Markdown', reply_markup: mainKeyboard(ctx).reply_markup });
});

bot.action(/^lang:(ar|fr)$/, async (ctx) => {
  ctx.session.language = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(t(ctx, 'languageChanged'));
  await ctx.reply(t(ctx, 'welcome'), mainKeyboard(ctx));
});

bot.hears(t('ar', 'language'), async (ctx) => { await ctx.reply(t(ctx, 'chooseLanguage'), languageKeyboard()); });
bot.hears(t('fr', 'language'), async (ctx) => { await ctx.reply(t(ctx, 'chooseLanguage'), languageKeyboard()); });

bot.hears(t('ar', 'publish'), async (ctx) => ctx.scene.enter('publish-property'));
bot.hears(t('fr', 'publish'), async (ctx) => ctx.scene.enter('publish-property'));

bot.hears(t('ar', 'browse'), async (ctx) => {
  const properties = await fetchRecentProperties();
  await showProperties(ctx, properties, false);
});
bot.hears(t('fr', 'browse'), async (ctx) => {
  const properties = await fetchRecentProperties();
  await showProperties(ctx, properties, false);
});

bot.hears(t('ar', 'filter'), async (ctx) => ctx.reply(t(ctx, 'chooseWilaya'), wilayaKeyboard('filter')));
bot.hears(t('fr', 'filter'), async (ctx) => ctx.reply(t(ctx, 'chooseWilaya'), wilayaKeyboard('filter')));

bot.hears(t('ar', 'favorites'), async (ctx) => {
  const favorites = await fetchFavoriteProperties(ctx.from.id);
  if (!favorites.length) { await ctx.reply(t(ctx, 'noFavorites')); return; }
  await showProperties(ctx, favorites, true);
});
bot.hears(t('fr', 'favorites'), async (ctx) => {
  const favorites = await fetchFavoriteProperties(ctx.from.id);
  if (!favorites.length) { await ctx.reply(t(ctx, 'noFavorites')); return; }
  await showProperties(ctx, favorites, true);
});

bot.action(/^filter:page:(\d+)$/, async (ctx) => {
  const page = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(wilayaKeyboard('filter', page).reply_markup);
});

bot.action(/^filter:(\d+)$/, async (ctx) => {
  const code = ctx.match[1];
  const stateName = WILAYA_CODES[code];
  if (!stateName) {
    await ctx.answerCbQuery(t(ctx, 'invalidProperty'), { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  const properties = await fetchPropertiesByState(stateName);
  if (!properties.length) { await ctx.reply(t(ctx, 'noProperties')); return; }
  await showProperties(ctx, properties, false);
});

bot.action(/^fav:([0-9a-f-]{36})$/i, async (ctx) => {
  const propertyId = ctx.match[1];
  await addFavorite(ctx.from.id, propertyId);
  await ctx.answerCbQuery(t(ctx, 'favoriteAdded'), { show_alert: true });
});

bot.action(/^unfav:([0-9a-f-]{36})$/i, async (ctx) => {
  const propertyId = ctx.match[1];
  await removeFavorite(ctx.from.id, propertyId);
  await ctx.answerCbQuery(t(ctx, 'favoriteRemoved'), { show_alert: true });
});

async function showProperties(ctx, properties, favorites = false) {
  if (!properties.length) { await ctx.reply(t(ctx, 'noProperties')); return; }
  for (const property of properties) {
    const action = favorites ? 'unfav' : 'fav';
    const label = favorites ? '★ / ★' : '☆ / ★';

    const caption = [
      `#${property.id.slice(0, 8)}`,
      `${PROPERTY_TYPES[property.property_type]?.ar || property.property_type} — ${property.state_name}`,
      formatPrice(property.price),
      '',
      sanitizeText(property.description, 900)
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([[Markup.button.callback(label, `${action}:${property.id}`)]]);

    try {
      if (property.video_url) {
        await ctx.replyWithVideo(property.video_url, { caption, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      } else if (property.image_url) {
        await ctx.replyWithPhoto(property.image_url, { caption, parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      } else {
        await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }
    } catch (error) {
      log('warn', 'property_delivery_failed', { propertyId: property.id, message: error.message });
      await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
    }
  }
}

bot.catch(async (error, ctx) => {
  log('error', 'bot_handler_failed', { updateId: ctx.update?.update_id, message: error.message, stack: error.stack });
  try { await ctx.reply(t(ctx, 'genericError')); } catch (replyError) {
    log('error', 'bot_error_reply_failed', { message: replyError.message });
  }
});

// -----------------------------------------------------------------------------
// Express application
// -----------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

let isReady = false;
let isStopping = false;

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"], scriptSrc: ["'none'"], styleSrc: ["'none'"],
      imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"],
      objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (req, res) => {
  if (!isReady || isStopping) {
    return res.status(503).json({ status: 'not_ready' });
  }
  try {
    await assertDatabaseReady();
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    log('error', 'readiness_check_failed', { message: error.message });
    res.status(503).json({ status: 'degraded' });
  }
});

app.use((req, res, next) => {
  if (!isReady || isStopping) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ error: 'Service is starting or shutting down.' });
  }
  next();
});

function verifyTelegramSecret(req, res, next) {
  const provided = req.get('x-telegram-bot-api-secret-token') || '';
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(config.webhookSecret);
  const isValid = providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!isValid) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

app.post(WEBHOOK_PATH, verifyTelegramSecret, express.json({ limit: '256kb', strict: true }), async (req, res, next) => {
  try {
    if (!req.body || !Number.isSafeInteger(req.body.update_id)) {
      throw new AppError('Invalid Telegram update', 400);
    }
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => { res.status(404).json({ error: 'Route not found' }); });

app.use((error, req, res, next) => {
  if (res.headersSent) { return next(error); }
  const status = error instanceof AppError ? error.status : 500;
  const message = error instanceof AppError ? error.message : 'Internal server error';
  log('error', 'http_request_failed', {
    requestId: req.requestId, method: req.method, path: req.path, status, message: error.message, stack: error.stack
  });
  res.status(status).json({ error: message, request_id: req.requestId });
});

// -----------------------------------------------------------------------------
// Server lifecycle
// -----------------------------------------------------------------------------

const server = http.createServer(app);
server.requestTimeout = 45000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

async function start() {
  await assertDatabaseReady();
  const botInfo = await bot.telegram.getMe();
  log('info', 'bot_connected', { username: botInfo.username });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start Aqar Algeria / بدء أقار الجزائر' },
    { command: 'publish', description: 'Publish a property / نشر عقار' },
    { command: 'browse', description: 'Browse properties / تصفح العقارات' },
    { command: 'favorites', description: 'View favorites / المفضلة' }
  ]);

  await bot.telegram.setWebhook(WEBHOOK_URL, {
    secret_token: config.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 20
  });

  isReady = true;
  log('info', 'server_started', { port: config.port, webhook: WEBHOOK_URL });
}

function shutdown(signal, exitCode = 0) {
  if (isStopping) { return; }
  isStopping = true;
  isReady = false;
  log('info', 'shutdown_started', { signal });

  const forceExitTimer = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 30000);
  forceExitTimer.unref();

  server.close((error) => {
    clearTimeout(forceExitTimer);
    process.exit(error ? 1 : exitCode);
  });
  server.closeIdleConnections();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

process.once('uncaughtException', (error) => {
  log('error', 'uncaught_exception', { message: error.message, stack: error.stack });
  shutdown('uncaughtException', 1);
});

process.once('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', { message: reason instanceof Error ? reason.message : String(reason) });
  shutdown('unhandledRejection', 1);
});

start().catch((error) => {
  isReady = false;
  log('error', 'startup_failed', { message: error.message, stack: error.stack });
  shutdown('startup_failed', 1);
});
