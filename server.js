'use strict';

/**
 * Aqar Algeria — Enterprise Production Telegram Real-Estate Bot
 * Stack: Node.js, Express, Telegraf, Supabase (Database & Storage)
 */

const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// -----------------------------------------------------------------------------
// Configuration & Environment Setup
// -----------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'aqar_algeria_secret_token';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'properties';
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN || !WEBHOOK_DOMAIN) {
  console.error('Error: BOT_TOKEN or WEBHOOK_DOMAIN environment variable is missing!');
  process.exit(1);
}

const WEBHOOK_PATH = '/telegram/webhook';
const WEBHOOK_URL = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;

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

// -----------------------------------------------------------------------------
// Supabase Client Initialization
// -----------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

async function assertDatabaseReady() {
  const { error } = await supabase.from('test_messages').select('id').limit(1);
  if (error) {
    console.warn(`Supabase warning: ${error.message}`);
  }
}

// -----------------------------------------------------------------------------
// Localization Strings (Arabic & French)
// -----------------------------------------------------------------------------

const STRINGS = Object.freeze({
  ar: {
    welcome: 'مرحبًا بك في منصة أقار الجزائر 🏠✨\nالنظام الذكي المتطور لإدارة وعروض العقارات.\nاختر إجراءً من القائمة أدناه:',
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
    enterPrice: 'أدخل السعر بالدينار الجزائري:',
    enterPhone: 'أدخل رقم هاتف صحيح:',
    enterDescription: 'أدخل وصفًا تفصيليًا للعقار:',
    sendImage: 'أرسل صورة للعقار، أو اضغط تخطي.',
    skip: '⏭️ تخطي',
    published: 'تم نشر العقار بنجاح في المنصة!',
    cancelled: 'تم إلغاء العملية.',
    noProperties: 'لا توجد عقارات متاحة حاليًا.',
    noFavorites: 'لا توجد عقارات في المفضلة.',
    favoriteAdded: 'تمت إضافة العقار إلى المفضلة.',
    favoriteRemoved: 'تمت إزالة العقار من المفضلة.',
    genericError: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقًا.',
    chooseWilaya: 'اختر ولاية لعرض العقارات:'
  },
  fr: {
    welcome: 'Bienvenue sur la plateforme Aqar Algérie 🏠✨\nLe système intelligent de gestion immobilière.\nChoisissez une action ci-dessous :',
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
    enterPrice: 'Entrez le prix en DZD :',
    enterPhone: 'Entrez un numéro mobile valide :',
    enterDescription: 'Entrez une description détaillée :',
    sendImage: 'Envoyez une photo du bien, ou appuyez sur Ignorer.',
    skip: '⏭️ Ignorer',
    published: 'Le bien a été publié avec succès !',
    cancelled: 'L’opération a été annulée.',
    noProperties: 'Aucun bien disponible pour le moment.',
    noFavorites: 'Aucun bien dans les favoris.',
    favoriteAdded: 'Le bien a été ajouté aux favoris.',
    favoriteRemoved: 'Le bien a été retiré des favoris.',
    genericError: 'Une erreur est survenue, veuillez réessayer.',
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

function wilayaKeyboard(prefix, page = 0) {
  const perPage = 12;
  const start = page * perPage;
  const slice = WILAYAS.slice(start, start + perPage);
  const buttons = slice.map((wilaya, index) => [
    Markup.button.callback(wilaya, `${prefix}:${start + index + 1}`)
  ]);
  const navigation = [];
  if (page > 0) navigation.push(Markup.button.callback('◀️', `${prefix}:page:${page - 1}`));
  if (start + perPage < WILAYAS.length) navigation.push(Markup.button.callback('▶️', `${prefix}:page:${page + 1}`));
  if (navigation.length) buttons.push(navigation);
  return Markup.inlineKeyboard(buttons);
}

// -----------------------------------------------------------------------------
// Property Publishing Wizard (Scenes)
// -----------------------------------------------------------------------------

const publishWizard = new Scenes.WizardScene(
  'publish-property',
  async (ctx) => {
    ctx.session.wizard = { propertyType: null, stateName: null, price: null, phone: null, description: null, imageUrl: null };
    await ctx.reply(t(ctx, 'publishIntro'), Markup.inlineKeyboard([
      [Markup.button.callback('شقة 🏢', 'ptype:شقة'), Markup.button.callback('فيلا 🏡', 'ptype:فيلا')],
      [Markup.button.callback('منزل 🏠', 'ptype:منزل'), Markup.button.callback('أرض 📐', 'ptype:قطعة أرض')]
    ]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery) return ctx.reply(t(ctx, 'publishIntro'));
    const propertyType = ctx.callbackQuery.data.replace('ptype:', '');
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
      ctx.session.wizard.stateName = WILAYA_CODES[code] || 'الجزائر';
      await ctx.answerCbQuery();
      await ctx.reply(t(ctx, 'enterPrice'), cancelKeyboard(ctx));
      return ctx.wizard.next();
    }
    await ctx.reply(t(ctx, 'chooseState'), wilayaKeyboard('wstate'));
  },
  async (ctx) => {
    ctx.session.wizard.price = ctx.message?.text || '0';
    await ctx.reply(t(ctx, 'enterPhone'), cancelKeyboard(ctx));
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.session.wizard.phone = ctx.message?.text || '';
    await ctx.reply(t(ctx, 'enterDescription'), cancelKeyboard(ctx));
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.session.wizard.description = ctx.message?.text || '';
    await ctx.reply(t(ctx, 'sendImage'), Markup.keyboard([[t(ctx, 'skip')], [t(ctx, 'cancel')]]).resize().persistent());
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === t(ctx, 'skip')) return finishPublishing(ctx);
    const photo = ctx.message?.photo?.at(-1);
    if (photo) {
      try {
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const res = await fetch(fileLink.href);
        const buffer = Buffer.from(await res.arrayBuffer());
        const fileName = `${ctx.from.id}_${Date.now()}.jpg`;
        await supabase.storage.from(STORAGE_BUCKET).upload(fileName, buffer, { contentType: 'image/jpeg' });
        const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
        ctx.session.wizard.imageUrl = data.publicUrl;
      } catch (e) {
        console.error('Media upload error:', e);
      }
    }
    return finishPublishing(ctx);
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
    message: wizard.description,
    image_url: wizard.imageUrl || 'EMPTY',
    video_url: 'EMPTY'
  };
  await supabase.from('test_messages').insert([payload]);
  await ctx.reply(t(ctx, 'published'), mainKeyboard(ctx));
  ctx.session.wizard = null;
  return ctx.scene.leave();
}

const stage = new Scenes.Stage([publishWizard]);
const bot = new Telegraf(BOT_TOKEN);

bot.use(session({ defaultSession: () => ({ language: 'ar', wizard: null }) }));
bot.use(stage.middleware());

// -----------------------------------------------------------------------------
// Bot Handlers & Actions
// -----------------------------------------------------------------------------

bot.start((ctx) => ctx.reply(t(ctx, 'welcome'), { parse_mode: 'Markdown', ...mainKeyboard(ctx) }));

bot.action(/^lang:(ar|fr)$/, async (ctx) => {
  ctx.session.language = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(t(ctx, 'languageChanged'));
  await ctx.reply(t(ctx, 'welcome'), mainKeyboard(ctx));
});

bot.hears([STRINGS.ar.language, STRINGS.fr.language], (ctx) => {
  ctx.reply(t(ctx, 'chooseLanguage'), Markup.inlineKeyboard([
    [Markup.button.callback('العربية', 'lang:ar'), Markup.button.callback('Français', 'lang:fr')]
  ]));
});

bot.hears([STRINGS.ar.publish, STRINGS.fr.publish], (ctx) => ctx.scene.enter('publish-property'));

bot.hears([STRINGS.ar.browse, STRINGS.fr.browse], async (ctx) => {
  const { data } = await supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(5);
  if (!data || !data.length) return ctx.reply(t(ctx, 'noProperties'));
  for (const p of data) {
    const text = `🏠 <b>نوع العقار:</b> ${p.property_type}\n📍 <b>الولاية:</b> ${p.state_name}\n💰 <b>السعر:</b> ${p.price}\n📞 <b>الهاتف:</b> <code>${p.phone}</code>\n📝 <b>الوصف:</b> ${p.description}`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('⭐ حفظ في المفضلة', `fav_${p.id}`)]
    ]);
    if (p.image_url && p.image_url !== 'EMPTY') {
      await ctx.replyWithPhoto(p.image_url, { caption: text, parse_mode: 'HTML', ...kb });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', ...kb });
    }
  }
});

bot.hears([STRINGS.ar.filter, STRINGS.fr.filter], (ctx) => ctx.reply(t(ctx, 'chooseWilaya'), wilayaKeyboard('filter')));

bot.action(/^filter:(\d+)$/, async (ctx) => {
  const stateName = WILAYA_CODES[ctx.match[1]];
  const { data } = await supabase.from('test_messages').select('*').eq('state_name', stateName).limit(5);
  await ctx.answerCbQuery();
  if (!data || !data.length) return ctx.reply(t(ctx, 'noProperties'));
  for (const p of data) {
    const text = `🏠 <b>نوع العقار:</b> ${p.property_type}\n📍 <b>الولاية:</b> ${p.state_name}\n💰 <b>السعر:</b> ${p.price}\n📞 <b>الهاتف:</b> <code>${p.phone}</code>\n📝 <b>الوصف:</b> ${p.description}`;
    if (p.image_url && p.image_url !== 'EMPTY') {
      await ctx.replyWithPhoto(p.image_url, { caption: text, parse_mode: 'HTML' });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
  }
});

bot.action(/fav_(.+)/, async (ctx) => {
  const propertyId = ctx.match[1];
  const userId = ctx.from.id;
  try {
    await supabase.from('user_favorites').insert([{ user_id: userId, property_id: propertyId }]);
    await ctx.answerCbQuery('⭐ تم حفظ العقار في المفضلة بنجاح!');
  } catch (e) {
    await ctx.answerCbQuery('⭐ العقار موجود مسبقاً في مفضلتك.');
  }
});

bot.hears([STRINGS.ar.favorites, STRINGS.fr.favorites], async (ctx) => {
  const userId = ctx.from.id;
  const { data: favs } = await supabase.from('user_favorites').select('property_id').eq('user_id', userId);
  if (!favs || !favs.length) return ctx.reply(t(ctx, 'noFavorites'));
  
  const pIds = favs.map(f => f.property_id);
  const { data: properties } = await supabase.from('test_messages').select('*').in('id', pIds);
  if (!properties || !properties.length) return ctx.reply(t(ctx, 'noProperties'));

  await ctx.reply('⭐ <b>قائمة عقاراتك المفضلة:</b>', { parse_mode: 'HTML' });
  for (const p of properties) {
    const text = `🏠 ${p.property_type} - ${p.state_name}\n💰 ${p.price}\n📞 ${p.phone}\n📝 ${p.description}`;
    if (p.image_url && p.image_url !== 'EMPTY') {
      await ctx.replyWithPhoto(p.image_url, { caption: text });
    } else {
      await ctx.reply(text);
    }
  }
});

// -----------------------------------------------------------------------------
// Express Server & Webhook Routing
// -----------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.status(200).send('OK'));

app.post(WEBHOOK_PATH, async (req, res, next) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

const server = http.createServer(app);

async function start() {
  await assertDatabaseReady();
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Aqar Algeria Enterprise Server running on port ${PORT}`);
    await bot.telegram.setWebhook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET });
  });
}

start().catch(err => {
  console.error('Startup Error:', err);
  process.exit(1);
});
