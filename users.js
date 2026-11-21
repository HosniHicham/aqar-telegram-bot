  // =========================================================================
  // 📨 إضافة احترافية: لوحة متابعة استفسارات العميل وردود الإدارة
  // - تعتمد على user_id لعرض كل استفسارات العميل من user_inquiries
  // - تجلب كل الردود المرتبطة بـ inquiry_id من inquiry_replies
  // - تحفظ الاستفسارات الجديدة فعلياً في user_inquiries وتتيح متابعة الردود
  // =========================================================================
  const clientInquiryBrowse = {};

  const CLIENT_INQUIRY_STATUS = {
    open: '🆕 مفتوح (بانتظار الرد)',
    in_progress: '⏳ قيد المعالجة (تم التفاعل)',
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

  function inferTargetRoleFromInquiry(inquiryKey = '', titleText = '') {
    const src = `${inquiryKey} ${titleText}`.toLowerCase();
    if (/payment|دفع|وصل|baridimob|ccp/.test(src)) return 'payments_admin';
    if (/points|نقاط|مكافآت|رصيد/.test(src)) return 'points_admin';
    if (/reject|pending|remind|re_review|no_contact|ad_note|إعلان|معلق|مرفوض|مراجعة|تذكير/.test(src)) {
      return 'ads_reviewer';
    }
    return 'general_support';
  }

  async function createUserInquiryRecord({
    userId,
    propertyId = null,
    propertySource = null,
    inquiryType = 'general',
    targetRole = 'general_support',
    subject = null,
    message = ''
  }) {
    try {
      const cleanPropId = propertyId && Number.isFinite(Number(propertyId)) && Number(propertyId) > 0
        ? Number(propertyId)
        : null;

      const { data, error } = await supabase
        .from('user_inquiries')
        .insert([{
          user_id: userId,
          property_id: cleanPropId,
          property_source: cleanPropId ? (propertySource || 'pending_properties') : null,
          inquiry_type: inquiryType,
          target_role: targetRole,
          subject,
          message: message || subject || 'استفسار من العميل',
          status: 'open'
        }])
        .select()
        .single();

      if (error) {
        console.error('createUserInquiryRecord error:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.error('createUserInquiryRecord exception:', e);
      return null;
    }
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
      console.error('fetchClientInquiriesByUserId error:', e);
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
    const propLine = inquiry.property_id
      ? `🏠 <b>الإعلان المرتبط:</b> <code>#${inquiry.property_id}</code>\n`
      : '';
    const subjectLine = inquiry.subject
      ? `📌 <b>الموضوع:</b> ${escapeHtml(inquiry.subject)}\n`
      : '';

    const hasReplies = Array.isArray(replies) && replies.length > 0;
    const replyStateBanner = hasReplies
      ? `✅ <b>حالة الرد:</b> تم الرد (${replies.length} ${replies.length === 1 ? 'رد' : 'ردود'})\n`
      : `⏳ <b>حالة الرد:</b> لم يتم الرد بعد — بانتظار الإدارة\n`;

    let repliesSection = `\n💬 <b>سجل ردود الإدارة:</b>\n`;
    if (!hasReplies) {
      repliesSection += `<i>— لا توجد ردود حتى الآن على هذا الاستعلام، وسيصلك الإشعار فور رد الإدارة —</i>`;
    } else {
      repliesSection += replies.map((rep, rIdx) => {
        const repTime = formatDateTime(rep.created_at);
        const repRole = CLIENT_ROLE_NAMES[rep.admin_role] || 'الإدارة';
        const repBody = escapeHtml(
          rep.reply_message ||
          (rep.media_type === 'photo' ? '🖼 مرفق صورة من الإدارة' : rep.media_type === 'video' ? '🎥 مرفق فيديو من الإدارة' : '')
        );
        return `${rIdx + 1}. <b>[${repRole}]</b> • <code>${escapeHtml(repTime)}</code>:\n   ↳ ${repBody}`;
      }).join('\n');
    }

    const combined =
      `📨 <b>استفساراتي (ID: <code>${inquiry.user_id}</code>)</b> • <code>#${inquiry.id}</code> (${idx + 1} من ${total})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>الحالة:</b> ${statusText}\n` +
      replyStateBanner +
      `🎯 <b>القسم المختص:</b> ${roleText}\n` +
      propLine +
      `🕒 <b>تاريخ الإرسال:</b> <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      subjectLine +
      `📝 <b>نص استفسارك:</b>\n${escapeHtml(inquiry.message || '')}\n` +
      `━━━━━━━━━━━━━━━━━━━━` +
      repliesSection;

    return combined.length > 3950 ? combined.slice(0, 3940) + '\n…' : combined;
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
        `📭 <b>لا توجد استفسارات مسجلة لحسابك (<code>${userId}</code>) حتى الآن.</b>\n\nيمكنك إرسال استفسار جديد من <b>"💬 دعم واقتراحات وشكر"</b> أو من بطاقة أي إعلان خاص بك.`,
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

  // زر فتح لوحة متابعة الاستفسارات للعميل
  bot.hears('📨 استفساراتي وردود الإدارة', async (ctx) => {
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

  // متابعة استعلام قائم من طرف العميل
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
      `💬 <b>متابعة الاستعلام رقم</b> <code>#${parentInquiryId}</code>\n\nاكتب رسالتك الإضافية أو توضيحك ليتم تسجيله وإرساله للإدارة:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['📨 استفساراتي وردود الإدارة', '⬅️ لوحة العميل']]).resize()
      },
      true
    );
  });

  // ربط إنشاء الاستعلامات الجديدة بجدول user_inquiries عند استفسارات الإعلانات
  const _origProcessAdInquiryAction = processAdInquiryAction;
  processAdInquiryAction = async function (ctx, userId, actionLabel, reqId) {
    const s = supportUserSession[userId];
    const adsList = s?.ads || await fetchUserOwnedAds(userId);
    const relatedAd = adsList.find(a => String(a.id) === String(reqId)) || s?.selectedAd || null;
    const roleGuess = inferTargetRoleFromInquiry(actionLabel, actionLabel);

    const created = await createUserInquiryRecord({
      userId,
      propertyId: relatedAd?.id || reqId,
      propertySource: relatedAd?.source || 'pending_properties',
      inquiryType: 'ad_inquiry',
      targetRole: roleGuess,
      subject: actionLabel,
      message: `${actionLabel} — بخصوص الإعلان رقم #${reqId}.`
    });

    await _origProcessAdInquiryAction(ctx, userId, actionLabel, reqId);

    if (created?.id) {
      await ctx.reply(
        `🗂 <b>رقم متابعة استفسارك:</b> <code>#${created.id}</code> — يمكنك تتبعه والاطلاع على ردود الإدارة من <b>"📨 استفساراتي وردود الإدارة"</b>.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  };

  // ربط فئات الدعم السريع بجدول user_inquiries
  bot.hears(
    ['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري', '🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين', '👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'],
    async (ctx, next) => {
      const userId = ctx.from.id;
      const chosenCat = ctx.message.text.trim();
      const roleGuess = inferTargetRoleFromInquiry('', chosenCat);
      await createUserInquiryRecord({
        userId,
        inquiryType: 'support_category',
        targetRole: roleGuess,
        subject: chosenCat,
        message: QUICK_SUPPORT_PRESETS[chosenCat] || chosenCat
      });
      return next();
    }
  );

  // التقاط نص المتابعة للعميل على استعلام قائم
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const text = ctx.message.text ? ctx.message.text.trim() : '';

    if (state && state.step === 'client_following_up_inquiry' && text && !text.startsWith('/')) {
      await safeDeleteUserMessage(ctx);
      const parentId = state.data?.parentInquiryId;

      const createdFollowUp = await createUserInquiryRecord({
        userId,
        inquiryType: 'follow_up',
        targetRole: 'general_support',
        subject: parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        message: text
      });

      await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        text,
        null,
        'text',
        {},
        parentId || null
      );

      delete userState[userId];
      const followCode = createdFollowUp?.id ? ` (رقم المتابعة: <code>#${createdFollowUp.id}</code>)` : '';
      await replyTracked(
        ctx,
        userId,
        `✅ <b>تم إرسال متابعتك إلى الإدارة بنجاح</b>${followCode}.\nيمكنك الاطلاع على سجل استفساراتك والردود من <b>"📨 استفساراتي وردود الإدارة"</b>.`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['📨 استفساراتي وردود الإدارة', '⬅️ لوحة العميل'],
            ['🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
      return;
    }

    return next();
  });

  // إضافة زر "📨 استفساراتي وردود الإدارة" تلقائياً في لوحة العميل دون تعديل تعريفها الأصلي
  const _origGetSupportHubKeyboard = getSupportHubKeyboard;
  getSupportHubKeyboard = function () {
    return Markup.keyboard([
      ['👤 ملفي الشخصي ورصيدي', '📋 إعلاناتي وحالتها'],
      ['🗂 تصفح إعلاناتي الخاصة', '📨 استفساراتي وردود الإدارة'],
      ['💬 دعم واقتراحات وشكر', '🏠 القائمة الرئيسية']
    ]).resize();
  };
