'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// 🔒 المتطلبات الأساسية مع قيم احتياطية لضمان عدم توقف السيرفر على Render
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: Required environment variables are missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

const userState = {};
const userLang = {};
const browsingSession = {};

// =========================================================================
// 🔄 دوال الجلب الديناميكي من Supabase
// =========================================================================
async function getSetting(key, defaultValue = '') {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
    return data ? data.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// 🛡️ جلب معرفات المدراء من جدول app_settings (سواء كان رقماً واحداً أو عدة أرقام مفصولة بفاصلة)
async function getAdminIds() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_id').single();
    if (!data || !data.value) return [5883330772]; // قيمة افتراضية احتياطية
    
    return data.value.split(/[,،\s]+/).map(id => Number(id.trim())).filter(Boolean);
  } catch (e) {
    return [5883330772];
  }
}

async function getDynamicWilayas() {
  try {
    const { data } = await supabase.from('wilayas').select('name').eq('is_active', true);
    if (data && data.length > 0) return data.map(item => item.name);
  } catch (e) {}
  return ['الجزائر العاصمة', 'وهران', 'مستغانم', 'قسنطينة', 'عنابة', 'البليدة', 'تلمسان', 'سطيف', 'بجاية'];
}

async function getDynamicPropertyTypes() {
  try {
    const { data } = await supabase
      .from('property_types')
      .select('title, row_num, col_num')
      .eq('is_active', true)
      .order('row_num', { ascending: true })
      .order('col_num', { ascending: true });
    return data || [];
  } catch (e) {
    return [];
  }
}

async function getDynamicPropertyTypesKeyboard() {
  const data = await getDynamicPropertyTypes();
  if (!data || data.length === 0) {
    return Markup.keyboard([
      ['شقة', 'فيلا', 'منزل'],
      ['قطعة أرض', 'محل تجاري'],
      ['🏠 القائمة الرئيسية']
    ]).resize();
  }

  const rows = {};
  for (const item of data) {
    if (!rows[item.row_num]) rows[item.row_num] = [];
    rows[item.row_num].push(item.title);
  }

  const keyboard = Object.keys(rows)
    .sort((a, b) => Number(a) - Number(b))
    .map(r => rows[r]);

  keyboard.push(['🏠 القائمة الرئيسية']);
  return Markup.keyboard(keyboard).resize();
}

async function getDynamicFeatures() {
  try {
    const { data, error } = await supabase
      .from('property_features')
      .select('title, category, row_num, col_num')
      .eq('is_active', true)
      .order('row_num', { ascending: true })
      .order('col_num', { ascending: true });

    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}

async function getDynamicDescriptionKeyboard() {
  const data = await getDynamicFeatures();
  
  if (!data || data.length === 0) {
    return Markup.keyboard([
      ['✅ تأكيد الوصف والانتقال'],
      ['↩️ تراجع عن الأخيرة', '🗑️ مسح الكل'],
      ['⬅️ رجوع', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  const rows = {};
  for (const item of data) {
    const rNum = item.row_num || 1;
    if (!rows[rNum]) rows[rNum] = [];
    rows[rNum].push(item);
  }

  const keyboard = [];
  const sortedRowKeys = Object.keys(rows).sort((a, b) => Number(a) - Number(b));

  for (const rKey of sortedRowKeys) {
    const sortedRowItems = rows[rKey].sort((a, b) => (a.col_num || 1) - (b.col_num || 1));
    keyboard.push(sortedRowItems.map(i => i.title));
  }

  keyboard.push(['✅ تأكيد الوصف والانتقال']);
  keyboard.push(['↩️ تراجع عن الأخيرة', '🗑️ مسح الكل']);
  keyboard.push(['⬅️ رجوع', '🏠 القائمة الرئيسية']);

  return Markup.keyboard(keyboard).resize();
}

// =========================================================================
// 📝 الأدوات ومساعدات واجهة المستخدم
// =========================================================================
function chunkButtons(buttonsArray, chunkSize = 4) {
  const chunked = [];
  for (let i = 0; i < buttonsArray.length; i += chunkSize) {
    chunked.push(buttonsArray.slice(i, i + chunkSize));
  }
  return chunked;
}

function getMainMenuKeyboard() {
  return Markup.keyboard([
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['🎁 رصيدي وجمع النقاط', '📞 الدعم والإدارة'],
    ['🌐 تغيير اللغة / Langue', 'ℹ️ عن المنصة'],
    ['🌐 تصفح الموقع الرسمي (البروزر)']
  ]).resize();
}

function getBrowsingKeyboard(currentIndex, totalCount) {
  const navRow = [];
  if (currentIndex > 0) navRow.push('⬅️ السابق');
  navRow.push(`📄 ${currentIndex + 1} / ${totalCount}`);
  if (currentIndex < totalCount - 1) navRow.push('التالي ➡️');

  return Markup.keyboard([navRow, ['📍 تغيير الولاية', '🏠 القائمة الرئيسية']]).resize();
}

function getAuthKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 اضغط هنا لمشاركة رقم هاتفك والبدء')]
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

function formatMoney(numStr) {
  if (!numStr) return '0 دج';
  const clean = String(numStr).replace(/\D/g, '');
  if (!clean) return '0 دج';
  return Number(clean).toLocaleString('en-US') + ' دج';
}

function getSketchNumpad(displayValue, isPrice = true) {
  const displayText = displayValue ? (isPrice ? formatMoney(displayValue) : displayValue) : '0';

  return Markup.inlineKeyboard([
    [Markup.button.callback(`📥 [ ${displayText} ]`, 'noop_input')],
    [Markup.button.callback('1', 'n_1'), Markup.button.callback('2', 'n_2'), Markup.button.callback('3', 'n_3')],
    [Markup.button.callback('4', 'n_4'), Markup.button.callback('5', 'n_5'), Markup.button.callback('6', 'n_6')],
    [Markup.button.callback('7', 'n_7'), Markup.button.callback('8', 'n_8'), Markup.button.callback('9', 'n_9')],
    [
      Markup.button.callback('0', 'n_0'),
      isPrice ? Markup.button.callback('+مليون', 'n_million') : Markup.button.callback('⌫', 'n_back'),
      Markup.button.callback('🗑️ مسح', 'n_clear')
    ],
    [Markup.button.callback('✅ [ OK ] تأكيد', 'n_confirm')]
  ]);
}

// =========================================================================
// ⏳ مديولوير ذكي لحل مشكلة وضع النوم (Cold Start)
// =========================================================================
bot.use(async (ctx, next) => {
  let waitMsgId = null;
  let isResponded = false;

  const timer = setTimeout(async () => {
    if (!isResponded && ctx.message && ctx.message.text) {
      try {
        const waitMsg = await ctx.reply('⏳ <b>جاري إيقاظ الخادم والاتصال... يرجى الانتظار لحظة.</b>', { parse_mode: 'HTML' });
        waitMsgId = waitMsg.message_id;
      } catch (e) {}
    }
  }, 1500);

  try {
    await next();
  } finally {
    isResponded = true;
    clearTimeout(timer);

    if (waitMsgId) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsgId).catch(() => {});
      } catch (e) {}
    }
  }
});

// =========================================================================
// 🎬 صفحة الويب المصغرة لربح النقاط
// =========================================================================
app.get('/watch-ad', async (req, res) => {
  const userId = req.query.uid || '';
  const rewardPoints = await getSetting('ad_reward_points', '25');

  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مشاهدة إعلان وربح نقاط</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src='//libtl.com/sdk.js' data-zone='12268522' data-sdk='show_12268522'></script>
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
    .alert-box {
      background: #7F1D1D; color: #FCA5A5; border: 1px solid #991B1B;
      padding: 12px; border-radius: 8px; font-size: 13px; font-weight: bold;
      margin-bottom: 15px; display: none; line-height: 1.5;
    }
    button {
      background: #D4AF37; color: #0F172A; border: none; padding: 14px 24px;
      border-radius: 10px; font-size: 16px; font-weight: bold; width: 100%;
      cursor: pointer; margin-top: 15px;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🎁 ربح نقاط عقار الجزائر</h2>
    <p style="color:#94A3B8; font-size:14px;">اضغط على الزر أدناه لبدء مشاهدة الإعلان وربح +${rewardPoints} نقطة.</p>
    <div id="alertBox" class="alert-box">
      ⚠️ <b>تنبيه هام جداً:</b><br>يرجى الانتظار وعدم إغلاق الصفحة حتى ينتهي الإعلان بالكامل لكي يتم احتساب نقاطك تلقائياً!
    </div>
    <button id="adBtn" onclick="triggerAd()">▶️ عرض الإعلان الآن</button>
  </div>
  <script>
    const tg = window.Telegram.WebApp;
    tg.expand();
    const btnEl = document.getElementById('adBtn');
    const alertBox = document.getElementById('alertBox');

    function triggerAd() {
      btnEl.disabled = true;
      btnEl.textContent = '⏳ جاري عرض الإعلان... يرجى الانتظار';
      alertBox.style.display = 'block';

      if (typeof show_12268522 === 'function') {
        show_12268522().then(() => {
          claimReward();
        }).catch((e) => {
          alert('تعذر عرض الإعلان حالياً، حاول مجدداً.');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ عرض الإعلان الآن';
          alertBox.style.display = 'none';
        });
      } else {
        setTimeout(() => { claimReward(); }, 4000);
      }
    }

    async function claimReward() {
      try {
        const res = await fetch('/api/claim-ad-reward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: '${userId}' })
        });
        const data = await res.json();
        if (data.ok) {
          alert('🎉 مبروك! تمت إضافة النقاط بنجاح.');
          tg.close();
        } else {
          alert('حدث خطأ، حاول مجدداً');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ عرض الإعلان الآن';
          alertBox.style.display = 'none';
        }
      } catch (e) {
        alert('خطأ في الاتصال بالسيرفر');
        btnEl.disabled = false;
        btnEl.textContent = '▶️ عرض الإعلان الآن';
        alertBox.style.display = 'none';
      }
    }
  </script>
</body>
</html>`);
});

app.post('/api/claim-ad-reward', async (req, res) => {
  const userId = Number(req.body.userId);
  if (!userId) return res.status(400).json({ ok: false });

  try {
    const user = await getUserRecord(userId);
    if (!user) return res.status(404).json({ ok: false });

    const rewardPoints = Number(await getSetting('ad_reward_points', '25'));
    const newPoints = (user.points || 0) + rewardPoints;
    await supabase.from('users').update({ points: newPoints }).eq('id', userId);

    await bot.telegram.sendMessage(
      userId,
      `🎉 <b>مبروك! تمت إضافة +${rewardPoints} نقطة إلى رصيدك بعد مشاهدة الإعلان.</b>\n🪙 <b>رصيدك الحالي:</b> ${newPoints} نقطة.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    res.json({ ok: true, points: newPoints });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// =========================================================================
// 🏢 معالج نشر العقار (Wizard)
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
const WIZ_LABELS = ['🏠 النوع', '📍 الولاية', '💰 السعر', '📞 الهاتف', '📝 الوصف', '📸 الوسائط', '💳 الدفع'];

async function getWizardPrompt(stepIndex) {
  const prompts = [
    'اختر <b>نوع العقار</b> من الأزرار أدناه:',
    'اختر <b>الولاية</b> من الأزرار أدناه:',
    'استخدم لوحة الأرقام أدناه لتشكيل السعر، ثم اضغط <b>OK</b>:',
    'استخدم لوحة الأرقام أدناه لإدخال رقم الهاتف، ثم اضغط <b>OK</b>:',
    'اختر <b>مزايا ومواصفات العقار</b> من الأزرار أدناه (يمكنك اختيار أكثر من ميزة)، ثم اضغط <b>✅ تأكيد الوصف والانتقال</b>:',
    'أرسل الآن <b>صورة أو فيديو العقار</b>:',
    'اختر طريقة الدفع أدناه:',
    'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:'
  ];
  return prompts[stepIndex] || '';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildWizardText(state, opts = {}) {
  const totalSteps = 7;
  let active = WIZ_STEPS.indexOf(state.step);
  if (active >= 6 || state.step === 'publishing') active = 6;
  if (active < 0) active = 0;

  const d = state.data;
  const titleText = await getSetting('wizard_title', '🏢 <b>نشر عقار جديد</b>');
  const head = opts.header || `${titleText}  •  الخطوة ${active + 1} من ${totalSteps}`;
  if (opts.onlyHeader) return head;

  const filled = opts.complete ? totalSteps : active + 1;
  const bar = '▰'.repeat(filled) + '▱'.repeat(totalSteps - filled);

  let descPreview = null;
  if (d.description) {
    descPreview = d.description.length > 200 ? d.description.slice(0, 200) + '…' : d.description;
  } else if (state.step === 'waiting_for_description' && d.features_list && d.features_list.length > 0) {
    descPreview = d.features_list.join(' | ') + ' (قيد التعديل...)';
  }

  const currentPriceDisplay = d.price ? formatMoney(d.price) : (state.step === 'waiting_for_price' ? 'قيد التشكيل بالحقل أدناه...' : null);
  const currentPhoneDisplay = d.phone || (state.step === 'waiting_for_phone' ? 'قيد التشكيل بالحقل أدناه...' : null);

  const values = [
    d.property_type,
    d.state_name,
    currentPriceDisplay,
    currentPhoneDisplay,
    descPreview,
    d.media_label || null,
    d.payment_label || null
  ];

  const lines = values.map((val, i) => {
    const mark = val ? '✅' : (i === active ? '👉' : '▫️');
    return `${mark} ${WIZ_LABELS[i]}: ${val ? '<b>' + escapeHtml(val) + '</b>' : '…'}`;
  });

  const stepPromptIdx = Math.max(WIZ_STEPS.indexOf(state.step), 0);
  const defaultPrompt = await getWizardPrompt(stepPromptIdx);
  const footer = opts.footer !== undefined ? opts.footer : defaultPrompt;
  return `${head}\n${bar}\n\n${lines.join('\n')}` + (footer ? `\n\n${footer}` : '');
}

async function getStandardReplyKeyboard(stateStep) {
  const backText = '⬅️ رجوع';
  const homeText = '🏠 القائمة الرئيسية';
  const cancelText = '❌ إلغاء العملية والعودة';

  if (stateStep === 'waiting_for_type') {
    return await getDynamicPropertyTypesKeyboard();
  } else if (stateStep === 'waiting_for_state') {
    const dynamicWilayas = await getDynamicWilayas();
    return Markup.keyboard([
      ...chunkButtons(dynamicWilayas.map(w => `📍 ${w}`), 4),
      [backText, homeText]
    ]).resize();
  } else if (stateStep === 'waiting_for_description') {
    return await getDynamicDescriptionKeyboard();
  } else if (stateStep === 'waiting_for_payment_choice') {
    const publishCost = await getSetting('publish_cost_points', '100');
    return Markup.keyboard([
      ['💳 الدفع عبر BaridiMob / CCP'],
      [`🪙 النشر مجاناً (${publishCost} نقطة)`],
      [backText, homeText]
    ]).resize();
  } else {
    return Markup.keyboard([
      [backText, homeText],
      [cancelText]
    ]).resize();
  }
}

async function renderWizard(ctx, userId, opts = {}) {
  const state = userState[userId];
  if (!state) return;

  const user = await getUserRecord(userId);
  const currentPoints = user ? (user.points || 0) : 0;
  const publishCost = await getSetting('publish_cost_points', '100');

  if (state.step === 'waiting_for_payment_choice' && !opts.footer) {
    opts.footer =
      `💰 <b>اختر طريقة إتمام ونشر الإعلان:</b>\n\n` +
      `1️⃣ <b>الدفع السريع (BaridiMob / CCP):</b> 500 دج (أولوية ومراجعة فورية).\n` +
      `2️⃣ <b>النشر المجاني بالنقاط:</b> يتطلب <b>${publishCost} نقطة</b>\n` +
      `🪙 <b>رصيدك الحالي:</b> <b>${currentPoints} نقطة</b>`;
  }

  const text = await buildWizardText(state, opts);

  if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
    try {
      await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {}
    return;
  }

  const replyKeyboard = opts.noKeyboard ? getMainMenuKeyboard() : await getStandardReplyKeyboard(state.step);

  let extraMarkup = replyKeyboard;
  if (state.step === 'waiting_for_price') {
    extraMarkup = getSketchNumpad(state.tempInput || '', true);
  } else if (state.step === 'waiting_for_phone') {
    extraMarkup = getSketchNumpad(state.tempInput || '', false);
  }

  if (state.wizardMsgId) {
    try {
      await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, {
        parse_mode: 'HTML',
        ...extraMarkup
      });
      return;
    } catch (e) {}
  }

  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...extraMarkup });
  const oldId = state.wizardMsgId;
  state.wizardMsgId = sent.message_id;
  state.chatId = ctx.chat.id;

  if (oldId && oldId !== sent.message_id) {
    await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
  }
}

// =========================================================================
// 🎯 الأوامر ومعالجات الأحداث
// =========================================================================
bot.start(async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  const userId = ctx.from.id;

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
  userLang[userId] = 'ar';

  const verified = await isUserVerified(userId);
  const rawWelcomeTpl = await getSetting('welcome_msg_template', 'أهلاً بك يا <b>{name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:');
  const welcomeText = rawWelcomeTpl.replace('{name}', userName);

  if (verified) {
    delete userState[userId];
    ctx.reply(welcomeText, { parse_mode: 'HTML', ...getMainMenuKeyboard() });
  } else {
    const authText = await getSetting('auth_prompt_template', `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`);
    ctx.reply(authText, { parse_mode: 'HTML', ...getAuthKeyboard() });
  }
});

bot.on('contact', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  await ctx.sendChatAction('typing');
  const contact = ctx.message.contact;
  const phoneNumber = contact.phone_number;
  const firstName = ctx.from.first_name || '';
  const userId = ctx.from.id;
  const referrerId = userState[userId]?.pendingReferrer || null;

  try {
    const { error: insertError } = await supabase.from('users').insert([
      { id: userId, first_name: firstName, phone_number: phoneNumber, points: 0, referred_by: referrerId }
    ]);
    if (insertError) throw insertError;

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
    ctx.reply('🎉 <b>تم توثيق حسابك بنجاح!</b>', {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard()
    });
  } catch (err) {
    ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
  }
});

bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي'))) {
    const verified = await isUserVerified(ctx.from.id);
    if (!verified) {
      return ctx.reply('⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:', getAuthKeyboard());
    }
  }
  return next();
});

bot.hears(['❌ إلغاء العملية والعودة', '🏠 القائمة الرئيسية'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const oldWizard = userState[userId];
  if (oldWizard && oldWizard.wizardMsgId) {
    await ctx.telegram.deleteMessage(oldWizard.chatId, oldWizard.wizardMsgId).catch(() => {});
  }
  delete userState[userId];
  delete browsingSession[userId];

  ctx.reply('✅ العودة إلى القائمة الرئيسية:', {
    parse_mode: 'HTML',
    ...getMainMenuKeyboard()
  });
});

bot.hears('⬅️ رجوع', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step === 'publishing') return;

  const idx = WIZ_STEPS.indexOf(state.step);
  if (idx <= 0) return;

  const prevKey = WIZ_KEYS[idx - 1];
  if (prevKey) delete state.data[prevKey];
  
  if (WIZ_STEPS[idx - 1] === 'waiting_for_description') {
    state.data.description = null;
    state.data.features_list = [];
  }

  state.step = WIZ_STEPS[idx - 1];
  state.tempInput = '';

  await renderWizard(ctx, userId);
});

bot.hears('🎁 رصيدي وجمع النقاط', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const user = await getUserRecord(userId);
  const points = user ? (user.points || 0) : 0;
  const rewardPoints = await getSetting('ad_reward_points', '25');
  const publishCost = await getSetting('publish_cost_points', '100');

  const botUsername = ctx.botInfo?.username || 'AqarDZ_bot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  const msg =
    `🎁 <b>محفظة النقاط والمكافآت:</b>\n\n` +
    `🪙 <b>رصيدك الحالي:</b> <b>${points} نقطة</b>\n` +
    `📌 <b>تكلفة نشر عقار مجاناً:</b> ${publishCost} نقطة\n\n` +
    `🎬 <b>الطريقة 1: مشاهدة إعلان (+${rewardPoints} نقطة)</b>\n` +
    `اضغط على الزر أدناه لمشاهدة إعلان الفيديو وربح النقاط فوراً.\n\n` +
    `👥 <b>الطريقة 2: دعوة الأصدقاء (+50 نقطة لكل صديق)</b>\n` +
    `شارك رابطك الخاص:\n<code>${refLink}</code>`;

  const inlineButtons = [];
  if (WEBHOOK_DOMAIN) {
    inlineButtons.push([
      Markup.button.webApp(`🎬 مشاهدة إعلان الفيديو (+${rewardPoints} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
    ]);
  }

  await ctx.reply(msg, {
    parse_mode: 'HTML',
    ...(inlineButtons.length ? Markup.inlineKeyboard(inlineButtons) : {})
  });
});

bot.hears('🌐 تصفح الموقع الرسمي (البروزر)', async (ctx) => {
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

bot.hears('📞 الدعم والإدارة', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const supportMsg = await getSetting('support_text', '📞 <b>مركز الدعم التقني - منصة عقار الجزائر:</b>\n\nنحن في خدمتك دائماً.');
  ctx.reply(supportMsg, { parse_mode: 'HTML', ...getMainMenuKeyboard() });
});

bot.hears('ℹ️ عن المنصة', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const aboutMsg = await getSetting('about_text', '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.');
  ctx.reply(aboutMsg, { parse_mode: 'HTML', ...getMainMenuKeyboard() });
});

// =========================================================================
// 🔍 تصفح العقارات (من جدول test_messages)
// =========================================================================
async function showStatesMenu(ctx) {
  try {
    const { data } = await supabase.from('test_messages').select('state_name');
    if (!data || data.length === 0) return ctx.reply('📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.', getMainMenuKeyboard());

    const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
    const stateButtons = uniqueStates.map(state => `📍 ${state}`);
    const chunkedStates = chunkButtons(stateButtons, 4);
    chunkedStates.push(['🌐 الكل'], ['🏠 القائمة الرئيسية']);

    const browseTitle = await getSetting('browse_title', '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>');
    ctx.reply(browseTitle, { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() });
  } catch (err) {
    ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
  }
}

bot.hears('🔍 تصفح العقارات المتاحة', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  delete browsingSession[ctx.from.id];
  showStatesMenu(ctx);
});

bot.hears(['📍 تغيير الولاية', 'تغيير الولاية'], async (ctx) => {
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
    state.tempInput = '';
    return renderWizard(ctx, userId);
  }

  const stateList = await getUniqueStatesList();
  if (stateList.includes(selectedState)) {
    browsingSession[userId] = { state: selectedState, page: 0 };
    renderPropertyPage(ctx, userId, 0);
  }
});

bot.hears('🌐 الكل', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  browsingSession[userId] = { state: 'ALL', page: 0 };
  renderPropertyPage(ctx, userId, 0);
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
    if (!data || data.length === 0) return ctx.reply('📭 عذراً، لا توجد عقارات مسجلة.', getMainMenuKeyboard());

    if (pageIndex < 0) pageIndex = 0;
    if (pageIndex >= data.length) pageIndex = data.length - 1;
    session.page = pageIndex;

    const item = data[pageIndex];
    const caption = `🏛 <b>الولاية:</b> ${item.state_name} (${pageIndex + 1}/${data.length})\n\n🏠 <b>العقار:</b> ${item.property_type}\n💰 <b>السعر:</b> ${item.price}\n📞 <b>الهاتف:</b> <code>${item.phone}</code>\n📝 <b>الوصف:</b> ${item.description || item.message}`;

    const contactBtnText = await getSetting('contact_btn_text', '📞 اتصال بالمالك');
    const inlineKb = Markup.inlineKeyboard(Markup.button.callback(contactBtnText, 'contact_admin'));
    const replyKb = getBrowsingKeyboard(pageIndex, data.length);

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
    ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
  }
}

bot.hears(/^📄 \d+ \/ \d+$/, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
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
  numberButtons.push(['🔙 رجوع للعقار']);

  await ctx.reply(`🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`, {
    parse_mode: 'HTML',
    ...Markup.keyboard(numberButtons).resize()
  });
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

bot.hears('🔙 رجوع للعقار', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session) {
    session.selectingPage = false;
    renderPropertyPage(ctx, userId, session.page);
  }
});

bot.hears('⬅️ السابق', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session && session.page > 0) {
    renderPropertyPage(ctx, userId, session.page - 1);
  }
});

bot.hears('التالي ➡️', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const session = browsingSession[userId];
  if (session) {
    renderPropertyPage(ctx, userId, session.page + 1);
  }
});

// =========================================================================
// ➕ إضافة عقار والدفع (الإدراج في جدول test_messages)
// =========================================================================
bot.hears('➕ إضافة عقار جديد', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const old = userState[userId];
  if (old && old.wizardMsgId) await ctx.telegram.deleteMessage(old.chatId, old.wizardMsgId).catch(() => {});

  userState[userId] = { 
    step: 'waiting_for_type', 
    data: { features_list: [] }, 
    chatId: ctx.chat.id, 
    wizardMsgId: null, 
    tempInput: '' 
  };
  renderWizard(ctx, userId);
});

bot.hears('💳 الدفع عبر BaridiMob / CCP', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_payment_choice') return;

  const ccpRip = await getSetting('ccp_rip', '00234567890123456789');
  const ccpName = await getSetting('ccp_name', '');
  const nameLine = ccpName ? `\n👤 <b>الاسم:</b> ${ccpName}` : '';

  const ccpInstructions =
    `💳 <b>الدفع عبر بريدي موب أو CCP:</b>\n\n` +
    `يرجى تحويل مبلغ <b>500 دج</b> إلى الحساب التالي:${nameLine}\n` +
    `📌 <b>رقم الحساب (RIP) (اضغط للنسخ 👇):</b>\n` +
    `<code>${ccpRip}</code>\n\n` +
    `📸 <b>بعد التحويل، أرسل هنا صورة وصل الدفع (Reçu):</b>`;

  state.data.payment_label = '💳 تحويل بريدي موب / CCP';
  state.step = 'waiting_for_payment_receipt';
  await renderWizard(ctx, userId, { footer: ccpInstructions });
});

bot.hears(/^🪙 النشر مجاناً/, async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step !== 'waiting_for_payment_choice') return;

  const user = await getUserRecord(userId);
  const currentPoints = user ? (user.points || 0) : 0;
  const publishCost = Number(await getSetting('publish_cost_points', '100'));

  if (currentPoints < publishCost) {
    return ctx.reply(
      `⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nرصيدك الحالي: <b>${currentPoints} نقطة</b> وتحتاج إلى <b>${publishCost} نقطة</b>.\n\nاضغط على زر <b>"🎁 رصيدي وجمع النقاط"</b> لمشاهدة إعلانات وربح نقاط مجانية!`,
      { parse_mode: 'HTML' }
    );
  }

  state.step = 'publishing';
  try {
    const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة والحفظ...');
    await renderWizard(ctx, userId, { footer: publishingText });

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

    await supabase.from('users').update({ points: currentPoints - publishCost }).eq('id', userId);

    const cleanPrice = String(state.data.price || '0').replace(/[^\d.]/g, '') || '0';
    const cleanPhone = String(state.data.phone || '').trim();

    await supabase.from('test_messages').insert([{
      property_type: state.data.property_type,
      state_name: state.data.state_name,
      price: cleanPrice,
      phone: cleanPhone,
      description: state.data.description,
      message: state.data.description,
      image_url: isVideo ? 'EMPTY' : mediaUrl,
      video_url: isVideo ? mediaUrl : 'EMPTY'
    }]);

    if (state.wizardMsgId) {
      await ctx.telegram.deleteMessage(state.chatId, state.wizardMsgId).catch(() => {});
    }

    await ctx.reply(
      `🎉 <b>تم خصم ${publishCost} نقطة ونشر إعلانك بنجاح في المنصة مجاناً!</b>`,
      { parse_mode: 'HTML', ...getMainMenuKeyboard() }
    );
    delete userState[userId];
  } catch (err) {
    ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard());
    delete userState[userId];
  }
});

// ⚡ معالج لوحة الأرقام (Numpad)
bot.action(/^n_(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state) return await ctx.answerCbQuery('انتهت الجلسة، ابدأ من جديد.');

  const action = ctx.match[1];
  state.tempInput = state.tempInput || '';

  if (action >= '0' && action <= '9') {
    state.tempInput += action;
  } else if (action === 'million') {
    state.tempInput += '000000';
  } else if (action === 'back') {
    state.tempInput = state.tempInput.slice(0, -1);
  } else if (action === 'clear') {
    state.tempInput = '';
  } else if (action === 'confirm') {
    if (!state.tempInput || state.tempInput.length === 0) {
      return await ctx.answerCbQuery('⚠️ يرجى إدخال الرقم في الحقل أولاً!');
    }

    if (state.step === 'waiting_for_price') {
      state.data.price = state.tempInput;
      state.step = 'waiting_for_phone';
      state.tempInput = '';
    } else if (state.step === 'waiting_for_phone') {
      if (state.tempInput.length < 9) {
        return await ctx.answerCbQuery('⚠️ رقم الهاتف قصير جداً!');
      }
      state.data.phone = state.tempInput;
      state.step = 'waiting_for_description';
      state.data.features_list = state.data.features_list || [];
      state.tempInput = '';
    }
  }

  await ctx.answerCbQuery().catch(() => {});
  await renderWizard(ctx, userId);
});

bot.action('noop_input', async (ctx) => {
  await ctx.answerCbQuery('هذا هو حقل الإدخال الرقمي المؤقت 💡');
});

// 📝 معالج النصوص: اختيار النوع + بناء الوصف التفاعلي
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text ? ctx.message.text.trim() : '';
  if (userText.startsWith('/')) return;

  const state = userState[userId];
  if (!state) return;

  if (state.step === 'waiting_for_type') {
    const validTypes = await getDynamicPropertyTypes();
    const allowedTitles = validTypes.map(item => item.title);

    if (allowedTitles.includes(userText)) {
      await safeDeleteUserMessage(ctx);
      state.data.property_type = userText;
      state.step = 'waiting_for_state';
      state.tempInput = '';
      return renderWizard(ctx, userId);
    }
    return;
  }

  if (state.step === 'waiting_for_description') {
    await safeDeleteUserMessage(ctx);
    state.data.features_list = state.data.features_list || [];

    if (userText === '↩️ تراجع عن الأخيرة') {
      if (state.data.features_list.length > 0) {
        state.data.features_list.pop();
        return renderWizard(ctx, userId);
      }
      return;
    }

    if (userText === '🗑️ مسح الكل') {
      state.data.features_list = [];
      return renderWizard(ctx, userId);
    }

    if (userText === '✅ تأكيد الوصف والانتقال') {
      if (state.data.features_list.length === 0) {
        const warnMsg = await ctx.reply('⚠️ <b>يرجى اختيار ميزة واحدة على الأقل قبل التأكيد!</b>', { parse_mode: 'HTML' });
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
        return;
      }
      state.data.description = state.data.features_list.join(' | ');
      state.step = 'waiting_for_media';
      return renderWizard(ctx, userId);
    }

    const validFeatures = await getDynamicFeatures();
    const allowedFeatures = validFeatures.map(f => f.title);

    if (allowedFeatures.includes(userText)) {
      if (!state.data.features_list.includes(userText)) {
        state.data.features_list.push(userText);
      }
      return renderWizard(ctx, userId);
    }
  }
});

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
    return renderWizard(ctx, userId);
  }

  if (state && state.step === 'waiting_for_payment_receipt') {
    const receiptPhoto = ctx.message.photo[ctx.message.photo.length - 1];
    state.step = 'publishing';

    try {
      const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة والحفظ...');
      await renderWizard(ctx, userId, { footer: publishingText });

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

      let receiptUrl = '';
      try {
        const receiptFileLink = await ctx.telegram.getFileLink(receiptPhoto.file_id);
        const resReceipt = await fetch(receiptFileLink.href);
        const bufReceipt = Buffer.from(await resReceipt.arrayBuffer());
        const receiptFileName = `${Date.now()}_receipt_${userId}.jpg`;
        await supabase.storage.from('test_media').upload(receiptFileName, bufReceipt, { contentType: 'image/jpeg', upsert: true });
        const { data: pubReceiptUrl } = supabase.storage.from('test_media').getPublicUrl(receiptFileName);
        receiptUrl = pubReceiptUrl.publicUrl;
      } catch (e) {
        receiptUrl = receiptPhoto.file_id;
      }

      const isVideo = state.data.media_type === 'video';
      const cleanPrice = String(state.data.price || '0').replace(/[^\d.]/g, '') || '0';
      const cleanPhone = String(state.data.phone || '').trim();

      const { data: insertedRow, error: insertError } = await supabase
        .from('pending_properties')
        .insert([{
          user_id: userId,
          property_type: state.data.property_type,
          state_name: state.data.state_name,
          price: cleanPrice,
          phone: cleanPhone,
          description: state.data.description,
          image_url: isVideo ? 'EMPTY' : mediaUrl,
          video_url: isVideo ? mediaUrl : 'EMPTY',
          receipt_url: receiptUrl,
          status: 'pending'
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
        `💰 <b>السعر:</b> ${formatMoney(cleanPrice)}\n` +
        `📞 <b>الهاتف:</b> ${cleanPhone}\n` +
        `📝 <b>الوصف:</b> ${state.data.description}`;

      // جلب قائمة المدراء (سواء مدير واحد أو عدة مدراء) وإرسال الإشعار لهم جماعياً
      const adminIds = await getAdminIds();

      for (const currentAdminId of adminIds) {
        await ctx.telegram.sendPhoto(currentAdminId, receiptPhoto.file_id, {
          caption: adminCaption + `\n\n👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ قرار:</b>`,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`),
              Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`)
            ]
          ])
        }).catch(() => {});
      }

      if (state.wizardMsgId) {
        await ctx.telegram.deleteMessage(state.chatId, state.wizardMsgId).catch(() => {});
      }

      await ctx.reply(
        `⏳ <b>تم استلام وصل الدفع وحفظ طلبك برقم (#${requestId})!</b>\n\nالإعلان قيد المراجعة من طرف الإدارة وسيتم نشره فور تأكيد التحويل.`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard() }
      );
      delete userState[userId];
    } catch (err) {
      ctx.reply('⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard());
      delete userState[userId];
    }
  }
});

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
    return renderWizard(ctx, userId);
  }
});

// =========================================================================
// 🛡️ معالج موافقة أو رفض الإدارة (النشر في جدول test_messages)
// =========================================================================
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
      return ctx.editMessageCaption(`⚠️ <b>الطلب (#${requestId}) غير موجود أو تم التعامل معه مسبقاً.</b>`, { parse_mode: 'HTML' });
    }

    const targetUserId = pendingItem.user_id;

    if (action === 'approve') {
      const cleanPrice = String(pendingItem.price || '0').replace(/[^\d.]/g, '') || '0';
      const cleanPhone = String(pendingItem.phone || '').trim();

      const { error: publishError } = await supabase.from('test_messages').insert([{
        property_type: pendingItem.property_type,
        state_name: pendingItem.state_name,
        price: cleanPrice,
        phone: cleanPhone,
        description: pendingItem.description,
        message: pendingItem.description,
        image_url: pendingItem.image_url,
        video_url: pendingItem.video_url
      }]);

      if (publishError) throw publishError;

      await supabase.from('pending_properties').update({ status: 'approved' }).eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        `🎉 <b>تم قبول إعلانك رقم (#${requestId}) ونشره بنجاح في المنصة!</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n📌 الحالة: <b>مقبول (مُحفظ في جدول test_messages)</b>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n📌 الحالة: <b>مرفوض</b>`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`);
  }
};

bot.action(/^approve_(\d+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
bot.action(/^reject_(\d+)$/, (ctx) => handleAdminAction(ctx, 'reject'));

// =========================================================================
// 🚀 تشغيل السيرفر
// =========================================================================
const PORT = process.env.PORT || 3000;
if (WEBHOOK_DOMAIN) {
  app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    if (req.body && req.body.update_id) bot.handleUpdate(req.body);
  });
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  app.get('/', (req, res) => res.send('Aqar Algeria Production System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
