'use strict';

const { Markup } = require('telegraf');

function createUsersHandler({ bot, app, supabase, WEBHOOK_DOMAIN, getAdminIds }) {
  const userState = {};
  const userLang = {};
  const browsingSession = {};
  const botMessagesHistory = {};
  const supportUserSession = {};
  const MAX_PROPERTY_IMAGES = 6;

  function trackBotMessage(userId, chatId, messageId) {
    if (!userId || !chatId || !messageId) return;
    if (!botMessagesHistory[userId]) {
      botMessagesHistory[userId] = { chatId, ids: [] };
    }
    botMessagesHistory[userId].chatId = chatId;
    if (!botMessagesHistory[userId].ids.includes(messageId)) {
      botMessagesHistory[userId].ids.push(messageId);
    }
  }

  async function clearTrackedBotMessages(ctx, userId, keepMessageIds = []) {
    const history = botMessagesHistory[userId];
    const keepSet = new Set(Array.isArray(keepMessageIds) ? keepMessageIds : [keepMessageIds].filter(Boolean));
    const chatId = ctx?.chat?.id || history?.chatId;
    if (!history || !chatId) return;

    const remaining = [];
    for (const msgId of history.ids) {
      if (keepSet.has(msgId)) {
        remaining.push(msgId);
        continue;
      }
      try {
        await ctx.telegram.deleteMessage(chatId, msgId);
      } catch (e) {}
    }
    botMessagesHistory[userId].ids = remaining;
  }

  async function replyTracked(ctx, userId, text, extra = {}, cleanPrevious = false, keepIds = []) {
    if (cleanPrevious) {
      await clearTrackedBotMessages(ctx, userId, keepIds);
    }
    const sent = await ctx.reply(text, extra);
    if (sent && sent.message_id) {
      trackBotMessage(userId, ctx.chat.id, sent.message_id);
    }
    return sent;
  }

  async function getSetting(key, defaultValue = '') {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
      return data ? data.value : defaultValue;
    } catch (e) {
      return defaultValue;
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

  function getBrowsingKeyboard(currentIndex, totalCount, mediaIdx = 0, totalMedia = 0) {
    const rows = [];

    if (totalMedia > 1) {
      const mediaRow = [];
      if (mediaIdx > 0) mediaRow.push('🖼 الصورة السابقة');
      mediaRow.push(`📸 عنصر ${mediaIdx + 1} / ${totalMedia}`);
      if (mediaIdx < totalMedia - 1) mediaRow.push('الصورة التالية 🖼');
      rows.push(mediaRow);
    }

    const navRow = [];
    if (currentIndex > 0) navRow.push('⬅️ السابق');
    navRow.push(`📄 ${currentIndex + 1} / ${totalCount}`);
    if (currentIndex < totalCount - 1) navRow.push('التالي ➡️');

    rows.push(navRow);
    rows.push(['📍 تغيير الولاية', '🏠 القائمة الرئيسية']);

    return Markup.keyboard(rows).resize();
  }

  function getAuthKeyboard() {
    return Markup.keyboard([
      [Markup.button.contactRequest('📱 اضغط هنا لمشاركة رقم هاتفك والبدء')]
    ]).resize().oneTime();
  }

  function getBottomNumpadKeyboard(displayValue, isPrice = true) {
    const displayText = displayValue ? (isPrice ? formatMoney(displayValue) : displayValue) : '0';

    return Markup.keyboard([
      [`📥 القيمة الحالية: [ ${displayText} ]`],
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['0', isPrice ? '+مليون' : '⌫', '🗑️ مسح'],
      ['✅ [ OK ] تأكيد'],
      ['⬅️ رجوع', '🏠 القائمة الرئيسية'],
      ['❌ إلغاء العملية والعودة']
    ]).resize();
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

  function sanitizeNumericPrice(val) {
    if (val === null || val === undefined) return 0;
    const digitsOnly = String(val).replace(/\D/g, '');
    if (!digitsOnly) return 0;
    const num = Number(digitsOnly);
    return Number.isFinite(num) ? num : 0;
  }

  function formatMoney(val) {
    if (!val) return '0 دج';
    const str = String(val).trim();
    if (/[ا-يa-zA-Z]/.test(str)) return str;
    const clean = str.replace(/\D/g, '');
    if (!clean) return '0 دج';
    return Number(clean).toLocaleString('en-US') + ' دج';
  }

  function formatDateTime(dateInput) {
    const target = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(target.getTime())) return String(dateInput || 'غير محدد');
    try {
      return target.toLocaleString('fr-DZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return target.toISOString().replace('T', ' ').slice(0, 16);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function normalizeMediaRef(v) {
    if (typeof v !== 'string') return null;
    const clean = v.trim();
    if (!clean || clean === 'EMPTY' || clean === 'FREE_NO_RECEIPT') return null;
    return clean.startsWith('tg:') ? clean.slice(3) : clean;
  }

  function parseMediaListFromField(fieldVal) {
    if (!fieldVal || typeof fieldVal !== 'string') return [];
    const trimmed = fieldVal.trim();
    if (!trimmed || trimmed === 'EMPTY') return [];

    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          return [...new Set(arr.map(normalizeMediaRef).filter(Boolean))];
        }
      } catch (e) {}
    }

    return [...new Set(trimmed.split('|').map(normalizeMediaRef).filter(Boolean))];
  }

  function parseImagesFromImageUrl(imageUrlField) {
    return parseMediaListFromField(imageUrlField);
  }

  function buildOrderedBrowsingMedia(item) {
    const videos = parseMediaListFromField(item.video_url)
      .slice(0, MAX_PROPERTY_IMAGES)
      .map(ref => ({ type: 'video', ref }));

    const photos = parseImagesFromImageUrl(item.image_url)
      .slice(0, MAX_PROPERTY_IMAGES)
      .map(ref => ({ type: 'photo', ref }));

    return [...videos, ...photos];
  }

  async function uploadMediaListByType(ctx, mediaItems = [], targetType) {
    const filtered = mediaItems.filter(item => item.type === targetType);
    const urls = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      let url = `tg:${item.file_id}`;
      try {
        const fileLink = await ctx.telegram.getFileLink(item.file_id);
        const res = await fetch(fileLink.href);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = targetType === 'video' ? 'mp4' : 'jpg';
        const mime = targetType === 'video' ? 'video/mp4' : 'image/jpeg';
        const fileName = `${Date.now()}_${i}_${targetType}_aqar.${ext}`;
        await supabase.storage.from('test_media').upload(fileName, buf, { contentType: mime, upsert: true });
        const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
        if (pubUrl && pubUrl.publicUrl) url = pubUrl.publicUrl;
      } catch (e) {}
      urls.push(url);
    }
    return urls.length > 0 ? urls.join('|') : 'EMPTY';
  }

  function formatMediaSummaryLabel(mediaItems = []) {
    const photosCount = mediaItems.filter(i => i.type === 'photo').length;
    const videosCount = mediaItems.filter(i => i.type === 'video').length;
    const parts = [];
    if (photosCount > 0) parts.push(`${photosCount} صورة`);
    if (videosCount > 0) parts.push(`${videosCount} فيديو`);
    if (parts.length === 0) return null;
    return `📎 تم إرفاق ${parts.join(' و ')} (يمكنك إضافة المزيد)`;
  }

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
  const WIZ_LABELS = ['🏠 النوع', '📍 الولاية', '💰 السعر', '📞 الهاتف', '📝 الوصف', '📸 الصور والفيديو', '💳 الدفع'];

  async function getWizardPrompt(stepIndex) {
    const prompts = [
      'اختر <b>نوع العقار</b> من القائمة في الأسفل:',
      'اختر <b>الولاية</b> من القائمة في الأسفل:',
      'استخدم لوحة الأرقام في الأسفل لتشكيل السعر، ثم اضغط <b>✅ [ OK ] تأكيد</b>:',
      'استخدم لوحة الأرقام في الأسفل لإدخال رقم الهاتف، ثم اضغط <b>✅ [ OK ] تأكيد</b>:',
      'اختر <b>مزايا ومواصفات العقار</b> من القائمة في الأسفل (يمكنك اختيار أكثر من ميزة)، ثم اضغط <b>✅ تأكيد الوصف والانتقال</b>:',
      `أرسل الآن <b>عدة صور أو فيديوهات للعقار</b> (حتى ${MAX_PROPERTY_IMAGES} ملفات معاً)، ثم اضغط <b>✅ إنهاء إرفاق الوسائط والانتقال</b>:`,
      'اختر طريقة الدفع أو النشر من القائمة في الأسفل:',
      'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:'
    ];
    return prompts[stepIndex] || '';
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

    const currentPriceDisplay = d.price
      ? formatMoney(d.price)
      : (state.step === 'waiting_for_price' ? `${formatMoney(state.tempInput || '0')} (قيد الإدخال...)` : null);

    const currentPhoneDisplay = d.phone
      ? d.phone
      : (state.step === 'waiting_for_phone' ? `${state.tempInput || '0'} (قيد الإدخال...)` : null);

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

  async function getStandardReplyKeyboard(state) {
    const stateStep = state.step;
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
    } else if (stateStep === 'waiting_for_price') {
      return getBottomNumpadKeyboard(state.tempInput || '', true);
    } else if (stateStep === 'waiting_for_phone') {
      return getBottomNumpadKeyboard(state.tempInput || '', false);
    } else if (stateStep === 'waiting_for_description') {
      return await getDynamicDescriptionKeyboard();
    } else if (stateStep === 'waiting_for_media') {
      const count = (state.data.media_items || []).length;
      const rows = [];
      if (count > 0) {
        rows.push([`✅ إنهاء إرفاق الوسائط (${count}) والانتقال`]);
        rows.push(['🗑️ مسح الوسائط المرفقة']);
      }
      rows.push([backText, homeText]);
      rows.push([cancelText]);
      return Markup.keyboard(rows).resize();
    } else if (stateStep === 'waiting_for_payment_choice') {
      const publishCost = await getSetting('publish_cost_points', '100');
      return Markup.keyboard([
        ['💳 الدفع عبر BaridiMob / CCP'],
        [`🪙 النشر مجاناً (${publishCost} نقطة)`],
        ['🆓 نشر مجاني'],
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
        `3️⃣ <b>نشر مجاني:</b> يُرسل إلى قائمة الانتظار والمراجعة الإدارية كإعلان مجاني.\n` +
        `🪙 <b>رصيدك الحالي:</b> <b>${currentPoints} نقطة</b>`;
    }

    const text = await buildWizardText(state, opts);

    if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
      try {
        await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
      } catch (e) {}
      return;
    }

    const replyKeyboard = opts.noKeyboard ? getMainMenuKeyboard() : await getStandardReplyKeyboard(state);
    const sent = await ctx.reply(text, { parse_mode: 'HTML', ...replyKeyboard });
    const oldId = state.wizardMsgId;
    state.wizardMsgId = sent.message_id;
    state.chatId = ctx.chat.id;
    if (sent.message_id) {
      trackBotMessage(userId, ctx.chat.id, sent.message_id);
    }

    if (oldId && oldId !== sent.message_id) {
      await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
    }
  }

  async function showStatesMenu(ctx) {
    const userId = ctx.from.id;
    try {
      const { data, error } = await supabase.from('test_messages').select('state_name');
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.', getMainMenuKeyboard(), true);
      }

      const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
      const stateButtons = uniqueStates.map(state => `📍 ${state}`);
      const chunkedStates = chunkButtons(stateButtons, 4);
      chunkedStates.push(['🌐 الكل'], ['🏠 القائمة الرئيسية']);

      const browseTitle = await getSetting('browse_title', '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>');
      await replyTracked(ctx, userId, browseTitle, { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() }, true);
    } catch (err) {
      console.error('showStatesMenu error:', err);
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(), true);
    }
  }

  async function renderPropertyPage(ctx, userId, pageIndex, mediaIndex = 0) {
    const session = browsingSession[userId];
    if (!session) return;

    session.selectingPage = false;

    try {
      let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
      if (session.state !== 'ALL') query = query.eq('state_name', session.state);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, '📭 عذراً، لا توجد عقارات مسجلة.', getMainMenuKeyboard(), true);
      }

      if (pageIndex < 0) pageIndex = 0;
      if (pageIndex >= data.length) pageIndex = data.length - 1;
      session.page = pageIndex;

      const item = data[pageIndex];
      const orderedMedia = buildOrderedBrowsingMedia(item);
      const totalMedia = orderedMedia.length;

      let safeMediaIndex = Number(mediaIndex) || 0;
      if (safeMediaIndex < 0) safeMediaIndex = 0;
      if (totalMedia > 0 && safeMediaIndex >= totalMedia) safeMediaIndex = totalMedia - 1;
      session.photoIndex = safeMediaIndex;

      const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIndex] : null;
      const mediaTypeLabel = currentMedia ? (currentMedia.type === 'video' ? '🎥 فيديو' : '🖼 صورة') : '';
      const mediaLine = totalMedia > 0 ? `\n${mediaTypeLabel}: <b>${safeMediaIndex + 1} / ${totalMedia}</b>` : '';
      const publishedAtText = item.created_at ? formatDateTime(item.created_at) : 'غير مسجل';

      const caption =
        `🏛 <b>الولاية:</b> ${escapeHtml(item.state_name || '')} (${pageIndex + 1}/${data.length})\n\n` +
        `🏠 <b>العقار:</b> ${escapeHtml(item.property_type || '')}\n` +
        `💰 <b>السعر:</b> ${formatMoney(item.price)}\n` +
        `📞 <b>هاتف المالك:</b> <code>${escapeHtml(item.phone || '')}</code>\n` +
        `🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(publishedAtText)}</code>${mediaLine}\n` +
        `📝 <b>الوصف:</b> ${escapeHtml(item.description || item.message || '')}`;

      const replyKb = getBrowsingKeyboard(pageIndex, data.length, safeMediaIndex, totalMedia);

      let sentMsg = null;
      if (currentMedia) {
        try {
          sentMsg = currentMedia.type === 'video'
            ? await ctx.replyWithVideo(currentMedia.ref, { caption, parse_mode: 'HTML', ...replyKb })
            : await ctx.replyWithPhoto(currentMedia.ref, { caption, parse_mode: 'HTML', ...replyKb });
        } catch (mediaErr) {}
      }

      if (!sentMsg) {
        sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...replyKb });
      }

      const keepId = sentMsg?.message_id ? [sentMsg.message_id] : [];
      if (sentMsg?.message_id) {
        trackBotMessage(userId, ctx.chat.id, sentMsg.message_id);
      }
      session.lastMessageIds = keepId;
      await clearTrackedBotMessages(ctx, userId, keepId);
    } catch (err) {
      console.error('renderPropertyPage error:', err);
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(), true);
    }
  }

  const AD_INQUIRY_TYPES = {
    why_rejected: '❌ لماذا تم رفض إعلاني؟',
    re_review: '🔄 طلب إعادة مراجعة الإعلان',
    why_pending: '❓ لماذا إعلاني معلق؟',
    remind_admin: '⏱️ تذكير الإدارة بمراجعة الطلب',
    no_contact: '📞 لماذا لم يتم التواصل معي؟',
    ad_note: '⚠️ ملاحظة أو استفسار حول الإعلان'
  };

  const QUICK_SUPPORT_PRESETS = {
    '💳 مشكلة في الدفع': 'العميل يبلغ عن مشكلة أو استفسار بخصوص الدفع.',
    '🏠 إعلان أو تصفح عقاري': 'العميل لديه استفسار بخصوص الإعلانات أو التصفح العقاري.',
    '🪙 النقاط والمكافآت': 'العميل يستفسر عن النقاط والمكافآت.',
    '💡 اقتراح أو تحسين': 'العميل يشارك اقتراحاً أو فكرة لتحسين المنصة.',
    '👏 شكر أو ملاحظة إيجابية': 'العميل يرسل رسالة شكر وتقدير للمنصة.',
    '💬 استفسار عام / أخرى': 'العميل يطلب تواصلاً أو استفساراً عاماً مع الإدارة.'
  };

  async function fetchUserOwnedAds(userId) {
    const ads = [];
    try {
      const { data: pendingRows } = await supabase
        .from('pending_properties')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false });

      if (Array.isArray(pendingRows)) {
        for (const row of pendingRows) {
          const st = row.status || 'pending';
          ads.push({
            ...row,
            source: 'pending_properties',
            ad_status: st,
            status_label: st === 'approved' ? '✅ مقبول' : st === 'rejected' ? '❌ مرفوض' : '⏳ معلق'
          });
        }
      }
    } catch (e) {}

    try {
      const { data: publishedRows } = await supabase
        .from('test_messages')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false });

      if (Array.isArray(publishedRows)) {
        const existingApprovedKeys = new Set(
          ads.filter(a => a.ad_status === 'approved').map(a => `${a.property_type}|${a.state_name}|${a.price}|${a.phone}`)
        );
        for (const row of publishedRows) {
          const key = `${row.property_type}|${row.state_name}|${row.price}|${row.phone}`;
          if (!existingApprovedKeys.has(key)) {
            ads.push({ ...row, source: 'test_messages', ad_status: 'approved', status_label: '✅ مقبول' });
          }
        }
      }
    } catch (e) {}

    return ads;
  }

  function getSupportHubKeyboard() {
    return Markup.keyboard([
      ['👤 ملفي الشخصي ورصيدي', '📋 إعلاناتي وحالتها'],
      ['🗂 تصفح إعلاناتي الخاصة', '💬 دعم واقتراحات وشكر'],
      ['🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getSupportCategoriesKeyboard() {
    return Markup.keyboard([
      ['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري'],
      ['🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين'],
      ['👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'],
      ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getInteractiveAdInlineKeyboard(ad) {
    const id = encodeURIComponent(String(ad.id || '0'));
    if (ad.ad_status === 'pending') {
      return Markup.inlineKeyboard([
        [Markup.button.callback('❓ لماذا إعلاني معلق؟', `adinq:why_pending:${id}`)],
        [Markup.button.callback('⏱️ تذكير الإدارة بمراجعة الطلب', `adinq:remind_admin:${id}`)],
        [Markup.button.callback('📞 لماذا لم يتم التواصل معي؟', `adinq:no_contact:${id}`)]
      ]);
    }
    if (ad.ad_status === 'rejected') {
      return Markup.inlineKeyboard([
        [Markup.button.callback('❌ لماذا تم رفض إعلاني؟', `adinq:why_rejected:${id}`)],
        [Markup.button.callback('🔄 طلب إعادة مراجعة الإعلان', `adinq:re_review:${id}`)]
      ]);
    }
    return Markup.inlineKeyboard([
      [Markup.button.callback('⚠️ ملاحظة أو استفسار حول الإعلان', `adinq:ad_note:${id}`)]
    ]);
  }

  function getAdActionButtonsForStatus(ad) {
    const id = ad.id || 'غير_محدد';
    if (ad.ad_status === 'pending') {
      return Markup.keyboard([
        [`❓ لماذا إعلاني معلق؟ (#${id})`],
        [`⏱️ تذكير الإدارة بمراجعة الطلب (#${id})`],
        [`📞 لماذا لم يتم التواصل معي؟ (#${id})`],
        ['⬅️ قائمة الإعلانات', '🏠 القائمة الرئيسية']
      ]).resize();
    }
    if (ad.ad_status === 'rejected') {
      return Markup.keyboard([
        [`❌ لماذا تم رفض إعلاني؟ (#${id})`],
        [`🔄 طلب إعادة مراجعة الإعلان (#${id})`],
        ['⬅️ قائمة الإعلانات', '🏠 القائمة الرئيسية']
      ]).resize();
    }
    return Markup.keyboard([
      [`⚠️ ملاحظة أو استفسار حول الإعلان (#${id})`],
      ['⬅️ قائمة الإعلانات', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getUserOwnBrowsingKeyboard(index, total, mediaIdx = 0, totalMedia = 0) {
    const rows = [];
    if (totalMedia > 1) {
      const mRow = [];
      if (mediaIdx > 0) mRow.push('🖼 الصورة السابقة');
      mRow.push(`📸 عنصر ${mediaIdx + 1} / ${totalMedia}`);
      if (mediaIdx < totalMedia - 1) mRow.push('الصورة التالية 🖼');
      rows.push(mRow);
    }

    const navRow = [];
    if (index > 0) navRow.push('⬅️ إعلاني السابق');
    navRow.push(`🗂 ${index + 1} / ${total}`);
    if (index < total - 1) navRow.push('إعلاني التالي ➡️');
    rows.push(navRow);
    rows.push(['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  async function openSupportDashboard(ctx, userId) {
    const dbUser = await getUserRecord(userId);
    const allAds = await fetchUserOwnedAds(userId);
    const pendingCount = allAds.filter(a => a.ad_status === 'pending').length;
    const approvedCount = allAds.filter(a => a.ad_status === 'approved').length;
    const rejectedCount = allAds.filter(a => a.ad_status === 'rejected').length;

    const points = dbUser?.points ?? 0;
    const name = escapeHtml(dbUser?.first_name || ctx.from.first_name || 'عميلنا الكريم');
    const supportIntro = await getSetting('support_text', '');

    supportUserSession[userId] = { mode: 'dashboard', ads: allAds };
    userState[userId] = { step: 'support_dashboard', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    const text =
      `🎛 <b>لوحة العميل ومركز الدعم</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 أهلاً بك يا <b>${name}</b>\n` +
      `🪙 <b>رصيد النقاط:</b> <b>${points} نقطة</b>\n` +
      `📊 <b>إعلاناتك:</b> إجمالي <b>${allAds.length}</b> | ⏳ معلق: <b>${pendingCount}</b> | ✅ مقبول: <b>${approvedCount}</b> | ❌ مرفوض: <b>${rejectedCount}</b>` +
      (supportIntro ? `\n\n${supportIntro}` : '') +
      `\n\n👇 <b>اختر ما تريد من الأزرار أدناه:</b>`;

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard() }, true);
  }

  async function renderUserOwnAdBrowser(ctx, userId, adIndex = 0, mediaIndex = 0) {
    const allAds = await fetchUserOwnedAds(userId);
    if (!allAds.length) {
      return replyTracked(ctx, userId, '📭 <b>لا توجد إعلانات مسجلة باسمك حتى الآن.</b>', {
        parse_mode: 'HTML',
        ...getSupportHubKeyboard()
      }, true);
    }

    let safeIdx = Number(adIndex) || 0;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= allAds.length) safeIdx = allAds.length - 1;

    const ad = allAds[safeIdx];
    const orderedMedia = buildOrderedBrowsingMedia(ad);
    const totalMedia = orderedMedia.length;

    let safeMediaIdx = Number(mediaIndex) || 0;
    if (safeMediaIdx < 0) safeMediaIdx = 0;
    if (totalMedia > 0 && safeMediaIdx >= totalMedia) safeMediaIdx = totalMedia - 1;

    supportUserSession[userId] = {
      mode: 'browsing_own_ads',
      ads: allAds,
      page: safeIdx,
      mediaIndex: safeMediaIdx,
      selectingPage: false
    };

    const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIdx] : null;
    const mediaLine = totalMedia > 0 ? `\n${currentMedia.type === 'video' ? '🎥 فيديو' : '🖼 صورة'}: <b>${safeMediaIdx + 1} / ${totalMedia}</b>` : '';
    const adDateLine = ad.created_at ? `\n🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(formatDateTime(ad.created_at))}</code>` : '';

    const caption =
      `🗂 <b>إعلاناتك الخاصة (${safeIdx + 1}/${allAds.length})</b> — الحالة: <b>${ad.status_label}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏠 <b>العقار:</b> ${escapeHtml(ad.property_type || '')}\n` +
      `📍 <b>الولاية:</b> ${escapeHtml(ad.state_name || '')}\n` +
      `💰 <b>السعر:</b> ${formatMoney(ad.price)}\n` +
      `📞 <b>الهاتف:</b> <code>${escapeHtml(ad.phone || '')}</code>${adDateLine}${mediaLine}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(ad.description || ad.message || '')}`;

    const kb = getUserOwnBrowsingKeyboard(safeIdx, allAds.length, safeMediaIdx, totalMedia);

    let sentMsg = null;
    if (currentMedia) {
      try {
        sentMsg = currentMedia.type === 'video'
          ? await ctx.replyWithVideo(currentMedia.ref, { caption, parse_mode: 'HTML', ...kb })
          : await ctx.replyWithPhoto(currentMedia.ref, { caption, parse_mode: 'HTML', ...kb });
      } catch (e) {}
    }

    if (!sentMsg) {
      sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...kb });
    }

    const keepIds = sentMsg?.message_id ? [sentMsg.message_id] : [];
    if (sentMsg?.message_id) trackBotMessage(userId, ctx.chat.id, sentMsg.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }

  async function resolvePendingRecordForReview(relatedAd, senderUserId, fallbackAdId = null) {
    let candidate = relatedAd ? { ...relatedAd } : null;
    try {
      const lookupId = candidate?.id || fallbackAdId;
      if (lookupId && String(lookupId) !== '0' && String(lookupId) !== 'غير_محدد') {
        const { data } = await supabase.from('pending_properties').select('*').eq('id', lookupId).single();
        if (data) {
          const st = data.status || 'pending';
          return {
            ...data,
            source: 'pending_properties',
            ad_status: st,
            status_label: st === 'approved' ? '✅ مقبول' : st === 'rejected' ? '❌ مرفوض' : '⏳ معلق'
          };
        }
      }
    } catch (e) {}
    return candidate;
  }

  async function sendStructuredTicketToAdmins(ctx, senderUserId, ticketTitle, detailText, relatedAd = null, fallbackAdId = null) {
    const adminIds = await getAdminIds();
    const dbUser = await getUserRecord(senderUserId);
    const fullName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
    );
    const phoneLine = dbUser?.phone_number ? `\n📞 <b>هاتف العميل:</b> <code>${escapeHtml(dbUser.phone_number)}</code>` : '';
    const resolvedAd = await resolvePendingRecordForReview(relatedAd, senderUserId, fallbackAdId);
    const receiptRef = normalizeMediaRef(resolvedAd?.receipt_url);
    const adIdNum = Number(resolvedAd?.id || fallbackAdId);
    const hasNumericAdId = Number.isFinite(adIdNum) && adIdNum > 0;
    const adIdLabel = resolvedAd?.id || fallbackAdId || null;

    const header =
      `📩 <b>طلب من العميل — ${escapeHtml(ticketTitle)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>الاسم:</b> ${fullName}\n` +
      `🆔 <b>الآيدي (ID):</b> <code>${senderUserId}</code>${phoneLine}` +
      (adIdLabel ? `\n📌 <b>الإعلان:</b> <code>#${escapeHtml(String(adIdLabel))}</code>` : '') + `\n`;

    const inlineRows = [];
    if (hasNumericAdId) {
      inlineRows.push([
        Markup.button.callback(`❌ رفض (#${adIdNum})`, `reject_${adIdNum}`),
        Markup.button.callback(`✅ قبول ونشر (#${adIdNum})`, `approve_${adIdNum}`)
      ]);
    }
    inlineRows.push([Markup.button.callback(`✉️ رد على العميل (${senderUserId})`, `support_reply_${senderUserId}`)]);

    const replyMarkup = Markup.inlineKeyboard(inlineRows);
    const bodyText = detailText ? `\n💬 <b>الطلب:</b>\n${escapeHtml(detailText)}` : '';

    for (const adminId of adminIds) {
      try {
        if (receiptRef) {
          await ctx.telegram.sendPhoto(adminId, receiptRef, {
            caption: header + bodyText,
            parse_mode: 'HTML',
            ...replyMarkup
          }).catch(async () => {
            await ctx.telegram.sendMessage(adminId, header + bodyText, { parse_mode: 'HTML', ...replyMarkup });
          });
        } else {
          await ctx.telegram.sendMessage(adminId, header + bodyText, { parse_mode: 'HTML', ...replyMarkup });
        }
      } catch (err) {}
    }
  }

  async function processAdInquiryAction(ctx, userId, actionLabel, reqId) {
    const s = supportUserSession[userId];
    const adsList = s?.ads || await fetchUserOwnedAds(userId);
    const relatedAd = adsList.find(a => String(a.id) === String(reqId)) || s?.selectedAd || null;

    await sendStructuredTicketToAdmins(ctx, userId, `${actionLabel} (#${reqId})`, `${actionLabel} — بخصوص الإعلان رقم #${reqId}.`, relatedAd, reqId);
    await replyTracked(ctx, userId, `✅ <b>تم إرسال استفسارك (${escapeHtml(actionLabel)}) بخصوص الإعلان <code>#${escapeHtml(String(reqId))}</code> إلى الإدارة.</b>`, {
      parse_mode: 'HTML',
      ...Markup.keyboard([['📋 إعلاناتي وحالتها'], ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']]).resize()
    }, true);
  }

  async function handleStart(ctx) {
    await safeDeleteUserMessage(ctx);
    await ctx.sendChatAction('typing').catch(() => {});
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
    const welcomeText = rawWelcomeTpl.replace('{name}', userName).replace(/\\n/g, '\n');

    if (verified) {
      delete userState[userId];
      await replyTracked(ctx, userId, welcomeText, { parse_mode: 'HTML', ...getMainMenuKeyboard() }, true);
    } else {
      const authText = await getSetting('auth_prompt_template', `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`);
      await replyTracked(ctx, userId, authText.replace(/\\n/g, '\n'), { parse_mode: 'HTML', ...getAuthKeyboard() }, true);
    }
  }

  return {
    handleStart,

    handleContact: async (ctx) => {
      await safeDeleteUserMessage(ctx);
      const contact = ctx.message.contact;
      const userId = ctx.from.id;
      const referrerId = userState[userId]?.pendingReferrer || null;

      try {
        const { error: insertError } = await supabase.from('users').insert([
          { id: userId, first_name: ctx.from.first_name || '', phone_number: contact.phone_number, points: 0, referred_by: referrerId }
        ]);
        if (insertError) throw insertError;

        if (referrerId) {
          const refUser = await getUserRecord(referrerId);
          if (refUser) {
            const updatedPts = (refUser.points || 0) + 50;
            await supabase.from('users').update({ points: updatedPts }).eq('id', referrerId);
            await ctx.telegram.sendMessage(referrerId, `🎉 <b>مبروك! انضم صديق جديد عبر رابطك وحصلت على +50 نقطة!</b>\n🪙 رصيدك الحالي: ${updatedPts} نقطة.`, { parse_mode: 'HTML' }).catch(() => {});
          }
        }

        delete userState[userId];
        await replyTracked(ctx, userId, '🎉 <b>تم توثيق حسابك بنجاح!</b>', { parse_mode: 'HTML', ...getMainMenuKeyboard() }, true);
      } catch (err) {
        await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
      }
    },

    handleCallback: async (ctx) => {
      const data = ctx.callbackQuery?.data || '';
      const match = data.match(/^adinq:([a-z_]+):(.+)$/);
      if (match) {
        const userId = ctx.from.id;
        const reqId = decodeURIComponent(match[2]);
        const actionLabel = AD_INQUIRY_TYPES[match[1]] || 'استفسار حول الإعلان';
        await ctx.answerCbQuery('✅ تم إرسال استفسارك للإدارة').catch(() => {});
        return processAdInquiryAction(ctx, userId, actionLabel, reqId);
      }
      await ctx.answerCbQuery().catch(() => {});
    },

    handleText: async (ctx) => {
      const userId = ctx.from.id;
      const userText = (ctx.message?.text || '').trim();
      if (!userText) return;

      const protectedKeywords = ['تصفح', 'إضافة', 'رصيدي'];
      if (protectedKeywords.some(k => userText.includes(k)) && !(await isUserVerified(userId))) {
        return replyTracked(ctx, userId, '⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:', getAuthKeyboard());
      }

      if (userText === '❌ إلغاء العملية والعودة' || userText === '🏠 القائمة الرئيسية') {
        await safeDeleteUserMessage(ctx);
        delete userState[userId];
        delete browsingSession[userId];
        return replyTracked(ctx, userId, '✅ العودة إلى القائمة الرئيسية:', { parse_mode: 'HTML', ...getMainMenuKeyboard() }, true);
      }

      if (userText === '⬅️ رجوع') {
        await safeDeleteUserMessage(ctx);
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
        if (WIZ_STEPS[idx - 1] === 'waiting_for_media') {
          state.data.media_items = [];
          state.data.media_label = null;
        }
        state.step = WIZ_STEPS[idx - 1];
        state.tempInput = '';
        return renderWizard(ctx, userId);
      }

      if (userText === '🎁 رصيدي وجمع النقاط') {
        await safeDeleteUserMessage(ctx);
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
          `اضغط على الزر في القائمة السفلية لمشاهدة إعلان الفيديو وربح النقاط فوراً.\n\n` +
          `👥 <b>الطريقة 2: دعوة الأصدقاء (+50 نقطة لكل صديق)</b>\n` +
          `شارك رابطك الخاص:\n<code>${refLink}</code>`;

        const keyboardRows = [];
        if (WEBHOOK_DOMAIN) {
          keyboardRows.push([Markup.button.webApp(`🎬 مشاهدة إعلان الفيديو (+${rewardPoints} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)]);
        }
        keyboardRows.push(['🏠 القائمة الرئيسية']);
        return replyTracked(ctx, userId, msg, { parse_mode: 'HTML', ...Markup.keyboard(keyboardRows).resize() }, true);
      }

      if (userText === '🌐 تصفح الموقع الرسمي (البروزر)') {
        await safeDeleteUserMessage(ctx);
        return replyTracked(ctx, userId, '🌐 <b>رابط منصة عقار الجزائر (ويب):</b>\n\nانقر على الرابط التالي لفتحه في المتصفح:\nhttps://hosnihicham.github.io/testHTML', {
          parse_mode: 'HTML',
          ...getMainMenuKeyboard()
        }, true);
      }

      if (userText === 'ℹ️ عن المنصة') {
        await safeDeleteUserMessage(ctx);
        const aboutMsg = await getSetting('about_text', '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.');
        return replyTracked(ctx, userId, aboutMsg, { parse_mode: 'HTML', ...getMainMenuKeyboard() }, true);
      }

      if (userText === '🔍 تصفح العقارات المتاحة' || userText === '📍 تغيير الولاية' || userText === 'تغيير الولاية') {
        await safeDeleteUserMessage(ctx);
        delete browsingSession[userId];
        return showStatesMenu(ctx);
      }

      const stateMatch = userText.match(/^📍 (.+)/);
      if (stateMatch) {
        await safeDeleteUserMessage(ctx);
        const selectedState = stateMatch[1].trim();
        const st = userState[userId];
        if (st && st.step === 'waiting_for_state') {
          st.data.state_name = selectedState;
          st.step = 'waiting_for_price';
          st.tempInput = '';
          return renderWizard(ctx, userId);
        }
        const stateList = await getUniqueStatesList();
        if (stateList.includes(selectedState)) {
          browsingSession[userId] = { state: selectedState, page: 0, photoIndex: 0 };
          return renderPropertyPage(ctx, userId, 0, 0);
        }
      }

      if (userText === '🌐 الكل') {
        await safeDeleteUserMessage(ctx);
        browsingSession[userId] = { state: 'ALL', page: 0, photoIndex: 0 };
        return renderPropertyPage(ctx, userId, 0, 0);
      }

      if (userText === 'الصورة التالية 🖼') {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session) return renderPropertyPage(ctx, userId, session.page, (session.photoIndex || 0) + 1);
      }

      if (userText === '🖼 الصورة السابقة') {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session) return renderPropertyPage(ctx, userId, session.page, Math.max((session.photoIndex || 0) - 1, 0));
      }

      if (/^📸 (صورة|عنصر) \d+ \/ \d+$/.test(userText)) {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session) return renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
      }

      if (/^📄 \d+ \/ \d+$/.test(userText)) {
        await safeDeleteUserMessage(ctx);
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
        return replyTracked(ctx, userId, `🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`, {
          parse_mode: 'HTML',
          ...Markup.keyboard(numberButtons).resize()
        }, true);
      }

      if (/^\d+$/.test(userText)) {
        const sOwn = supportUserSession[userId];
        if (sOwn && sOwn.mode === 'browsing_own_ads' && sOwn.selectingPage) {
          await safeDeleteUserMessage(ctx);
          sOwn.selectingPage = false;
          return renderUserOwnAdBrowser(ctx, userId, parseInt(userText, 10) - 1, 0);
        }
        const session = browsingSession[userId];
        if (session && session.selectingPage) {
          await safeDeleteUserMessage(ctx);
          session.selectingPage = false;
          return renderPropertyPage(ctx, userId, parseInt(userText, 10) - 1, 0);
        }
      }

      if (userText === '🔙 رجوع للعقار') {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session) {
          session.selectingPage = false;
          return renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
        }
      }

      if (userText === '⬅️ السابق') {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session && session.page > 0) return renderPropertyPage(ctx, userId, session.page - 1, 0);
      }

      if (userText === 'التالي ➡️') {
        await safeDeleteUserMessage(ctx);
        const session = browsingSession[userId];
        if (session) return renderPropertyPage(ctx, userId, session.page + 1, 0);
      }

      if (userText === '➕ إضافة عقار جديد') {
        await safeDeleteUserMessage(ctx);
        await clearTrackedBotMessages(ctx, userId);
        userState[userId] = {
          step: 'waiting_for_type',
          data: { features_list: [], media_items: [] },
          chatId: ctx.chat.id,
          wizardMsgId: null,
          tempInput: ''
        };
        return renderWizard(ctx, userId);
      }

      if (userText === '💳 الدفع عبر BaridiMob / CCP') {
        await safeDeleteUserMessage(ctx);
        const st = userState[userId];
        if (!st || st.step !== 'waiting_for_payment_choice') return;
        const ccpRip = await getSetting('ccp_rip', '00234567890123456789');
        const ccpName = await getSetting('ccp_name', '');
        const nameLine = ccpName ? `\n👤 <b>الاسم:</b> ${ccpName}` : '';
        const ccpInstructions =
          `💳 <b>الدفع عبر بريدي موب أو CCP:</b>\n\n` +
          `يرجى تحويل مبلغ <b>500 دج</b> إلى الحساب التالي:${nameLine}\n` +
          `📌 <b>رقم الحساب (RIP) (اضغط للنسخ 👇):</b>\n` +
          `<code>${ccpRip}</code>\n\n` +
          `📸 <b>بعد التحويل، أرسل هنا صورة وصل الدفع (Reçu):</b>`;
        st.data.payment_label = '💳 تحويل بريدي موب / CCP';
        st.step = 'waiting_for_payment_receipt';
        return renderWizard(ctx, userId, { footer: ccpInstructions });
      }

      if (userText === '🆓 نشر مجاني') {
        await safeDeleteUserMessage(ctx);
        const st = userState[userId];
        if (!st || st.step !== 'waiting_for_payment_choice') return;
        st.data.payment_label = '🆓 إعلان مجاني (بانتظار الإدارة)';
        st.step = 'publishing';

        try {
          const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة وإرسال الإعلان المجاني للإدارة...');
          await renderWizard(ctx, userId, { footer: publishingText });

          const mediaItems = st.data.media_items || [];
          const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
          const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');
          const numericPrice = sanitizeNumericPrice(st.data.price);
          const cleanPhone = String(st.data.phone || '').replace(/\D/g, '').trim();
          const submittedAt = formatDateTime(new Date());

          const { data: insertedRow, error: insertError } = await supabase
            .from('pending_properties')
            .insert([{
              user_id: userId,
              property_type: st.data.property_type,
              state_name: st.data.state_name,
              price: numericPrice,
              phone: cleanPhone,
              description: st.data.description,
              image_url: combinedImagesUrl,
              video_url: videoUrl,
              receipt_url: 'FREE_NO_RECEIPT',
              status: 'pending'
            }])
            .select()
            .single();
          if (insertError) throw insertError;

          const requestId = insertedRow.id;
          const adminCaption =
            `🆓 <b>إعلان مجاني جديد في قائمة الانتظار (#${requestId})</b>\n` +
            `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
            `👤 <b>المرسل:</b> <code>${userId}</code>\n` +
            `🏠 <b>العقار:</b> ${escapeHtml(st.data.property_type || '')}\n` +
            `📍 <b>الولاية:</b> ${escapeHtml(st.data.state_name || '')}\n` +
            `💰 <b>السعر:</b> ${formatMoney(numericPrice)}\n` +
            `📞 <b>الهاتف:</b> <code>${escapeHtml(cleanPhone)}</code>\n` +
            `📝 <b>الوصف:</b> ${escapeHtml(st.data.description || '')}`;

          const adminButtons = Markup.inlineKeyboard([
            [
              Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`),
              Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`)
            ],
            [Markup.button.callback(`✉️ رد على العميل (${userId})`, `support_reply_${userId}`)]
          ]);

          const adminIds = await getAdminIds();
          for (const currentAdminId of adminIds) {
            await ctx.telegram.sendMessage(currentAdminId, adminCaption, { parse_mode: 'HTML', ...adminButtons }).catch(() => {});
          }

          delete userState[userId];
          return replyTracked(ctx, userId, `⏳ <b>تم تسجيل إعلانك المجاني في قائمة الانتظار برقم (#${requestId}) وإرساله إلى الإدارة!</b>`, {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard()
          }, true);
        } catch (err) {
          delete userState[userId];
          return replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(), true);
        }
      }

      if (userText.startsWith('🪙 النشر مجاناً')) {
        await safeDeleteUserMessage(ctx);
        const st = userState[userId];
        if (!st || st.step !== 'waiting_for_payment_choice') return;
        const user = await getUserRecord(userId);
        const currentPoints = user ? (user.points || 0) : 0;
        const publishCost = Number(await getSetting('publish_cost_points', '100'));

        if (currentPoints < publishCost) {
          const warnMsg = await ctx.reply(`⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nرصيدك الحالي: <b>${currentPoints} نقطة</b> وتحتاج إلى <b>${publishCost} نقطة</b>.`, { parse_mode: 'HTML' });
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3500);
          return;
        }

        st.step = 'publishing';
        try {
          const mediaItems = st.data.media_items || [];
          const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
          const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');
          await supabase.from('users').update({ points: currentPoints - publishCost }).eq('id', userId);

          const nowIso = new Date().toISOString();
          await supabase.from('test_messages').insert([{
            property_type: st.data.property_type,
            state_name: st.data.state_name,
            price: sanitizeNumericPrice(st.data.price),
            phone: String(st.data.phone || '').replace(/\D/g, '').trim(),
            description: st.data.description,
            message: st.data.description,
            image_url: combinedImagesUrl,
            video_url: videoUrl,
            created_at: nowIso
          }]);

          delete userState[userId];
          return replyTracked(ctx, userId, `🎉 <b>تم خصم ${publishCost} نقطة ونشر إعلانك بنجاح في المنصة مجاناً!</b>`, {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard()
          }, true);
        } catch (err) {
          delete userState[userId];
          return replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(), true);
        }
      }

      const adInquiryMatch = userText.match(/^(❓ لماذا إعلاني معلق\؟|⏱️ تذكير الإدارة بمراجعة الطلب|📞 لماذا لم يتم التواصل معي\؟|❌ لماذا تم رفض إعلاني\؟|🔄 طلب إعادة مراجعة الإعلان|⚠️ ملاحظة أو استفسار حول الإعلان) \(#([^)]+)\)$/);
      if (adInquiryMatch) {
        await safeDeleteUserMessage(ctx);
        return processAdInquiryAction(ctx, userId, adInquiryMatch[1], adInquiryMatch[2]);
      }

      if (userText === '📞 الدعم والإدارة' || userText === '⬅️ لوحة العميل') {
        await safeDeleteUserMessage(ctx);
        return openSupportDashboard(ctx, userId);
      }

      if (userText === '👤 ملفي الشخصي ورصيدي') {
        await safeDeleteUserMessage(ctx);
        const dbUser = await getUserRecord(userId);
        const allAds = await fetchUserOwnedAds(userId);
        return replyTracked(
          ctx,
          userId,
          `👤 <b>الملف الشخصي والرصيد</b>\n━━━━━━━━━━━━━━━━━━━━\n• <b>الاسم:</b> ${escapeHtml(dbUser?.first_name || ctx.from.first_name || 'غير محدد')}\n• <b>رصيد النقاط:</b> <b>${dbUser?.points ?? 0} نقطة</b>\n• <b>عدد إعلاناتك المسجلة:</b> <b>${allAds.length}</b>`,
          { parse_mode: 'HTML', ...getSupportHubKeyboard() },
          true
        );
      }

      if (userText === '📋 إعلاناتي وحالتها' || userText === '⬅️ قائمة الإعلانات') {
        await safeDeleteUserMessage(ctx);
        const allAds = await fetchUserOwnedAds(userId);
        supportUserSession[userId] = { mode: 'ads_filter', ads: allAds };
        const pending = allAds.filter(a => a.ad_status === 'pending').length;
        const approved = allAds.filter(a => a.ad_status === 'approved').length;
        const rejected = allAds.filter(a => a.ad_status === 'rejected').length;
        return replyTracked(ctx, userId, `📋 <b>إعلاناتي وحالتها</b>\n\nاختر الفئة:`, {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            [`⏳ معلقة (${pending})`, `✅ مقبولة (${approved})`],
            [`❌ مرفوضة (${rejected})`, `📌 الكل (${allAds.length})`],
            ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']
          ]).resize()
        }, true);
      }

      const catMatch = userText.match(/^(⏳ معلقة|✅ مقبولة|❌ مرفوضة|📌 الكل) \(\d+\)$/);
      if (catMatch) {
        await safeDeleteUserMessage(ctx);
        const prefix = catMatch[1];
        const allAds = await fetchUserOwnedAds(userId);
        let filtered = allAds;
        let label = 'جميع إعلاناتك';
        if (prefix.startsWith('⏳')) {
          filtered = allAds.filter(a => a.ad_status === 'pending');
          label = 'إعلاناتك المعلقة';
        } else if (prefix.startsWith('✅')) {
          filtered = allAds.filter(a => a.ad_status === 'approved');
          label = 'إعلاناتك المقبولة';
        } else if (prefix.startsWith('❌')) {
          filtered = allAds.filter(a => a.ad_status === 'rejected');
          label = 'إعلاناتك المرفوضة';
        }
        if (!filtered.length) {
          return replyTracked(ctx, userId, `📭 <b>لا توجد إعلانات في فئة "${escapeHtml(label)}".</b>`, {
            parse_mode: 'HTML',
            ...Markup.keyboard([['📋 إعلاناتي وحالتها'], ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']]).resize()
          }, true);
        }
        supportUserSession[userId] = { mode: 'select_ad_for_action', ads: filtered };
        const listLines = filtered.slice(0, 15).map((ad, idx) => `${idx + 1}. ${ad.status_label} <b>#${ad.id || '—'}</b> — ${escapeHtml(ad.property_type || '')} (${escapeHtml(ad.state_name || '')}) • ${formatMoney(ad.price)}`);
        const adButtons = filtered.slice(0, 12).map(ad => `📄 إعلان #${ad.id || '—'} (${escapeHtml(ad.property_type || '')})`);
        return replyTracked(ctx, userId, `📋 <b>${escapeHtml(label)} (${filtered.length}):</b>\n\n${listLines.join('\n')}`, {
          parse_mode: 'HTML',
          ...Markup.keyboard([...chunkButtons(adButtons, 2), ['⬅️ قائمة الإعلانات', '⬅️ لوحة العميل']]).resize()
        }, true);
      }

      const adItemMatch = userText.match(/^📄 إعلان #(\S+) \((.+)\)$/);
      if (adItemMatch) {
        await safeDeleteUserMessage(ctx);
        const reqIdStr = adItemMatch[1];
        const allAds = supportUserSession[userId]?.ads || await fetchUserOwnedAds(userId);
        const targetAd = allAds.find(a => String(a.id) === String(reqIdStr)) || allAds[0];
        if (!targetAd) return;
        supportUserSession[userId] = { mode: 'ad_actions', ads: allAds, selectedAd: targetAd };
        const cardText =
          `📄 <b>تفاصيل الإعلان #${escapeHtml(String(targetAd.id || '—'))}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `• <b>الحالة:</b> <b>${targetAd.status_label}</b>\n` +
          `• <b>العقار:</b> ${escapeHtml(targetAd.property_type || '')}\n` +
          `• <b>الولاية:</b> ${escapeHtml(targetAd.state_name || '')}\n` +
          `• <b>السعر:</b> ${formatMoney(targetAd.price)}\n` +
          `• <b>الوصف:</b> ${escapeHtml(targetAd.description || targetAd.message || '')}`;
        return replyTracked(ctx, userId, cardText, {
          parse_mode: 'HTML',
          ...getInteractiveAdInlineKeyboard(targetAd),
          ...getAdActionButtonsForStatus(targetAd)
        }, true);
      }

      if (userText === '🗂 تصفح إعلاناتي الخاصة') {
        await safeDeleteUserMessage(ctx);
        return renderUserOwnAdBrowser(ctx, userId, 0, 0);
      }

      if (userText === 'إعلاني التالي ➡️') {
        await safeDeleteUserMessage(ctx);
        const s = supportUserSession[userId];
        if (s && s.mode === 'browsing_own_ads') return renderUserOwnAdBrowser(ctx, userId, (s.page || 0) + 1, 0);
      }

      if (userText === '⬅️ إعلاني السابق') {
        await safeDeleteUserMessage(ctx);
        const s = supportUserSession[userId];
        if (s && s.mode === 'browsing_own_ads') return renderUserOwnAdBrowser(ctx, userId, Math.max((s.page || 0) - 1, 0), 0);
      }

      if (/^🗂 \d+ \/ \d+$/.test(userText)) {
        await safeDeleteUserMessage(ctx);
        const s = supportUserSession[userId];
        if (!s || s.mode !== 'browsing_own_ads' || !s.ads?.length) return;
        s.selectingPage = true;
        const total = s.ads.length;
        const rows = [];
        let row = [];
        for (let i = 1; i <= total; i++) {
          row.push(`${i}`);
          if (row.length === 5) {
            rows.push(row);
            row = [];
          }
        }
        if (row.length) rows.push(row);
        rows.push(['🗂 تصفح إعلاناتي الخاصة']);
        return replyTracked(ctx, userId, `🔢 <b>اختر رقم إعلانك للانتقال إليه مباشرة (1 إلى ${total}):</b>`, {
          parse_mode: 'HTML',
          ...Markup.keyboard(rows).resize()
        }, true);
      }

      if (userText === '💬 دعم واقتراحات وشكر') {
        await safeDeleteUserMessage(ctx);
        userState[userId] = { step: 'support_selecting_category', data: {}, chatId: ctx.chat.id, wizardMsgId: null };
        return replyTracked(ctx, userId, '💬 <b>اختر نوع الرسالة أو الملاحظة:</b>', {
          parse_mode: 'HTML',
          ...getSupportCategoriesKeyboard()
        }, true);
      }

      if (Object.prototype.hasOwnProperty.call(QUICK_SUPPORT_PRESETS, userText)) {
        await safeDeleteUserMessage(ctx);
        await sendStructuredTicketToAdmins(ctx, userId, userText, QUICK_SUPPORT_PRESETS[userText], null);
        delete userState[userId];
        return replyTracked(ctx, userId, `✅ <b>تم إرسال طلبك (${escapeHtml(userText)}) إلى الإدارة.</b>`, {
          parse_mode: 'HTML',
          ...getSupportHubKeyboard()
        }, true);
      }

      const st = userState[userId];
      if (!st) return;

      if (st.step === 'waiting_for_type') {
        const validTypes = await getDynamicPropertyTypes();
        if (validTypes.map(item => item.title).includes(userText)) {
          await safeDeleteUserMessage(ctx);
          st.data.property_type = userText;
          st.step = 'waiting_for_state';
          st.tempInput = '';
          return renderWizard(ctx, userId);
        }
      } else if (st.step === 'waiting_for_price' || st.step === 'waiting_for_phone') {
        await safeDeleteUserMessage(ctx);
        st.tempInput = st.tempInput || '';
        if (userText.startsWith('📥 القيمة الحالية:')) return;
        if (userText >= '0' && userText <= '9') {
          st.tempInput += userText;
          return renderWizard(ctx, userId);
        }
        if (userText === '+مليون') {
          st.tempInput += '000000';
          return renderWizard(ctx, userId);
        }
        if (userText === '⌫') {
          st.tempInput = st.tempInput.slice(0, -1);
          return renderWizard(ctx, userId);
        }
        if (userText === '🗑️ مسح') {
          st.tempInput = '';
          return renderWizard(ctx, userId);
        }
        if (userText === '✅ [ OK ] تأكيد') {
          if (!st.tempInput) return;
          if (st.step === 'waiting_for_price') {
            st.data.price = st.tempInput;
            st.step = 'waiting_for_phone';
            st.tempInput = '';
            return renderWizard(ctx, userId);
          }
          if (st.step === 'waiting_for_phone') {
            if (st.tempInput.length < 9) return;
            st.data.phone = st.tempInput;
            st.step = 'waiting_for_description';
            st.data.features_list = st.data.features_list || [];
            st.tempInput = '';
            return renderWizard(ctx, userId);
          }
        }
      } else if (st.step === 'waiting_for_description') {
        await safeDeleteUserMessage(ctx);
        st.data.features_list = st.data.features_list || [];
        if (userText === '↩️ تراجع عن الأخيرة' && st.data.features_list.length > 0) {
          st.data.features_list.pop();
          return renderWizard(ctx, userId);
        }
        if (userText === '🗑️ مسح الكل') {
          st.data.features_list = [];
          return renderWizard(ctx, userId);
        }
        if (userText === '✅ تأكيد الوصف والانتقال') {
          if (st.data.features_list.length === 0) return;
          st.data.description = st.data.features_list.join(' | ');
          st.step = 'waiting_for_media';
          st.data.media_items = [];
          return renderWizard(ctx, userId);
        }
        const validFeatures = await getDynamicFeatures();
        if (validFeatures.map(f => f.title).includes(userText)) {
          if (!st.data.features_list.includes(userText)) st.data.features_list.push(userText);
          return renderWizard(ctx, userId);
        }
      } else if (st.step === 'waiting_for_media') {
        await safeDeleteUserMessage(ctx);
        if (userText === '🗑️ مسح الوسائط المرفقة' || userText === '🗑️ مسح الصور المرفقة') {
          st.data.media_items = [];
          st.data.media_label = null;
          return renderWizard(ctx, userId);
        }
        if (userText.startsWith('✅ إنهاء إرفاق')) {
          if (!st.data.media_items || st.data.media_items.length === 0) return;
          st.step = 'waiting_for_payment_choice';
          return renderWizard(ctx, userId);
        }
      }
    },

    handlePhoto: async (ctx) => {
      const userId = ctx.from.id;
      const st = userState[userId];
      await safeDeleteUserMessage(ctx);

      if (st && st.step === 'waiting_for_media') {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        st.data.media_items = st.data.media_items || [];
        if (st.data.media_items.length >= MAX_PROPERTY_IMAGES) return;
        st.data.media_items.push({ type: 'photo', file_id: photo.file_id });
        st.data.media_label = formatMediaSummaryLabel(st.data.media_items);
        return renderWizard(ctx, userId);
      }

      if (st && st.step === 'waiting_for_payment_receipt') {
        const receiptPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        st.step = 'publishing';
        try {
          const mediaItems = st.data.media_items || [];
          const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
          const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');
          let receiptUrl = receiptPhoto.file_id;
          try {
            const receiptFileLink = await ctx.telegram.getFileLink(receiptPhoto.file_id);
            const resReceipt = await fetch(receiptFileLink.href);
            const bufReceipt = Buffer.from(await resReceipt.arrayBuffer());
            const receiptFileName = `${Date.now()}_receipt_${userId}.jpg`;
            await supabase.storage.from('test_media').upload(receiptFileName, bufReceipt, { contentType: 'image/jpeg', upsert: true });
            const { data: pubReceiptUrl } = supabase.storage.from('test_media').getPublicUrl(receiptFileName);
            if (pubReceiptUrl?.publicUrl) receiptUrl = pubReceiptUrl.publicUrl;
          } catch (e) {}

          const { data: insertedRow, error: insertError } = await supabase
            .from('pending_properties')
            .insert([{
              user_id: userId,
              property_type: st.data.property_type,
              state_name: st.data.state_name,
              price: sanitizeNumericPrice(st.data.price),
              phone: String(st.data.phone || '').replace(/\D/g, '').trim(),
              description: st.data.description,
              image_url: combinedImagesUrl,
              video_url: videoUrl,
              receipt_url: receiptUrl,
              status: 'pending'
            }])
            .select()
            .single();
          if (insertError) throw insertError;

          const requestId = insertedRow.id;
          const adminButtons = Markup.inlineKeyboard([
            [
              Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`),
              Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`)
            ]
          ]);
          const adminIds = await getAdminIds();
          for (const currentAdminId of adminIds) {
            await ctx.telegram.sendPhoto(currentAdminId, receiptUrl, {
              caption: `🚨 <b>طلب إعلان عقاري جديد (#${requestId})</b>\n👤 المستخدم: <code>${userId}</code>`,
              parse_mode: 'HTML',
              ...adminButtons
            }).catch(() => {});
          }

          delete userState[userId];
          return replyTracked(ctx, userId, `⏳ <b>تم استلام وصل الدفع وحفظ طلبك برقم (#${requestId})!</b>`, {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard()
          }, true);
        } catch (err) {
          delete userState[userId];
          return replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(), true);
        }
      }
    },

    handleVideo: async (ctx) => {
      const userId = ctx.from.id;
      const st = userState[userId];
      await safeDeleteUserMessage(ctx);

      if (st && st.step === 'waiting_for_media') {
        const video = ctx.message.video;
        st.data.media_items = st.data.media_items || [];
        if (st.data.media_items.length >= MAX_PROPERTY_IMAGES) return;
        st.data.media_items.push({ type: 'video', file_id: video.file_id });
        st.data.media_label = formatMediaSummaryLabel(st.data.media_items);
        return renderWizard(ctx, userId);
      }
    }
  };
}

module.exports = { createUsersHandler };
