  // =========================================================================
  // 📨 دوال حفظ ومعاينة استعلامات المستخدم (user_inquiries + inquiry_replies)
  // =========================================================================
  const clientInquiryBrowse = {};

  const CLIENT_INQUIRY_STATUS = {
    open: '🆕 مفتوح (بانتظار الرد)',
    in_progress: '⏳ قيد المعالجة (تم الرد)',
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

  // تحديث لوحة العميل لتشمل زر "📨 استعلاماتي وردود الإدارة"
  function getSupportHubKeyboard() {
    return Markup.keyboard([
      ['👤 ملفي الشخصي ورصيدي', '📋 إعلاناتي وحالتها'],
      ['🗂 تصفح إعلاناتي الخاصة', '📨 استعلاماتي وردود الإدارة'],
      ['💬 دعم واقتراحات وشكر', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  async function fetchClientInquiriesByUserId(userId) {
    try {
      const { data, error } = await supabase
        .from('user_inquiries')
        .select('*')
        .eq('user_id', userId)
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

  function formatClientInquiryCard(inquiry, replies, idx, total) {
    const statusText = CLIENT_INQUIRY_STATUS[inquiry.status] || escapeHtml(inquiry.status || 'open');
    const roleText = CLIENT_ROLE_NAMES[inquiry.target_role] || escapeHtml(inquiry.target_role || 'الدعم العام');
    const propLine = inquiry.property_id ? `🏠 <b>الإعلان المرتبط:</b> <code>#${inquiry.property_id}</code>\n` : '';
    const subjectLine = inquiry.subject ? `📌 <b>الموضوع:</b> ${escapeHtml(inquiry.subject)}\n` : '';

    const hasReplies = Array.isArray(replies) && replies.length > 0;
    const replyBanner = hasReplies
      ? `✅ <b>حالة الرد:</b> تم الرد (${replies.length} ${replies.length === 1 ? 'رد' : 'ردود'})\n`
      : `⏳ <b>حالة الرد:</b> لم يتم الرد بعد — بانتظار الإدارة\n`;

    let repliesSection = `\n💬 <b>سجل ردود الإدارة:</b>\n`;
    if (!hasReplies) {
      repliesSection += `<i>— لا توجد ردود مسجلة بعد، سيصلك إشعار فور رد الإدارة —</i>`;
    } else {
      repliesSection += replies.map((rep, rIdx) => {
        const repTime = formatDateTime(rep.created_at);
        const repRole = CLIENT_ROLE_NAMES[rep.admin_role] || 'الإدارة';
        const repBody = escapeHtml(
          rep.reply_message ||
          (rep.media_type === 'photo' ? '🖼 صورة مرفقة' : rep.media_type === 'video' ? '🎥 فيديو مرفق' : '')
        );
        return `${rIdx + 1}. <b>[${repRole}]</b> • <code>${escapeHtml(repTime)}</code>:\n   ↳ ${repBody}`;
      }).join('\n');
    }

    const text =
      `📨 <b>استعلاماتي (ID: <code>${inquiry.user_id}</code>)</b> • <code>#${inquiry.id}</code> (${idx + 1} من ${total})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>الحالة:</b> ${statusText}\n` +
      replyBanner +
      `🎯 <b>القسم المختص:</b> ${roleText}\n` +
      propLine +
      `🕒 <b>التاريخ:</b> <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      subjectLine +
      `📝 <b>نص استعلامك:</b>\n${escapeHtml(inquiry.message || '')}\n` +
      `━━━━━━━━━━━━━━━━━━━━` +
      repliesSection;

    return text.length > 3950 ? text.slice(0, 3940) + '\n…' : text;
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
        `📭 <b>لا توجد استعلامات مسجلة لحسابك (<code>${userId}</code>) حتى الآن.</b>`,
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

    const cardText = formatClientInquiryCard(currentInquiry, replies, safeIdx, st.items.length);
    const kb = getClientInquiriesKeyboard(safeIdx, st.items.length, currentInquiry);

    const sent = await ctx.reply(cardText, { parse_mode: 'HTML', ...kb }).catch(() => null);
    const keepIds = sent?.message_id ? [sent.message_id] : [];
    if (sent?.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }
