'use strict';
// =========================================================================
// 👤 SERVER USERS — كل ما يخص المستخدم
// يستدعيه server.js (الأب) للمستخدمين العاديين، وللأدمن في وضع المعاينة.
// المرفق في استعلام العميل مدمج داخل نفس رسالة البطاقة بدون رسائل منفصلة.
// =========================================================================

module.exports = function registerUsers(bot, core) {
  const {
    Markup, supabase, app, WEBHOOK_DOMAIN, MAX_PROPERTY_IMAGES,
    userState, userLang, browsingSession, supportUserSession,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, getAdminIds, getUserRecord, isUserVerified,
    chunkButtons, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml, fitTelegramText,
    normalizeMediaRef, parseMediaListFromField, parseImagesFromImageUrl, buildOrderedBrowsingMedia,
    getMainMenuKeyboard, getAuthKeyboard, getWebsiteUrl
  } = core;

  const clientInquiryBrowse = {};

  const CLIENT_INQUIRY_STATUS = {
    open: '🆕 مفتوح (بانتظار الرد)',
    in_progress: '⏳ قيد المعالجة',
    resolved: '✅ تم الحل',
    closed: '🔒 مغلق'
  };

  const CLIENT_ROLE_NAMES = {
    ads_reviewer: '🏠 مراجعة الإعلانات',
    payments_admin: '💳 مسؤول الدفع',
    points_admin: '🪙 مسؤول النقاط',
    general_support: '💬 الدعم العام',
    super_admin: '👑 الإدارة العامة'
  };

  function inferTargetRole(titleText = '', detailText = '') {
    const src = `${titleText} ${detailText}`.toLowerCase();
    if (/دفع|وصل|baridimob|ccp|payment/.test(src)) return 'payments_admin';
    if (/نقاط|مكافآت|رصيد|points/.test(src)) return 'points_admin';
    if (/معلق|مرفوض|مراجعة|تذكير|إعلان|التواصل|reject|pending|remind|re_review|no_contact|ad_note/.test(src)) {
      return 'ads_reviewer';
    }
    return 'general_support';
  }

  function inferInquiryType(titleText = '') {
    if (/لماذا إعلاني معلق/.test(titleText)) return 'why_pending';
    if (/تذكير الإدارة/.test(titleText)) return 'remind_admin';
    if (/لم يتم التواصل/.test(titleText)) return 'no_contact';
    if (/لماذا تم رفض/.test(titleText)) return 'why_rejected';
    if (/إعادة مراجعة/.test(titleText)) return 're_review';
    if (/ملاحظة أو استفسار/.test(titleText)) return 'ad_note';
    if (/مشكلة في الدفع/.test(titleText)) return 'payment_issue';
    if (/النقاط/.test(titleText)) return 'points_issue';
    if (/اقتراح/.test(titleText)) return 'suggestion';
    if (/شكر/.test(titleText)) return 'thanks';
    return 'general';
  }

  async function saveInquiryToSupabase({
    userId,
    propertyId = null,
    propertySource = null,
    inquiryType = 'general',
    targetRole = 'general_support',
    subject = null,
    message = '',
    attachmentUrl = null
  }) {
    try {
      const numPropId = Number(propertyId);
      const cleanPropId = Number.isFinite(numPropId) && numPropId > 0 ? numPropId : null;

      const { data, error } = await supabase
        .from('user_inquiries')
        .insert([{
          user_id: Number(userId),
          property_id: cleanPropId,
          property_source: cleanPropId ? (propertySource || 'pending_properties') : null,
          inquiry_type: inquiryType,
          target_role: targetRole,
          subject: subject || null,
          message: message || subject || 'استفسار من العميل',
          attachment_url: attachmentUrl || null,
          status: 'open'
        }])
        .select()
        .single();

      if (error) {
        console.error('saveInquiryToSupabase error:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.error('saveInquiryToSupabase exception:', e);
      return null;
    }
  }

  async function fetchClientInquiriesByUserId(userId) {
    try {
      const { data, error } = await supabase
        .from('user_inquiries')
        .select('*')
        .eq('user_id', Number(userId))
        .order('id', { ascending: false })
        .limit(50);

      if (error || !data) return [];
      return data;
    } catch (e) {
      return [];
    }
  }

  async function fetchClientRepliesForInquiry(inquiryId) {
    try {
      const { data, error } = await supabase
        .from('inquiry_replies')
        .select('*')
        .eq('inquiry_id', inquiryId)
        .order('id', { ascending: true });

      if (error || !data) return [];
      return data;
    } catch (e) {
      return [];
    }
  }

  function getClientInquiriesKeyboard(idx, total, currentInquiry = null) {
    const rows = [];
    const navRow = [];
    if (idx > 0) navRow.push('⬅️ استفساري السابق');
    navRow.push(`📋 ${idx + 1} / ${total}`);
    if (idx < total - 1) navRow.push('استفساري التالي ➡️');
    if (navRow.length > 0) rows.push(navRow);

    if (currentInquiry && currentInquiry.id) {
      rows.push([`💬 متابعة الاستعلام #${currentInquiry.id}`]);
    }
    rows.push(['💬 دعم واقتراحات وشكر', '⬅️ لوحة العميل']);
    rows.push(['🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  function formatClientInquiryCard(inquiry, replies, idx, total, isMediaCaption = false) {
    const statusText = CLIENT_INQUIRY_STATUS[inquiry.status] || escapeHtml(inquiry.status || 'open');
    const roleText = CLIENT_ROLE_NAMES[inquiry.target_role] || escapeHtml(inquiry.target_role || 'الدعم العام');
    const propLine = inquiry.property_id ? `🏠 <b>الإعلان:</b> <code>#${inquiry.property_id}</code>\n` : '';
    const subjectLine = inquiry.subject ? `📌 <b>الموضوع:</b> ${escapeHtml(inquiry.subject)}\n` : '';

    const combinedReplies = Array.isArray(replies) ? [...replies] : [];
    if (combinedReplies.length === 0 && inquiry.admin_reply) {
      combinedReplies.push({
        admin_role: inquiry.target_role,
        reply_message: inquiry.admin_reply,
        created_at: inquiry.updated_at || inquiry.created_at
      });
    }

    const hasReplies = combinedReplies.length > 0;
    const replyBanner = hasReplies
      ? `✅ <b>الردود:</b> تم الرد (${combinedReplies.length})\n`
      : `⏳ <b>الردود:</b> بانتظار الإدارة\n`;

    let repliesSection = `\n💬 <b>ردود الإدارة:</b>\n`;
    if (!hasReplies) {
      repliesSection += `<i>— لا توجد ردود بعد —</i>`;
    } else {
      repliesSection += combinedReplies.map((rep, rIdx) => {
        const repTime = formatDateTime(rep.created_at);
        const repRole = CLIENT_ROLE_NAMES[rep.admin_role] || 'الإدارة';
        const repBody = escapeHtml(
          rep.reply_message ||
          (rep.media_type === 'photo' ? '🖼 صورة مرفقة' : rep.media_type === 'video' ? '🎥 فيديو مرفق' : '')
        );
        return `${rIdx + 1}. <b>[${repRole}]</b> <code>${escapeHtml(repTime)}</code>: ${repBody}`;
      }).join('\n');
    }

    const text =
      `📨 <b>استعلاماتي</b> • <code>#${inquiry.id}</code> (${idx + 1}/${total})\n` +
      `📊 ${statusText} | 🎯 ${roleText}\n` +
      replyBanner +
      propLine +
      `🕒 <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      subjectLine +
      `📝 <b>استفسارك:</b> ${escapeHtml(inquiry.message || '')}` +
      repliesSection;

    return fitTelegramText(text, isMediaCaption);
  }

  async function renderClientInquiryAt(ctx, userId, index = 0, refresh = false) {
    delete browsingSession[userId];
    let st = clientInquiryBrowse[userId];

    if (!st || refresh) {
      const list = await fetchClientInquiriesByUserId(userId);
      st = { items: list, index: 0 };
      clientInquiryBrowse[userId] = st;
    }

    if (!st.items || st.items.length === 0) {
      delete clientInquiryBrowse[userId];
      return replyTracked(
        ctx, userId,
        `📭 <b>لا توجد استفسارات مسجلة لحسابك (<code>${userId}</code>) حتى الآن.</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['💬 دعم واقتراحات وشكر', '📋 إعلاناتي وحالتها'],
            ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    let safeIdx = Number(index) || 0;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= st.items.length) safeIdx = st.items.length - 1;
    st.index = safeIdx;

    const currentInquiry = st.items[safeIdx];
    const replies = await fetchClientRepliesForInquiry(currentInquiry.id);
    const kb = getClientInquiriesKeyboard(safeIdx, st.items.length, currentInquiry);

    const latestMediaReply = [...replies].reverse().find(r => r.attachment_url && (r.media_type === 'photo' || r.media_type === 'video'));
    const replyAttach = latestMediaReply ? normalizeMediaRef(latestMediaReply.attachment_url) : null;
    const inqAttach = normalizeMediaRef(currentInquiry.attachment_url);

    const attachedMedia = replyAttach
      ? { type: latestMediaReply.media_type === 'video' ? 'video' : 'photo', ref: replyAttach }
      : (inqAttach ? { type: 'photo', ref: inqAttach } : null);

    let sent = null;
    if (attachedMedia) {
      const mediaCaption = formatClientInquiryCard(currentInquiry, replies, safeIdx, st.items.length, true);
      try {
        sent = attachedMedia.type === 'video'
          ? await ctx.replyWithVideo(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...kb })
          : await ctx.replyWithPhoto(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...kb });
      } catch (e) {
        console.error('renderClientInquiryAt media card error:', e.message);
      }
    }

    if (!sent) {
      const cardText = formatClientInquiryCard(currentInquiry, replies, safeIdx, st.items.length, false);
      sent = await ctx.reply(cardText, { parse_mode: 'HTML', ...kb }).catch(() => null);
    }

    const keepIds = sent?.message_id ? [sent.message_id] : [];
    if (sent?.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
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
    const keyboard = Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map(r => rows[r]);
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
    for (const rKey of Object.keys(rows).sort((a, b) => Number(a) - Number(b))) {
      const sorted = rows[rKey].sort((a, b) => (a.col_num || 1) - (b.col_num || 1));
      keyboard.push(sorted.map(i => i.title));
    }
    keyboard.push(['✅ تأكيد الوصف والانتقال']);
    keyboard.push(['↩️ تراجع عن الأخيرة', '🗑️ مسح الكل']);
    keyboard.push(['⬅️ رجوع', '🏠 القائمة الرئيسية']);
    return Markup.keyboard(keyboard).resize();
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

  async function openUserHome(ctx, prefixNote = '') {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || 'مستخدمنا الكريم';
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const rawWelcomeTpl = await getSetting('welcome_msg_template', 'أهلاً بك يا <b>{name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:');
    const welcomeText = rawWelcomeTpl.replace('{name}', userName).replace(/\\n/g, '\n');
    await replyTracked(ctx, userId, prefixNote + welcomeText, {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard(userId, unreadCount)
    }, true);
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

      await core.bot.telegram.sendMessage(
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
    'waiting_for_type', 'waiting_for_state', 'waiting_for_price', 'waiting_for_phone',
    'waiting_for_description', 'waiting_for_media', 'waiting_for_payment_choice', 'waiting_for_payment_receipt'
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
      d.property_type, d.state_name, currentPriceDisplay, currentPhoneDisplay,
      descPreview, d.media_label || null, d.payment_label || null
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
      return Markup.keyboard([[backText, homeText], [cancelText]]).resize();
    }
  }

  async function renderWizard(ctx, userId, opts = {}) {
    const state = userState[userId];
    if (!state) return;

    const user = await getUserRecord(userId);
    const currentPoints = user ? (user.points || 0) : 0;
    const publishCost = await getSetting('publish_cost_points', '100');
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;

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

    const replyKeyboard = opts.noKeyboard ? getMainMenuKeyboard(userId, unreadCount) : await getStandardReplyKeyboard(state);

    const sent = await ctx.reply(text, { parse_mode: 'HTML', ...replyKeyboard });
    const oldId = state.wizardMsgId;
    state.wizardMsgId = sent.message_id;
    state.chatId = ctx.chat.id;
    if (sent.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);

    if (oldId && oldId !== sent.message_id) {
      await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
    }
  }

  bot.start(async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await ctx.sendChatAction('typing');
    const userName = ctx.from.first_name || 'مستخدمنا الكريم';
    const userId = ctx.from.id;

    const startPayload = ctx.startPayload || '';
    if (startPayload.startsWith('ref_')) {
      const referrerId = Number(startPayload.replace('ref_', ''));
      if (referrerId && referrerId !== userId) userState[userId] = { pendingReferrer: referrerId };
    } else {
      delete userState[userId];
    }

    delete browsingSession[userId];
    delete supportUserSession[userId];
    delete clientInquiryBrowse[userId];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
    userLang[userId] = 'ar';

    const verified = await isUserVerified(userId);
    if (verified) {
      delete userState[userId];
      await openUserHome(ctx);
    } else {
      const authText = await getSetting('auth_prompt_template', `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:`);
      await replyTracked(ctx, userId, authText.replace(/\\n/g, '\n'), { parse_mode: 'HTML', ...getAuthKeyboard() }, true);
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
      const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
      await replyTracked(ctx, userId, '🎉 <b>تم توثيق حسابك بنجاح!</b>', {
        parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount)
      }, true);
    } catch (err) {
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
    if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي'))) {
      const verified = await isUserVerified(ctx.from.id);
      if (!verified) {
        return replyTracked(ctx, ctx.from.id, '⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:', getAuthKeyboard());
      }
    }
    return next();
  });

  bot.hears(['❌ إلغاء العملية والعودة', '🏠 القائمة الرئيسية'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];
    delete clientInquiryBrowse[userId];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    await replyTracked(ctx, userId, '✅ العودة إلى القائمة الرئيسية:', {
      parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount)
    }, true);
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
    if (WIZ_STEPS[idx - 1] === 'waiting_for_media') {
      state.data.media_items = [];
      state.data.media_label = null;
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
      `اضغط على الزر في القائمة السفلية لمشاهدة إعلان الفيديو وربح النقاط فوراً.\n\n` +
      `👥 <b>الطريقة 2: دعوة الأصدقاء (+50 نقطة لكل صديق)</b>\n` +
      `شارك رابطك الخاص:\n<code>${refLink}</code>`;

    const keyboardRows = [];
    if (WEBHOOK_DOMAIN) {
      keyboardRows.push([
        Markup.button.webApp(`🎬 مشاهدة إعلان الفيديو (+${rewardPoints} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
      ]);
    }
    keyboardRows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(ctx, userId, msg, { parse_mode: 'HTML', ...Markup.keyboard(keyboardRows).resize() }, true);
  });

  bot.hears(['🌐 تصفح الموقع الرسمي (البروزر)', '🌐 تصفح الموقع الرسمي'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    if (!getWebsiteUrl()) {
      return replyTracked(ctx, userId, '⚠️ الموقع غير متاح حالياً.', { ...getMainMenuKeyboard(userId, unreadCount) }, true);
    }
    await replyTracked(ctx, userId, '🌐 <b>منصة عقار الجزائر</b>', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.url('🌐 فتح الموقع الرسمي', getWebsiteUrl())]])
    }, true);
    await ctx.reply('👇', { ...getMainMenuKeyboard(userId, unreadCount) }).then(m => trackBotMessage(userId, ctx.chat.id, m.message_id)).catch(() => {});
  });

  bot.hears('ℹ️ عن المنصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const aboutMsg = await getSetting('about_text', '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.');
    await replyTracked(ctx, userId, aboutMsg, { parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount) }, true);
  });

  async function showStatesMenu(ctx) {
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    try {
      const { data, error } = await supabase.from('test_messages').select('state_name');
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.', getMainMenuKeyboard(userId, unreadCount), true);
      }

      const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
      const stateButtons = uniqueStates.map(state => `📍 ${state}`);
      const chunkedStates = chunkButtons(stateButtons, 4);
      chunkedStates.push(['🌐 الكل'], ['🏠 القائمة الرئيسية']);

      const browseTitle = await getSetting('browse_title', '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>');
      await replyTracked(ctx, userId, browseTitle, { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() }, true);
    } catch (err) {
      console.error('showStatesMenu error:', err);
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(userId, unreadCount), true);
    }
  }

  bot.hears('🔍 تصفح العقارات المتاحة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    delete browsingSession[ctx.from.id];
    delete supportUserSession[ctx.from.id];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[ctx.from.id];
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
      delete supportUserSession[userId];
      if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
      browsingSession[userId] = { state: selectedState, page: 0, photoIndex: 0 };
      renderPropertyPage(ctx, userId, 0, 0);
    }
  });

  bot.hears('🌐 الكل', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    delete supportUserSession[userId];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
    browsingSession[userId] = { state: 'ALL', page: 0, photoIndex: 0 };
    renderPropertyPage(ctx, userId, 0, 0);
  });

  async function renderPropertyPage(ctx, userId, pageIndex, mediaIndex = 0) {
    const session = browsingSession[userId];
    if (!session) return;
    session.selectingPage = false;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;

    try {
      let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
      if (session.state !== 'ALL') query = query.eq('state_name', session.state);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, '📭 عذراً، لا توجد عقارات مسجلة.', getMainMenuKeyboard(userId, unreadCount), true);
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

      const rawCaption =
        `🏛 <b>الولاية:</b> ${escapeHtml(item.state_name || '')} (${pageIndex + 1}/${data.length})\n\n` +
        `🏠 <b>العقار:</b> ${escapeHtml(item.property_type || '')}\n` +
        `💰 <b>السعر:</b> ${formatMoney(item.price)}\n` +
        `📞 <b>هاتف المالك:</b> <code>${escapeHtml(item.phone || '')}</code>\n` +
        `🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(publishedAtText)}</code>${mediaLine}\n` +
        `📝 <b>الوصف:</b> ${escapeHtml(item.description || item.message || '')}`;

      const caption = fitTelegramText(rawCaption, !!currentMedia);
      const replyKb = getBrowsingKeyboard(pageIndex, data.length, safeMediaIndex, totalMedia);
      const msgInlineKb = (item.user_id && Number(item.user_id) !== Number(userId))
        ? Markup.inlineKeyboard([
            [Markup.button.callback('💬 مراسلة المالك', `msg_prop:${item.id}:${item.user_id}`)]
          ])
        : undefined;

      const cardExtra = {
        caption,
        parse_mode: 'HTML',
        ...(msgInlineKb || {}),
        ...replyKb
      };

      let sentMsg = null;
      if (currentMedia) {
        try {
          sentMsg = currentMedia.type === 'video'
            ? await ctx.replyWithVideo(currentMedia.ref, cardExtra)
            : await ctx.replyWithPhoto(currentMedia.ref, cardExtra);
        } catch (mediaErr) {}
      }
      if (!sentMsg) sentMsg = await ctx.reply(caption, cardExtra);

      const keepId = sentMsg?.message_id ? [sentMsg.message_id] : [];
      if (sentMsg?.message_id) trackBotMessage(userId, ctx.chat.id, sentMsg.message_id);
      session.lastMessageIds = keepId;
      await clearTrackedBotMessages(ctx, userId, keepId);
    } catch (err) {
      console.error('renderPropertyPage error:', err);
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(userId, unreadCount), true);
    }
  }

  bot.hears('الصورة التالية 🖼', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, (own.mediaIndex || 0) + 1);
    }
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, (session.photoIndex || 0) + 1);
  });

  bot.hears('🖼 الصورة السابقة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, Math.max((own.mediaIndex || 0) - 1, 0));
    }
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, Math.max((session.photoIndex || 0) - 1, 0));
  });

  bot.hears(/^📸 (صورة|عنصر) \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, own.mediaIndex || 0);
    }
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
  });

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
      if (row.length === 5) { numberButtons.push(row); row = []; }
    }
    if (row.length > 0) numberButtons.push(row);
    numberButtons.push(['🔙 رجوع للعقار']);

    await replyTracked(ctx, userId, `🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`, {
      parse_mode: 'HTML', ...Markup.keyboard(numberButtons).resize()
    }, true);
  });

  bot.hears(/^\d+$/, async (ctx, next) => {
    const userId = ctx.from.id;
    const n = parseInt(ctx.message.text.trim(), 10);

    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads' && own.selectingPage) {
      await safeDeleteUserMessage(ctx);
      own.selectingPage = false;
      return renderUserOwnAdBrowser(ctx, userId, n - 1, 0);
    }

    const session = browsingSession[userId];
    if (session && session.selectingPage) {
      await safeDeleteUserMessage(ctx);
      session.selectingPage = false;
      return renderPropertyPage(ctx, userId, n - 1, 0);
    }
    return next();
  });

  bot.hears('🔙 رجوع للعقار', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session) {
      session.selectingPage = false;
      renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
    }
  });

  bot.hears('⬅️ السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session && session.page > 0) renderPropertyPage(ctx, userId, session.page - 1, 0);
  });

  bot.hears('التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session) renderPropertyPage(ctx, userId, session.page + 1, 0);
  });

  bot.hears('➕ إضافة عقار جديد', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
    await clearTrackedBotMessages(ctx, userId);

    userState[userId] = {
      step: 'waiting_for_type',
      data: { features_list: [], media_items: [] },
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

  bot.hears('🆓 نشر مجاني', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    state.data.payment_label = '🆓 إعلان مجاني (بانتظار الإدارة)';
    state.step = 'publishing';

    try {
      const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة وإرسال الإعلان المجاني للإدارة...');
      await renderWizard(ctx, userId, { footer: publishingText });

      const mediaItems = state.data.media_items || [];
      const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
      const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');

      const numericPrice = sanitizeNumericPrice(state.data.price);
      const cleanPhone = String(state.data.phone || '').replace(/\D/g, '').trim();
      const submittedAt = formatDateTime(new Date());

      const { data: insertedRow, error: insertError } = await supabase
        .from('pending_properties')
        .insert([{
          user_id: userId,
          property_type: state.data.property_type,
          state_name: state.data.state_name,
          price: numericPrice,
          phone: cleanPhone,
          description: state.data.description,
          image_url: combinedImagesUrl,
          video_url: videoUrl,
          receipt_url: 'FREE_NO_RECEIPT',
          status: 'pending'
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      const requestId = insertedRow.id;
      const photosCount = parseImagesFromImageUrl(combinedImagesUrl).length;
      const videosCount = parseMediaListFromField(videoUrl).length;
      const dbUser = await getUserRecord(userId);
      const senderName = escapeHtml(
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
      );

      const adminCaption =
        `🆓 <b>إعلان مجاني جديد في قائمة الانتظار (#${requestId})</b>\n` +
        `🏷 <b>النوع المالي:</b> <b>إعلان مجاني (بدون وصل دفع / بدون خصم نقاط)</b>\n` +
        `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
        `👤 <b>المرسل:</b> ${senderName} (<code>${userId}</code>)\n` +
        `🏠 <b>العقار:</b> ${escapeHtml(state.data.property_type || '')}\n` +
        `📍 <b>الولاية:</b> ${escapeHtml(state.data.state_name || '')}\n` +
        `💰 <b>السعر:</b> ${formatMoney(numericPrice)}\n` +
        `📞 <b>الهاتف:</b> <code>${escapeHtml(cleanPhone)}</code>\n` +
        `🖼 <b>عدد الصور:</b> ${photosCount}\n` +
        `🎥 <b>عدد الفيديوهات:</b> ${videosCount}\n` +
        `📝 <b>الوصف:</b> ${escapeHtml(state.data.description || '')}`;

      const adminButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`),
          Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`)
        ],
        [Markup.button.callback(`✉️ رد على العميل (${userId})`, `support_reply_${userId}`)]
      ]);

      const adminIds = await getAdminIds();
      const firstPhotoRef = parseImagesFromImageUrl(combinedImagesUrl)[0];

      for (const currentAdminId of adminIds) {
        try {
          if (firstPhotoRef) {
            await ctx.telegram.sendPhoto(currentAdminId, firstPhotoRef, {
              caption: fitTelegramText(
                adminCaption + `\n\n👇 <b>تنبيه للإدارة: هذا إعلان مجاني — يرجى مراجعته واتخاذ القرار:</b>`,
                true
              ),
              parse_mode: 'HTML',
              ...adminButtons
            });
          } else {
            await ctx.telegram.sendMessage(currentAdminId, fitTelegramText(adminCaption, false), {
              parse_mode: 'HTML',
              ...adminButtons
            });
          }
        } catch (sendErr) {
          console.error(`Failed to send free ad admin notification to ${currentAdminId}:`, sendErr.message);
          await ctx.telegram.sendMessage(currentAdminId, fitTelegramText(adminCaption, false), {
            parse_mode: 'HTML',
            ...adminButtons
          }).catch(() => {});
        }
      }

      delete userState[userId];
      await replyTracked(ctx, userId,
        `⏳ <b>تم تسجيل إعلانك المجاني في قائمة الانتظار برقم (#${requestId}) وإرساله إلى الإدارة!</b>\n\n` +
        `🆓 <b>نوع الطلب:</b> إعلان مجاني\n` +
        `🕒 <b>تاريخ ووقت الإرسال:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
        `سيتم نشره في التصفح فور موافقة الإدارة عليه.`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    } catch (err) {
      console.error('Free ad pending publish error:', err);
      delete userState[userId];
      await replyTracked(
        ctx, userId,
        `⚠️ <b>تعذر إرسال الإعلان المجاني إلى قائمة الانتظار:</b>\n<code>${escapeHtml(err.message || 'خطأ غير معروف')}</code>`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    }
  });

  bot.hears(/^🪙 النشر مجاناً/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const user = await getUserRecord(userId);
    const currentPoints = user ? (user.points || 0) : 0;
    const publishCost = Number(await getSetting('publish_cost_points', '100'));

    if (currentPoints < publishCost) {
      const warnMsg = await ctx.reply(
        `⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nرصيدك الحالي: <b>${currentPoints} نقطة</b> وتحتاج إلى <b>${publishCost} نقطة</b>.\n\nاضغط على زر <b>"🎁 رصيدي وجمع النقاط"</b> لمشاهدة إعلانات وربح نقاط مجانية!`,
        { parse_mode: 'HTML' }
      );
      setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3500);
      return;
    }

    state.step = 'publishing';
    try {
      const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة والحفظ...');
      await renderWizard(ctx, userId, { footer: publishingText });

      const mediaItems = state.data.media_items || [];
      const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
      const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');

      await supabase.from('users').update({ points: currentPoints - publishCost }).eq('id', userId);

      const numericPrice = sanitizeNumericPrice(state.data.price);
      const cleanPhone = String(state.data.phone || '').replace(/\D/g, '').trim();
      const nowIso = new Date().toISOString();

      await supabase.from('test_messages').insert([{
        user_id: userId,
        property_type: state.data.property_type,
        state_name: state.data.state_name,
        price: numericPrice,
        phone: cleanPhone,
        description: state.data.description,
        message: state.data.description,
        image_url: combinedImagesUrl,
        video_url: videoUrl,
        created_at: nowIso
      }]);

      delete userState[userId];
      await replyTracked(ctx, userId,
        `🎉 <b>تم خصم ${publishCost} نقطة ونشر إعلانك بنجاح في المنصة مجاناً!</b>\n🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
        { parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    } catch (err) {
      console.error('Free publish error:', err);
      delete userState[userId];
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(userId, unreadCount), true);
    }
  });

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

  function statusLabelOf(st) {
    return st === 'approved' ? '✅ مقبول' : st === 'rejected' ? '❌ مرفوض' : '⏳ معلق';
  }

  async function fetchUserOwnedAds(userId) {
    const ads = [];

    try {
      const { data: pendingRows } = await supabase
        .from('pending_properties').select('*').eq('user_id', userId).order('id', { ascending: false });

      if (Array.isArray(pendingRows)) {
        for (const row of pendingRows) {
          const st = row.status || 'pending';
          ads.push({ ...row, source: 'pending_properties', ad_status: st, status_label: statusLabelOf(st) });
        }
      }
    } catch (e) {}

    try {
      const { data: publishedRows } = await supabase
        .from('test_messages').select('*').eq('user_id', userId).order('id', { ascending: false });

      if (Array.isArray(publishedRows)) {
        const existingApprovedKeys = new Set(
          ads.filter(a => a.ad_status === 'approved')
            .map(a => `${a.property_type}|${a.state_name}|${a.price}|${a.phone}`)
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
      ['📨 استعلاماتي وردود الإدارة', '📋 إعلاناتي وحالتها'],
      ['👤 ملفي الشخصي ورصيدي', '🗂 تصفح إعلاناتي الخاصة'],
      ['💬 دعم واقتراحات وشكر', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getSupportCategoriesKeyboard() {
    return Markup.keyboard([
      ['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري'],
      ['🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين'],
      ['👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'],
      ['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل'],
      ['🏠 القائمة الرئيسية']
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
        ['📨 استعلاماتي وردود الإدارة', '⬅️ قائمة الإعلانات'],
        ['🏠 القائمة الرئيسية']
      ]).resize();
    }
    if (ad.ad_status === 'rejected') {
      return Markup.keyboard([
        [`❌ لماذا تم رفض إعلاني؟ (#${id})`],
        [`🔄 طلب إعادة مراجعة الإعلان (#${id})`],
        ['📨 استعلاماتي وردود الإدارة', '⬅️ قائمة الإعلانات'],
        ['🏠 القائمة الرئيسية']
      ]).resize();
    }
    return Markup.keyboard([
      [`⚠️ ملاحظة أو استفسار حول الإعلان (#${id})`],
      ['📨 استعلاماتي وردود الإدارة', '⬅️ قائمة الإعلانات'],
      ['🏠 القائمة الرئيسية']
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
    rows.push(['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل']);
    rows.push(['🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  async function openSupportDashboard(ctx, userId) {
    const dbUser = await getUserRecord(userId);
    const allAds = await fetchUserOwnedAds(userId);
    const myInquiries = await fetchClientInquiriesByUserId(userId);
    const pendingCount = allAds.filter(a => a.ad_status === 'pending').length;
    const approvedCount = allAds.filter(a => a.ad_status === 'approved').length;
    const rejectedCount = allAds.filter(a => a.ad_status === 'rejected').length;

    const points = dbUser?.points ?? 0;
    const name = escapeHtml(dbUser?.first_name || ctx.from.first_name || 'عميلنا الكريم');
    const supportIntro = (await getSetting('support_text', '')).replace(/\\n/g, '\n');

    supportUserSession[userId] = { mode: 'dashboard', ads: allAds };
    userState[userId] = { step: 'support_dashboard', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    const text =
      `🎛 <b>لوحة العميل ومركز الدعم</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 أهلاً بك يا <b>${name}</b>\n` +
      `🪙 <b>رصيد النقاط:</b> <b>${points} نقطة</b>\n` +
      `📨 <b>استعلاماتك المسجلة:</b> <b>${myInquiries.length}</b>\n` +
      `📊 <b>إعلاناتك:</b> إجمالي <b>${allAds.length}</b> | ⏳ معلق: <b>${pendingCount}</b> | ✅ مقبول: <b>${approvedCount}</b> | ❌ مرفوض: <b>${rejectedCount}</b>` +
      (supportIntro ? `\n\n${supportIntro}` : '') +
      `\n\n👇 <b>اختر "📨 استعلاماتي وردود الإدارة" لمتابعة استعلاماتك والردود عليها:</b>`;

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard() }, true);
  }

  async function renderUserOwnAdBrowser(ctx, userId, adIndex = 0, mediaIndex = 0) {
    const allAds = await fetchUserOwnedAds(userId);
    if (!allAds.length) {
      return replyTracked(ctx, userId, '📭 <b>لا توجد إعلانات مسجلة باسمك حتى الآن.</b>',
        { parse_mode: 'HTML', ...getSupportHubKeyboard() }, true);
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

    delete browsingSession[userId];
    supportUserSession[userId] = {
      mode: 'browsing_own_ads', ads: allAds, page: safeIdx, mediaIndex: safeMediaIdx, selectingPage: false
    };

    const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIdx] : null;
    const mediaLine = totalMedia > 0
      ? `\n${currentMedia.type === 'video' ? '🎥 فيديو' : '🖼 صورة'}: <b>${safeMediaIdx + 1} / ${totalMedia}</b>`
      : '';
    const adDateLine = ad.created_at
      ? `\n🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(formatDateTime(ad.created_at))}</code>` : '';

    const rawCaption =
      `🗂 <b>إعلاناتك الخاصة (${safeIdx + 1}/${allAds.length})</b> — الحالة: <b>${ad.status_label}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏠 <b>العقار:</b> ${escapeHtml(ad.property_type || '')}\n` +
      `📍 <b>الولاية:</b> ${escapeHtml(ad.state_name || '')}\n` +
      `💰 <b>السعر:</b> ${formatMoney(ad.price)}\n` +
      `📞 <b>الهاتف:</b> <code>${escapeHtml(ad.phone || '')}</code>${adDateLine}${mediaLine}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(ad.description || ad.message || '')}`;

    const caption = fitTelegramText(rawCaption, !!currentMedia);
    const kb = getUserOwnBrowsingKeyboard(safeIdx, allAds.length, safeMediaIdx, totalMedia);

    let sentMsg = null;
    if (currentMedia) {
      try {
        sentMsg = currentMedia.type === 'video'
          ? await ctx.replyWithVideo(currentMedia.ref, { caption, parse_mode: 'HTML', ...kb })
          : await ctx.replyWithPhoto(currentMedia.ref, { caption, parse_mode: 'HTML', ...kb });
      } catch (e) {}
    }
    if (!sentMsg) sentMsg = await ctx.reply(caption, { parse_mode: 'HTML', ...kb });

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
          return { ...data, source: 'pending_properties', ad_status: st, status_label: statusLabelOf(st) };
        }
      }

      if (candidate && senderUserId) {
        const { data: matchedRows } = await supabase
          .from('pending_properties')
          .select('*')
          .eq('user_id', senderUserId)
          .eq('property_type', candidate.property_type || '')
          .eq('state_name', candidate.state_name || '')
          .order('id', { ascending: false })
          .limit(1);

        if (matchedRows && matchedRows.length > 0) {
          const row = matchedRows[0];
          const st = row.status || 'pending';
          return { ...row, source: 'pending_properties', ad_status: st, status_label: statusLabelOf(st) };
        }
      }
    } catch (e) {}

    return candidate;
  }

  async function sendStructuredTicketToAdmins(ctx, senderUserId, ticketTitle, detailText, relatedAd = null, payloadType = 'text', mediaContent = {}, fallbackAdId = null) {
    const adminIds = await getAdminIds();
    const dbUser = await getUserRecord(senderUserId);
    const fullName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
    );
    const phoneLine = dbUser?.phone_number ? `\n📞 <b>هاتف العميل:</b> <code>${escapeHtml(dbUser.phone_number)}</code>` : '';

    const resolvedAd = await resolvePendingRecordForReview(relatedAd, senderUserId, fallbackAdId);
    const receiptRef = normalizeMediaRef(resolvedAd?.receipt_url);
    const isFreeAd = resolvedAd?.receipt_url === 'FREE_NO_RECEIPT';

    const adIdNum = Number(resolvedAd?.id || fallbackAdId);
    const hasNumericAdId = Number.isFinite(adIdNum) && adIdNum > 0;
    const adIdLabel = resolvedAd?.id || fallbackAdId || null;

    const attachmentRef =
      payloadType === 'photo' && mediaContent.fileId
        ? `tg:${mediaContent.fileId}`
        : payloadType === 'video' && mediaContent.fileId
        ? `tg:${mediaContent.fileId}`
        : null;

    const savedInquiry = await saveInquiryToSupabase({
      userId: senderUserId,
      propertyId: hasNumericAdId ? adIdNum : null,
      propertySource: hasNumericAdId ? (resolvedAd?.source || 'pending_properties') : null,
      inquiryType: inferInquiryType(ticketTitle),
      targetRole: inferTargetRole(ticketTitle, detailText),
      subject: ticketTitle,
      message: detailText || mediaContent.caption || ticketTitle,
      attachmentUrl: attachmentRef
    });

    const inqBadge = savedInquiry?.id ? ` • استعلام <code>#${savedInquiry.id}</code>` : '';
    const isReminderOrReview =
      /تذكير|معلق|إعادة مراجعة|remind|pending|re_review/i.test(ticketTitle) ||
      /تذكير|معلق|إعادة مراجعة/i.test(detailText || '');

    const photosCount = parseImagesFromImageUrl(resolvedAd?.image_url).length;
    const videosCount = parseMediaListFromField(resolvedAd?.video_url).length;
    const adTypeBadge = isFreeAd ? `\n🏷 <b>نوع الإعلان:</b> <b>إعلان مجاني</b>` : '';
    const adTimeBadge = resolvedAd?.created_at
      ? `\n🕒 <b>تاريخ الإرسال:</b> <code>${escapeHtml(formatDateTime(resolvedAd.created_at))}</code>`
      : `\n🕒 <b>وقت الطلب:</b> <code>${escapeHtml(formatDateTime(new Date()))}</code>`;

    const adBlock = adIdLabel
      ? `\n📌 <b>الإعلان:</b> <code>#${escapeHtml(String(adIdLabel))}</code>` +
        (resolvedAd?.property_type ? ` (${escapeHtml(resolvedAd.property_type)}${resolvedAd?.state_name ? ` - ${escapeHtml(resolvedAd.state_name)}` : ''}${resolvedAd?.price ? ` - ${formatMoney(resolvedAd.price)}` : ''})` : '') +
        (resolvedAd?.status_label || relatedAd?.status_label ? ` — الحالة: <b>${resolvedAd?.status_label || relatedAd?.status_label}</b>` : '') +
        adTypeBadge +
        adTimeBadge +
        (isReminderOrReview && (photosCount > 0 || videosCount > 0)
          ? `\n🖼 <b>الصور:</b> ${photosCount} | 🎥 <b>الفيديو:</b> ${videosCount}` : '') +
        (resolvedAd?.description ? `\n📝 <b>الوصف:</b> ${escapeHtml(resolvedAd.description)}` : '')
      : adTimeBadge;

    const header = isReminderOrReview
      ? `🔔 <b>معاينة تذكير إعلان — ${escapeHtml(ticketTitle)}${inqBadge}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>الاسم:</b> ${fullName}\n` +
        `🆔 <b>الآيدي (ID):</b> <code>${senderUserId}</code>${phoneLine}${adBlock}\n`
      : `📩 <b>طلب من العميل — ${escapeHtml(ticketTitle)}${inqBadge}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>الاسم:</b> ${fullName}\n` +
        `🆔 <b>الآيدي (ID):</b> <code>${senderUserId}</code>${phoneLine}${adBlock}\n`;

    const inlineRows = [];
    if (savedInquiry?.id) {
      inlineRows.push([Markup.button.callback(`💬 الرد على الاستعلام (#${savedInquiry.id})`, `inq_reply_${savedInquiry.id}`)]);
    }
    if (hasNumericAdId) {
      inlineRows.push([
        Markup.button.callback(`❌ رفض (#${adIdNum})`, `reject_${adIdNum}`),
        Markup.button.callback(`✅ قبول ونشر (#${adIdNum})`, `approve_${adIdNum}`)
      ]);
    }
    inlineRows.push([Markup.button.callback(`✉️ رد على العميل (${senderUserId})`, `support_reply_${senderUserId}`)]);

    const replyMarkup = Markup.inlineKeyboard(inlineRows);
    const bodyText = detailText ? `\n💬 <b>الطلب:</b>\n${escapeHtml(detailText)}` : '';
    const fullAdminText = header + bodyText;

    for (const adminId of adminIds) {
      try {
        if (payloadType === 'photo') {
          const cap = fitTelegramText(
            header + (mediaContent.caption ? `\n💬 <b>الطلب:</b> ${escapeHtml(mediaContent.caption)}` : '\n🖼 <b>مرفق صورة من العميل</b>'),
            true
          );
          await ctx.telegram.sendPhoto(adminId, mediaContent.fileId, { caption: cap, parse_mode: 'HTML', ...replyMarkup });
        } else if (payloadType === 'video') {
          const cap = fitTelegramText(
            header + (mediaContent.caption ? `\n💬 <b>الطلب:</b> ${escapeHtml(mediaContent.caption)}` : '\n🎥 <b>مرفق فيديو من العميل</b>'),
            true
          );
          await ctx.telegram.sendVideo(adminId, mediaContent.fileId, { caption: cap, parse_mode: 'HTML', ...replyMarkup });
        } else if (receiptRef) {
          const receiptCaption = fitTelegramText(
            fullAdminText + `\n\n🧾 <b>وصل الدفع (الفيرسمون) المرفق داخل الرسالة أعلاه 👆</b>`,
            true
          );
          try {
            await ctx.telegram.sendPhoto(adminId, receiptRef, { caption: receiptCaption, parse_mode: 'HTML', ...replyMarkup });
          } catch (receiptSendErr) {
            await ctx.telegram.sendMessage(adminId, fitTelegramText(fullAdminText, false), {
              parse_mode: 'HTML', ...replyMarkup
            });
          }
        } else {
          await ctx.telegram.sendMessage(adminId, fitTelegramText(fullAdminText, false), {
            parse_mode: 'HTML', ...replyMarkup
          });
        }
      } catch (err) {
        console.error(`Support ticket forward error to ${adminId}:`, err.message);
      }
    }

    return savedInquiry;
  }

  async function processAdInquiryAction(ctx, userId, actionLabel, reqId) {
    const s = supportUserSession[userId];
    const adsList = s?.ads || await fetchUserOwnedAds(userId);
    const relatedAd = adsList.find(a => String(a.id) === String(reqId)) || s?.selectedAd || null;

    const savedInq = await sendStructuredTicketToAdmins(
      ctx, userId,
      `${actionLabel} (#${reqId})`,
      `${actionLabel} — بخصوص الإعلان رقم #${reqId}.`,
      relatedAd, 'text', {}, reqId
    );

    const inqRefLine = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

    await replyTracked(
      ctx, userId,
      `✅ <b>تم إرسال استفسارك (${escapeHtml(actionLabel)}) بخصوص الإعلان <code>#${escapeHtml(String(reqId))}</code> إلى الإدارة.</b>${inqRefLine}`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ['📨 استعلاماتي وردود الإدارة', '📋 إعلاناتي وحالتها'],
          ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']
        ]).resize()
      },
      true
    );
  }

  bot.hears('📨 استعلاماتي وردود الإدارة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderClientInquiryAt(ctx, ctx.from.id, 0, true);
  });

  bot.hears('⬅️ استفساري السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    if (!st) return renderClientInquiryAt(ctx, userId, 0, true);
    await renderClientInquiryAt(ctx, userId, Math.max((st.index || 0) - 1, 0), false);
  });

  bot.hears('استفساري التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    if (!st) return renderClientInquiryAt(ctx, userId, 0, true);
    await renderClientInquiryAt(ctx, userId, (st.index || 0) + 1, false);
  });

  bot.hears(/^📋 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    if (!st) return renderClientInquiryAt(ctx, userId, 0, true);
    await renderClientInquiryAt(ctx, userId, st.index || 0, true);
  });

  bot.hears(/^💬 متابعة الاستعلام #(\d+)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const parentInquiryId = Number(ctx.match[1]);

    userState[userId] = {
      step: 'client_following_up_inquiry',
      data: { parentInquiryId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    await replyTracked(
      ctx, userId,
      `💬 <b>متابعة الاستعلام رقم</b> <code>#${parentInquiryId}</code>\n\nاكتب رسالتك أو أرفق صورة/فيديو ليتم حفظها في استعلاماتك وإرسالها للإدارة:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل']]).resize()
      },
      true
    );
  });

  bot.action(/^adinq:([a-z_]+):(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const inquiryKey = ctx.match[1];
    const reqId = decodeURIComponent(ctx.match[2]);
    const actionLabel = AD_INQUIRY_TYPES[inquiryKey] || 'استفسار حول الإعلان';

    await ctx.answerCbQuery('✅ تم تسجيل وإرسال استفسارك للإدارة');
    await processAdInquiryAction(ctx, userId, actionLabel, reqId);
  });

  bot.hears(/^(❓ لماذا إعلاني معلق\؟|⏱️ تذكير الإدارة بمراجعة الطلب|📞 لماذا لم يتم التواصل معي\؟|❌ لماذا تم رفض إعلاني\؟|🔄 طلب إعادة مراجعة الإعلان|⚠️ ملاحظة أو استفسار حول الإعلان) \(#([^)]+)\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await processAdInquiryAction(ctx, ctx.from.id, ctx.match[1], ctx.match[2]);
  });

  bot.hears('📞 الدعم والإدارة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openSupportDashboard(ctx, ctx.from.id);
  });

  bot.hears('⬅️ لوحة العميل', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openSupportDashboard(ctx, ctx.from.id);
  });

  bot.hears('👤 ملفي الشخصي ورصيدي', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const dbUser = await getUserRecord(userId);
    const allAds = await fetchUserOwnedAds(userId);

    const text =
      `👤 <b>الملف الشخصي والرصيد</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• <b>الاسم:</b> ${escapeHtml(dbUser?.first_name || ctx.from.first_name || 'غير محدد')}\n` +
      `• <b>رصيد النقاط:</b> <b>${dbUser?.points ?? 0} نقطة</b>\n` +
      `• <b>عدد إعلاناتك المسجلة:</b> <b>${allAds.length}</b>`;

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard() }, true);
  });

  async function showAdsFilterMenu(ctx, userId, intro) {
    const allAds = await fetchUserOwnedAds(userId);
    supportUserSession[userId] = { mode: 'ads_filter', ads: allAds };

    const pending = allAds.filter(a => a.ad_status === 'pending').length;
    const approved = allAds.filter(a => a.ad_status === 'approved').length;
    const rejected = allAds.filter(a => a.ad_status === 'rejected').length;

    await replyTracked(ctx, userId, intro, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        [`⏳ معلقة (${pending})`, `✅ مقبولة (${approved})`],
        [`❌ مرفوضة (${rejected})`, `📌 الكل (${allAds.length})`],
        ['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل'],
        ['🏠 القائمة الرئيسية']
      ]).resize()
    }, true);
  }

  bot.hears('📋 إعلاناتي وحالتها', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showAdsFilterMenu(ctx, ctx.from.id,
      `📋 <b>إعلاناتي وحالتها</b>\n\nاختر الفئة لعرض إعلاناتك والتساؤل حول أي إعلان بضغطة زر:`);
  });

  bot.hears('⬅️ قائمة الإعلانات', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showAdsFilterMenu(ctx, ctx.from.id, `📋 <b>إعلاناتي وحالتها</b>\nاختر الفئة:`);
  });

  bot.hears(/^(⏳ معلقة|✅ مقبولة|❌ مرفوضة|📌 الكل) \(\d+\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const prefix = ctx.match[1];
    const allAds = await fetchUserOwnedAds(userId);

    let filtered = allAds;
    let label = 'جميع إعلاناتك';
    if (prefix.startsWith('⏳')) {
      filtered = allAds.filter(a => a.ad_status === 'pending'); label = 'إعلاناتك المعلقة';
    } else if (prefix.startsWith('✅')) {
      filtered = allAds.filter(a => a.ad_status === 'approved'); label = 'إعلاناتك المقبولة';
    } else if (prefix.startsWith('❌')) {
      filtered = allAds.filter(a => a.ad_status === 'rejected'); label = 'إعلاناتك المرفوضة';
    }

    if (!filtered.length) {
      return replyTracked(ctx, userId,
        `📭 <b>لا توجد إعلانات في فئة "${escapeHtml(label)}".</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([['📋 إعلاناتي وحالتها'], ['⬅️ لوحة العميل', '🏠 القائمة الرئيسية']]).resize()
        }, true);
    }

    supportUserSession[userId] = { mode: 'select_ad_for_action', ads: filtered };

    const listLines = filtered.slice(0, 15).map((ad, idx) => {
      const adKind = ad.receipt_url === 'FREE_NO_RECEIPT' ? ' • 🆓 مجاني' : '';
      const adDate = ad.created_at ? ` • 🕒 ${formatDateTime(ad.created_at)}` : '';
      return `${idx + 1}. ${ad.status_label} <b>#${ad.id || '—'}</b> — ${escapeHtml(ad.property_type || '')} (${escapeHtml(ad.state_name || '')}) • ${formatMoney(ad.price)}${adKind}${adDate}`;
    });

    const adButtons = filtered.slice(0, 12).map(ad => `📄 إعلان #${ad.id || '—'} (${ad.property_type || ''})`);

    await replyTracked(
      ctx, userId,
      `📋 <b>${escapeHtml(label)} (${filtered.length}):</b>\n\n${listLines.join('\n')}\n\n👇 <b>اختر إعلاناً من الأزرار لإرسال استفسار أو تذكير حوله:</b>`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ...chunkButtons(adButtons, 2),
          ['⬅️ قائمة الإعلانات', '⬅️ لوحة العميل']
        ]).resize()
      },
      true
    );
  });

  bot.hears(/^📄 إعلان #(\S+) \((.*)\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const reqIdStr = ctx.match[1];
    const allAds = supportUserSession[userId]?.ads || await fetchUserOwnedAds(userId);
    const targetAd = allAds.find(a => String(a.id) === String(reqIdStr)) || allAds[0];
    if (!targetAd) return;

    supportUserSession[userId] = { mode: 'ad_actions', ads: allAds, selectedAd: targetAd };

    const adKindLine = targetAd.receipt_url === 'FREE_NO_RECEIPT' ? `\n• <b>النوع:</b> <b>إعلان مجاني</b>` : '';
    const adDateLine = targetAd.created_at ? `\n• <b>التاريخ والوقت:</b> <code>${escapeHtml(formatDateTime(targetAd.created_at))}</code>` : '';

    const cardText =
      `📄 <b>تفاصيل الإعلان #${escapeHtml(String(targetAd.id || '—'))}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• <b>الحالة:</b> <b>${targetAd.status_label}</b>${adKindLine}${adDateLine}\n` +
      `• <b>العقار:</b> ${escapeHtml(targetAd.property_type || '')}\n` +
      `• <b>الولاية:</b> ${escapeHtml(targetAd.state_name || '')}\n` +
      `• <b>السعر:</b> ${formatMoney(targetAd.price)}\n` +
      `• <b>الوصف:</b> ${escapeHtml(targetAd.description || targetAd.message || '')}\n\n` +
      `👇 <b>اختر التساؤل أو الإجراء من الأزرار أدناه:</b>`;

    await replyTracked(ctx, userId, cardText, {
      parse_mode: 'HTML',
      ...getInteractiveAdInlineKeyboard(targetAd),
      ...getAdActionButtonsForStatus(targetAd)
    }, true);
  });

  bot.hears('🗂 تصفح إعلاناتي الخاصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderUserOwnAdBrowser(ctx, ctx.from.id, 0, 0);
  });

  bot.hears('إعلاني التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const s = supportUserSession[userId];
    if (s && s.mode === 'browsing_own_ads') await renderUserOwnAdBrowser(ctx, userId, (s.page || 0) + 1, 0);
  });

  bot.hears('⬅️ إعلاني السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const s = supportUserSession[userId];
    if (s && s.mode === 'browsing_own_ads') await renderUserOwnAdBrowser(ctx, userId, Math.max((s.page || 0) - 1, 0), 0);
  });

  bot.hears(/^🗂 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const s = supportUserSession[userId];
    if (!s || s.mode !== 'browsing_own_ads' || !s.ads?.length) return;

    s.selectingPage = true;
    const total = s.ads.length;
    const rows = [];
    let row = [];
    for (let i = 1; i <= total; i++) {
      row.push(`${i}`);
      if (row.length === 5) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    rows.push(['🗂 تصفح إعلاناتي الخاصة']);

    await replyTracked(ctx, userId, `🔢 <b>اختر رقم إعلانك للانتقال إليه مباشرة (1 إلى ${total}):</b>`,
      { parse_mode: 'HTML', ...Markup.keyboard(rows).resize() }, true);
  });

  bot.hears('💬 دعم واقتراحات وشكر', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    userState[userId] = { step: 'support_selecting_category', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    await replyTracked(ctx, userId, `💬 <b>اختر نوع الرسالة أو الملاحظة:</b>`,
      { parse_mode: 'HTML', ...getSupportCategoriesKeyboard() }, true);
  });

  bot.hears(['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري', '🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين', '👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const chosenCat = ctx.message.text.trim();
    const presetDetail = QUICK_SUPPORT_PRESETS[chosenCat] || chosenCat;

    const savedInq = await sendStructuredTicketToAdmins(ctx, userId, chosenCat, presetDetail, null, 'text');
    delete userState[userId];

    const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام:</b> <code>#${savedInq.id}</code>` : '';
    const confirmMsg = chosenCat === '👏 شكر أو ملاحظة إيجابية'
      ? `👏 <b>شكراً جزيلاً لك على كلماتك الطيبة وثقتك بمنصة عقار الجزائر.</b>${inqTag}`
      : `✅ <b>تم تسجيل طلبك (${escapeHtml(chosenCat)}) وإرساله إلى الإدارة.</b>${inqTag}`;

    await replyTracked(ctx, userId, confirmMsg, { parse_mode: 'HTML', ...getSupportHubKeyboard() }, true);
  });

  bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userText = ctx.message.text ? ctx.message.text.trim() : '';
    if (userText.startsWith('/')) return;

    const state = userState[userId];
    if (!state) return;

    if (state.step === 'client_following_up_inquiry') {
      await safeDeleteUserMessage(ctx);
      const parentId = state.data?.parentInquiryId;

      const savedFollow = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        userText,
        null,
        'text',
        {},
        parentId || null
      );

      delete userState[userId];
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      return replyTracked(
        ctx,
        userId,
        `✅ <b>تم تسجيل متابعتك في استعلاماتك وإرسالها للإدارة${followRef}.</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل'],
            ['🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

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

    if (state.step === 'waiting_for_price' || state.step === 'waiting_for_phone') {
      await safeDeleteUserMessage(ctx);
      state.tempInput = state.tempInput || '';

      if (userText.startsWith('📥 القيمة الحالية:')) {
        return;
      } else if (userText >= '0' && userText <= '9') {
        state.tempInput += userText;
        return renderWizard(ctx, userId);
      } else if (userText === '+مليون') {
        state.tempInput += '000000';
        return renderWizard(ctx, userId);
      } else if (userText === '⌫') {
        state.tempInput = state.tempInput.slice(0, -1);
        return renderWizard(ctx, userId);
      } else if (userText === '🗑️ مسح') {
        state.tempInput = '';
        return renderWizard(ctx, userId);
      } else if (userText === '✅ [ OK ] تأكيد') {
        if (!state.tempInput || state.tempInput.length === 0) {
          const warnMsg = await ctx.reply('⚠️ <b>يرجى إدخال الرقم في الحقل أولاً!</b>', { parse_mode: 'HTML' });
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
          return;
        }

        if (state.step === 'waiting_for_price') {
          state.data.price = state.tempInput;
          state.step = 'waiting_for_phone';
          state.tempInput = '';
          return renderWizard(ctx, userId);
        } else if (state.step === 'waiting_for_phone') {
          if (state.tempInput.length < 9) {
            const warnMsg = await ctx.reply('⚠️ <b>رقم الهاتف قصير جداً!</b>', { parse_mode: 'HTML' });
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
            return;
          }
          state.data.phone = state.tempInput;
          state.step = 'waiting_for_description';
          state.data.features_list = state.data.features_list || [];
          state.tempInput = '';
          return renderWizard(ctx, userId);
        }
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
        state.data.media_items = [];
        return renderWizard(ctx, userId);
      }

      const validFeatures = await getDynamicFeatures();
      const allowedFeatures = validFeatures.map(f => f.title);

      if (allowedFeatures.includes(userText)) {
        if (!state.data.features_list.includes(userText)) state.data.features_list.push(userText);
        return renderWizard(ctx, userId);
      }
    }

    if (state.step === 'waiting_for_media') {
      await safeDeleteUserMessage(ctx);

      if (userText === '🗑️ مسح الوسائط المرفقة' || userText === '🗑️ مسح الصور المرفقة') {
        state.data.media_items = [];
        state.data.media_label = null;
        return renderWizard(ctx, userId);
      }

      if (userText.startsWith('✅ إنهاء إرفاق')) {
        if (!state.data.media_items || state.data.media_items.length === 0) {
          const warnMsg = await ctx.reply('⚠️ <b>يرجى إرسال صورة أو فيديو واحد على الأقل أولاً!</b>', { parse_mode: 'HTML' });
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
          return;
        }
        state.step = 'waiting_for_payment_choice';
        return renderWizard(ctx, userId);
      }
    }
  });

  bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;

    await safeDeleteUserMessage(ctx);

    if (state && state.step === 'client_following_up_inquiry') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const parentId = state.data?.parentInquiryId;
      const savedFollow = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        ctx.message.caption || '🖼 صورة مرفقة من العميل',
        null,
        'photo',
        { fileId: photo.file_id, caption: ctx.message.caption || '' },
        parentId || null
      );
      delete userState[userId];
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      return replyTracked(
        ctx,
        userId,
        `✅ <b>تم إرسال الصورة وتسجيل متابعتك للإدارة${followRef}.</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل'],
            ['🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    if (state && state.step === 'waiting_for_media') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      state.data.media_items = state.data.media_items || [];

      if (state.data.media_items.length >= MAX_PROPERTY_IMAGES) {
        const warnMsg = await ctx.reply(`⚠️ <b>وصلت للحد الأقصى (${MAX_PROPERTY_IMAGES} ملفات).</b> اضغط زر الإنهاء في الأسفل.`, { parse_mode: 'HTML' });
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
        return;
      }

      state.data.media_items.push({ type: 'photo', file_id: photo.file_id });
      state.data.media_label = formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId);
    }

    if (state && state.step === 'waiting_for_payment_receipt') {
      const receiptPhoto = ctx.message.photo[ctx.message.photo.length - 1];
      state.step = 'publishing';

      try {
        const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة والحفظ...');
        await renderWizard(ctx, userId, { footer: publishingText });

        const mediaItems = state.data.media_items || [];
        const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
        const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');

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

        const numericPrice = sanitizeNumericPrice(state.data.price);
        const cleanPhone = String(state.data.phone || '').replace(/\D/g, '').trim();

        const { data: insertedRow, error: insertError } = await supabase
          .from('pending_properties')
          .insert([{
            user_id: userId,
            property_type: state.data.property_type,
            state_name: state.data.state_name,
            price: numericPrice,
            phone: cleanPhone,
            description: state.data.description,
            image_url: combinedImagesUrl,
            video_url: videoUrl,
            receipt_url: receiptUrl,
            status: 'pending'
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        const requestId = insertedRow.id;
        const photosCount = parseImagesFromImageUrl(combinedImagesUrl).length;
        const videosCount = parseMediaListFromField(videoUrl).length;
        const submittedAt = formatDateTime(insertedRow.created_at || new Date());

        const adminCaption =
          `🚨 <b>طلب إعلان عقاري جديد (#${requestId})</b>\n` +
          `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
          `👤 <b>معرف المستخدم:</b> <code>${userId}</code>\n` +
          `🏠 <b>النوع:</b> ${escapeHtml(state.data.property_type || '')}\n` +
          `📍 <b>الولاية:</b> ${escapeHtml(state.data.state_name || '')}\n` +
          `💰 <b>السعر:</b> ${formatMoney(numericPrice)}\n` +
          `📞 <b>الهاتف:</b> ${escapeHtml(cleanPhone)}\n` +
          `🖼 <b>عدد الصور:</b> ${photosCount}\n` +
          `🎥 <b>عدد الفيديوهات:</b> ${videosCount}\n` +
          `📝 <b>الوصف:</b> ${escapeHtml(state.data.description || '')}`;

        const adminButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`),
            Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`)
          ]
        ]);

        const photoSource =
          typeof receiptUrl === 'string' && receiptUrl.startsWith('http') ? receiptUrl : receiptPhoto.file_id;

        const adminIds = await getAdminIds();

        for (const currentAdminId of adminIds) {
          try {
            await ctx.telegram.sendPhoto(currentAdminId, photoSource, {
              caption: fitTelegramText(
                adminCaption + `\n\n👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ قرار:</b>`,
                true
              ),
              parse_mode: 'HTML',
              ...adminButtons
            });
          } catch (sendErr) {
            console.error(`Failed to send admin notification to ${currentAdminId}:`, sendErr.message);
            await ctx.telegram.sendMessage(currentAdminId, fitTelegramText(adminCaption, false), {
              parse_mode: 'HTML',
              ...adminButtons
            }).catch(() => {});
          }
        }

        delete userState[userId];
        await replyTracked(ctx, userId,
          `⏳ <b>تم استلام وصل الدفع وحفظ طلبك برقم (#${requestId})!</b>\n🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\nالإعلان قيد المراجعة من طرف الإدارة وسيتم نشره فور تأكيد التحويل.`,
          { parse_mode: 'HTML', ...getMainMenuKeyboard(userId, unreadCount) },
          true
        );
      } catch (err) {
        console.error('Receipt publish error:', err);
        delete userState[userId];
        await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', getMainMenuKeyboard(userId, unreadCount), true);
      }
    }
  });

  bot.on('video', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    await safeDeleteUserMessage(ctx);

    if (state && state.step === 'client_following_up_inquiry') {
      const parentId = state.data?.parentInquiryId;
      const savedFollow = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        ctx.message.caption || '🎥 فيديو مرفق من العميل',
        null,
        'video',
        { fileId: ctx.message.video.file_id, caption: ctx.message.caption || '' },
        parentId || null
      );
      delete userState[userId];
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      return replyTracked(
        ctx,
        userId,
        `✅ <b>تم إرسال الفيديو وتسجيل متابعتك للإدارة${followRef}.</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['📨 استعلاماتي وردود الإدارة', '⬅️ لوحة العميل'],
            ['🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    if (state && state.step === 'waiting_for_media') {
      const video = ctx.message.video;
      state.data.media_items = state.data.media_items || [];

      if (state.data.media_items.length >= MAX_PROPERTY_IMAGES) {
        const warnMsg = await ctx.reply(`⚠️ <b>وصلت للحد الأقصى (${MAX_PROPERTY_IMAGES} ملفات).</b> اضغط زر الإنهاء في الأسفل.`, { parse_mode: 'HTML' });
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
        return;
      }

      state.data.media_items.push({ type: 'video', file_id: video.file_id });
      state.data.media_label = formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId);
    }
  });

  return { openUserHome };
};
