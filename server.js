'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : 5883330772;
const AD_REWARD_POINTS = 25; // عدد النقاط لكل مشاهدة إعلان
const PUBLISH_COST_POINTS = 100; // تكلفة نشر إعلان واحد بالنقاط

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
    paymentMethodPrompt: (points) =>
      `💰 <b>اختر طريقة إتمام ونشر الإعلان:</b>\n\n` +
      `1️⃣ <b>الدفع السريع (BaridiMob / CCP):</b> 500 دج (أولوية ومراجعة فورية).\n` +
      `2️⃣ <b>النشر المجاني بالنقاط:</b> يتطلب <b>${PUBLISH_COST_POINTS} نقطة</b> (رصيدك الحالي: <b>${points} نقطة</b>).`,
    ccpInstructions:
      `💳 <b>الدفع عبر بريدي موب أو CCP:</b>\n\nيرجى تحويل مبلغ <b>500 دج</b> إلى الحساب التالي:\n📌 <b>رقم الحساب (RIP) (اضغط للنسخ 👇):</b>\n<code>00234567890123456789</code>\n\n📸 <b>بعد التحويل، أرسل هنا صورة وصل الدفع (Reçu):</b>`,
    paymentPending: (reqId) => `⏳ <b>تم استلام وصل الدفع وحفظ طلبك برقم (#${reqId})!</b>\n\nالإعلان قيد المراجعة من طرف الإدارة وسيتم نشره فور تأكيد التحويل.`,
    pointsPublishSuccess: `🎉 <b>تم خصم ${PUBLISH_COST_POINTS} نقطة ونشر إعلانك بنجاح في المنصة مجاناً!</b>`,
    notEnoughPoints: (points) => `⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nرصيدك الحالي: <b>${points} نقطة</b> وتحتاج إلى <b>${PUBLISH_COST_POINTS} نقطة</b>.\n\nاضغط على زر <b>"🎁 رصيدي وجمع النقاط"</b> لمشاهدة إعلانات وربح نقاط مجانية!`,
    successPublish: (type, state, reqId) => `🎉 <b>تم قبول إعلانك رقم (#${reqId}) ونشره بنجاح في المنصة!</b>\n🏠 <b>العقار:</b> ${type} - ${state}`,
    rejectPublish: (type, state, reqId) => `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${reqId}) (${type} - ${state}).</b>\nيرجى التأكد من الوصل وإعادة المحاولة.`,
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
    paymentMethodPrompt: (points) => `💰 <b>Choisissez le mode de publication :</b>\n\n1️⃣ <b>CCP / BaridiMob :</b> 500 DA\n2️⃣ <b>Gratuit avec points :</b> ${PUBLISH_COST_POINTS} pts (Votre solde : <b>${points} pts</b>)`,
    ccpInstructions: '💳 <b>Paiement CCP/BaridiMob (Cliquez pour copier 👇):</b>\n<code>00234567890123456789</code>\n\nEnvoyez la photo du reçu :',
    paymentPending: (reqId) => `⏳ <b>Reçu reçu (Demande #${reqId}) !</b> En attente de validation.`,
    pointsPublishSuccess: `🎉 <b>${PUBLISH_COST_POINTS} points déduits. Annonce publiée gratuitement !</b>`,
    notEnoughPoints: (points) => `⚠️ <b>Solde insuffisant (${points}/${PUBLISH_COST_POINTS} pts).</b> Regardez des publicités pour gagner des points !`,
    successPublish: (type, state, reqId) => `🎉 <b>Annonce #${reqId} (${type} - ${state}) publiée avec succès !</b>`,
    rejectPublish: (type, state, reqId) => `❌ <b>Reçu rejeté pour la demande #${reqId} (${type} - ${state}).</b>`,
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
    [isAr ? '🎁 رصيدي وجمع النقاط' : '🎁 Mes Points & Pubs', isAr ? '📞 الدعم والإدارة' : '📞 Support & Contact'],
    [isAr ? '🌐 تغيير اللغة / Langue' : '🌐 Langue / اللغة', isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos'],
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

function getAuthKeyboard(userId) {
  const lang = userLang[userId] || 'ar';
  return Markup.keyboard([
    [Markup.button.contactRequest(STRINGS[lang]['authBtnText'])]
  ]).resize().oneTime();
}

async function getUserRecord(telegramId) {
  try {
    const { data } = await supabase.from('users').select('*').eq('id', telegramId).limit(1);
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    return null;
  }
}

async function isUserVerified(telegramId) {
  const user = await getUserRecord(telegramId);
  return !!user;
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

// =========================================================================
// 🎬 واجهة الإعلانات المصغرة داخل تيليجرام (Telegram Mini App - Rewarded Ad)
// =========================================================================
app.get('/watch-ad', (req, res) => {
  const userId = req.query.uid || '';
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مشاهدة إعلان وربح نقاط</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body {
      background: #0F172A; color: #F8FAFC; font-family: system-ui, -apple-system, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 20px; text-align: center; box-sizing: border-box;
    }
    .card {
      background: #1E293B; border: 1px solid #334155; border-radius: 16px;
      padding: 24px; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    .ad-box {
      background: linear-gradient(135deg, #0D9488 0%, #0284C7 100%);
      border-radius: 12px; padding: 30px 15px; margin: 20px 0;
      font-weight: bold; font-size: 18px; color: white;
    }
    .timer { font-size: 36px; font-weight: 800; color: #38BDF8; margin: 10px 0; }
    button {
      background: #D4AF37; color: #0F172A; border: none; padding: 14px 24px;
      border-radius: 10px; font-size: 16px; font-weight: bold; width: 100%;
      cursor: pointer; display: none;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🎁 إعلان مدفوع (+${AD_REWARD_POINTS} نقطة)</h2>
    <p style="color:#94A3B8; font-size:14px;">انتظر انتهاء العداد للحصول على مكافأتك فوراً</p>
    
    <!-- هنا تضع مستقبلاً كود شبكة الإعلانات مثل Adsgram أو Monetag -->
    <div class="ad-box" id="adSlot">
      🏠 منصة عقار الجزائر<br>
      <span style="font-size:13px; font-weight:normal;">مساحة إعلانية ممولة</span>
    </div>

    <div class="timer" id="countdown">15</div>
    <button id="claimBtn" onclick="claimReward()">✅ استلام ${AD_REWARD_POINTS} نقطة والعودة</button>
  </div>

  <script>
    const tg = window.Telegram.WebApp;
    tg.expand();
    let seconds = 15;
    const timerEl = document.getElementById('countdown');
    const btnEl = document.getElementById('claimBtn');

    const interval = setInterval(() => {
      seconds--;
      timerEl.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(interval);
        timerEl.style.display = 'none';
        btnEl.style.display = 'block';
      }
    }, 1000);

    async function claimReward() {
      btnEl.disabled = true;
      btnEl.textContent = '⏳ جاري إضافة النقاط...';
      try {
        const res = await fetch('/api/claim-ad-reward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '${userId}' })
        });
        const data = await res.json();
        if (data.ok) {
          tg.close();
        } else {
          alert('حدث خطأ، حاول مجدداً');
          btnEl.disabled = false;
        }
      } catch (e) {
        alert('خطأ في الاتصال');
        btnEl.disabled = false;
      }
    }
  </script>
</body>
</html>`);
});

// 🎯 نقطة نهاية (API) لإضافة النقاط بعد إتمام مشاهدة الإعلان
app.post('/api/claim-ad-reward', async (req, res) => {
  const userId = Number(req.body.userId);
  if (!userId) return res.status(400).json({ ok: false });

  try {
    const user = await getUserRecord(userId);
    if (!user) return res.status(404).json({ ok: false });

    const newPoints = (user.points || 0) + AD_REWARD_POINTS;
    await supabase.from('users').update({ points: newPoints }).eq('id', userId);

    await bot.telegram.sendMessage(
      userId,
      `🎉 <b>مبروك! تمت إضافة +${AD_REWARD_POINTS} نقطة إلى رصيدك بعد مشاهدة الإعلان.</b>\n🪙 <b>رصيدك الحالي:</b> ${newPoints} نقطة.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    res.json({ ok: true, points: newPoints });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// =========================================================================
// 🏢 معالج نشر العقار (7 خطوات: النوع -> الولاية -> السعر -> الهاتف -> الوصف -> الوسائط -> طريقة الدفع)
// =========================================================================
const WIZ_STEPS = [
  'waiting_for_type',
  'waiting_for_state',
  'waiting_for_price',
  'waiting_for_phone',
  'waiting_for_description',
  'waiting_for_media',
  'waiting_for_payment_choice',
  'waiting_for_payment_receipt'
];
const WIZ_KEYS = ['property_type', 'state_name', 'price', 'phone', 'description', 'media_label', null, null];

const WIZ = {
  ar: {
    title: '🏢 <b>نشر عقار جديد</b>',
    step: (n, total) => `الخطوة ${n} من ${total}`,
    labels: ['🏠 النوع', '📍 الولاية', '💰 السعر', '📞 الهاتف', '📝 الوصف', '📸 الوسائط', '💳 الدفع'],
    prompts: [
      'اختر <b>نوع العقار</b> من الأزرار أدناه:',
      'اختر <b>الولاية</b> من الأزرار أدناه:',
      'أرسل الآن <b>السعر المطلوب</b>:',
      'أدخل <b>رقم الهاتف للتواصل</b>:',
      'أدخل <b>الوصف التفصيلي</b> للعقار:',
      'أرسل الآن <b>صورة أو فيديو العقار</b>:',
      'اختر طريقة الدفع أدناه:',
      'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:'
    ],
    back: '⬅️ رجوع',
    home: '🏠 القائمة الرئيسية',
    cancelBtn: '❌ إلغاء العملية والعودة',
    publishing: '⏳ جاري المعالجة والحفظ...'
  },
  fr: {
    title: '🏢 <b>Nouvelle annonce</b>',
    step: (n, total) => `Étape ${n} sur ${total}`,
    labels: ['🏠 Type', '📍 Wilaya', '💰 Prix', '📞 Téléphone', '📝 Description', '📸 Média', '💳 Paiement'],
    prompts: [
      'Choisissez le type :',
      'Choisissez la wilaya :',
      'Prix demandé :',
      'Téléphone :',
      'Description :',
      'Photo ou vidéo :',
      'Choisissez le mode de paiement :',
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
  const totalSteps = 7;
  let active = WIZ_STEPS.indexOf(state.step);
  if (active >= 6 || state.step === 'publishing') active = 6;
  if (active < 0) active = 0;

  const d = state.data;
  const head = opts.header || `${W.title}  •  ${W.step(active + 1, totalSteps)}`;
  if (opts.onlyHeader) return head;

  const filled = opts.complete ? totalSteps : active + 1;
  const bar = '▰'.repeat(filled) + '▱'.repeat(totalSteps - filled);

  const desc = d.description ? (d.description.length > 200 ? d.description.slice(0, 200) + '…' : d.description) : null;
  const values = [d.property_type, d.state_name, d.price, d.phone, desc, d.media_label || null, d.payment_label || null];

  const lines = values.map((val, i) => {
    let mark = val ? '✅' : (i === active ? '👉' : '▫️');
    return `${mark} ${W.labels[i]}: ${val ? '<b>' + escapeHtml(val) + '</b>' : '…'}`;
  });

  const stepPromptIdx = Math.max(WIZ_STEPS.indexOf(state.step), 0);
  const footer = opts.footer !== undefined ? opts.footer : W.prompts[stepPromptIdx];
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
  } else if (state.step === 'waiting_for_payment_choice') {
    rows.push(['💳 الدفع عبر BaridiMob / CCP']);
    rows.push([`🪙 النشر مجاناً (${PUBLISH_COST_POINTS} نقطة)`]);
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

// 🎁 قائمة رصيدي وجمع النقاط (مشاهدة إعلانات + دعوة أصدقاء)
bot.hears(['🎁 رصيدي وجمع النقاط', '🎁 Mes Points & Pubs'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const user = await getUserRecord(userId);
  const points = user ? (user.points || 0) : 0;

  const botUsername = ctx.botInfo?.username || 'AqarDZ_bot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  const msg =
    `🎁 <b>محفظة النقاط والمكافآت:</b>\n\n` +
    `🪙 <b>رصيدك الحالي:</b> <b>${points} نقطة</b>\n` +
    `📌 <b>تكلفة نشر عقار مجاناً:</b> ${PUBLISH_COST_POINTS} نقطة\n\n` +
    `🎬 <b>الطريقة 1: مشاهدة إعلان (+${AD_REWARD_POINTS} نقطة)</b>\n` +
    `اضغط على الزر أدناه لمشاهدة إعلان قصير داخل تيليجرام وربح النقاط فوراً.\n\n` +
    `👥 <b>الطريقة 2: دعوة الأصدقاء (+50 نقطة لكل صديق)</b>\n` +
    `شارك رابطك الخاص:\n<code>${refLink}</code>`;

  const inlineButtons = [];
  if (WEBHOOK_DOMAIN) {
    inlineButtons.push([
      Markup.button.webApp(`🎬 شاهد إعلان الآن (+${AD_REWARD_POINTS} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
    ]);
  }

  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...(inlineButtons.length ? Markup.inlineKeyboard(inlineButtons) : {})
  });
});

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

  if (state.step === 'waiting_for_payment_choice') {
    const user = await getUserRecord(userId);
    const pts = user ? (user.points || 0) : 0;
    return renderWizard(ctx, userId, { footer: t(userId, 'paymentMethodPrompt', pts) });
  }

  await renderWizard(ctx, userId);
});

bot.start(async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;

  // التقاط كود الإحالة إن وجد (?start=ref_12345)
  const startPayload = ctx.startPayload || '';
  if (startPayload.startsWith('ref_')) {
    const referrerId = Number(startPayload.replace('ref_', ''));
    if (referrerId && referrerId !== userId) {
      userState[userId] = { pendingReferrer: referrerId };
    }
  } else {
    delete userState[userId];
  }

  delete browsingSession[userId];
  userLang[userId] = userLang[userId] || 'ar';

  const verified = await isUserVerified(userId);
  if (verified) {
    delete userState[userId];
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

// 📱 تسجيل المستخدم في جدول users + منح مكافأة الإحالة
bot.on('contact', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = ctx.from.first_name || '';
  const userId = ctx.from.id;
  const lang = userLang[userId] || 'ar';
  const referrerId = userState[userId]?.pendingReferrer || null;

  try {
    const { error: insertError } = await supabase.from('users').insert([
      {
        id: userId,
        first_name: firstName,
        phone_number: phoneNumber,
        points: 0,
        referred_by: referrerId
      }
    ]);
    if (insertError) throw insertError;

    // منح 50 نقطة لصاحب رابط الإحالة
    if (referrerId) {
      const refUser = await getUserRecord(referrerId);
      if (refUser) {
        const updatedPts = (refUser.points || 0) + 50;
        await supabase.from('users').update({ points: updatedPts }).eq('id', referrerId);
        await ctx.telegram.sendMessage(
          referrerId,
          `🎉 <b>مبروك! انضم صديق جديد عبر رابطك وحصلت على +50 نقطة!</b>\n🪙 رصيدك الحالي: ${updatedPts} نقطة.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }

    delete userState[userId];
    ctx.reply(lang === 'ar' ? '🎉 <b>تم توثيق حسابك بنجاح!</b>' : '🎉 <b>Compte vérifié !</b>', {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userId)
    });
  } catch (err) {
    console.error('User verification insert error:', err);
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
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي') || ctx.message.text?.includes('Parcourir') || ctx.message.text?.includes('Ajouter'))) {
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
    renderPropertyPage(ctx, userId, session.page);
  }
});

bot.hears(['⬅️ السابق', '⬅️ Précédent'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session && session.page > 0) {
    renderPropertyPage(ctx, userId, session.page - 1);
  }
});

bot.hears(['التالي ➡️', 'Suivant ➡️'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session) {
    renderPropertyPage(ctx, userId, session.page + 1);
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
  ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.action('set_lang_fr', async (ctx) => {
  await ctx.answerCbQuery();
  userLang[ctx.from.id] = 'fr';
  await ctx.deleteMessage().catch(() => {});
  ctx.reply(t(ctx.from.id, 'langChanged'), getMainMenuKeyboard(ctx.from.id));
});

bot.hears(['📞 الدعم والإدارة', '📞 Support & Contact'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  ctx.reply(t(ctx.from.id, 'supportText'), { parse_mode: 'HTML', ...getMainMenuKeyboard(ctx.from.id) });
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  ctx.reply(t(userId, 'aboutText'), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
});

bot.hears(['➕ إضافة عقار جديد', '➕ Ajouter un bien'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const old = userState[userId];
  if (old && old.wizardMsgId) await ctx.telegram.deleteMessage(old.chatId, old.wizardMsgId).catch(() => {});

  userState[userId] = { step: 'waiting_for_type', data: {}, chatId: ctx.chat.id, wizardMsgId: null };
  renderWizard(ctx, userId);
});

// اختيار طريقة الدفع في الخطوة 7
bot.hears('💳 الدفع عبر BaridiMob / CCP', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_payment_choice') return;

  state.data.payment_label = '💳 تحويل بريدي موب / CCP';
  state.step = 'waiting_for_payment_receipt';
  await renderWizard(ctx, userId, { footer: t(userId, 'ccpInstructions') });
});

bot.hears(`🪙 النشر مجاناً (${PUBLISH_COST_POINTS} نقطة)`, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_payment_choice') return;

  const user = await getUserRecord(userId);
  const currentPoints = user ? (user.points || 0) : 0;

  if (currentPoints < PUBLISH_COST_POINTS) {
    return ctx.reply(t(userId, 'notEnoughPoints', currentPoints), { parse_mode: 'HTML' });
  }

  state.step = 'publishing';
  try {
    await renderWizard(ctx, userId, { footer: WIZ[userLang[userId] || 'ar'].publishing });

    let mediaUrl = `tg:${state.data.media_file_id}`;
    try {
      const fileLink = await ctx.telegram.getFileLink(state.data.media_file_id);
      const res = await fetch(fileLink.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = state.data.media_type === 'video' ? 'mp4' : 'jpg';
      const mime = state.data.media_type === 'video' ? 'video/mp4' : 'image/jpeg';
      const fileName = `${Date.now()}_aqar.${ext}`;
      await supabase.storage.from('test_media').upload(fileName, buf, { contentType: mime, upsert: true });
      const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
      mediaUrl = pubUrl.publicUrl;
    } catch (e) {}

    const isVideo = state.data.media_type === 'video';

    // خصم النقاط من رصيد المستخدم
    await supabase.from('users').update({ points: currentPoints - PUBLISH_COST_POINTS }).eq('id', userId);

    // نشر العقار مباشرة في جدول العقارات
    await supabase.from('test_messages').insert([{
      property_type: state.data.property_type,
      state_name: state.data.state_name,
      price: String(state.data.price),
      phone: String(state.data.phone),
      description: state.data.description,
      message: state.data.description,
      image_url: isVideo ? 'EMPTY' : mediaUrl,
      video_url: isVideo ? mediaUrl : 'EMPTY'
    }]);

    if (state.wizardMsgId) {
      await ctx.telegram.deleteMessage(state.chatId, state.wizardMsgId).catch(() => {});
    }

    await ctx.reply(t(userId, 'pointsPublishSuccess'), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
    delete userState[userId];
  } catch (err) {
    console.error('Points publish error:', err);
    ctx.reply(t(userId, 'errorMsg'), getMainMenuKeyboard(userId));
    delete userState[userId];
  }
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

// 📸 استلام صورة العقار أو وصل الدفع
bot.on('photo', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    state.data.media_file_id = photo.file_id;
    state.data.media_type = 'photo';
    state.data.media_label = '🖼 تم إرفاق الصورة';

    state.step = 'waiting_for_payment_choice';
    const user = await getUserRecord(userId);
    const pts = user ? (user.points || 0) : 0;
    return renderWizard(ctx, userId, { footer: t(userId, 'paymentMethodPrompt', pts) });
  }

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
        const ext = state.data.media_type === 'video' ? 'mp4' : 'jpg';
        const mime = state.data.media_type === 'video' ? 'video/mp4' : 'image/jpeg';
        const fileName = `${Date.now()}_aqar.${ext}`;
        await supabase.storage.from('test_media').upload(fileName, buf, { contentType: mime, upsert: true });
        const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
        mediaUrl = pubUrl.publicUrl;
      } catch (e) {}

      const isVideo = state.data.media_type === 'video';

      const { data: insertedRow, error: insertError } = await supabase
        .from('pending_properties')
        .insert([{
          user_id: userId,
          property_type: state.data.property_type,
          state_name: state.data.state_name,
          price: String(state.data.price),
          phone: String(state.data.phone),
          description: state.data.description,
          image_url: isVideo ? 'EMPTY' : mediaUrl,
          video_url: isVideo ? mediaUrl : 'EMPTY',
          receipt_file_id: receiptPhoto.file_id
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      const requestId = insertedRow.id;

      const adminCaption =
        `🚨 <b>طلب إعلان عقاري جديد (#${requestId})</b>\n\n` +
        `👤 <b>معرف المستخدم:</b> <code>${userId}</code>\n` +
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
            Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`),
            Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`)
          ]
        ])
      });

      if (state.wizardMsgId) {
        await ctx.telegram.deleteMessage(state.chatId, state.wizardMsgId).catch(() => {});
      }

      await ctx.reply(t(userId, 'paymentPending', requestId), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
      delete userState[userId];
    } catch (err) {
      console.error('Receipt submit error:', err);
      ctx.reply(t(userId, 'errorMsg'), getMainMenuKeyboard(userId));
      delete userState[userId];
    }
  }
});

// 🎥 استلام فيديو العقار ثم الانتقال لخطوة اختيار الدفع
bot.on('video', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];

  if (state && state.step === 'waiting_for_media') {
    const video = ctx.message.video;
    state.data.media_file_id = video.file_id;
    state.data.media_type = 'video';
    state.data.media_label = '🎥 تم إرفاق الفيديو';

    state.step = 'waiting_for_payment_choice';
    const user = await getUserRecord(userId);
    const pts = user ? (user.points || 0) : 0;
    return renderWizard(ctx, userId, { footer: t(userId, 'paymentMethodPrompt', pts) });
  }
});

// 🛠️ معالجة قرار الأدمن عبر رقم الطلب الفريد (requestId)
const handleAdminAction = async (ctx, action) => {
  const requestId = Number(ctx.match[1]);
  await ctx.answerCbQuery();

  try {
    const { data: pendingItem, error: fetchError } = await supabase
      .from('pending_properties')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !pendingItem) {
      return ctx.editMessageCaption(`⚠️ <b>تمت معالجة الطلب (#${requestId}) مسبقاً أو لم يعد موجوداً.</b>`, { parse_mode: 'HTML' });
    }

    const targetUserId = pendingItem.user_id;
    const lang = userLang[targetUserId] || 'ar';

    if (action === 'approve') {
      const { error: publishError } = await supabase.from('test_messages').insert([{
        property_type: pendingItem.property_type,
        state_name: pendingItem.state_name,
        price: pendingItem.price,
        phone: pendingItem.phone,
        description: pendingItem.description,
        message: pendingItem.description,
        image_url: pendingItem.image_url,
        video_url: pendingItem.video_url
      }]);

      if (publishError) throw publishError;

      await supabase.from('pending_properties').delete().eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        STRINGS[lang].successPublish(pendingItem.property_type, pendingItem.state_name, requestId),
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code> (${pendingItem.property_type} - ${pendingItem.state_name})`,
        { parse_mode: 'HTML' }
      );
    } else {
      await supabase.from('pending_properties').delete().eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        STRINGS[lang].rejectPublish(pendingItem.property_type, pendingItem.state_name, requestId),
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `❌ <b>تم رفض الطلب (#${requestId}) وحذفه.</b>\n👤 المستخدم: <code>${targetUserId}</code> (${pendingItem.property_type} - ${pendingItem.state_name})`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    console.error('Admin action error:', err);
    await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`);
  }
};

bot.action(/^approve_(\d+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
bot.action(/^reject_(\d+)$/, (ctx) => handleAdminAction(ctx, 'reject'));

const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Complete Monetized System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
