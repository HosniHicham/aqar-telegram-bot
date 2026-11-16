'use strict';

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : 5883330772;
const AD_REWARD_POINTS = 25; 
const PUBLISH_COST_POINTS = 100; 

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
  return Markup.keyboard([
    ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
    ['🎁 رصيدي وجمع النقاط', '📞 الدعم والإدارة'],
    ['🌐 تغيير اللغة / Langue', 'ℹ️ عن المنصة'],
    ['🌐 تصفح الموقع الرسمي (البروزر)']
  ]).resize();
}

function getBrowsingKeyboard(userId, currentIndex, totalCount) {
  const prevBtn = '⬅️ السابق';
  const nextBtn = 'التالي ➡️';
  const counterText = `📄 ${currentIndex + 1} / ${totalCount}`;
  const changeWilayaBtn = '📍 تغيير الولاية';
  const homeBtn = '🏠 القائمة الرئيسية';

  const navRow = [];
  if (currentIndex > 0) navRow.push(prevBtn);
  navRow.push(counterText);
  if (currentIndex < totalCount - 1) navRow.push(nextBtn);

  return Markup.keyboard([navRow, [changeWilayaBtn, homeBtn]]).resize();
}

function getAuthKeyboard(userId) {
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

// =========================================================================
// 🎬 صفحة الويب المصغرة لربح النقاط
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
    <p style="color:#94A3B8; font-size:14px;">اضغط على الزر أدناه لبدء مشاهدة الإعلان وربح +${AD_REWARD_POINTS} نقطة.</p>
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
// 🏢 معالج نشر العقار
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
      'اضغط على زر <b>⌨️ إدخال السعر والهاتف</b> بالأسفل لفتح نموذج الإدخال:',
      'اضغط على زر <b>⌨️ إدخال السعر والهاتف</b> بالأسفل لفتح نموذج الإدخال:',
      'أدخل <b>الوصف التفصيلي</b> للعقار:',
      'أرسل الآن <b>صورة أو فيديو العقار</b>:',
      'اختر طريقة الدفع أدناه:',
      'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:'
    ],
    back: '⬅️ رجوع',
    home: '🏠 القائمة الرئيسية',
    cancelBtn: '❌ إلغاء العملية والعودة',
    publishing: '⏳ جاري المعالجة والحفظ...'
  }
};

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildWizardText(userId, state, opts = {}) {
  const W = WIZ['ar'];
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
  const W = WIZ['ar'];
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
  } else if ((state.step === 'waiting_for_price' || state.step === 'waiting_for_phone') && WEBHOOK_DOMAIN) {
    rows.push([Markup.button.webApp('⌨️ إدخال السعر والهاتف', `${WEBHOOK_DOMAIN}/form`)]);
    rows.push([W.back, W.home]);
    rows.push([W.cancelBtn]);
  } else {
    rows.push([W.back, W.home]);
    rows.push([W.cancelBtn]);
  }

  return Markup.keyboard(rows).resize();
}

// =========================================================================
// 📝 نموذج الإدخال الذكي (Mini App) للسعر ورقم الهاتف
// =========================================================================
async function clearPad() {}

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

app.get('/form', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>إدخال البيانات</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:#0F172A; color:#F8FAFC; font-family: system-ui,-apple-system,sans-serif; user-select:none; }
  .wrap { max-width:420px; margin:0 auto; padding:14px; }
  .field { background:#1E293B; border:2px solid #334155; border-radius:14px; padding:10px 14px; margin-bottom:10px; cursor:pointer; }
  .field.active { border-color:#D4AF37; box-shadow:0 0 0 3px rgba(212,175,55,.15); }
  .lbl { font-size:12px; color:#94A3B8; }
  .val { font-size:26px; font-weight:bold; min-height:36px; direction:ltr; text-align:right; letter-spacing:1px; }
  .sub { font-size:13px; color:#D4AF37; min-height:16px; }
  .err { color:#FCA5A5; font-size:13px; font-weight:bold; min-height:18px; margin:2px 4px 8px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:8px; }
  .k { background:#1E293B; color:#F8FAFC; border:1px solid #334155; border-radius:12px; font-size:22px; font-weight:bold; padding:14px 0; cursor:pointer; }
  .k:active { background:#334155; }
  .x { background:#273449; color:#D4AF37; font-size:17px; }
  .ok { width:100%; background:#D4AF37; color:#0F172A; border:none; border-radius:12px; font-size:18px; font-weight:bold; padding:15px; margin-top:6px; cursor:pointer; }
</style>
</head>
<body>
<div class="wrap">
  <div class="field active" id="fPrice"><div class="lbl">💰 السعر (دج)</div><div class="val" id="vPrice"></div><div class="sub" id="sPrice"></div></div>
  <div class="field" id="fPhone"><div class="lbl">📞 رقم الهاتف</div><div class="val" id="vPhone"></div><div class="sub" id="sPhone"></div></div>
  <div class="err" id="err"></div>
  <div class="grid" id="extra"></div>
  <div class="grid" id="pad"></div>
  <button class="ok" id="okBtn"></button>
</div>
<script>
var tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
var v = { price: '', phone: '' };
var active = 'price';

function fmtPrice(d) {
  if (!d) return '0';
  var o = '', c = 0;
  for (var i = d.length - 1; i >= 0; i--) {
    o = d.charAt(i) + o; c++;
    if (c % 3 === 0 && i > 0) o = ',' + o;
  }
  return o;
}
function words(d) {
  var n = Number(d || 0);
  function tr(x) { return String(Math.round(x * 100) / 100); }
  if (n >= 1e9) return tr(n / 1e9) + ' مليار';
  if (n >= 1e6) return tr(n / 1e6) + ' مليون';
  if (n >= 1000) return tr(n / 1000) + ' ألف';
  return '';
}
function fmtPhone(d) {
  if (!d) return '— — — —';
  var p = [d.substr(0, 4)];
  if (d.length > 4) p.push(d.substr(4, 2));
  if (d.length > 6) p.push(d.substr(6, 2));
  if (d.length > 8) p.push(d.substr(8, 2));
  return p.join(' ');
}
function validPhone(d) {
  return d.length === 10 && d.charAt(0) === '0' && '567'.indexOf(d.charAt(1)) >= 0;
}
function haptic() { try { tg.HapticFeedback.impactOccurred('light'); } catch (e) {} }
function setErr(m) { document.getElementById('err').textContent = m || ''; }

function mk(label, cls, fn) {
  var b = document.createElement('button');
  b.className = 'k ' + cls;
  b.textContent = label;
  b.onclick = function () { fn(label); };
  return b;
}

function render() {
  document.getElementById('vPrice').textContent = fmtPrice(v.price) + ' دج';
  document.getElementById('sPrice').textContent = words(v.price);
  document.getElementById('vPhone').textContent = fmtPhone(v.phone);
  document.getElementById('fPrice').className = 'field' + (active === 'price' ? ' active' : '');
  document.getElementById('fPhone').className = 'field' + (active === 'phone' ? ' active' : '');

  var extra = document.getElementById('extra');
  var pad = document.getElementById('pad');
  extra.innerHTML = ''; pad.innerHTML = '';

  var ex = [];
  if (active === 'price') ex = ['000', 'مليون', 'مسح'];
  else if (!v.phone) ex = ['05', '06', '07'];
  for (var i = 0; i < ex.length; i++) extra.appendChild(mk(ex[i], 'x', press));
  extra.style.display = ex.length ? 'grid' : 'none';

  var keys = ['1','2','3','4','5','6','7','8','9', active === 'price' ? '00' : 'مسح', '0', '⌫'];
  for (var j = 0; j < keys.length; j++) pad.appendChild(mk(keys[j], '', press));

  document.getElementById('okBtn').textContent =
    (active === 'price' && !v.phone) ? 'التالي ⬅️' : '✅ تأكيد';
}

function press(k) {
  setErr('');
  if (k === '⌫') {
    v[active] = v[active].slice(0, -1);
  } else if (k === 'مسح') {
    v[active] = '';
  } else if (k === 'مليون') {
    if (!v.price || v.price.length + 6 > 12) return;
    v.price += '000000';
  } else if (active === 'price') {
    if (!v.price && k.replace(/0/g, '') === '') return;
    if (v.price.length + k.length > 12) return;
    v.price += k;
  } else {
    var next = v.phone + k;
    if (next.length > 10) return;
    if (next.length === 1 && next !== '0') { setErr('يبدأ الرقم بـ 05 أو 06 أو 07'); return; }
    if (next.length === 2 && '567'.indexOf(next.charAt(1)) < 0) { setErr('يبدأ الرقم بـ 05 أو 06 أو 07'); return; }
    v.phone = next;
  }
  haptic();
  render();
}

document.getElementById('fPrice').onclick = function () { active = 'price'; setErr(''); render(); };
document.getElementById('fPhone').onclick = function () { active = 'phone'; setErr(''); render(); };

document.getElementById('okBtn').onclick = function () {
  if (!v.price || Number(v.price) <= 0) { active = 'price'; setErr('⚠️ أدخل السعر أولاً'); render(); return; }
  if (active === 'price' && !v.phone) { active = 'phone'; render(); return; }
  if (!validPhone(v.phone)) { active = 'phone'; setErr('⚠️ رقم الهاتف يجب أن يتكون من 10 أرقام ويبدأ بـ 05 أو 06 أو 07'); render(); return; }
  if (tg) { tg.sendData(JSON.stringify({ price: v.price, phone: v.phone })); }
  else { alert('افتح الصفحة من داخل تيليغرام'); }
};

render();
</script>
</body>
</html>`);
});

// استقبال بيانات النموذج من الـ Mini App
bot.on('message', async (ctx, next) => {
  const wad = ctx.message && ctx.message.web_app_data;
  if (!wad) return next();

  const userId = ctx.from.id;
  const state = userState[userId];
  await safeDeleteUserMessage(ctx);
  if (!state || (state.step !== 'waiting_for_price' && state.step !== 'waiting_for_phone')) return;

  let payload;
  try { payload = JSON.parse(wad.data); } catch (e) { return; }

  const priceDigits = String(payload.price || '');
  const phoneDigits = String(payload.phone || '');

  if (!/^[1-9]\d{0,11}$/.test(priceDigits) || !/^0[567]\d{8}$/.test(phoneDigits)) {
    return ctx.reply('⚠️ البيانات غير صحيحة، يرجى المحاولة مرة أخرى.');
  }

  state.data.price = `${priceDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} دج`;
  state.data.phone = phoneDigits;
  state.step = 'waiting_for_description';
  await renderWizard(ctx, userId);
});

bot.hears('🎁 رصيدي وجمع النقاط', async (ctx) => {
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
    `اضغط على الزر أدناه لمشاهدة إعلان الفيديو وربح النقاط فوراً.\n\n` +
    `👥 <b>الطريقة 2: دعوة الأصدقاء (+50 نقطة لكل صديق)</b>\n` +
    `شارك رابطك الخاص:\n<code>${refLink}</code>`;

  const inlineButtons = [];
  if (WEBHOOK_DOMAIN) {
    inlineButtons.push([
      Markup.button.webApp(`🎬 مشاهدة إعلان الفيديو (+${AD_REWARD_POINTS} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
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

bot.hears('⬅️ رجوع', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const state = userState[userId];
  if (!state || state.step === 'publishing') return;

  const idx = WIZ_STEPS.indexOf(state.step);
  if (idx <= 0) return;

  const prevKey = WIZ_KEYS[idx - 1];
  if (prevKey) delete state.data[prevKey];
  state.step = WIZ_STEPS[idx - 1];
  state.input = '';

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
  if (verified) {
    delete userState[userId];
    ctx.reply(t(userId, 'welcome', userName), { parse_mode: 'HTML', ...getMainMenuKeyboard(userId) });
  } else {
    ctx.reply(t(userId, 'authPrompt', userName), { parse_mode: 'HTML', ...getAuthKeyboard(userId) });
  }
});

bot.hears(['❌ إلغاء العملية والعودة', '🏠 القائمة الرئيسية'], async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const oldWizard = userState[userId];
  if (oldWizard) {
    await clearPad(ctx, oldWizard);
    if (oldWizard.wizardMsgId) {
      await ctx.telegram.deleteMessage(oldWizard.chatId, oldWizard.wizardMsgId).catch(() => {});
    }
  }
  delete userState[userId];
  delete browsingSession[userId];

  ctx.reply('✅ العودة إلى القائمة الرئيسية:', {
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
      ...getMainMenuKeyboard(userId)
    });
  } catch (err) {
    console.error('User verification insert error:', err);
    ctx.reply(t(userId, 'errorMsg'));
  }
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

bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
  if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي'))) {
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

bot.hears('📞 الدعم والإدارة', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  ctx.reply(t(ctx.from.id, 'supportText'), { parse_mode: 'HTML', ...getMainMenuKeyboard(ctx.from.id) });
});

bot.hears('ℹ️ عن المنصة', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  ctx.reply(t(userId, 'aboutText'), { parse_mode: 'HTML', ...getMainMenuKeyboard(ctx.from.id) });
});

bot.hears('➕ إضافة عقار جديد', async (ctx) => {
  await safeDeleteUserMessage(ctx);
  const userId = ctx.from.id;
  const old = userState[userId];
  if (old) {
    await clearPad(ctx, old);
    if (old.wizardMsgId) await ctx.telegram.deleteMessage(old.chatId, old.wizardMsgId).catch(() => {});
  }

  userState[userId] = { step: 'waiting_for_type', data: {}, chatId: ctx.chat.id, wizardMsgId: null, padMsgId: null, input: '' };
  renderWizard(ctx, userId);
});

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
    await renderWizard(ctx, userId, { footer: WIZ['ar'].publishing });

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

    await supabase.from('users').update({ points: currentPoints - PUBLISH_COST_POINTS }).eq('id', userId);

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

  if (!WEBHOOK_DOMAIN && state.step === 'waiting_for_price') {
    state.data.price = userText;
    state.step = 'waiting_for_phone';
  } else if (!WEBHOOK_DOMAIN && state.step === 'waiting_for_phone') {
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
      await renderWizard(ctx, userId, { footer: WIZ['ar'].publishing });

      // رفع صورة العقار الأساسية إلى Supabase Storage
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

      // رفع صورة وصل الدفع (Reçu) إلى Supabase Storage ليبقى رابطها دائماً وثابتاً في القاعدة
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
        receiptUrl = receiptPhoto.file_id; // حل احتياطي إذا فشل الرفع المباشر
      }

      const isVideo = state.data.media_type === 'video';

      // حفظ الطلب في جدول pending_properties مع الحالة 'pending' ورابط الوصل الثابت
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

// 🛠️ أزرار تفاعل الأدمن (تغيير الحالة في القاعدة دون حذف السطر للمراجعة والشكاوى)
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
      // 1. نشر العقار في جدول العروض الأساسية test_messages
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

      // 2. تحديث الحالة في جدول pending_properties إلى 'approved' بدلاً من الحذف لتبقى للـ Réclamation
      await supabase
        .from('pending_properties')
        .update({ status: 'approved' })
        .eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        `🎉 <b>تم قبول إعلانك رقم (#${requestId}) ونشره بنجاح في المنصة!</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n📌 الحالة: <b>مقبول (مُحفظ في السجل)</b>`,
        { parse_mode: 'HTML' }
      );
    } else {
      // تحديث الحالة في جدول pending_properties إلى 'rejected' لتبقى مرجعاً للشكاوى
      await supabase
        .from('pending_properties')
        .update({ status: 'rejected' })
        .eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n📌 الحالة: <b>مرفوض (مُحفظ في السجل)</b>`,
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
  app.get('/', (req, res) => res.send('Aqar Algeria Permanent Logs System is online 🚀'));
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
} else {
  bot.launch();
}
