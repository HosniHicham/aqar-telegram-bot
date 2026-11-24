'use strict';
// =========================================================================
// 🛡️ SERVER ADMIN — لوحة تحكم الإدارة
// - تصفح صور وفيديوهات الإعلانات بنفس أسلوب التصفح السلس
// - التنقل بين الإعلانات (المعلقة / المنشورة / المرفوضة / البحث)
// - إدارة ومعاينة استعلامات المستخدمين (user_inquiries) وسجل الردود (inquiry_replies)
// - المرفق في الاستعلام والرد مدمج داخل نفس الرسالة (caption) بدون رسائل مرفق منفصلة
// - مراسلة ناشر الإعلان بخصوص الإعلان (#ID) في كل الحالات (بما فيها المنشورة)
// - اعتماد ورفض طلبات الشحن المسبق (wallet_topups) وتحديث رصيد المحفظة (wallet_balance)
// =========================================================================

module.exports = function registerAdmin(bot, core) {
  const {
    Markup, supabase, userState,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getAdminIds, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml, fitTelegramText,
    normalizeMediaRef, parseImagesFromImageUrl, parseMediaListFromField, buildOrderedBrowsingMedia,
    getWebsiteButton,
    runSingleKnockWithSmartWake
  } = core;

  const adminBrowseState = {};
  const adminInquiryState = {};

  const ROLE_LABELS = {
    ads_reviewer: '🏠 مراجعة الإعلانات',
    payments_admin: '💳 مسؤول الدفع',
    points_admin: '🪙 مسؤول النقاط',
    general_support: '💬 الدعم العام',
    super_admin: '👑 الإدارة العامة'
  };

  const INQUIRY_STATUS_LABELS = {
    open: '🆕 مفتوح',
    in_progress: '⏳ قيد المعالجة',
    resolved: '✅ تم الحل',
    closed: '🔒 مغلق'
  };

  function getAdminMenuKeyboard() {
    const rows = [
      ['⏳ المعلقة', '✅ المنشورة', '❌ المرفوضة'],
      ['📩 الاستعلامات', '🔎 بحث سريع', '📊 الإحصائيات'],
      ['👁 معاينة المنصة كمستخدم']
    ];
    const webBtn = getWebsiteButton();
    if (webBtn) rows.push([webBtn]);
    return Markup.keyboard(rows).resize();
  }

  function getAdminBrowsingKeyboard(idx, total, filterType, currentItem = null, mediaIdx = 0, totalMedia = 0) {
    const rows = [];

    if (totalMedia > 1) {
      const mediaRow = [];
      if (mediaIdx > 0) mediaRow.push('🖼 الصورة السابقة');
      mediaRow.push(`📸 عنصر ${mediaIdx + 1} / ${totalMedia}`);
      if (mediaIdx < totalMedia - 1) mediaRow.push('الصورة التالية 🖼');
      rows.push(mediaRow);
    }

    const navRow = [];
    if (idx > 0) navRow.push('⬅️ السابق');
    navRow.push(`📄 ${idx + 1} / ${total}`);
    if (idx < total - 1) navRow.push('التالي ➡️');
    if (navRow.length > 0) rows.push(navRow);

    if (currentItem && currentItem.id && (currentItem.user_id || currentItem._resolvedUserId)) {
      rows.push([`✉️ مراسلة بخصوص #${currentItem.id}`]);
    }

    rows.push(['📩 الاستعلامات', '🔎 بحث سريع', '🎛 لوحة الإدارة']);
    rows.push(['👁 معاينة المنصة كمستخدم']);

    const webBtn = getWebsiteButton();
    if (webBtn && filterType) rows.push([webBtn]);

    return Markup.keyboard(rows).resize();
  }

  function getAdminInquiriesKeyboard(idx, total, currentInquiry = null) {
    const rows = [];

    const navRow = [];
    if (idx > 0) navRow.push('⬅️ الاستعلام السابق');
    navRow.push(`📋 ${idx + 1} / ${total}`);
    if (idx < total - 1) navRow.push('الاستعلام التالي ➡️');
    if (navRow.length > 0) rows.push(navRow);

    if (currentInquiry && currentInquiry.id) {
      rows.push([`💬 الرد على الاستعلام #${currentInquiry.id}`]);
    }

    rows.push(['🆕 المفتوحة', '⏳ قيد المعالجة', '✅ المحلولة', '📂 كل الاستعلامات']);
    rows.push(['🎛 لوحة الإدارة', '👁 معاينة المنصة كمستخدم']);

    return Markup.keyboard(rows).resize();
  }

  function getAdminSearchKeyboard() {
    return Markup.keyboard([
      ['🎛 لوحة الإدارة', '👁 معاينة المنصة كمستخدم']
    ]).resize();
  }

  async function countRows(table, filter) {
    try {
      let q = supabase.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = q.eq(filter[0], filter[1]);
      const { count } = await Promise.race([
        q,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      return count ?? 0;
    } catch (e) {
      return 0;
    }
  }

  async function getFullAdminStats() {
    const [pending, published, rejected, usersCount, openInquiries, inProgressInquiries] = await Promise.all([
      countRows('pending_properties', ['status', 'pending']),
      countRows('test_messages'),
      countRows('pending_properties', ['status', 'rejected']),
      countRows('users'),
      countRows('user_inquiries', ['status', 'open']),
      countRows('user_inquiries', ['status', 'in_progress'])
    ]);
    return {
      pending,
      published,
      rejected,
      usersCount,
      activeInquiries: openInquiries + inProgressInquiries,
      openInquiries,
      inProgressInquiries
    };
  }

  async function resolveAdOwnerUserId(item) {
    if (!item) return null;
    if (item.user_id) return Number(item.user_id);
    if (item._resolvedUserId) return Number(item._resolvedUserId);

    try {
      let q = supabase
        .from('pending_properties')
        .select('user_id')
        .order('id', { ascending: false })
        .limit(1);

      if (item.phone) {
        q = q.eq('phone', String(item.phone).replace(/\D/g, '').trim());
      } else if (item.property_type && item.state_name) {
        q = q.eq('property_type', item.property_type).eq('state_name', item.state_name);
      } else {
        return null;
      }

      const { data } = await q;
      if (Array.isArray(data) && data.length > 0 && data[0].user_id) {
        item._resolvedUserId = Number(data[0].user_id);
        return item._resolvedUserId;
      }
    } catch (e) {}

    return null;
  }

  async function openAdminHome(ctx, showStatsNotice = false) {
    const adminId = ctx.from.id;
    delete userState[adminId];
    delete adminBrowseState[adminId];
    delete adminInquiryState[adminId];
    core.resetSessions(adminId);

    const stats = typeof runSingleKnockWithSmartWake === 'function'
      ? await runSingleKnockWithSmartWake(ctx, adminId, () => getFullAdminStats(), {
          connectingText: '⏳ <b>لحظات من فضلك، جاري تجهيز لوحة الإدارة...</b>',
          backLabel: '🎛 لوحة الإدارة'
        })
      : await getFullAdminStats();

    const name = escapeHtml(ctx.from.first_name || 'المدير');

    const text =
      `🛡 <b>لوحة تحكم الإدارة</b>${showStatsNotice ? ' • <b>تقرير الإحصائيات</b>' : ''}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `مرحباً <b>${name}</b>، إليك ملخص المنصة:\n\n` +
      `⏳ <b>إعلانات قيد المراجعة:</b> <b>${stats.pending}</b>\n` +
      `✅ <b>إعلانات منشورة:</b> <b>${stats.published}</b>\n` +
      `❌ <b>إعلانات مرفوضة:</b> <b>${stats.rejected}</b>\n` +
      `📩 <b>استعلامات نشطة:</b> <b>${stats.activeInquiries}</b> (🆕 ${stats.openInquiries} | ⏳ ${stats.inProgressInquiries})\n` +
      `👥 <b>الأعضاء المسجلون:</b> <b>${stats.usersCount}</b>`;

    await replyTracked(ctx, adminId, text, { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
  }

  async function fetchAdminInquiries(statusFilter = 'all') {
    try {
      let q = supabase
        .from('user_inquiries')
        .select('*')
        .order('id', { ascending: false })
        .limit(100);

      if (statusFilter === 'open') {
        q = q.eq('status', 'open');
      } else if (statusFilter === 'in_progress') {
        q = q.eq('status', 'in_progress');
      } else if (statusFilter === 'done') {
        q = q.in('status', ['resolved', 'closed']);
      }

      const { data, error } = await q;
      if (error || !data) return [];
      return data;
    } catch (e) {
      console.error('fetchAdminInquiries error:', e);
      return [];
    }
  }

  async function fetchInquiryReplies(inquiryId) {
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

  function buildInquiryInlineButtons(inquiry) {
    const id = inquiry.id;
    const rows = [
      [Markup.button.callback(`💬 الرد على الاستعلام (#${id})`, `inq_reply_${id}`)]
    ];

    const statusRow = [];
    if (inquiry.status !== 'resolved') {
      statusRow.push(Markup.button.callback('✅ تم الحل', `inq_status_resolved_${id}`));
    }
    if (inquiry.status !== 'closed') {
      statusRow.push(Markup.button.callback('🔒 إغلاق', `inq_status_closed_${id}`));
    }
    if (inquiry.status === 'resolved' || inquiry.status === 'closed') {
      statusRow.push(Markup.button.callback('♻️ إعادة فتح', `inq_status_open_${id}`));
    }
    if (statusRow.length > 0) rows.push(statusRow);

    return Markup.inlineKeyboard(rows);
  }

  function formatInquiryCardText(inquiry, replies, idx, total, statusFilter, isMediaCaption = false) {
    const filterTitles = {
      all: '📂 كل الاستعلامات',
      open: '🆕 الاستعلامات المفتوحة',
      in_progress: '⏳ قيد المعالجة',
      done: '✅ المحلولة والمغلقة'
    };

    const roleLabel = ROLE_LABELS[inquiry.target_role] || escapeHtml(inquiry.target_role || 'غير محدد');
    const statusLabel = INQUIRY_STATUS_LABELS[inquiry.status] || escapeHtml(inquiry.status || 'open');
    const propLine = inquiry.property_id
      ? `🏠 <b>الإعلان:</b> <code>#${inquiry.property_id}</code>\n`
      : '';
    const subjectLine = inquiry.subject ? `📌 <b>الموضوع:</b> ${escapeHtml(inquiry.subject)}\n` : '';

    let repliesBlock = `\n💬 <b>الردود (${replies.length}):</b>\n`;
    if (!replies || replies.length === 0) {
      repliesBlock += `<i>— لا توجد ردود بعد —</i>`;
    } else {
      const formattedReplies = replies.map((r, rIdx) => {
        const rRole = ROLE_LABELS[r.admin_role] || r.admin_role || 'مسؤول';
        const rTime = formatDateTime(r.created_at);
        const rMsg = escapeHtml(
          r.reply_message ||
          (r.media_type === 'photo' ? '🖼 صورة مرفقة' : r.media_type === 'video' ? '🎥 فيديو مرفق' : '')
        );
        return `${rIdx + 1}. <b>[${rRole}]</b> (<code>${escapeHtml(rTime)}</code>): ${rMsg}`;
      });
      repliesBlock += formattedReplies.join('\n');
    }

    const fullText =
      `${filterTitles[statusFilter] || '📩 الاستعلامات'} • <code>#${inquiry.id}</code> (${idx + 1}/${total})\n` +
      `📊 <b>الحالة:</b> ${statusLabel} | 🎯 ${roleLabel}\n` +
      `👤 <b>العميل:</b> <code>${inquiry.user_id}</code> • 🕒 <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      propLine +
      subjectLine +
      `📝 <b>الاستعلام:</b> ${escapeHtml(inquiry.message || '')}` +
      repliesBlock;

    return fitTelegramText(fullText, isMediaCaption);
  }

  async function renderAdminInquiryAt(ctx, adminId, statusFilter = 'all', index = 0, refreshList = false) {
    delete adminBrowseState[adminId];
    let st = adminInquiryState[adminId];

    if (!st || st.statusFilter !== statusFilter || refreshList) {
      const items = typeof runSingleKnockWithSmartWake === 'function'
        ? await runSingleKnockWithSmartWake(ctx, adminId, () => fetchAdminInquiries(statusFilter), {
            connectingText: '⏳ <b>لحظات من فضلك، جاري تحميل الاستعلامات...</b>',
            backLabel: '🎛 لوحة الإدارة'
          })
        : await fetchAdminInquiries(statusFilter);
      st = { statusFilter, items, index: 0 };
      adminInquiryState[adminId] = st;
    }

    if (!st.items || st.items.length === 0) {
      delete adminInquiryState[adminId];
      return replyTracked(
        ctx, adminId,
        `📭 <b>لا توجد استعلامات في هذه الفئة حالياً.</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['🆕 المفتوحة', '⏳ قيد المعالجة', '✅ المحلولة', '📂 كل الاستعلامات'],
            ['🎛 لوحة الإدارة']
          ]).resize()
        },
        true
      );
    }

    let safeIdx = Number(index) || 0;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= st.items.length) safeIdx = st.items.length - 1;
    st.index = safeIdx;

    const inquiry = st.items[safeIdx];
    const replies = await fetchInquiryReplies(inquiry.id);

    const inlineKb = buildInquiryInlineButtons(inquiry);
    const bottomKb = getAdminInquiriesKeyboard(safeIdx, st.items.length, inquiry);

    const latestMediaReply = [...replies].reverse().find(r => r.attachment_url && (r.media_type === 'photo' || r.media_type === 'video'));
    const replyAttach = latestMediaReply ? normalizeMediaRef(latestMediaReply.attachment_url) : null;
    const inqAttach = normalizeMediaRef(inquiry.attachment_url);

    const attachedMedia = replyAttach
      ? { type: latestMediaReply.media_type === 'video' ? 'video' : 'photo', ref: replyAttach }
      : (inqAttach ? { type: 'photo', ref: inqAttach } : null);

    let sentCard = null;
    if (attachedMedia) {
      const mediaCaption = formatInquiryCardText(inquiry, replies, safeIdx, st.items.length, statusFilter, true);
      try {
        sentCard = attachedMedia.type === 'video'
          ? await ctx.replyWithVideo(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...inlineKb })
          : await ctx.replyWithPhoto(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...inlineKb });
      } catch (e) {
        console.error('renderAdminInquiryAt media card error:', e.message);
      }
    }

    if (!sentCard) {
      const textCard = formatInquiryCardText(inquiry, replies, safeIdx, st.items.length, statusFilter, false);
      sentCard = await ctx.reply(textCard, { parse_mode: 'HTML', ...inlineKb }).catch(() => null);
    }

    const ctrlMsg = await ctx.reply(`🧭 <b>استعلام ${safeIdx + 1} / ${st.items.length}</b>`, {
      parse_mode: 'HTML',
      ...bottomKb
    }).catch(() => null);

    const keepIds = [];
    if (sentCard?.message_id) {
      keepIds.push(sentCard.message_id);
      trackBotMessage(adminId, ctx.chat.id, sentCard.message_id);
    }
    if (ctrlMsg?.message_id) {
      keepIds.push(ctrlMsg.message_id);
      trackBotMessage(adminId, ctx.chat.id, ctrlMsg.message_id);
    }

    await clearTrackedBotMessages(ctx, adminId, keepIds);
  }

  async function saveInquiryReplyAndNotifyUser(ctx, adminId, inquiryId, payloadType, content) {
    const { data: inquiry, error: fetchErr } = await supabase
      .from('user_inquiries')
      .select('*')
      .eq('id', inquiryId)
      .single();

    if (fetchErr || !inquiry) {
      delete userState[adminId];
      return replyTracked(ctx, adminId, `⚠️ الاستعلام <code>#${inquiryId}</code> غير موجود.`, {
        parse_mode: 'HTML', ...getAdminMenuKeyboard()
      }, true);
    }

    const rawCaption = payloadType === 'text' ? content.text : (content.caption || '');
    const replyText = rawCaption || (payloadType === 'photo' ? '🖼 صورة مرفقة' : payloadType === 'video' ? '🎥 فيديو مرفق' : '');
    const attachmentUrl = payloadType === 'text' ? null : `tg:${content.fileId}`;

    const { error: insertReplyErr } = await supabase.from('inquiry_replies').insert([{
      inquiry_id: inquiryId,
      admin_id: adminId,
      admin_role: inquiry.target_role || 'general_support',
      reply_message: replyText || null,
      media_type: payloadType,
      attachment_url: attachmentUrl
    }]);

    if (insertReplyErr) {
      console.error('insert inquiry_replies error:', insertReplyErr);
      delete userState[adminId];
      return replyTracked(ctx, adminId,
        `⚠️ تعذر حفظ الرد في قاعدة البيانات: <code>${escapeHtml(insertReplyErr.message)}</code>`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
    }

    if (inquiry.status === 'open') {
      await supabase.from('user_inquiries').update({ status: 'in_progress' }).eq('id', inquiryId);
    }

    const propLine = inquiry.property_id ? `🏠 <b>بخصوص الإعلان:</b> <code>#${inquiry.property_id}</code>\n` : '';
    const userHeader =
      `📩 <b>رد من إدارة عقار الجزائر على استعلامك #${inquiryId}</b>\n` +
      propLine +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    let delivered = true;
    let deliverErrorReason = '';
    try {
      if (payloadType === 'photo') {
        const cap = fitTelegramText(
          userHeader + (rawCaption ? escapeHtml(rawCaption) : '🖼 <i>صورة مرفقة من الإدارة</i>'),
          true
        );
        await ctx.telegram.sendPhoto(inquiry.user_id, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else if (payloadType === 'video') {
        const cap = fitTelegramText(
          userHeader + (rawCaption ? escapeHtml(rawCaption) : '🎥 <i>فيديو مرفق من الإدارة</i>'),
          true
        );
        await ctx.telegram.sendVideo(inquiry.user_id, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else {
        await ctx.telegram.sendMessage(
          inquiry.user_id,
          fitTelegramText(userHeader + escapeHtml(replyText), false),
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      delivered = false;
      deliverErrorReason = e?.message || 'خطأ في الإرسال';
      console.error('deliver inquiry reply to user failed:', deliverErrorReason);
    }

    delete userState[adminId];
    const deliveryNote = delivered
      ? `✅ <b>تم حفظ الرد في سجل الاستعلام #${inquiryId} وإرساله للعميل بنجاح.</b>`
      : `✅ <b>تم حفظ الرد في سجل الاستعلام #${inquiryId}</b> (⚠️ تعذر الإرسال المباشر للعميل: <code>${escapeHtml(deliverErrorReason)}</code>).`;

    await ctx.reply(deliveryNote, { parse_mode: 'HTML' }).catch(() => {});

    const st = adminInquiryState[adminId];
    return renderAdminInquiryAt(ctx, adminId, st?.statusFilter || 'all', st?.index || 0, true);
  }

  async function fetchAdminAdsByFilter(filterType) {
    if (filterType === 'published') {
      const { data, error } = await supabase
        .from('test_messages')
        .select('*')
        .order('id', { ascending: false })
        .limit(100);
      if (error || !data) return [];
      return data.map(row => ({ ...row, _filterType: 'published' }));
    }

    const statusVal = filterType === 'rejected' ? 'rejected' : 'pending';
    const { data, error } = await supabase
      .from('pending_properties')
      .select('*')
      .eq('status', statusVal)
      .order('id', { ascending: filterType === 'pending' })
      .limit(100);

    if (error || !data) return [];
    const list = filterType === 'rejected' ? data.reverse() : data;
    return list.map(row => ({ ...row, _filterType: statusVal }));
  }

  async function searchAdminAds(rawQuery) {
    const cleanQuery = String(rawQuery || '').replace(/^#/, '').trim();
    if (!cleanQuery) return [];

    const digitsOnly = cleanQuery.replace(/\D/g, '');
    const results = [];
    const seenKeys = new Set();

    const addResults = (rows, filterType) => {
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const key = `${filterType}:${row.id}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        results.push({ ...row, _filterType: filterType });
      }
    };

    try {
      if (digitsOnly) {
        const numId = Number(digitsOnly);
        if (Number.isSafeInteger(numId) && numId > 0) {
          const { data: pById } = await supabase
            .from('pending_properties').select('*').eq('id', numId);
          if (Array.isArray(pById)) {
            for (const r of pById) addResults([r], r.status === 'rejected' ? 'rejected' : 'pending');
          }

          const { data: pubById } = await supabase
            .from('test_messages').select('*').eq('id', numId);
          addResults(pubById, 'published');
        }
      }

      const { data: pendingAll } = await supabase
        .from('pending_properties')
        .select('*')
        .order('id', { ascending: false })
        .limit(300);

      if (Array.isArray(pendingAll)) {
        const matchedPending = pendingAll.filter(r => {
          const phoneStr = String(r.phone || '');
          const userIdStr = String(r.user_id || '');
          return (
            (digitsOnly && (phoneStr.includes(digitsOnly) || userIdStr === digitsOnly)) ||
            phoneStr.includes(cleanQuery) ||
            userIdStr === cleanQuery
          );
        });
        for (const r of matchedPending) {
          addResults([r], r.status === 'rejected' ? 'rejected' : 'pending');
        }
      }

      const { data: pubAll } = await supabase
        .from('test_messages')
        .select('*')
        .order('id', { ascending: false })
        .limit(300);

      if (Array.isArray(pubAll)) {
        const matchedPub = pubAll.filter(r => {
          const phoneStr = String(r.phone || '');
          const userIdStr = String(r.user_id || '');
          return (
            (digitsOnly && (phoneStr.includes(digitsOnly) || userIdStr === digitsOnly)) ||
            phoneStr.includes(cleanQuery) ||
            userIdStr === cleanQuery
          );
        });
        addResults(matchedPub, 'published');
      }
    } catch (e) {
      console.error('searchAdminAds error:', e);
    }

    return results;
  }

  function buildAdInlineButtons(item, filterType) {
    const rows = [];
    const adId = item.id;

    if (filterType === 'pending') {
      rows.push([
        Markup.button.callback(`❌ رفض (#${adId})`, `reject_${adId}`),
        Markup.button.callback(`✅ قبول ونشر (#${adId})`, `approve_${adId}`)
      ]);
    } else if (filterType === 'rejected') {
      rows.push([
        Markup.button.callback(`♻️ إعادة للمراجعة (#${adId})`, `requeue_${adId}`),
        Markup.button.callback(`✅ قبول ونشر (#${adId})`, `approve_${adId}`)
      ]);
    } else if (filterType === 'published') {
      rows.push([Markup.button.callback(`🗑 حذف المنشور (#${adId})`, `del_pub_${adId}`)]);
    }

    return rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined;
  }

  function formatAdminAdCaption(item, idx, total, filterType, stats, searchQuery = '', currentMedia = null, mediaIdx = 0, totalMedia = 0) {
    const effectiveFilter = filterType || item._filterType || 'pending';
    const titleMap = {
      pending: '⏳ <b>قيد المراجعة</b>',
      published: '✅ <b>منشور</b>',
      rejected: '❌ <b>مرفوض</b>'
    };
    const isFree = item.receipt_url === 'FREE_NO_RECEIPT';
    const typeBadge = effectiveFilter === 'published'
      ? '🌐 عرض عام'
      : (isFree ? '🆓 باقة مجانية' : '💳 مدفوع بوصل');

    const photosCount = parseImagesFromImageUrl(item.image_url).length;
    const videosCount = parseMediaListFromField(item.video_url).length;
    const ownerId = item.user_id || item._resolvedUserId || '';
    const desc = String(item.description || item.message || '');
    const searchLine = searchQuery ? `🔎 <b>نتيجة البحث:</b> <code>${escapeHtml(searchQuery)}</code>\n` : '';
    const mediaLine = totalMedia > 0
      ? `\n${currentMedia?.type === 'video' ? '🎥 فيديو' : '🖼 صورة'}: <b>${mediaIdx + 1} / ${totalMedia}</b>`
      : '';

    const rawCap =
      `${searchLine}${titleMap[effectiveFilter] || '📌 <b>إعلان</b>'} • <code>#${item.id}</code> (${idx + 1} من ${total})\n` +
      `📊 معلق: <b>${stats.pending}</b> | منشور: <b>${stats.published}</b> | مرفوض: <b>${stats.rejected}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷 <b>التصنيف:</b> ${typeBadge}\n` +
      `🕒 <b>التاريخ:</b> <code>${escapeHtml(formatDateTime(item.created_at))}</code>\n` +
      (ownerId ? `👤 <b>المعلن:</b> <code>${ownerId}</code>\n` : '') +
      `🏠 <b>العقار:</b> ${escapeHtml(item.property_type || '')} — 📍 <b>${escapeHtml(item.state_name || '')}</b>\n` +
      `💰 <b>السعر:</b> ${formatMoney(item.price)} — 📞 <code>${escapeHtml(item.phone || '')}</code>\n` +
      `🖼 <b>الصور:</b> ${photosCount} | 🎥 <b>الفيديو:</b> ${videosCount}${mediaLine}\n` +
      `📝 <b>التفاصيل:</b> ${escapeHtml(desc.length > 260 ? desc.slice(0, 260) + '…' : desc)}`;

    return fitTelegramText(rawCap, !!currentMedia);
  }

  async function renderAdminAdAt(ctx, adminId, filterType, index = 0, refreshList = false, mediaIndex = 0) {
    delete adminInquiryState[adminId];
    const stats = await getFullAdminStats();
    let st = adminBrowseState[adminId];

    if (!st || st.filter !== filterType || refreshList) {
      const items = filterType === 'search' && Array.isArray(st?.items)
        ? st.items
        : (typeof runSingleKnockWithSmartWake === 'function'
            ? await runSingleKnockWithSmartWake(ctx, adminId, () => fetchAdminAdsByFilter(filterType), {
                connectingText: '⏳ <b>لحظات من فضلك، جاري تحميل الإعلانات...</b>',
                backLabel: '🎛 لوحة الإدارة'
              })
            : await fetchAdminAdsByFilter(filterType));
      st = {
        filter: filterType,
        items,
        index: 0,
        mediaIndex: 0,
        query: filterType === 'search' ? (st?.query || '') : ''
      };
      adminBrowseState[adminId] = st;
    }

    if (!st.items || st.items.length === 0) {
      const queryNote = st?.query ? ` للعبارة: <code>${escapeHtml(st.query)}</code>` : '';
      delete adminBrowseState[adminId];
      const emptyLabels = {
        pending: 'لا توجد إعلانات بانتظار المراجعة حالياً',
        published: 'لا توجد إعلانات منشورة حالياً',
        rejected: 'لا توجد إعلانات مرفوضة حالياً',
        search: `لا توجد نتائج مطابقة${queryNote}`
      };
      return replyTracked(
        ctx, adminId,
        `📭 <b>${emptyLabels[filterType] || 'لا توجد بيانات'}.</b>\n` +
        `📊 معلق: <b>${stats.pending}</b> | منشور: <b>${stats.published}</b> | مرفوض: <b>${stats.rejected}</b>`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() },
        true
      );
    }

    let safeIdx = Number(index) || 0;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= st.items.length) safeIdx = st.items.length - 1;
    st.index = safeIdx;

    const item = st.items[safeIdx];
    await resolveAdOwnerUserId(item);

    const cardFilter = item._filterType || (filterType === 'search' ? 'pending' : filterType);

    const receiptRef = normalizeMediaRef(item.receipt_url);
    const orderedMedia = buildOrderedBrowsingMedia(item);
    const mediaList = [];
    if (receiptRef && cardFilter !== 'published') {
      mediaList.push({ type: 'photo', ref: receiptRef });
    }
    for (const m of orderedMedia) {
      if (!mediaList.some(existing => existing.ref === m.ref)) {
        mediaList.push(m);
      }
    }

    const totalMedia = mediaList.length;
    let safeMediaIdx = Number(mediaIndex) || 0;
    if (safeMediaIdx < 0) safeMediaIdx = 0;
    if (totalMedia > 0 && safeMediaIdx >= totalMedia) safeMediaIdx = totalMedia - 1;
    st.mediaIndex = safeMediaIdx;

    const currentMedia = totalMedia > 0 ? mediaList[safeMediaIdx] : null;
    const caption = formatAdminAdCaption(
      item, safeIdx, st.items.length, cardFilter, stats, st.query || '',
      currentMedia, safeMediaIdx, totalMedia
    );
    const inlineKb = buildAdInlineButtons(item, cardFilter);
    const controlKb = getAdminBrowsingKeyboard(safeIdx, st.items.length, filterType, item, safeMediaIdx, totalMedia);

    const cardExtra = inlineKb ? { caption, parse_mode: 'HTML', ...inlineKb } : { caption, parse_mode: 'HTML' };

    let sentCard = null;
    try {
      if (currentMedia) {
        sentCard = currentMedia.type === 'video'
          ? await ctx.replyWithVideo(currentMedia.ref, cardExtra)
          : await ctx.replyWithPhoto(currentMedia.ref, cardExtra);
      } else {
        sentCard = await ctx.reply(caption, cardExtra);
      }
    } catch (e) {
      sentCard = await ctx.reply(caption, cardExtra).catch(() => null);
    }

    const ctrlMsg = await ctx.reply(`🧭 <b>${safeIdx + 1} / ${st.items.length}</b>`, {
      parse_mode: 'HTML',
      ...controlKb
    }).catch(() => null);

    const keepIds = [];
    if (sentCard?.message_id) {
      keepIds.push(sentCard.message_id);
      trackBotMessage(adminId, ctx.chat.id, sentCard.message_id);
    }
    if (ctrlMsg?.message_id) {
      keepIds.push(ctrlMsg.message_id);
      trackBotMessage(adminId, ctx.chat.id, ctrlMsg.message_id);
    }

    await clearTrackedBotMessages(ctx, adminId, keepIds);
  }

  bot.start(async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openAdminHome(ctx);
  });

  bot.hears(['🎛 لوحة الإدارة', '🏠 القائمة الرئيسية', '❌ إلغاء العملية والعودة'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    delete userState[adminId];
    if (core.previewMode[adminId]) return core.modules.user.openUserHome(ctx);
    return openAdminHome(ctx);
  });

  bot.hears('👁 معاينة المنصة كمستخدم', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await core.enterPreview(ctx);
  });

  bot.hears('📊 الإحصائيات', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openAdminHome(ctx, true);
  });

  bot.hears(['📩 الاستعلامات', '📂 كل الاستعلامات'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminInquiryAt(ctx, ctx.from.id, 'all', 0, true);
  });

  bot.hears('🆕 المفتوحة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminInquiryAt(ctx, ctx.from.id, 'open', 0, true);
  });

  bot.hears('⏳ قيد المعالجة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminInquiryAt(ctx, ctx.from.id, 'in_progress', 0, true);
  });

  bot.hears('✅ المحلولة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminInquiryAt(ctx, ctx.from.id, 'done', 0, true);
  });

  bot.hears('⬅️ الاستعلام السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminInquiryState[adminId];
    if (!st) return renderAdminInquiryAt(ctx, adminId, 'all', 0, true);
    await renderAdminInquiryAt(ctx, adminId, st.statusFilter, Math.max((st.index || 0) - 1, 0), false);
  });

  bot.hears('الاستعلام التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminInquiryState[adminId];
    if (!st) return renderAdminInquiryAt(ctx, adminId, 'all', 0, true);
    await renderAdminInquiryAt(ctx, adminId, st.statusFilter, (st.index || 0) + 1, false);
  });

  bot.hears(/^📋 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminInquiryState[adminId];
    if (!st) return renderAdminInquiryAt(ctx, adminId, 'all', 0, true);
    await renderAdminInquiryAt(ctx, adminId, st.statusFilter, st.index || 0, true);
  });

  bot.hears(/^💬 الرد على الاستعلام #(\d+)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const inquiryId = Number(ctx.match[1]);

    userState[adminId] = {
      step: 'replying_to_inquiry',
      data: { inquiryId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    await replyTracked(
      ctx, adminId,
      `💬 <b>الرد على الاستعلام</b> <code>#${inquiryId}</code>\n\nاكتب ردك أو أرفق صورة/فيديو لحفظه في سجل الردود وإرساله للعميل:`,
      { parse_mode: 'HTML', ...Markup.keyboard([['📩 الاستعلامات', '🎛 لوحة الإدارة']]).resize() },
      true
    );
  });

  bot.action(/^inq_reply_(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    const inquiryId = Number(ctx.match[1]);

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }
    await ctx.answerCbQuery();

    userState[adminId] = {
      step: 'replying_to_inquiry',
      data: { inquiryId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    await replyTracked(
      ctx, adminId,
      `💬 <b>الرد على الاستعلام</b> <code>#${inquiryId}</code>\n\nاكتب ردك أو أرفق صورة/فيديو لحفظه في سجل الردود وإرساله للعميل:`,
      { parse_mode: 'HTML', ...Markup.keyboard([['📩 الاستعلامات', '🎛 لوحة الإدارة']]).resize() },
      true
    );
  });

  bot.action(/^inq_status_(open|resolved|closed)_(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    const newStatus = ctx.match[1];
    const inquiryId = Number(ctx.match[2]);

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }

    await supabase.from('user_inquiries').update({ status: newStatus }).eq('id', inquiryId);
    await ctx.answerCbQuery(`تم تحديث الحالة: ${INQUIRY_STATUS_LABELS[newStatus] || newStatus}`);

    const st = adminInquiryState[adminId];
    await renderAdminInquiryAt(ctx, adminId, st?.statusFilter || 'all', st?.index || 0, true);
  });

  bot.hears('🔎 بحث سريع', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    userState[adminId] = {
      step: 'searching_admin_ads',
      data: {},
      chatId: ctx.chat.id,
      wizardMsgId: null
    };
    await replyTracked(
      ctx, adminId,
      `🔎 <b>البحث في الإعلانات</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `أدخل <b>رقم الإعلان</b>، أو <b>رقم الهاتف</b>، أو <b>معرّف المعلن (ID)</b>:`,
      { parse_mode: 'HTML', ...getAdminSearchKeyboard() },
      true
    );
  });

  bot.hears(['⏳ المعلقة', '📥 الطلبات المعلقة'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'pending', 0, true, 0);
  });

  bot.hears('✅ المنشورة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'published', 0, true, 0);
  });

  bot.hears('❌ المرفوضة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'rejected', 0, true, 0);
  });

  bot.hears('الصورة التالية 🖼', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, st.index || 0, false, (st.mediaIndex || 0) + 1);
  });

  bot.hears('🖼 الصورة السابقة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, st.index || 0, false, Math.max((st.mediaIndex || 0) - 1, 0));
  });

  bot.hears(/^📸 عنصر \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, st.index || 0, false, st.mediaIndex || 0);
  });

  bot.hears('⬅️ السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, Math.max((st.index || 0) - 1, 0), false, 0);
  });

  bot.hears('التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, (st.index || 0) + 1, false, 0);
  });

  bot.hears(/^📄 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, st.index || 0, false, st.mediaIndex || 0);
  });

  bot.hears(/^✉️ مراسلة بخصوص #(\d+)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const adId = Number(ctx.match[1]);
    const st = adminBrowseState[adminId];
    const currentItem = st?.items?.find(i => Number(i.id) === adId) || st?.items?.[st?.index || 0];
    const targetUserId = await resolveAdOwnerUserId(currentItem);

    if (!targetUserId) {
      return replyTracked(ctx, adminId, `⚠️ لا يوجد حساب معلن مرتبط بالإعلان <code>#${adId}</code>.`, {
        parse_mode: 'HTML', ...getAdminMenuKeyboard()
      }, true);
    }

    userState[adminId] = {
      step: 'replying_to_support_user',
      data: { targetUserId, adId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    await replyTracked(
      ctx, adminId,
      `✉️ <b>مراسلة المعلن</b> <code>${targetUserId}</code> بخصوص الإعلان <code>#${adId}</code>\n\nاكتب رسالتك أو أرفق صورة/فيديو لإرسالها مباشرة:`,
      { parse_mode: 'HTML', ...Markup.keyboard([['🎛 لوحة الإدارة']]).resize() },
      true
    );
  });

  bot.action(/^support_reply_(\d+)(?:_(\d+))?$/, async (ctx) => {
    const adminId = ctx.from.id;
    const targetUserId = Number(ctx.match[1]);
    const adId = ctx.match[2] ? Number(ctx.match[2]) : null;

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }
    await ctx.answerCbQuery();

    userState[adminId] = {
      step: 'replying_to_support_user',
      data: { targetUserId, adId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const adRefText = adId ? ` بخصوص الإعلان <code>#${adId}</code>` : '';
    await replyTracked(
      ctx, adminId,
      `✉️ <b>مراسلة المعلن</b> <code>${targetUserId}</code>${adRefText}\n\nاكتب رسالتك أو أرفق صورة/فيديو لإرسالها مباشرة:`,
      { parse_mode: 'HTML', ...Markup.keyboard([['🎛 لوحة الإدارة']]).resize() },
      true
    );
  });

  async function deliverAdminReplyToUser(ctx, adminId, targetUserId, payloadType, content, adId = null) {
    const adLine = adId ? `📌 <b>بخصوص الإعلان:</b> <code>#${adId}</code>\n` : '';
    const header = `📩 <b>رسالة من إدارة عقار الجزائر</b>\n${adLine}━━━━━━━━━━━━━━━━━━━━\n`;

    try {
      if (payloadType === 'photo') {
        const cap = fitTelegramText(
          header + (content.caption ? escapeHtml(content.caption) : '🖼 <i>مرفق صورة</i>'),
          true
        );
        await ctx.telegram.sendPhoto(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else if (payloadType === 'video') {
        const cap = fitTelegramText(
          header + (content.caption ? escapeHtml(content.caption) : '🎥 <i>مرفق فيديو</i>'),
          true
        );
        await ctx.telegram.sendVideo(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else {
        await ctx.telegram.sendMessage(
          targetUserId,
          fitTelegramText(header + escapeHtml(content.text), false),
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      delete userState[adminId];
      return replyTracked(ctx, adminId,
        `⚠️ تعذر إيصال الرسالة إلى <code>${targetUserId}</code> (قد يكون أوقف استقبال الرسائل).`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
    }

    delete userState[adminId];
    const kb = core.previewMode[adminId] ? core.getMainMenuKeyboard(adminId) : getAdminMenuKeyboard();
    const doneAdText = adId ? ` بخصوص الإعلان <code>#${adId}</code>` : '';
    await replyTracked(ctx, adminId,
      `✅ <b>تم إرسال الرسالة بنجاح</b> إلى <code>${targetUserId}</code>${doneAdText}.`,
      { parse_mode: 'HTML', ...kb }, true);
  }

  bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    const text = ctx.message.text ? ctx.message.text.trim() : '';

    await safeDeleteUserMessage(ctx);

    if (text === core.WAIT_BTN_TEXT) {
      return;
    }

    if (text.startsWith('/') && text !== '/start') {
      return openAdminHome(ctx);
    }

    if (state && state.step === 'searching_admin_ads') {
      delete userState[adminId];
      const matches = await searchAdminAds(text);
      adminBrowseState[adminId] = {
        filter: 'search',
        items: matches,
        index: 0,
        mediaIndex: 0,
        query: text
      };
      return renderAdminAdAt(ctx, adminId, 'search', 0, false, 0);
    }

    if (state && state.step === 'replying_to_inquiry') {
      const inquiryId = state.data?.inquiryId;
      if (!inquiryId) {
        delete userState[adminId];
        return openAdminHome(ctx);
      }
      return saveInquiryReplyAndNotifyUser(ctx, adminId, inquiryId, 'text', { text });
    }

    if (state && state.step === 'replying_to_support_user') {
      const targetUserId = state.data?.targetUserId;
      const adId = state.data?.adId || null;
      if (!targetUserId) {
        delete userState[adminId];
        return openAdminHome(ctx);
      }
      return deliverAdminReplyToUser(ctx, adminId, targetUserId, 'text', { text }, adId);
    }

    return openAdminHome(ctx);
  });

  bot.on('photo', async (ctx, next) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    if (state && state.step === 'replying_to_inquiry') {
      await safeDeleteUserMessage(ctx);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      return saveInquiryReplyAndNotifyUser(ctx, adminId, state.data.inquiryId, 'photo', {
        fileId: photo.file_id, caption: ctx.message.caption || ''
      });
    }
    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      return deliverAdminReplyToUser(ctx, adminId, state.data.targetUserId, 'photo', {
        fileId: photo.file_id, caption: ctx.message.caption || ''
      }, state.data?.adId || null);
    }
    await safeDeleteUserMessage(ctx);
    return next();
  });

  bot.on('video', async (ctx, next) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    if (state && state.step === 'replying_to_inquiry') {
      await safeDeleteUserMessage(ctx);
      return saveInquiryReplyAndNotifyUser(ctx, adminId, state.data.inquiryId, 'video', {
        fileId: ctx.message.video.file_id, caption: ctx.message.caption || ''
      });
    }
    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      return deliverAdminReplyToUser(ctx, adminId, state.data.targetUserId, 'video', {
        fileId: ctx.message.video.file_id, caption: ctx.message.caption || ''
      }, state.data?.adId || null);
    }
    await safeDeleteUserMessage(ctx);
    return next();
  });

  async function editCard(ctx, text, replyMarkup = undefined) {
    const extra = replyMarkup ? { parse_mode: 'HTML', ...replyMarkup } : { parse_mode: 'HTML' };
    try {
      await ctx.editMessageCaption(text, extra);
    } catch (e) {
      await ctx.editMessageText(text, extra).catch(() => {});
    }
  }

  bot.action(/^(topup_approve|topup_reject)_(\d+)$/, async (ctx) => {
    const actionType = ctx.match[1];
    const topupId = Number(ctx.match[2]);
    const adminId = ctx.from.id;

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }

    try {
      const { data: topup, error } = await supabase
        .from('wallet_topups')
        .select('*')
        .eq('id', topupId)
        .single();

      if (error || !topup) {
        await ctx.answerCbQuery('⚠️ طلب الشحن غير موجود', { show_alert: true });
        return editCard(ctx, `⚠️ <b>طلب الشحن (#${topupId}) غير موجود أو تمت معالجته.</b>`);
      }

      if (topup.status !== 'pending') {
        await ctx.answerCbQuery(`ℹ️ الطلب حالته الحالية: ${topup.status}`, { show_alert: true });
        return;
      }

      const nowIso = new Date().toISOString();
      const targetUserId = Number(topup.user_id);
      const amount = sanitizeNumericPrice(topup.amount || 0);

      if (actionType === 'topup_approve') {
        const { data: targetUser } = await supabase
          .from('users')
          .select('wallet_balance')
          .eq('id', targetUserId)
          .single();

        const currentWallet = sanitizeNumericPrice(targetUser?.wallet_balance || 0);
        const newWallet = currentWallet + amount;

        const { error: balErr } = await supabase
          .from('users')
          .update({ wallet_balance: newWallet })
          .eq('id', targetUserId);

        if (balErr) throw balErr;

        await supabase
          .from('wallet_topups')
          .update({ status: 'approved', reviewed_by: adminId, reviewed_at: nowIso })
          .eq('id', topupId);

        await ctx.answerCbQuery('✅ تم اعتماد الشحن وإضافة الرصيد');

        await ctx.telegram.sendMessage(
          targetUserId,
          `🎉 <b>تمت الموافقة على طلب الشحن المسبق (#${topupId})!</b>\n` +
          `💰 <b>المبلغ المضاف:</b> +${formatMoney(amount)}\n` +
          `💼 <b>رصيد محفظتك الحالي:</b> <b>${formatMoney(newWallet)}</b>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await editCard(
          ctx,
          `✅ <b>تم اعتماد طلب الشحن (#${topupId}) وإضافة الرصيد</b>\n` +
          `👤 العميل: <code>${targetUserId}</code> • المبلغ: <b>${formatMoney(amount)}</b>\n` +
          `💼 الرصيد الجديد: <b>${formatMoney(newWallet)}</b>`
        );
      } else {
        await supabase
          .from('wallet_topups')
          .update({ status: 'rejected', reviewed_by: adminId, reviewed_at: nowIso })
          .eq('id', topupId);

        await ctx.answerCbQuery('❌ تم رفض طلب الشحن');

        await ctx.telegram.sendMessage(
          targetUserId,
          `❌ <b>نعتذر، تعذّر اعتماد طلب الشحن المسبق (#${topupId})</b> بقيمة <b>${formatMoney(amount)}</b>. يرجى مراجعة وصل الدفع أو التواصل مع الدعم.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await editCard(
          ctx,
          `❌ <b>تم رفض طلب الشحن (#${topupId})</b>\n` +
          `👤 العميل: <code>${targetUserId}</code> • المبلغ: <b>${formatMoney(amount)}</b>`
        );
      }
    } catch (err) {
      console.error(`Topup action error #${topupId}:`, err);
      await ctx.answerCbQuery('⚠️ تعذرت العملية', { show_alert: true }).catch(() => {});
      await ctx.reply(`⚠️ تعذرت معالجة طلب الشحن #${topupId}: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  const handleAdminAction = async (ctx, action) => {
    const requestId = Number(ctx.match[1]);
    const adminId = ctx.from.id;

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }

    try {
      if (action === 'delete_published') {
        await supabase.from('test_messages').delete().eq('id', requestId);
        await ctx.answerCbQuery('🗑 تم حذف الإعلان');
        await editCard(ctx, `🗑 <b>تم حذف الإعلان (#${requestId}) من المنصة.</b>`);
        return;
      }

      const { data: pendingItem, error: fetchError } = await supabase
        .from('pending_properties').select('*').eq('id', requestId).single();

      if (fetchError || !pendingItem) {
        await ctx.answerCbQuery('⚠️ الطلب غير متوفر أو تمت معالجته', { show_alert: true });
        return editCard(ctx, `⚠️ <b>الطلب (#${requestId}) غير متوفر أو تمت معالجته مسبقاً.</b>`);
      }

      const targetUserId = pendingItem.user_id;
      const isFreeAd = pendingItem.receipt_url === 'FREE_NO_RECEIPT';

      if (action === 'requeue') {
        await supabase.from('pending_properties').update({ status: 'pending' }).eq('id', requestId);
        await ctx.answerCbQuery('♻️ أُعيد لقائمة المراجعة');
        await editCard(ctx, `♻️ <b>تمت إعادة الإعلان (#${requestId}) إلى قائمة المراجعة.</b>`);
        return;
      }

      if (action === 'approve') {
        const numericPrice = sanitizeNumericPrice(pendingItem.price);
        const cleanPhone = String(pendingItem.phone || '').replace(/\D/g, '').trim();
        const nowIso = new Date().toISOString();

        let { error: publishError } = await supabase.from('test_messages').insert([{
          user_id: targetUserId,
          property_type: pendingItem.property_type,
          state_name: pendingItem.state_name,
          price: numericPrice,
          phone: cleanPhone,
          description: pendingItem.description,
          message: pendingItem.description,
          image_url: pendingItem.image_url || 'EMPTY',
          video_url: pendingItem.video_url || 'EMPTY',
          created_at: nowIso
        }]);

        if (publishError) {
          const retryRes = await supabase.from('test_messages').insert([{
            user_id: targetUserId,
            property_type: pendingItem.property_type,
            state_name: pendingItem.state_name,
            price: numericPrice,
            phone: cleanPhone,
            description: pendingItem.description,
            message: pendingItem.description,
            image_url: pendingItem.image_url || 'EMPTY',
            video_url: pendingItem.video_url || 'EMPTY'
          }]);
          publishError = retryRes.error;
        }
        if (publishError) throw publishError;

        await supabase.from('pending_properties').update({ status: 'approved' }).eq('id', requestId);
        await ctx.answerCbQuery('✅ تم القبول والنشر');

        await ctx.telegram.sendMessage(
          targetUserId,
          `🎉 <b>تمت الموافقة على إعلانك (#${requestId}) ونشره في المنصة.</b>\n🕒 <b>تاريخ النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await editCard(
          ctx,
          `✅ <b>تم قبول الإعلان (#${requestId}) ونشره بنجاح</b>\n` +
          `👤 المعلن: <code>${targetUserId}</code> • ${isFreeAd ? 'باقة مجانية' : 'مدفوع بوصل'}\n` +
          `🕒 وقت النشر: <code>${escapeHtml(formatDateTime(nowIso))}</code>`
        );
      } else {
        await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);
        await ctx.answerCbQuery('❌ تم الرفض');

        const rejectUserMsg = isFreeAd
          ? `❌ <b>نعتذر، لم تتم الموافقة على نشر إعلانك المجاني (#${requestId}).</b>`
          : `❌ <b>نعتذر، تعذّر قبول وصل الدفع الخاص بإعلانك (#${requestId}).</b>`;

        await ctx.telegram.sendMessage(targetUserId, rejectUserMsg, { parse_mode: 'HTML' }).catch(() => {});

        await editCard(
          ctx,
          `❌ <b>تم رفض الإعلان (#${requestId})</b>\n` +
          `👤 المعلن: <code>${targetUserId}</code> • ${isFreeAd ? 'باقة مجانية' : 'مدفوع بوصل'}`
        );
      }
    } catch (err) {
      console.error(`Admin action error #${requestId}:`, err);
      await ctx.answerCbQuery('⚠️ تعذرت العملية', { show_alert: true }).catch(() => {});
      await ctx.reply(`⚠️ تعذرت معالجة الإعلان #${requestId}: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' }).catch(() => {});
    }
  };

  bot.action(/^approve_(\d+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
  bot.action(/^reject_(\d+)$/, (ctx) => handleAdminAction(ctx, 'reject'));
  bot.action(/^requeue_(\d+)$/, (ctx) => handleAdminAction(ctx, 'requeue'));
  bot.action(/^del_pub_(\d+)$/, (ctx) => handleAdminAction(ctx, 'delete_published'));

  return { openAdminHome };
};
