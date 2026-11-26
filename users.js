'use strict';
// =========================================================================
// 👤 SERVER USERS — كل ما يخص المستخدم
// يستدعيه server.js (الأب) للمستخدمين العاديين، وللأدمن في وضع المعاينة.
// المرفق في استعلام العميل مدمج داخل نفس رسالة البطاقة بدون رسائل منفصلة.
// يدعم الشحن عبر BaridiMob / CCP بتشكيل المبلغ عبر أزرار المضاعفات من app_settings
// (مع وصل واحد لكل عملية شحن وحفظ أرشيف كامل في جدول wallet_topups).
// =========================================================================

const BTN_CONTACT_OWNER = '📞 اتصل بالمالك';

module.exports = function registerUsers(bot, core) {
  const {
    Markup, supabase, app, services, WEBHOOK_DOMAIN, MAX_PROPERTY_IMAGES,
    userState, userLang, browsingSession, supportUserSession,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, getAdminIds, getUserRecord, isUserVerified,
    chunkButtons, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml, fitTelegramText,
    normalizeMediaRef, parseMediaListFromField, parseImagesFromImageUrl, buildOrderedBrowsingMedia,
    getMainMenuKeyboard: rawGetMainMenuKeyboard, getAuthKeyboard, getWebsiteUrl
  } = core;

  const clientInquiryBrowse = {};
  const lastButtonHintAt = {};
  const buttonHintTimers = {};

  function applyPlaceholders(templateStr = '', vars = {}) {
    let out = String(templateStr ?? '').replace(/\\n/g, '\n');
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v ?? ''));
    }
    return out;
  }

  async function cfg(key, fallback = '', vars = {}) {
    const raw = await getSetting(key, fallback);
    return applyPlaceholders(raw ?? fallback, vars);
  }

  // الخطوات والمواضع المسموح فيها بالكتابة اليدوية (تُستثنى من تنبيه "استعمل الأزرار")
  const FREE_TEXT_STEPS = new Set([
    'payment_issue_writing_detail',
    'client_following_up_inquiry'
  ]);

  function isFreeTextInputAllowed(userId, userText) {
    if (/^\d+$/.test(userText)) {
      const own = supportUserSession[userId];
      if (own && own.mode === 'browsing_own_ads' && own.selectingPage) return true;
      const session = browsingSession[userId];
      if (session && session.selectingPage) return true;
    }
    const st = userState[userId];
    if (st && FREE_TEXT_STEPS.has(st.step)) return true;
    return false;
  }

  async function notifyUseButtonsHint(ctx, userId) {
    if (isFreeTextInputAllowed(userId, ctx.message?.text ? ctx.message.text.trim() : '')) return;

    await safeDeleteUserMessage(ctx);

    const now = Date.now();
    if (lastButtonHintAt[userId] && now - lastButtonHintAt[userId] < 3500) return;
    lastButtonHintAt[userId] = now;

    if (buttonHintTimers[userId]) {
      clearTimeout(buttonHintTimers[userId]);
      delete buttonHintTimers[userId];
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const hintMsgText = await cfg(
      'use_buttons_hint',
      '👇 <b>يرجى استعمال الأزرار التفاعلية في الأسفل</b> — هذا الموضع غير مخصص للكتابة اليدوية.'
    );

    const hintMsg = await ctx.reply(hintMsgText, { parse_mode: 'HTML' }).catch(() => null);

    if (hintMsg?.message_id) {
      const hintMsgId = hintMsg.message_id;
      buttonHintTimers[userId] = setTimeout(async () => {
        delete buttonHintTimers[userId];
        await ctx.telegram.deleteMessage(chatId, hintMsgId).catch(() => {});
      }, 3500);
    }
  }

  async function getInquiryStatusMap() {
    return {
      open: await cfg('status_open_label', '🆕 مفتوح (بانتظار الرد)'),
      in_progress: await cfg('status_in_progress_label', '⏳ قيد المعالجة'),
      resolved: await cfg('status_resolved_label', '✅ تم الحل'),
      closed: await cfg('status_closed_label', '🔒 مغلق')
    };
  }

  async function getRoleNamesMap() {
    return {
      ads_reviewer: await cfg('role_ads_reviewer_label', '🏠 مراجعة الإعلانات'),
      payments_admin: await cfg('role_payments_admin_label', '💳 مسؤول الدفع'),
      points_admin: await cfg('role_points_admin_label', '🪙 مسؤول النقاط'),
      general_support: await cfg('role_general_support_label', '💬 الدعم العام'),
      super_admin: await cfg('role_super_admin_label', '👑 الإدارة العامة')
    };
  }

  async function getTopupStatusMap() {
    return {
      pending: await cfg('topup_pending_label', '⏳ معلق'),
      approved: await cfg('topup_approved_label', '✅ مقبول'),
      rejected: await cfg('topup_rejected_label', '❌ مرفوض')
    };
  }

  async function statusLabelOf(st) {
    if (st === 'approved') return await cfg('ad_approved_label', '✅ مقبول');
    if (st === 'rejected') return await cfg('ad_rejected_label', '❌ مرفوض');
    return await cfg('ad_pending_label', '⏳ معلق');
  }

  // -----------------------------------------------------------------------
  // 💳 لوحة تشكيل مبلغ الشحن بالأزرار والمضاعفات (من app_settings)
  // -----------------------------------------------------------------------
  async function getTopupSteps() {
    if (services && typeof services.getTopupMultipliersFromSettings === 'function') {
      return services.getTopupMultipliersFromSettings();
    }
    return [
      { key: 'topup_step_1', orderNum: 1, amount: 100, label: '+100' },
      { key: 'topup_step_2', orderNum: 2, amount: 500, label: '+500' },
      { key: 'topup_step_3', orderNum: 3, amount: 1000, label: '+1000' }
    ];
  }

  async function getMultiplierFactorValue() {
    if (services && typeof services.getTopupMultiplierFactor === 'function') {
      return services.getTopupMultiplierFactor();
    }
    const factor = sanitizeNumericPrice(await cfg('topup_multiplier_factor', '2'));
    return factor > 1 ? factor : 2;
  }

  async function getTopupAmountKeypad(currentAmount = 0) {
    const steps = await getTopupSteps();
    const mult2Flag = await cfg('topup_mult_2_enabled', '1');
    const factor = await getMultiplierFactorValue();
    const stepButtons = steps.map(s => s.label);
    const stepRows = chunkButtons(stepButtons, 3);

    const utilityRow = [];
    if (String(mult2Flag).trim() !== '0') {
      utilityRow.push(`✖️${factor}`);
    }
    utilityRow.push('⌫', '🗑️ مسح');

    return Markup.keyboard([
      [`💰 المبلغ الحالي: [ ${formatMoney(currentAmount)} ]`],
      ...stepRows,
      utilityRow,
      ['✅ [ OK ] تأكيد'],
      ['⬅️ رجوع', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  async function renderTopupAmountStep(ctx, userId, customNote = '') {
    const state = userState[userId];
    if (!state) return;

    const currentAmount = sanitizeNumericPrice(state.data?.amount || 0);
    const ccpRip = await cfg('ccp_rip', '00234567890123456789');
    const ccpName = await cfg('ccp_name', '');
    const nameLine = ccpName
      ? await cfg('topup_name_line_template', '\n👤 <b>الاسم:</b> {ccp_name}', { ccp_name: escapeHtml(ccpName) })
      : '';

    const headerText = await cfg('topup_screen_template', '', {
      name_line: nameLine,
      ccp_rip: escapeHtml(ccpRip)
    });

    const promptText = await cfg(
      'topup_keypad_prompt',
      '👇 <b>استخدم أزرار المضاعفات لتشكيل المبلغ (مثال: 100 ثم ضغطة أخرى لتصبح 200...) ثم اضغط ✅ [ OK ] تأكيد:</b>'
    );

    const fullText = [headerText, promptText, customNote].filter(Boolean).join('\n\n');
    const kb = await getTopupAmountKeypad(currentAmount);

    return replyTracked(ctx, userId, fullText, { parse_mode: 'HTML', ...kb }, true);
  }

  function getSupportButtonLabel(unreadRepliesCount = 0) {
    return unreadRepliesCount > 0
      ? `📞 الدعم والإدارة (${unreadRepliesCount})`
      : '📞 الدعم والإدارة';
  }

  function applySupportBadgeToKeyboard(kbObj, unreadRepliesCount = 0) {
    if (!kbObj || !kbObj.reply_markup || !Array.isArray(kbObj.reply_markup.keyboard)) {
      return kbObj;
    }
    const targetLabel = getSupportButtonLabel(unreadRepliesCount);
    const updatedRows = kbObj.reply_markup.keyboard.map(row =>
      Array.isArray(row)
        ? row.map(btn => {
            if (typeof btn === 'string' && /^📞 الدعم والإدارة(?:\s*\(\d+\))?$/.test(btn)) {
              return targetLabel;
            }
            if (btn && typeof btn === 'object' && typeof btn.text === 'string' && /^📞 الدعم والإدارة(?:\s*\(\d+\))?$/.test(btn.text)) {
              return { ...btn, text: targetLabel };
            }
            return btn;
          })
        : row
    );
    return {
      ...kbObj,
      reply_markup: {
        ...kbObj.reply_markup,
        keyboard: updatedRows
      }
    };
  }

  async function buildUserMainKeyboard(userId, unreadCount = 0) {
    let unreadRepliesCount = 0;
    try {
      const summary = await getClientRepliesSummary(userId);
      unreadRepliesCount = summary.unreadRepliesCount || 0;
    } catch (e) {}

    const baseKb = typeof rawGetMainMenuKeyboard === 'function'
      ? await rawGetMainMenuKeyboard(userId, unreadCount, unreadRepliesCount)
      : Markup.keyboard([
          ['🔍 تصفح العقارات المتاحة', '➕ إضافة عقار جديد'],
          ['🎁 رصيدي وجمع النقاط', getSupportButtonLabel(unreadRepliesCount)],
          ['🌐 تصفح الموقع الرسمي (البروزر)', 'ℹ️ عن المنصة']
        ]).resize();

    return applySupportBadgeToKeyboard(baseKb, unreadRepliesCount);
  }

  async function uploadSingleReceiptToStorage(ctx, fileId, userId) {
    try {
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const res = await fetch(fileLink.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const fileName = `${Date.now()}_topup_${userId}.jpg`;
      await supabase.storage.from('test_media').upload(fileName, buf, { contentType: 'image/jpeg', upsert: true });
      const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
      if (pubUrl && pubUrl.publicUrl) return pubUrl.publicUrl;
    } catch (e) {}
    return `tg:${fileId}`;
  }

  async function submitWalletTopupRequest(ctx, userId, amount, receiptFileId) {
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const cleanAmount = sanitizeNumericPrice(amount);

    if (!cleanAmount || cleanAmount <= 0 || !receiptFileId) {
      delete userState[userId];
      const incompleteMsg = await cfg('topup_incomplete_data_msg', '⚠️ البيانات غير مكتملة، يرجى المحاولة مرة أخرى.');
      return replyTracked(ctx, userId, incompleteMsg, {
        parse_mode: 'HTML', ...mainKb
      }, true);
    }

    const receiptUrl = await uploadSingleReceiptToStorage(ctx, receiptFileId, userId);
    const paymentMethodLabel = await cfg('topup_payment_method_label', 'BaridiMob / CCP');
    const defaultSenderName = await cfg('default_sender_name', 'مستخدم');

    const { data: topupRow, error } = await supabase
      .from('wallet_topups')
      .insert([{
        user_id: Number(userId),
        amount: cleanAmount,
        receipt_urls: receiptUrl,
        payment_method: paymentMethodLabel,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    const topupId = topupRow.id;
    const submittedAt = formatDateTime(topupRow.created_at || new Date());
    const dbUser = await getUserRecord(userId);
    const senderName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || defaultSenderName
    );
    const formattedAmount = formatMoney(cleanAmount);

    const adminCaption = await cfg('topup_admin_caption_template', '', {
      topup_id: topupId,
      submitted_at: escapeHtml(submittedAt),
      sender_name: senderName,
      user_id: userId,
      amount: formattedAmount
    });
    const adminReviewFooter = await cfg('topup_admin_review_footer', '👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ القرار:</b>');

    const adminButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback(`❌ رفض (#${topupId})`, `topup_reject_${topupId}`),
        Markup.button.callback(`✅ اعتماد وإضافة الرصيد (#${topupId})`, `topup_approve_${topupId}`)
      ],
      [Markup.button.callback(`✉️ رد على العميل (${userId})`, `support_reply_${userId}`)]
    ]);

    const adminIds = await getAdminIds();
    const photoSource = typeof receiptUrl === 'string' && receiptUrl.startsWith('http')
      ? receiptUrl
      : receiptFileId;

    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendPhoto(adminId, photoSource, {
          caption: fitTelegramText(
            `${adminCaption}\n\n${adminReviewFooter}`,
            true
          ),
          parse_mode: 'HTML',
          ...adminButtons
        });
      } catch (e) {
        await ctx.telegram.sendMessage(adminId, fitTelegramText(adminCaption, false), {
          parse_mode: 'HTML',
          ...adminButtons
        }).catch(() => {});
      }
    }

    delete userState[userId];
    const userDoneMsg = await cfg('topup_submitted_user_template', '', {
      topup_id: topupId,
      amount: formattedAmount,
      submitted_at: escapeHtml(submittedAt)
    });

    await replyTracked(
      ctx, userId,
      userDoneMsg,
      { parse_mode: 'HTML', ...mainKb },
      true
    );
  }

  async function fetchUserWalletTopups(userId) {
    try {
      const { data, error } = await supabase
        .from('wallet_topups')
        .select('*')
        .eq('user_id', Number(userId))
        .order('id', { ascending: false })
        .limit(20);

      if (error || !data) return [];
      return data;
    } catch (e) {
      return [];
    }
  }

  function formatTopupChoiceLabel(topup) {
    const stIcon = topup.status === 'approved' ? '✅' : topup.status === 'rejected' ? '❌' : '⏳';
    const amtText = formatMoney(sanitizeNumericPrice(topup.amount || 0));
    return `${stIcon} شحن #${topup.id} • ${amtText}`;
  }

  function inferTargetRole(titleText = '', detailText = '') {
    const src = `${titleText} ${detailText}`.toLowerCase();
    if (/دفع|وصل|baridimob|ccp|payment|شحن/.test(src)) return 'payments_admin';
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
    if (/مشكلة في الدفع|شحن/.test(titleText)) return 'payment_issue';
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
      const defaultMsgFallback = await cfg('default_inquiry_message_fallback', 'استفسار من العميل');

      const { data, error } = await supabase
        .from('user_inquiries')
        .insert([{
          user_id: Number(userId),
          property_id: cleanPropId,
          property_source: cleanPropId ? (propertySource || 'pending_properties') : null,
          inquiry_type: inquiryType,
          target_role: targetRole,
          subject: subject || null,
          message: message || subject || defaultMsgFallback,
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

  async function markInquiryRepliesAsRead(inquiryId) {
    if (!inquiryId) return;
    try {
      await supabase
        .from('inquiry_replies')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('inquiry_id', inquiryId)
        .eq('is_read', false);
    } catch (e) {
      console.error('markInquiryRepliesAsRead error:', e.message);
    }
  }

  async function getClientRepliesSummary(userId, inquiriesList = null) {
    const list = Array.isArray(inquiriesList)
      ? inquiriesList
      : await fetchClientInquiriesByUserId(userId);

    if (!list.length) {
      return {
        inquiries: list,
        totalReplies: 0,
        unreadRepliesCount: 0,
        unreadInquiriesCount: 0,
        readInquiriesCount: 0,
        unreadCountByInquiryId: {},
        totalCountByInquiryId: {}
      };
    }

    const ids = list.map(i => i.id).filter(Boolean);
    const unreadCountByInquiryId = {};
    const totalCountByInquiryId = {};
    let totalReplies = 0;
    let unreadRepliesCount = 0;

    try {
      const { data: replyRows } = await supabase
        .from('inquiry_replies')
        .select('inquiry_id, is_read')
        .in('inquiry_id', ids);

      if (Array.isArray(replyRows)) {
        for (const r of replyRows) {
          totalCountByInquiryId[r.inquiry_id] = (totalCountByInquiryId[r.inquiry_id] || 0) + 1;
          totalReplies += 1;
          if (r.is_read === false) {
            unreadCountByInquiryId[r.inquiry_id] = (unreadCountByInquiryId[r.inquiry_id] || 0) + 1;
            unreadRepliesCount += 1;
          }
        }
      }
    } catch (e) {}

    const sortedList = [...list].sort((a, b) => {
      const aUnread = (unreadCountByInquiryId[a.id] || 0) > 0 ? 1 : 0;
      const bUnread = (unreadCountByInquiryId[b.id] || 0) > 0 ? 1 : 0;
      if (bUnread !== aUnread) return bUnread - aUnread;
      return Number(b.id || 0) - Number(a.id || 0);
    });

    const unreadInquiriesCount = sortedList.filter(i => (unreadCountByInquiryId[i.id] || 0) > 0).length;
    const readInquiriesCount = sortedList.length - unreadInquiriesCount;

    return {
      inquiries: sortedList,
      totalReplies,
      unreadRepliesCount,
      unreadInquiriesCount,
      readInquiriesCount,
      unreadCountByInquiryId,
      totalCountByInquiryId
    };
  }

  function getFilteredInquiriesList(st) {
    const all = Array.isArray(st?.allItems) ? st.allItems : [];
    const unreadMap = st?.unreadCountByInquiryId || {};
    const mode = st?.filterMode || 'all';

    if (mode === 'unread') {
      return all.filter(inq => (unreadMap[inq.id] || 0) > 0);
    }
    if (mode === 'read') {
      return all.filter(inq => (unreadMap[inq.id] || 0) === 0);
    }
    return all;
  }

  async function getFilterModeTitle(mode = 'all') {
    if (mode === 'unread') return await cfg('filter_unread_label', '🔔 غير المقروءة');
    if (mode === 'read') return await cfg('filter_read_label', '📖 المقروءة');
    return await cfg('filter_all_label', '📚 الكل');
  }

  function getInquiriesMenuLabel(unreadRepliesCount = 0) {
    return unreadRepliesCount > 0
      ? `📨 استعلاماتي وردود الإدارة (${unreadRepliesCount})`
      : '📨 استعلاماتي وردود الإدارة';
  }

  function buildInquiryIndexButtonLabel(inq, pos, unreadRepCount = 0, totalRepCount = 0, fallbackSubj = 'استفسار') {
    const subj = String(inq.subject || inq.message || fallbackSubj).replace(/\s+/g, ' ').trim();
    const shortSubj = subj.length > 20 ? `${subj.slice(0, 20)}…` : subj;
    const statusDot = unreadRepCount > 0 ? '🔔' : (inq.status === 'resolved' ? '✅' : inq.status === 'closed' ? '🔒' : '🆕');
    const repTag = unreadRepCount > 0 ? ` (${unreadRepCount})` : (totalRepCount > 0 ? ` [${totalRepCount}]` : '');
    return `${statusDot} #${inq.id}${repTag} (${pos}) • ${shortSubj}`;
  }

  function getClientInquiriesKeyboard(idx, total, currentInquiry = null, st = null) {
    const unreadRepliesCount = st?.unreadRepliesCount || 0;
    const unreadInqCount = st?.unreadInquiriesCount || 0;
    const readInqCount = st?.readInquiriesCount || 0;
    const totalInqCount = (st?.allItems || []).length;
    const mode = st?.filterMode || 'all';

    const rows = [];
    const navRow = [];
    if (idx > 0) navRow.push('⬅️ استفساري السابق');
    navRow.push(`📋 ${idx + 1} / ${total}`);
    if (idx < total - 1) navRow.push('استفساري التالي ➡️');
    if (navRow.length > 0) rows.push(navRow);

    rows.push([
      `${mode === 'unread' ? '✅ ' : ''}🔔 غير المقروءة (${unreadInqCount})`,
      `${mode === 'read' ? '✅ ' : ''}📖 المقروءة (${readInqCount})`,
      `${mode === 'all' ? '✅ ' : ''}📚 الكل (${totalInqCount})`
    ]);

    if (currentInquiry && currentInquiry.id) {
      rows.push([`💬 متابعة الاستعلام #${currentInquiry.id}`]);
    }
    rows.push([
      '💬 دعم واقتراحات وشكر',
      unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
    ]);
    rows.push(['🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  async function formatClientInquiryCard(inquiry, replies, idx, total, isMediaCaption = false, mediaSenderLabel = '', filterMode = 'all') {
    const statusMap = await getInquiryStatusMap();
    const roleMap = await getRoleNamesMap();
    const defaultAdminLabel = await cfg('default_admin_role_label', 'الإدارة');
    const defaultGeneralRole = await cfg('default_general_support_role_label', 'الدعم العام');
    const photoPlaceholder = await cfg('reply_photo_placeholder', '🖼 صورة مرفقة');
    const videoPlaceholder = await cfg('reply_video_placeholder', '🎥 فيديو مرفق');

    const statusText = statusMap[inquiry.status] || escapeHtml(inquiry.status || 'open');
    const roleText = roleMap[inquiry.target_role] || escapeHtml(inquiry.target_role || defaultGeneralRole);
    const propLine = inquiry.property_id ? `🏠 <b>الإعلان:</b> <code>#${inquiry.property_id}</code>\n` : '';
    const subjectLine = inquiry.subject ? `📌 <b>الموضوع:</b> ${escapeHtml(inquiry.subject)}\n` : '';
    const mediaSourceLine = mediaSenderLabel
      ? `📎 <b>مرسل المرفق:</b> <b>${escapeHtml(mediaSenderLabel)}</b>\n`
      : '';

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
      ? await cfg('replies_done_template', '✅ <b>الردود:</b> تم الرد ({count})\n', { count: combinedReplies.length })
      : await cfg('replies_waiting_line', '⏳ <b>الردود:</b> بانتظار الإدارة\n');

    const repliesHeaderLine = await cfg('replies_header_line', '\n💬 <b>ردود الإدارة:</b>\n');
    const noRepliesPlaceholder = await cfg('no_replies_placeholder', '<i>— لا توجد ردود بعد —</i>');

    let repliesSection = repliesHeaderLine;
    if (!hasReplies) {
      repliesSection += noRepliesPlaceholder;
    } else {
      repliesSection += combinedReplies.map((rep, rIdx) => {
        const repTime = formatDateTime(rep.created_at);
        const repRole = roleMap[rep.admin_role] || defaultAdminLabel;
        const repBody = escapeHtml(
          rep.reply_message ||
          (rep.media_type === 'photo' ? photoPlaceholder : rep.media_type === 'video' ? videoPlaceholder : '')
        );
        return `${rIdx + 1}. <b>[${repRole}]</b> <code>${escapeHtml(repTime)}</code>: ${repBody}`;
      }).join('\n');
    }

    const filterTitle = await getFilterModeTitle(filterMode);
    const text =
      `📨 <b>استعلاماتي (${filterTitle})</b> • <code>#${inquiry.id}</code> (${idx + 1}/${total})\n` +
      `📊 ${statusText} | 🎯 ${roleText}\n` +
      replyBanner +
      mediaSourceLine +
      propLine +
      `🕒 <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      subjectLine +
      `📝 <b>استفسارك:</b> ${escapeHtml(inquiry.message || '')}` +
      repliesSection;

    return fitTelegramText(text, isMediaCaption);
  }

  async function showClientInquiryIndexMenu(ctx, userId) {
    delete browsingSession[userId];
    let st = clientInquiryBrowse[userId];

    if (!st || !Array.isArray(st.allItems)) {
      const summary = await getClientRepliesSummary(userId);
      st = {
        allItems: summary.inquiries,
        items: summary.inquiries,
        index: 0,
        filterMode: 'all',
        selectingIndex: false,
        labelMap: {},
        unreadRepliesCount: summary.unreadRepliesCount,
        unreadInquiriesCount: summary.unreadInquiriesCount,
        readInquiriesCount: summary.readInquiriesCount,
        unreadCountByInquiryId: summary.unreadCountByInquiryId,
        totalCountByInquiryId: summary.totalCountByInquiryId
      };
      clientInquiryBrowse[userId] = st;
    }

    st.items = getFilteredInquiriesList(st);

    if (!st.items.length) {
      return renderClientInquiryAt(ctx, userId, 0, false);
    }

    st.selectingIndex = true;
    st.labelMap = {};

    const fallbackSubj = await cfg('default_inquiry_subject', 'استفسار');
    const summaryLines = await Promise.all(st.items.map(async (inq, idx) => {
      const unreadRepCount = st.unreadCountByInquiryId[inq.id] || 0;
      const totalRepCount = st.totalCountByInquiryId[inq.id] || 0;
      const lbl = buildInquiryIndexButtonLabel(inq, idx + 1, unreadRepCount, totalRepCount, fallbackSubj);
      st.labelMap[lbl] = idx;
      const dt = inq.created_at
        ? await cfg('inquiry_list_date_tag_template', ' • <code>{time}</code>', { time: escapeHtml(formatDateTime(inq.created_at)) })
        : '';
      const repBadge = unreadRepCount > 0
        ? await cfg('inquiry_new_badge_template', ' • 🔔 جديد <b>({count})</b>', { count: unreadRepCount })
        : (totalRepCount > 0
          ? await cfg('inquiry_read_badge_template', ' • 📖 مقروء ({count})', { count: totalRepCount })
          : '');
      return `${idx + 1}. <b>#${inq.id}</b> — ${escapeHtml(inq.subject || inq.message || fallbackSubj)}${repBadge}${dt}`;
    }));

    const buttons = Object.keys(st.labelMap);
    const rows = chunkButtons(buttons, 1);
    rows.push([
      '🔙 رجوع للاستعلام',
      st.unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${st.unreadRepliesCount})` : '⬅️ لوحة العميل'
    ]);
    rows.push(['🏠 القائمة الرئيسية']);

    const filterTitle = await getFilterModeTitle(st.filterMode);
    const menuText = await cfg('inquiry_index_menu_template', '', {
      filter_label: filterTitle,
      count: st.items.length,
      lines: summaryLines.join('\n')
    });

    const sent = await ctx.reply(
      menuText,
      { parse_mode: 'HTML', ...Markup.keyboard(rows).resize() }
    ).catch(() => null);

    const keepIds = sent?.message_id ? [sent.message_id] : [];
    if (sent?.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }

  async function renderClientInquiryAt(ctx, userId, index = 0, refresh = false, forcedFilterMode = null) {
    delete browsingSession[userId];
    let st = clientInquiryBrowse[userId];

    if (!st || refresh) {
      const summary = await getClientRepliesSummary(userId);
      const nextMode = forcedFilterMode || st?.filterMode || 'all';

      st = {
        allItems: summary.inquiries,
        items: [],
        index: 0,
        filterMode: nextMode,
        selectingIndex: false,
        labelMap: {},
        unreadRepliesCount: summary.unreadRepliesCount,
        unreadInquiriesCount: summary.unreadInquiriesCount,
        readInquiriesCount: summary.readInquiriesCount,
        unreadCountByInquiryId: summary.unreadCountByInquiryId,
        totalCountByInquiryId: summary.totalCountByInquiryId
      };
      st.items = getFilteredInquiriesList(st);
      clientInquiryBrowse[userId] = st;
    } else {
      if (forcedFilterMode) {
        st.filterMode = forcedFilterMode;
      }
      st.items = getFilteredInquiriesList(st);
      st.selectingIndex = false;
    }

    if (!st.allItems || st.allItems.length === 0) {
      delete clientInquiryBrowse[userId];
      const noInqMsg = await cfg('no_inquiries_registered_template', '📭 <b>لا توجد استفسارات مسجلة لحسابك (<code>{user_id}</code>) حتى الآن.</b>', { user_id: userId });
      return replyTracked(
        ctx, userId,
        noInqMsg,
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

    if (!st.items.length) {
      const emptyLabel = await getFilterModeTitle(st.filterMode);
      const noInqFilterMsg = await cfg('no_inquiries_in_filter_template', '📭 <b>لا توجد استفسارات ضمن قسم ({filter_label}) حالياً.</b>', { filter_label: emptyLabel });
      return replyTracked(
        ctx, userId,
        noInqFilterMsg,
        {
          parse_mode: 'HTML',
          ...getClientInquiriesKeyboard(0, 1, null, st)
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

    const hadUnreadHere = (st.unreadCountByInquiryId?.[currentInquiry.id] || 0) > 0 ||
      replies.some(r => r.is_read === false);

    if (hadUnreadHere) {
      await markInquiryRepliesAsRead(currentInquiry.id);
      const removedUnread = st.unreadCountByInquiryId?.[currentInquiry.id] || replies.filter(r => r.is_read === false).length;
      st.unreadCountByInquiryId[currentInquiry.id] = 0;
      st.unreadRepliesCount = Math.max(0, (st.unreadRepliesCount || 0) - removedUnread);
      st.unreadInquiriesCount = (st.allItems || []).filter(i => (st.unreadCountByInquiryId[i.id] || 0) > 0).length;
      st.readInquiriesCount = (st.allItems || []).length - st.unreadInquiriesCount;
      for (const r of replies) r.is_read = true;
    }

    const kb = getClientInquiriesKeyboard(safeIdx, st.items.length, currentInquiry, st);
    const roleMap = await getRoleNamesMap();
    const defaultAdminLabel = await cfg('default_admin_role_label', 'الإدارة');
    const clientSenderLabel = await cfg('sender_client_label', 'أنت (العميل)');

    const latestMediaReply = [...replies]
      .reverse()
      .find(r => r.attachment_url && (r.media_type === 'photo' || r.media_type === 'video'));

    const replyAttach = latestMediaReply ? normalizeMediaRef(latestMediaReply.attachment_url) : null;
    const inqAttach = normalizeMediaRef(currentInquiry.attachment_url);

    let attachedMedia = null;
    if (replyAttach) {
      const roleName = roleMap[latestMediaReply.admin_role] || defaultAdminLabel;
      const adminPrefix = await cfg('sender_admin_prefix_template', 'الإدارة ({role})', { role: roleName });
      attachedMedia = {
        type: latestMediaReply.media_type === 'video' ? 'video' : 'photo',
        ref: replyAttach,
        senderLabel: adminPrefix
      };
    } else if (inqAttach) {
      const isVideoAttach = /\.(mp4|mov|webm)(\?|$)/i.test(inqAttach);
      attachedMedia = {
        type: isVideoAttach ? 'video' : 'photo',
        ref: inqAttach,
        senderLabel: clientSenderLabel
      };
    }

    let sent = null;
    if (attachedMedia) {
      const mediaCaption = await formatClientInquiryCard(
        currentInquiry,
        replies,
        safeIdx,
        st.items.length,
        true,
        attachedMedia.senderLabel,
        st.filterMode
      );
      try {
        sent = attachedMedia.type === 'video'
          ? await ctx.replyWithVideo(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...kb })
          : await ctx.replyWithPhoto(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...kb });
      } catch (e) {
        console.error('renderClientInquiryAt media card error:', e.message);
      }
    }

    if (!sent) {
      const cardText = await formatClientInquiryCard(currentInquiry, replies, safeIdx, st.items.length, false, '', st.filterMode);
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

  function getBrowsingKeyboard(currentIndex, totalCount, mediaIdx = 0, totalMedia = 0, canContactOwner = false) {
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
    if (canContactOwner) {
      rows.push([BTN_CONTACT_OWNER]);
    }
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

  async function formatMediaSummaryLabel(mediaItems = []) {
    const photosCount = mediaItems.filter(i => i.type === 'photo').length;
    const videosCount = mediaItems.filter(i => i.type === 'video').length;
    const parts = [];

    if (photosCount > 0) {
      parts.push(
        photosCount === 1
          ? await cfg('media_count_photo_singular', '1 صورة')
          : await cfg('media_count_photo_plural_template', '{count} صور', { count: photosCount })
      );
    }
    if (videosCount > 0) {
      parts.push(
        videosCount === 1
          ? await cfg('media_count_video_singular', '1 فيديو')
          : await cfg('media_count_video_plural_template', '{count} فيديو', { count: videosCount })
      );
    }
    if (parts.length === 0) return null;

    const joiner = await cfg('media_count_joiner', ' و ');
    return await cfg('media_summary_template', '📎 تم إرفاق {summary} (يمكنك إضافة المزيد)', {
      summary: parts.join(joiner)
    });
  }

  async function buildPsychologyCue(points, publishCost, walletNum) {
    const remaining = Math.max(0, publishCost - points);
    if (points >= publishCost) {
      return await cfg('cue_points_ready', '✨ <b>رصيد نقاطك مكتمل الآن!</b> بإمكانك نشر إعلانك القادم دون أي عناء، أو إبقاء رصيدك جاهزاً لوقت الحاجة.');
    }
    if (walletNum === 0 && remaining <= 50) {
      return await cfg('cue_almost_ready_template', '', { remaining, publish_cost: publishCost });
    }
    if (walletNum === 0) {
      return await cfg('cue_choose_pace', '💡 <b>اختر الإيقاع الذي يناسبك:</b> اجمع نقاطك بهدوء عبر المشاهدة أو الدعوة، أو اشحن رصيدك الآن لتنجز إعلاناتك بسرعة وراحة بال.');
    }
    return await cfg('cue_wallet_active', '✨ <b>محفظتك نشطة وجاهزة</b> — استثمر رصيدك أو اجمع نقاطاً إضافية لتوسيع فرصك على المنصة.');
  }

  async function showWalletAndPointsScreen(ctx, userId) {
    const user = await getUserRecord(userId);
    const points = Number(user?.points || 0);
    const walletNum = sanitizeNumericPrice(user?.wallet_balance || 0);
    const walletBalance = formatMoney(walletNum);
    const rewardPoints = Number(await cfg('ad_reward_points', '25'));
    const publishCost = Number(await cfg('publish_cost_points', '100'));
    const refReward = Number(await cfg('referral_reward_points', '50'));
    const defaultBotUsername = await cfg('default_bot_username', 'AqarDZ_bot');

    const botUsername = ctx.botInfo?.username || defaultBotUsername;
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    const cue = await buildPsychologyCue(points, publishCost, walletNum);

    const msg = await cfg('wallet_screen_template', '', {
      wallet_balance: walletBalance,
      points,
      publish_cost: publishCost,
      cue,
      reward_points: rewardPoints,
      ref_reward: refReward,
      ref_link: refLink
    });

    const keyboardRows = [['💳 شحن الرصيد (CCP / BaridiMob)']];
    if (WEBHOOK_DOMAIN) {
      const watchBtnLabel = await cfg('watch_ad_btn_template', '🎬 مشاهدة إعلان (+{reward_points} نقطة)', {
        reward_points: rewardPoints
      });
      keyboardRows.push([
        Markup.button.webApp(watchBtnLabel, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
      ]);
    }
    keyboardRows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(ctx, userId, msg, { parse_mode: 'HTML', ...Markup.keyboard(keyboardRows).resize() }, true);
  }

  async function openUserHome(ctx, prefixNote = '') {
    const userId = ctx.from.id;
    const defaultFirstName = await cfg('default_user_first_name', 'مستخدمنا الكريم');
    const userName = ctx.from.first_name || defaultFirstName;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const welcomeText = await cfg(
      'welcome_msg_template',
      'أهلاً بك يا <b>{name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:',
      { name: userName }
    );
    await replyTracked(ctx, userId, prefixNote + welcomeText, {
      parse_mode: 'HTML',
      ...mainKb
    }, true);
  }

  app.get('/watch-ad', async (req, res) => {
    const userId = req.query.uid || '';
    const rewardPoints = await cfg('ad_reward_points', '25');
    const pageTitle = await cfg('watch_ad_page_title', 'إضافة نقاط إلى رصيدك');
    const headingText = await cfg('watch_ad_heading', '🎁 تعزيز رصيد نقاطك');
    const descText = await cfg('watch_ad_desc_template', 'أكمل عرض الفيديو القصير لإضافة +{reward_points} نقطة إلى رصيدك.', { reward_points: rewardPoints });
    const alertHtml = await cfg('watch_ad_alert_html', 'ℹ️ <b>يرجى البقاء في الصفحة حتى اكتمال العرض</b> ليتم تسجيل نقاطك تلقائياً في حسابك.');
    const btnStart = await cfg('watch_ad_btn_start', '▶️ بدء العرض الآن');
    const btnLoading = await cfg('watch_ad_btn_loading', '⏳ جاري التحميل... يرجى الانتظار');
    const alertUnavailable = JSON.stringify(await cfg('watch_ad_unavailable_alert', 'العرض غير متاح حالياً، يمكنك المحاولة بعد قليل.'));
    const alertSuccess = JSON.stringify(await cfg('watch_ad_success_alert', '✨ تم إضافة النقاط إلى رصيدك بنجاح.'));
    const alertRetry = JSON.stringify(await cfg('watch_ad_retry_alert', 'تعذر إتمام العملية، يرجى المحاولة مجدداً.'));
    const alertNetwork = JSON.stringify(await cfg('watch_ad_network_alert', 'تعذر الاتصال بالخادم حالياً.'));

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
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
      background: #1E3A5F; color: #BAE6FD; border: 1px solid #0284C7;
      padding: 12px; border-radius: 8px; font-size: 13px;
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
    <h2>${headingText}</h2>
    <p style="color:#94A3B8; font-size:14px;">${descText}</p>
    <div id="alertBox" class="alert-box">
      ${alertHtml}
    </div>
    <button id="adBtn" onclick="triggerAd()">${btnStart}</button>
  </div>
  <script>
    const tg = window.Telegram.WebApp;
    tg.expand();
    const btnEl = document.getElementById('adBtn');
    const alertBox = document.getElementById('alertBox');
    const startLabel = ${JSON.stringify(btnStart)};
    const loadingLabel = ${JSON.stringify(btnLoading)};

    function triggerAd() {
      btnEl.disabled = true;
      btnEl.textContent = loadingLabel;
      alertBox.style.display = 'block';

      if (typeof show_12268522 === 'function') {
        show_12268522().then(() => {
          claimReward();
        }).catch((e) => {
          alert(${alertUnavailable});
          btnEl.disabled = false;
          btnEl.textContent = startLabel;
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
          alert(${alertSuccess});
          tg.close();
        } else {
          alert(${alertRetry});
          btnEl.disabled = false;
          btnEl.textContent = startLabel;
          alertBox.style.display = 'none';
        }
      } catch (e) {
        alert(${alertNetwork});
        btnEl.disabled = false;
        btnEl.textContent = startLabel;
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

      const rewardPoints = Number(await cfg('ad_reward_points', '25'));
      const newPoints = (user.points || 0) + rewardPoints;
      await supabase.from('users').update({ points: newPoints }).eq('id', userId);

      const rewardClaimedMsg = await cfg('ad_reward_claimed_msg_template', '', {
        reward_points: rewardPoints,
        new_points: newPoints
      });

      await core.bot.telegram.sendMessage(
        userId,
        rewardClaimedMsg,
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
      await cfg('wizard_prompt_type', 'اختر <b>نوع العقار</b> من القائمة في الأسفل:'),
      await cfg('wizard_prompt_state', 'اختر <b>الولاية</b> من القائمة في الأسفل:'),
      await cfg('wizard_prompt_price', 'استخدم لوحة الأرقام في الأسفل لتشكيل السعر، ثم اضغط <b>✅ [ OK ] تأكيد</b>:'),
      await cfg('wizard_prompt_phone', 'استخدم لوحة الأرقام في الأسفل لإدخال رقم الهاتف، ثم اضغط <b>✅ [ OK ] تأكيد</b>:'),
      await cfg('wizard_prompt_description', 'اختر <b>مزايا ومواصفات العقار</b> من القائمة في الأسفل (يمكنك اختيار أكثر من ميزة)، ثم اضغط <b>✅ تأكيد الوصف والانتقال</b>:'),
      await cfg('wizard_prompt_media_template', 'أرسل الآن <b>عدة صور أو فيديوهات للعقار</b> (حتى {max} ملفات معاً)، ثم اضغط <b>✅ إنهاء إرفاق الوسائط والانتقال</b>:', { max: MAX_PROPERTY_IMAGES }),
      await cfg('wizard_prompt_payment_choice', 'اختر طريقة الدفع أو النشر من القائمة في الأسفل:'),
      await cfg('wizard_prompt_payment_receipt', 'أرسل الآن <b>صورة وصل الدفع (BaridiMob / CCP)</b>:')
    ];
    return prompts[stepIndex] || '';
  }

  async function buildWizardText(state, opts = {}) {
    const totalSteps = 7;
    let active = WIZ_STEPS.indexOf(state.step);
    if (active >= 6 || state.step === 'publishing') active = 6;
    if (active < 0) active = 0;

    const d = state.data;
    const titleText = await cfg('wizard_title', '🏢 <b>نشر عقار جديد</b>');
    const head = opts.header || await cfg('wizard_step_counter_template', '{title}  •  الخطوة {current} من {total}', {
      title: titleText,
      current: active + 1,
      total: totalSteps
    });
    if (opts.onlyHeader) return head;

    const filled = opts.complete ? totalSteps : active + 1;
    const bar = '▰'.repeat(filled) + '▱'.repeat(totalSteps - filled);

    const editingSuffix = await cfg('wizard_editing_suffix', ' (قيد التعديل...)');
    const typingSuffix = await cfg('wizard_typing_suffix', ' (قيد الإدخال...)');

    let descPreview = null;
    if (d.description) {
      descPreview = d.description.length > 200 ? d.description.slice(0, 200) + '…' : d.description;
    } else if (state.step === 'waiting_for_description' && d.features_list && d.features_list.length > 0) {
      descPreview = d.features_list.join(' | ') + editingSuffix;
    }

    const currentPriceDisplay = d.price
      ? formatMoney(d.price)
      : (state.step === 'waiting_for_price' ? `${formatMoney(state.tempInput || '0')}${typingSuffix}` : null);

    const currentPhoneDisplay = d.phone
      ? d.phone
      : (state.step === 'waiting_for_phone' ? `${state.tempInput || '0'}${typingSuffix}` : null);

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
      const publishCost = await cfg('publish_cost_points', '100');
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
    const publishCost = await cfg('publish_cost_points', '100');
    const paidPrice = await cfg('paid_ad_price_dzd', '500');
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);

    if (state.step === 'waiting_for_payment_choice' && !opts.footer) {
      opts.footer = await cfg('wizard_payment_options_template', '', {
        paid_price: paidPrice,
        publish_cost: publishCost,
        points: currentPoints
      });
    }

    const text = await buildWizardText(state, opts);

    if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
      try {
        await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
      } catch (e) {}
      return;
    }

    const replyKeyboard = opts.noKeyboard ? mainKb : await getStandardReplyKeyboard(state);

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
    const defaultFirstName = await cfg('default_user_first_name', 'مستخدمنا الكريم');
    const userName = ctx.from.first_name || defaultFirstName;
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
      const authText = await cfg(
        'auth_prompt_template',
        'أهلاً بك يا <b>{name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\n⚠️ <b>تنبيه أمني:</b>\nللاستفادة من خدمات المنصة وتصفح العقارات، يرجى <b>تأكيد رقم هاتفك</b> أولاً بضغطة زر واحدة:',
        { name: userName }
      );
      await replyTracked(ctx, userId, authText, { parse_mode: 'HTML', ...getAuthKeyboard() }, true);
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
    const refReward = Number(await cfg('referral_reward_points', '50'));

    try {
      const { error: insertError } = await supabase.from('users').insert([
        { id: userId, first_name: firstName, phone_number: phoneNumber, points: 0, referred_by: referrerId }
      ]);
      if (insertError) throw insertError;

      if (referrerId) {
        const refUser = await getUserRecord(referrerId);
        if (refUser) {
          const updatedPts = (refUser.points || 0) + refReward;
          await supabase.from('users').update({ points: updatedPts }).eq('id', referrerId);
          const refJoinedMsg = await cfg('referral_joined_msg_template', '', {
            points: refReward,
            total_points: updatedPts
          });
          await ctx.telegram.sendMessage(
            referrerId,
            refJoinedMsg,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }

      delete userState[userId];
      const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
      const mainKb = await buildUserMainKeyboard(userId, unreadCount);
      const verifiedSuccessMsg = await cfg('contact_verified_success_msg', '🎉 <b>تم توثيق حسابك بنجاح!</b>');
      await replyTracked(ctx, userId, verifiedSuccessMsg, {
        parse_mode: 'HTML', ...mainKb
      }, true);
    } catch (err) {
      const genericErrMsg = await cfg('generic_error_msg', '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
      await replyTracked(ctx, userId, genericErrMsg);
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
    if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي'))) {
      const verified = await isUserVerified(ctx.from.id);
      if (!verified) {
        const verifyReqMsg = await cfg('verify_phone_required_msg', '⚠️ عذراً، يجب عليك تأكيد رقم هاتفك أولاً عبر الزر أدناه:');
        return replyTracked(ctx, ctx.from.id, verifyReqMsg, getAuthKeyboard());
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
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const returnedHomeMsg = await cfg('returned_home_msg', '✅ العودة إلى القائمة الرئيسية:');
    await replyTracked(ctx, userId, returnedHomeMsg, {
      parse_mode: 'HTML', ...mainKb
    }, true);
  });

  bot.hears('⬅️ رجوع', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step === 'publishing') return;

    if (state.step === 'topup_keypad_amount') {
      delete userState[userId];
      return showWalletAndPointsScreen(ctx, userId);
    }

    if (state.step === 'topup_waiting_receipt') {
      state.step = 'topup_keypad_amount';
      return renderTopupAmountStep(ctx, userId);
    }

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
    await showWalletAndPointsScreen(ctx, ctx.from.id);
  });

  bot.hears('💳 شحن الرصيد (CCP / BaridiMob)', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const defaultAmt = sanitizeNumericPrice(await cfg('topup_default_amount', '100'));

    userState[userId] = {
      step: 'topup_keypad_amount',
      data: { amount: defaultAmt },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    return renderTopupAmountStep(ctx, userId);
  });

  bot.hears(['🌐 تصفح الموقع الرسمي (البروزر)', '🌐 تصفح الموقع الرسمي'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    if (!getWebsiteUrl()) {
      const unavailMsg = await cfg('website_unavailable_msg', '⚠️ الموقع غير متاح حالياً.');
      return replyTracked(ctx, userId, unavailMsg, { ...mainKb }, true);
    }
    const siteTitleMsg = await cfg('website_title_msg', '🌐 <b>منصة عقار الجزائر</b>');
    const siteBtnLabel = await cfg('website_btn_label', '🌐 فتح الموقع الرسمي');
    await replyTracked(ctx, userId, siteTitleMsg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.url(siteBtnLabel, getWebsiteUrl())]])
    }, true);
    await ctx.reply('👇', { ...mainKb }).then(m => trackBotMessage(userId, ctx.chat.id, m.message_id)).catch(() => {});
  });

  bot.hears('ℹ️ عن المنصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const aboutMsg = await cfg(
      'about_text',
      '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.'
    );
    await replyTracked(ctx, userId, aboutMsg, { parse_mode: 'HTML', ...mainKb }, true);
  });

  async function showStatesMenu(ctx) {
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const noAdsMsg = await cfg('no_ads_msg', '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.');
    const genericErrMsg = await cfg('generic_error_msg', '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
    try {
      const { data, error } = await supabase.from('test_messages').select('state_name');
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, noAdsMsg, mainKb, true);
      }

      const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
      const stateButtons = uniqueStates.map(state => `📍 ${state}`);
      const chunkedStates = chunkButtons(stateButtons, 4);
      chunkedStates.push(['🌐 الكل'], ['🏠 القائمة الرئيسية']);

      const browseTitle = await cfg('browse_title', '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>');
      await replyTracked(ctx, userId, browseTitle, { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() }, true);
    } catch (err) {
      console.error('showStatesMenu error:', err);
      await replyTracked(ctx, userId, genericErrMsg, mainKb, true);
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
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const noAdsMsg = await cfg('no_ads_msg', '📭 عذراً، لا توجد عقارات مسجلة.');
    const genericErrMsg = await cfg('generic_error_msg', '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
    const unrecordedText = await cfg('default_unrecorded_text', 'غير مسجل');
    const photoLabel = await cfg('media_photo_label', '🖼 صورة');
    const videoLabel = await cfg('media_video_label', '🎥 فيديو');
    const contactOwnerBtnLabel = await cfg('contact_owner_btn_label', '💬 مراسلة المالك');

    try {
      let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
      if (session.state !== 'ALL') query = query.eq('state_name', session.state);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, noAdsMsg, mainKb, true);
      }

      if (pageIndex < 0) pageIndex = 0;
      if (pageIndex >= data.length) pageIndex = data.length - 1;
      session.page = pageIndex;

      const item = data[pageIndex];
      const canContactOwner = Boolean(item.user_id && Number(item.user_id) !== Number(userId));
      session.currentProperty = item;

      const orderedMedia = buildOrderedBrowsingMedia(item);
      const totalMedia = orderedMedia.length;

      let safeMediaIndex = Number(mediaIndex) || 0;
      if (safeMediaIndex < 0) safeMediaIndex = 0;
      if (totalMedia > 0 && safeMediaIndex >= totalMedia) safeMediaIndex = totalMedia - 1;
      session.photoIndex = safeMediaIndex;

      const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIndex] : null;
      const mediaTypeLabel = currentMedia ? (currentMedia.type === 'video' ? videoLabel : photoLabel) : '';
      const mediaLine = totalMedia > 0 ? `\n${mediaTypeLabel}: <b>${safeMediaIndex + 1} / ${totalMedia}</b>` : '';
      const publishedAtText = item.created_at ? formatDateTime(item.created_at) : unrecordedText;

      const rawCaption = await cfg('property_card_template', '', {
        state_name: escapeHtml(item.state_name || ''),
        page_num: pageIndex + 1,
        total_count: data.length,
        property_type: escapeHtml(item.property_type || ''),
        price: formatMoney(item.price),
        phone: escapeHtml(item.phone || ''),
        published_at: escapeHtml(publishedAtText),
        media_line: mediaLine,
        description: escapeHtml(item.description || item.message || '')
      });

      const caption = fitTelegramText(rawCaption, !!currentMedia);
      const replyKb = getBrowsingKeyboard(pageIndex, data.length, safeMediaIndex, totalMedia, canContactOwner);
      const msgInlineKb = canContactOwner
        ? Markup.inlineKeyboard([
            [Markup.button.callback(contactOwnerBtnLabel, `msg_prop:${item.id}:${item.user_id}`)]
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
      await replyTracked(ctx, userId, genericErrMsg, mainKb, true);
    }
  }

  bot.hears(BTN_CONTACT_OWNER, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    let prop = session?.currentProperty || null;

    if (!prop && session) {
      try {
        let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
        if (session.state !== 'ALL') query = query.eq('state_name', session.state);
        const { data } = await query;
        if (Array.isArray(data) && data.length > 0) {
          const safeIdx = Math.min(Math.max(0, Number(session.page) || 0), data.length - 1);
          prop = data[safeIdx];
        }
      } catch (_) {}
    }

    if (!prop?.id || !prop?.user_id) {
      const missingMsg = await cfg('owner_missing_msg', '⚠️ <b>تعذر تحديد بيانات المالك لهذا العقار حالياً.</b>');
      return replyTracked(
        ctx,
        userId,
        missingMsg,
        { parse_mode: 'HTML' },
        true
      );
    }

    if (Number(prop.user_id) === Number(userId)) {
      const ownPropMsg = await cfg('own_property_msg', 'ℹ️ <b>هذا العقار منشور بحسابك.</b>');
      return replyTracked(
        ctx,
        userId,
        ownPropMsg,
        { parse_mode: 'HTML' },
        true
      );
    }

    if (typeof core.messenger?.startPropertyMessage === 'function') {
      await core.messenger.startPropertyMessage(ctx, { id: prop.id, user_id: prop.user_id });
    }
  });

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

    const pickNumMsg = await cfg('pick_property_number_template', '🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى {total}):</b>', { total: totalCount });
    await replyTracked(ctx, userId, pickNumMsg, {
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

    const ccpRip = await cfg('ccp_rip', '00234567890123456789');
    const ccpName = await cfg('ccp_name', '');
    const paidPrice = await cfg('paid_ad_price_dzd', '500');
    const nameLine = ccpName
      ? await cfg('topup_name_line_template', '\n👤 <b>الاسم:</b> {ccp_name}', { ccp_name: ccpName })
      : '';

    const ccpInstructions = await cfg('wizard_ccp_instructions_template', '', {
      paid_price: paidPrice,
      name_line: nameLine,
      ccp_rip: ccpRip
    });

    state.data.payment_label = await cfg('wizard_payment_label_ccp', '💳 تحويل بريدي موب / CCP');
    state.step = 'waiting_for_payment_receipt';
    await renderWizard(ctx, userId, { footer: ccpInstructions });
  });

  bot.hears('🆓 نشر مجاني', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    state.data.payment_label = await cfg('wizard_payment_label_free', '🆓 إعلان مجاني (بانتظار الإدارة)');
    state.step = 'publishing';

    const freeMarker = await cfg('free_ad_receipt_marker', 'FREE_NO_RECEIPT');
    const defaultSenderName = await cfg('default_sender_name', 'مستخدم');
    const unknownErrText = await cfg('default_unknown_error_text', 'خطأ غير معروف');

    try {
      const publishingText = await cfg('publishing_free_text', '⏳ جاري المعالجة وإرسال الإعلان المجاني للإدارة...');
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
          receipt_url: freeMarker,
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
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || defaultSenderName
      );

      const adminCaption = await cfg('free_ad_admin_caption_template', '', {
        request_id: requestId,
        submitted_at: escapeHtml(submittedAt),
        sender_name: senderName,
        user_id: userId,
        property_type: escapeHtml(state.data.property_type || ''),
        state_name: escapeHtml(state.data.state_name || ''),
        price: formatMoney(numericPrice),
        phone: escapeHtml(cleanPhone),
        photos_count: photosCount,
        videos_count: videosCount,
        description: escapeHtml(state.data.description || '')
      });
      const adminFooter = await cfg('free_ad_admin_footer', '👇 <b>تنبيه للإدارة: هذا إعلان مجاني — يرجى مراجعته واتخاذ القرار:</b>');

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
                `${adminCaption}\n\n${adminFooter}`,
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
      const userSubmittedMsg = await cfg('free_ad_submitted_user_template', '', {
        request_id: requestId,
        submitted_at: escapeHtml(submittedAt)
      });

      await replyTracked(ctx, userId,
        userSubmittedMsg,
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    } catch (err) {
      console.error('Free ad pending publish error:', err);
      delete userState[userId];
      const userFailedMsg = await cfg('free_ad_failed_user_template', '', {
        error: escapeHtml(err.message || unknownErrText)
      });
      await replyTracked(
        ctx, userId,
        userFailedMsg,
        { parse_mode: 'HTML', ...mainKb },
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
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const user = await getUserRecord(userId);
    const currentPoints = user ? (user.points || 0) : 0;
    const publishCost = Number(await cfg('publish_cost_points', '100'));
    const genericErrMsg = await cfg('generic_error_msg', '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');

    if (currentPoints < publishCost) {
      const warnText = await cfg('insufficient_points_warn_template', '', {
        points: currentPoints,
        publish_cost: publishCost
      });
      const warnMsg = await ctx.reply(
        warnText,
        { parse_mode: 'HTML' }
      );
      setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3500);
      return;
    }

    state.step = 'publishing';
    try {
      const publishingText = await cfg('publishing_text', '⏳ جاري المعالجة والحفظ...');
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
      const successMsg = await cfg('points_publish_success_template', '', {
        publish_cost: publishCost,
        published_at: escapeHtml(formatDateTime(nowIso))
      });

      await replyTracked(ctx, userId,
        successMsg,
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    } catch (err) {
      console.error('Free publish error:', err);
      delete userState[userId];
      await replyTracked(ctx, userId, genericErrMsg, mainKb, true);
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

  async function getQuickSupportPresets() {
    return {
      '🏠 إعلان أو تصفح عقاري': await cfg('preset_property_browse', 'العميل لديه استفسار بخصوص الإعلانات أو التصفح العقاري.'),
      '🪙 النقاط والمكافآت': await cfg('preset_points_rewards', 'العميل يستفسر عن النقاط والمكافآت.'),
      '💡 اقتراح أو تحسين': await cfg('preset_suggestion', 'العميل يشارك اقتراحاً أو فكرة لتحسين المنصة.'),
      '👏 شكر أو ملاحظة إيجابية': await cfg('preset_thanks', 'العميل يرسل رسالة شكر وتقدير للمنصة.'),
      '💬 استفسار عام / أخرى': await cfg('preset_general', 'العميل يطلب تواصلاً أو استفساراً عاماً مع الإدارة.')
    };
  }

  async function fetchUserOwnedAds(userId) {
    const ads = [];
    const approvedLabel = await cfg('ad_approved_label', '✅ مقبول');

    try {
      const { data: pendingRows } = await supabase
        .from('pending_properties').select('*').eq('user_id', userId).order('id', { ascending: false });

      if (Array.isArray(pendingRows)) {
        for (const row of pendingRows) {
          const st = row.status || 'pending';
          ads.push({ ...row, source: 'pending_properties', ad_status: st, status_label: await statusLabelOf(st) });
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
            ads.push({ ...row, source: 'test_messages', ad_status: 'approved', status_label: approvedLabel });
          }
        }
      }
    } catch (e) {}

    return ads;
  }

  function getSupportHubKeyboard(unreadRepliesCount = 0) {
    return Markup.keyboard([
      [getInquiriesMenuLabel(unreadRepliesCount), '📋 إعلاناتي وحالتها'],
      ['👤 ملفي الشخصي ورصيدي', '🗂 تصفح إعلاناتي الخاصة'],
      ['💬 دعم واقتراحات وشكر', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getSupportCategoriesKeyboard(unreadRepliesCount = 0) {
    return Markup.keyboard([
      ['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري'],
      ['🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين'],
      ['👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'],
      [
        getInquiriesMenuLabel(unreadRepliesCount),
        unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
      ],
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

  function getAdActionButtonsForStatus(ad, unreadRepliesCount = 0) {
    const id = ad.id || 'غير_محدد';
    const inqBtn = getInquiriesMenuLabel(unreadRepliesCount);
    if (ad.ad_status === 'pending') {
      return Markup.keyboard([
        [`❓ لماذا إعلاني معلق؟ (#${id})`],
        [`⏱️ تذكير الإدارة بمراجعة الطلب (#${id})`],
        [`📞 لماذا لم يتم التواصل معي؟ (#${id})`],
        [inqBtn, '⬅️ قائمة الإعلانات'],
        ['🏠 القائمة الرئيسية']
      ]).resize();
    }
    if (ad.ad_status === 'rejected') {
      return Markup.keyboard([
        [`❌ لماذا تم رفض إعلاني؟ (#${id})`],
        [`🔄 طلب إعادة مراجعة الإعلان (#${id})`],
        [inqBtn, '⬅️ قائمة الإعلانات'],
        ['🏠 القائمة الرئيسية']
      ]).resize();
    }
    return Markup.keyboard([
      [`⚠️ ملاحظة أو استفسار حول الإعلان (#${id})`],
      [inqBtn, '⬅️ قائمة الإعلانات'],
      ['🏠 القائمة الرئيسية']
    ]).resize();
  }

  function getUserOwnBrowsingKeyboard(index, total, mediaIdx = 0, totalMedia = 0, unreadRepliesCount = 0) {
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
    rows.push([
      getInquiriesMenuLabel(unreadRepliesCount),
      unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
    ]);
    rows.push(['🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  async function openSupportDashboard(ctx, userId) {
    const dbUser = await getUserRecord(userId);
    const allAds = await fetchUserOwnedAds(userId);
    const {
      inquiries: myInquiries,
      unreadRepliesCount,
      unreadInquiriesCount,
      readInquiriesCount
    } = await getClientRepliesSummary(userId);

    const pendingCount = allAds.filter(a => a.ad_status === 'pending').length;
    const approvedCount = allAds.filter(a => a.ad_status === 'approved').length;
    const rejectedCount = allAds.filter(a => a.ad_status === 'rejected').length;

    const points = dbUser?.points ?? 0;
    const walletBalance = formatMoney(sanitizeNumericPrice(dbUser?.wallet_balance || 0));
    const defaultClientName = await cfg('default_client_name', 'عميلنا الكريم');
    const name = escapeHtml(dbUser?.first_name || ctx.from.first_name || defaultClientName);
    const supportIntro = await cfg('support_text', '');
    const inqBtnLabel = getInquiriesMenuLabel(unreadRepliesCount);

    supportUserSession[userId] = { mode: 'dashboard', ads: allAds, unreadRepliesCount };
    userState[userId] = { step: 'support_dashboard', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    const alertLine = unreadRepliesCount > 0
      ? await cfg('support_unread_alert_template', '', {
          unread_replies: unreadRepliesCount,
          unread_inquiries: unreadInquiriesCount,
          inquiries_btn: inqBtnLabel
        })
      : '';

    const text = await cfg('support_dashboard_template', '', {
      name,
      wallet_balance: walletBalance,
      points,
      total_inquiries: myInquiries.length,
      unread_inquiries: unreadInquiriesCount,
      read_inquiries: readInquiriesCount,
      unread_replies: unreadRepliesCount,
      total_ads: allAds.length,
      pending_count: pendingCount,
      approved_count: approvedCount,
      rejected_count: rejectedCount,
      alert_line: alertLine,
      intro_block: supportIntro ? `\n\n${supportIntro}` : '',
      inquiries_btn: inqBtnLabel
    });

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) }, true);
  }

  async function renderUserOwnAdBrowser(ctx, userId, adIndex = 0, mediaIndex = 0) {
    const allAds = await fetchUserOwnedAds(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    if (!allAds.length) {
      const noOwnAdsMsg = await cfg('no_own_ads_msg', '📭 <b>لا توجد إعلانات مسجلة باسمك حتى الآن.</b>');
      return replyTracked(ctx, userId, noOwnAdsMsg,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) }, true);
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
      mode: 'browsing_own_ads', ads: allAds, page: safeIdx, mediaIndex: safeMediaIdx, selectingPage: false, unreadRepliesCount
    };

    const photoLabel = await cfg('media_photo_label', '🖼 صورة');
    const videoLabel = await cfg('media_video_label', '🎥 فيديو');
    const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIdx] : null;
    const mediaLine = totalMedia > 0
      ? `\n${currentMedia.type === 'video' ? videoLabel : photoLabel}: <b>${safeMediaIdx + 1} / ${totalMedia}</b>`
      : '';
    const adDateLine = ad.created_at
      ? await cfg('own_ad_time_template', '\n🕒 <b>التاريخ والوقت:</b> <code>{time}</code>', { time: escapeHtml(formatDateTime(ad.created_at)) })
      : '';

    const rawCaption = await cfg('own_ad_card_template', '', {
      page_num: safeIdx + 1,
      total_ads: allAds.length,
      status_label: ad.status_label,
      property_type: escapeHtml(ad.property_type || ''),
      state_name: escapeHtml(ad.state_name || ''),
      price: formatMoney(ad.price),
      phone: escapeHtml(ad.phone || ''),
      date_line: adDateLine,
      media_line: mediaLine,
      description: escapeHtml(ad.description || ad.message || '')
    });

    const caption = fitTelegramText(rawCaption, !!currentMedia);
    const kb = getUserOwnBrowsingKeyboard(safeIdx, allAds.length, safeMediaIdx, totalMedia, unreadRepliesCount);

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
          return { ...data, source: 'pending_properties', ad_status: st, status_label: await statusLabelOf(st) };
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
          return { ...row, source: 'pending_properties', ad_status: st, status_label: await statusLabelOf(st) };
        }
      }
    } catch (e) {}

    return candidate;
  }

  async function sendStructuredTicketToAdmins(ctx, senderUserId, ticketTitle, detailText, relatedAd = null, payloadType = 'text', mediaContent = {}, fallbackAdId = null, forcedAttachmentUrl = null) {
    const adminIds = await getAdminIds();
    const dbUser = await getUserRecord(senderUserId);
    const defaultSenderName = await cfg('default_sender_name', 'مستخدم');
    const freeMarker = await cfg('free_ad_receipt_marker', 'FREE_NO_RECEIPT');
    const photoDefaultCap = await cfg('ticket_admin_photo_default_caption', '\n🖼 <b>مرفق صورة من العميل</b>');
    const videoDefaultCap = await cfg('ticket_admin_video_default_caption', '\n🎥 <b>مرفق فيديو من العميل</b>');
    const receiptFooter = await cfg('ticket_receipt_attached_footer', '🧾 <b>وصل الدفع المرفق داخل الرسالة أعلاه 👆</b>');
    const bodyPrefix = await cfg('ticket_body_prefix', '\n💬 <b>الطلب:</b>\n');

    const fullName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || defaultSenderName
    );
    const phoneLine = dbUser?.phone_number ? `\n📞 <b>هاتف العميل:</b> <code>${escapeHtml(dbUser.phone_number)}</code>` : '';

    const resolvedAd = await resolvePendingRecordForReview(relatedAd, senderUserId, fallbackAdId);
    const receiptRef = normalizeMediaRef(resolvedAd?.receipt_url || forcedAttachmentUrl);
    const isFreeAd = resolvedAd?.receipt_url === freeMarker;

    const adIdNum = Number(resolvedAd?.id || fallbackAdId);
    const hasNumericAdId = Number.isFinite(adIdNum) && adIdNum > 0;
    const adIdLabel = resolvedAd?.id || fallbackAdId || null;

    const attachmentRef =
      payloadType === 'photo' && mediaContent.fileId
        ? `tg:${mediaContent.fileId}`
        : payloadType === 'video' && mediaContent.fileId
        ? `tg:${mediaContent.fileId}`
        : (forcedAttachmentUrl || null);

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
    const adTypeBadge = isFreeAd ? await cfg('free_ad_badge_line', '\n🏷 <b>نوع الإعلان:</b> <b>إعلان مجاني</b>') : '';
    const adTimeBadge = resolvedAd?.created_at
      ? await cfg('ad_created_time_template', '\n🕒 <b>تاريخ الإرسال:</b> <code>{time}</code>', { time: escapeHtml(formatDateTime(resolvedAd.created_at)) })
      : await cfg('ticket_request_time_template', '\n🕒 <b>وقت الطلب:</b> <code>{time}</code>', { time: escapeHtml(formatDateTime(new Date())) });

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
    const bodyText = detailText ? `${bodyPrefix}${escapeHtml(detailText)}` : '';
    const fullAdminText = header + bodyText;

    for (const adminId of adminIds) {
      try {
        if (payloadType === 'photo') {
          const cap = fitTelegramText(
            header + (mediaContent.caption ? `\n💬 <b>الطلب:</b> ${escapeHtml(mediaContent.caption)}` : photoDefaultCap),
            true
          );
          await ctx.telegram.sendPhoto(adminId, mediaContent.fileId, { caption: cap, parse_mode: 'HTML', ...replyMarkup });
        } else if (payloadType === 'video') {
          const cap = fitTelegramText(
            header + (mediaContent.caption ? `\n💬 <b>الطلب:</b> ${escapeHtml(mediaContent.caption)}` : videoDefaultCap),
            true
          );
          await ctx.telegram.sendVideo(adminId, mediaContent.fileId, { caption: cap, parse_mode: 'HTML', ...replyMarkup });
        } else if (receiptRef) {
          const receiptCaption = fitTelegramText(
            `${fullAdminText}\n\n${receiptFooter}`,
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

    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const inqRefLine = savedInq?.id
      ? await cfg('inq_ref_line_template', '\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#{inquiry_id}</code>', { inquiry_id: savedInq.id })
      : '';
    const sentMsg = await cfg('ad_inquiry_sent_template', '', {
      action_label: escapeHtml(actionLabel),
      req_id: escapeHtml(String(reqId)),
      inq_ref_line: inqRefLine
    });

    await replyTracked(
      ctx, userId,
      sentMsg,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [getInquiriesMenuLabel(unreadRepliesCount), '📋 إعلاناتي وحالتها'],
          [
            unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل',
            '🏠 القائمة الرئيسية'
          ]
        ]).resize()
      },
      true
    );
  }

  bot.hears(/^📨 استعلاماتي وردود الإدارة(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderClientInquiryAt(ctx, ctx.from.id, 0, true, 'all');
  });

  bot.hears(/^(?:✅\s*)?🔔 غير المقروءة(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderClientInquiryAt(ctx, ctx.from.id, 0, true, 'unread');
  });

  bot.hears(/^(?:✅\s*)?📖 المقروءة(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderClientInquiryAt(ctx, ctx.from.id, 0, true, 'read');
  });

  bot.hears(/^(?:✅\s*)?📚 الكل(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderClientInquiryAt(ctx, ctx.from.id, 0, true, 'all');
  });

  bot.hears('⬅️ استفساري السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    if (!st) return renderClientInquiryAt(ctx, userId, 0, true, 'all');
    await renderClientInquiryAt(ctx, userId, Math.max((st.index || 0) - 1, 0), false);
  });

  bot.hears('استفساري التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    if (!st) return renderClientInquiryAt(ctx, userId, 0, true, 'all');
    await renderClientInquiryAt(ctx, userId, (st.index || 0) + 1, false);
  });

  bot.hears(/^📋 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showClientInquiryIndexMenu(ctx, ctx.from.id);
  });

  bot.hears('🔙 رجوع للاستعلام', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const st = clientInquiryBrowse[userId];
    await renderClientInquiryAt(ctx, userId, st?.index || 0, false);
  });

  bot.hears(/^💬 متابعة الاستعلام #(\d+)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const parentInquiryId = Number(ctx.match[1]);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);

    userState[userId] = {
      step: 'client_following_up_inquiry',
      data: { parentInquiryId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const followPrompt = await cfg('follow_up_prompt_template', '', { parent_id: parentInquiryId });

    await replyTracked(
      ctx, userId,
      followPrompt,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [
            getInquiriesMenuLabel(unreadRepliesCount),
            unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
          ]
        ]).resize()
      },
      true
    );
  });

  bot.action(/^adinq:([a-z_]+):(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const inquiryKey = ctx.match[1];
    const reqId = decodeURIComponent(ctx.match[2]);
    const defaultActionLabel = await cfg('default_inquiry_action_label', 'استفسار حول الإعلان');
    const actionLabel = AD_INQUIRY_TYPES[inquiryKey] || defaultActionLabel;
    const ackMsg = await cfg('ad_inquiry_callback_ack', '✅ تم تسجيل وإرسال استفسارك للإدارة');

    await ctx.answerCbQuery(ackMsg);
    await processAdInquiryAction(ctx, userId, actionLabel, reqId);
  });

  bot.hears(/^(❓ لماذا إعلاني معلق\؟|⏱️ تذكير الإدارة بمراجعة الطلب|📞 لماذا لم يتم التواصل معي\؟|❌ لماذا تم رفض إعلاني\؟|🔄 طلب إعادة مراجعة الإعلان|⚠️ ملاحظة أو استفسار حول الإعلان) \(#([^)]+)\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await processAdInquiryAction(ctx, ctx.from.id, ctx.match[1], ctx.match[2]);
  });

  bot.hears(/^📞 الدعم والإدارة(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openSupportDashboard(ctx, ctx.from.id);
  });

  bot.hears(/^⬅️ لوحة العميل(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openSupportDashboard(ctx, ctx.from.id);
  });

  bot.hears('👤 ملفي الشخصي ورصيدي', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const dbUser = await getUserRecord(userId);
    const allAds = await fetchUserOwnedAds(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const defaultProfileName = await cfg('default_profile_name', 'غير محدد');

    const text = await cfg('profile_card_template', '', {
      name: escapeHtml(dbUser?.first_name || ctx.from.first_name || defaultProfileName),
      wallet_balance: formatMoney(dbUser?.wallet_balance || 0),
      points: dbUser?.points ?? 0,
      ads_count: allAds.length
    });

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) }, true);
  });

  async function showAdsFilterMenu(ctx, userId, intro) {
    const allAds = await fetchUserOwnedAds(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    supportUserSession[userId] = { mode: 'ads_filter', ads: allAds, unreadRepliesCount };

    const pending = allAds.filter(a => a.ad_status === 'pending').length;
    const approved = allAds.filter(a => a.ad_status === 'approved').length;
    const rejected = allAds.filter(a => a.ad_status === 'rejected').length;

    await replyTracked(ctx, userId, intro, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        [`⏳ معلقة (${pending})`, `✅ مقبولة (${approved})`],
        [`❌ مرفوضة (${rejected})`, `📌 الكل (${allAds.length})`],
        [
          getInquiriesMenuLabel(unreadRepliesCount),
          unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
        ],
        ['🏠 القائمة الرئيسية']
      ]).resize()
    }, true);
  }

  bot.hears('📋 إعلاناتي وحالتها', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const intro = await cfg('ads_filter_intro', '');
    await showAdsFilterMenu(ctx, ctx.from.id, intro);
  });

  bot.hears('⬅️ قائمة الإعلانات', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const intro = await cfg('ads_back_list_intro', '');
    await showAdsFilterMenu(ctx, ctx.from.id, intro);
  });

  bot.hears(/^(⏳ معلقة|✅ مقبولة|❌ مرفوضة|📌 الكل) \(\d+\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const prefix = ctx.match[1];
    const allAds = await fetchUserOwnedAds(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const freeMarker = await cfg('free_ad_receipt_marker', 'FREE_NO_RECEIPT');
    const freeShortTag = await cfg('free_ad_short_tag', ' • 🆓 مجاني');

    let filtered = allAds;
    let label = await cfg('filter_all_label', 'جميع إعلاناتك');
    if (prefix.startsWith('⏳')) {
      filtered = allAds.filter(a => a.ad_status === 'pending'); label = 'إعلاناتك المعلقة';
    } else if (prefix.startsWith('✅')) {
      filtered = allAds.filter(a => a.ad_status === 'approved'); label = 'إعلاناتك المقبولة';
    } else if (prefix.startsWith('❌')) {
      filtered = allAds.filter(a => a.ad_status === 'rejected'); label = 'إعلاناتك المرفوضة';
    }

    if (!filtered.length) {
      const emptyCatMsg = await cfg('no_ads_in_category_template', '', { category_label: escapeHtml(label) });
      return replyTracked(ctx, userId,
        emptyCatMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['📋 إعلاناتي وحالتها'],
            [
              unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل',
              '🏠 القائمة الرئيسية'
            ]
          ]).resize()
        }, true);
    }

    supportUserSession[userId] = { mode: 'select_ad_for_action', ads: filtered, unreadRepliesCount };

    const listLines = await Promise.all(filtered.slice(0, 15).map(async (ad, idx) => {
      const adKind = ad.receipt_url === freeMarker ? freeShortTag : '';
      const adDate = ad.created_at
        ? await cfg('ad_list_date_tag_template', ' • 🕒 {time}', { time: formatDateTime(ad.created_at) })
        : '';
      return `${idx + 1}. ${ad.status_label} <b>#${ad.id || '—'}</b> — ${escapeHtml(ad.property_type || '')} (${escapeHtml(ad.state_name || '')}) • ${formatMoney(ad.price)}${adKind}${adDate}`;
    }));

    const adButtons = filtered.slice(0, 12).map(ad => `📄 إعلان #${ad.id || '—'} (${ad.property_type || ''})`);
    const categoryListMsg = await cfg('ads_category_list_template', '', {
      category_label: escapeHtml(label),
      count: filtered.length,
      lines: listLines.join('\n')
    });

    await replyTracked(
      ctx, userId,
      categoryListMsg,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ...chunkButtons(adButtons, 2),
          [
            '⬅️ قائمة الإعلانات',
            unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
          ]
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
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const targetAd = allAds.find(a => String(a.id) === String(reqIdStr)) || allAds[0];
    if (!targetAd) return;

    supportUserSession[userId] = { mode: 'ad_actions', ads: allAds, selectedAd: targetAd, unreadRepliesCount };

    const freeMarker = await cfg('free_ad_receipt_marker', 'FREE_NO_RECEIPT');
    const adKindLine = targetAd.receipt_url === freeMarker
      ? await cfg('free_ad_detail_line', '\n• <b>النوع:</b> <b>إعلان مجاني</b>')
      : '';
    const adDateLine = targetAd.created_at
      ? await cfg('ad_detail_time_template', '\n• <b>التاريخ والوقت:</b> <code>{time}</code>', { time: escapeHtml(formatDateTime(targetAd.created_at)) })
      : '';

    const cardText = await cfg('ad_detail_card_template', '', {
      ad_id: escapeHtml(String(targetAd.id || '—')),
      status_label: targetAd.status_label,
      free_line: adKindLine,
      date_line: adDateLine,
      property_type: escapeHtml(targetAd.property_type || ''),
      state_name: escapeHtml(targetAd.state_name || ''),
      price: formatMoney(targetAd.price),
      description: escapeHtml(targetAd.description || targetAd.message || '')
    });

    await replyTracked(ctx, userId, cardText, {
      parse_mode: 'HTML',
      ...getInteractiveAdInlineKeyboard(targetAd),
      ...getAdActionButtonsForStatus(targetAd, unreadRepliesCount)
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

    const pickOwnAdMsg = await cfg('pick_own_ad_number_template', '🔢 <b>اختر رقم إعلانك للانتقال إليه مباشرة (1 إلى {total}):</b>', { total });
    await replyTracked(ctx, userId, pickOwnAdMsg,
      { parse_mode: 'HTML', ...Markup.keyboard(rows).resize() }, true);
  });

  bot.hears('💬 دعم واقتراحات وشكر', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    userState[userId] = { step: 'support_selecting_category', data: {}, chatId: ctx.chat.id, wizardMsgId: null };
    const selectCatMsg = await cfg('support_select_category_msg', '💬 <b>اختر نوع الرسالة أو الملاحظة:</b>');

    await replyTracked(ctx, userId, selectCatMsg,
      { parse_mode: 'HTML', ...getSupportCategoriesKeyboard(unreadRepliesCount) }, true);
  });

  bot.hears('💳 مشكلة في الدفع', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const topups = await fetchUserWalletTopups(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const dashBtn = unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل';
    const topupStatusMap = await getTopupStatusMap();
    const pendingTopupLabel = await cfg('topup_pending_label', '⏳ معلق');

    if (!topups || topups.length === 0) {
      userState[userId] = {
        step: 'payment_issue_writing_detail',
        data: { selectedTopup: null },
        chatId: ctx.chat.id,
        wizardMsgId: null
      };

      const noTopupsMsg = await cfg('payment_issue_no_topups_msg', '');

      return replyTracked(
        ctx, userId,
        noTopupsMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['⏳ لم يصلني الرصيد بعد', '❌ تم رفض الدفع بدون سبب واضح'],
            ['💬 دعم واقتراحات وشكر', dashBtn]
          ]).resize()
        },
        true
      );
    }

    const labelToTopup = {};
    const summaryLines = await Promise.all(topups.map(async (t, i) => {
      const lbl = formatTopupChoiceLabel(t);
      labelToTopup[lbl] = t;
      const stText = topupStatusMap[t.status] || t.status || pendingTopupLabel;
      const amtText = formatMoney(sanitizeNumericPrice(t.amount || 0));
      const dtText = t.created_at
        ? await cfg('topup_date_tag_template', ' • <code>{time}</code>', { time: escapeHtml(formatDateTime(t.created_at)) })
        : '';
      return `${i + 1}. <b>#${t.id}</b> — <b>${amtText}</b> (${stText})${dtText}`;
    }));

    userState[userId] = {
      step: 'payment_issue_selecting_topup',
      data: { labelToTopup },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const btnRows = chunkButtons(Object.keys(labelToTopup), 2);
    btnRows.push(['💬 دعم واقتراحات وشكر', dashBtn]);
    btnRows.push(['🏠 القائمة الرئيسية']);

    const selectTopupMsg = await cfg('payment_issue_select_topup_template', '', {
      lines: summaryLines.join('\n')
    });

    await replyTracked(
      ctx, userId,
      selectTopupMsg,
      { parse_mode: 'HTML', ...Markup.keyboard(btnRows).resize() },
      true
    );
  });

  bot.hears(['🏠 إعلان أو تصفح عقاري', '🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين', '👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const chosenCat = ctx.message.text.trim();
    const presets = await getQuickSupportPresets();
    const presetDetail = presets[chosenCat] || chosenCat;
    const thanksDefault = await cfg('thanks_msg_text', '👏 <b>شكراً جزيلاً لك على كلماتك الطيبة وثقتك بمنصة عقار الجزائر.</b>');

    const savedInq = await sendStructuredTicketToAdmins(ctx, userId, chosenCat, presetDetail, null, 'text');
    delete userState[userId];
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);

    const inqTag = savedInq?.id
      ? await cfg('inq_ref_line_template', '\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#{inquiry_id}</code>', { inquiry_id: savedInq.id })
      : '';
    const catSentMsg = await cfg('support_cat_sent_template', '', {
      category: escapeHtml(chosenCat),
      inq_tag: inqTag
    });
    const confirmMsg = chosenCat === '👏 شكر أو ملاحظة إيجابية'
      ? `${thanksDefault}${inqTag}`
      : catSentMsg;

    await replyTracked(ctx, userId, confirmMsg, { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) }, true);
  });

  bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userText = ctx.message.text ? ctx.message.text.trim() : '';
    if (userText.startsWith('/')) return;

    if (userText === core.WAIT_BTN_TEXT) {
      await safeDeleteUserMessage(ctx);
      return;
    }

    const inqBrowse = clientInquiryBrowse[userId];
    if (inqBrowse && inqBrowse.selectingIndex && inqBrowse.labelMap && Object.prototype.hasOwnProperty.call(inqBrowse.labelMap, userText)) {
      await safeDeleteUserMessage(ctx);
      const chosenIdx = inqBrowse.labelMap[userText];
      return renderClientInquiryAt(ctx, userId, chosenIdx, false);
    }

    const state = userState[userId];
    if (!state) {
      await notifyUseButtonsHint(ctx, userId);
      return;
    }

    if (state.step === 'topup_keypad_amount') {
      await safeDeleteUserMessage(ctx);
      let currentAmt = sanitizeNumericPrice(state.data?.amount || 0);
      const steps = await getTopupSteps();
      const factor = await getMultiplierFactorValue();
      const multButtonText = `✖️${factor}`;
      const matchedStep = steps.find(s => s.label === userText);

      if (userText.startsWith('💰 المبلغ الحالي:')) {
        return;
      }

      if (matchedStep) {
        currentAmt += matchedStep.amount;
        state.data.amount = currentAmt;
        return renderTopupAmountStep(ctx, userId);
      }

      if (userText === multButtonText || userText === '✖️2') {
        const defaultAmt = sanitizeNumericPrice(await cfg('topup_default_amount', '100'));
        currentAmt = currentAmt > 0 ? currentAmt * factor : defaultAmt;
        state.data.amount = currentAmt;
        return renderTopupAmountStep(ctx, userId);
      }

      if (userText === '⌫') {
        const strAmt = String(currentAmt);
        currentAmt = strAmt.length > 1 ? sanitizeNumericPrice(strAmt.slice(0, -1)) : 0;
        state.data.amount = currentAmt;
        return renderTopupAmountStep(ctx, userId);
      }

      if (userText === '🗑️ مسح') {
        state.data.amount = 0;
        return renderTopupAmountStep(ctx, userId);
      }

      if (userText === '✅ [ OK ] تأكيد') {
        if (!currentAmt || currentAmt <= 0) {
          const invalidAmtMsg = await cfg(
            'topup_invalid_amount_msg',
            '⚠️ <b>يرجى تكوين مبلغ أكبر من الصفر عبر أزرار المضاعفات أولاً.</b>'
          );
          return renderTopupAmountStep(ctx, userId, invalidAmtMsg);
        }

        state.step = 'topup_waiting_receipt';
        const askReceiptMsg = await cfg('topup_ask_receipt_template', '', {
          amount: formatMoney(currentAmt)
        });

        return replyTracked(
          ctx, userId,
          askReceiptMsg,
          {
            parse_mode: 'HTML',
            ...Markup.keyboard([
              ['⬅️ رجوع', '🏠 القائمة الرئيسية']
            ]).resize()
          },
          true
        );
      }

      // أي كتابة يدوية غير زر معروف تُرفض ويُنبَّه المستخدم لاستعمال الأزرار
      await notifyUseButtonsHint(ctx, userId);
      return;
    }

    if (state.step === 'payment_issue_selecting_topup') {
      await safeDeleteUserMessage(ctx);
      const chosenTopup = state.data?.labelToTopup?.[userText];
      if (!chosenTopup) {
        const pickWarn = await cfg('payment_issue_pick_button_warn', '⚠️ <b>يرجى اختيار إحدى الدفعات من الأزرار الظاهرة في الأسفل:</b>');
        return replyTracked(
          ctx, userId,
          pickWarn,
          { parse_mode: 'HTML' },
          true
        );
      }

      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const dashBtn = unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل';
      const topupStatusMap = await getTopupStatusMap();
      const pendingTopupLabel = await cfg('topup_pending_label', '⏳ معلق');
      const unrecordedText = await cfg('default_unrecorded_text', 'غير مسجل');

      state.step = 'payment_issue_writing_detail';
      state.data = { selectedTopup: chosenTopup };

      const amtText = formatMoney(sanitizeNumericPrice(chosenTopup.amount || 0));
      const stText = topupStatusMap[chosenTopup.status] || chosenTopup.status || pendingTopupLabel;
      const dtText = chosenTopup.created_at ? formatDateTime(chosenTopup.created_at) : unrecordedText;

      const detailPromptMsg = await cfg('payment_issue_detail_prompt_template', '', {
        topup_id: chosenTopup.id,
        amount: amtText,
        status: stText,
        created_at: escapeHtml(dtText)
      });

      return replyTracked(
        ctx, userId,
        detailPromptMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['⏳ لم يصلني الرصيد بعد', '❌ تم رفض الدفع بدون سبب واضح'],
            ['💬 دعم واقتراحات وشكر', dashBtn]
          ]).resize()
        },
        true
      );
    }

    if (state.step === 'payment_issue_writing_detail') {
      await safeDeleteUserMessage(ctx);
      const topup = state.data?.selectedTopup || null;
      const topupRef = topup ? normalizeMediaRef(topup.receipt_urls || topup.receipt_url) : null;
      const topupStatusMap = await getTopupStatusMap();
      const pendingTopupLabel = await cfg('topup_pending_label', '⏳ معلق');
      const unrecordedText = await cfg('default_unrecorded_text', 'غير مسجل');

      const subjectTitle = topup
        ? `مشكلة في الدفع — طلب شحن #${topup.id}`
        : 'مشكلة في الدفع';

      const topupContextLine = topup
        ? `[بيانات الدفعة: طلب #${topup.id} | المبلغ: ${formatMoney(sanitizeNumericPrice(topup.amount || 0))} | الحالة الحالية: ${topupStatusMap[topup.status] || topup.status || pendingTopupLabel} | التاريخ: ${topup.created_at ? formatDateTime(topup.created_at) : unrecordedText}]\n`
        : '';

      const savedInq = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        subjectTitle,
        `${topupContextLine}تفاصيل الاستعلام: ${userText}`,
        null,
        'text',
        {},
        null,
        topupRef
      );

      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const inqTag = savedInq?.id
        ? await cfg('inq_ref_line_template', '\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#{inquiry_id}</code>', { inquiry_id: savedInq.id })
        : '';
      const sentMsg = await cfg('payment_issue_sent_template', '', {
        inq_tag: inqTag,
        inquiries_btn: getInquiriesMenuLabel(unreadRepliesCount)
      });

      return replyTracked(
        ctx, userId,
        sentMsg,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

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
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      const followSentMsg = await cfg('follow_up_sent_template', '', { follow_ref: followRef });

      return replyTracked(
        ctx,
        userId,
        followSentMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            [
              getInquiriesMenuLabel(unreadRepliesCount),
              unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
            ],
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
      await notifyUseButtonsHint(ctx, userId);
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
          const enterNumWarn = await cfg('wizard_enter_number_warn', '⚠️ <b>يرجى إدخال الرقم في الحقل أولاً!</b>');
          const warnMsg = await ctx.reply(enterNumWarn, { parse_mode: 'HTML' });
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
            const shortPhoneWarn = await cfg('wizard_short_phone_warn', '⚠️ <b>رقم الهاتف قصير جداً!</b>');
            const warnMsg = await ctx.reply(shortPhoneWarn, { parse_mode: 'HTML' });
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
      await notifyUseButtonsHint(ctx, userId);
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
          const pickFeatureWarn = await cfg('wizard_pick_feature_warn', '⚠️ <b>يرجى اختيار ميزة واحدة على الأقل قبل التأكيد!</b>');
          const warnMsg = await ctx.reply(pickFeatureWarn, { parse_mode: 'HTML' });
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
      await notifyUseButtonsHint(ctx, userId);
      return;
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
          const pickMediaWarn = await cfg('wizard_pick_media_warn', '⚠️ <b>يرجى إرسال صورة أو فيديو واحد على الأقل أولاً!</b>');
          const warnMsg = await ctx.reply(pickMediaWarn, { parse_mode: 'HTML' });
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
          return;
        }
        state.step = 'waiting_for_payment_choice';
        return renderWizard(ctx, userId);
      }
      await notifyUseButtonsHint(ctx, userId);
      return;
    }

    await notifyUseButtonsHint(ctx, userId);
  });

  bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const maxMediaMsg = await cfg('max_media_msg_template', '⚠️ <b>وصلت للحد الأقصى ({max} ملفات).</b> اضغط زر الإنهاء في الأسفل.', { max: MAX_PROPERTY_IMAGES });
    const unknownErrText = await cfg('default_unknown_error_text', 'خطأ غير معروف');
    const genericErrMsg = await cfg('generic_error_msg', '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');

    await safeDeleteUserMessage(ctx);

    if (state && state.step === 'topup_waiting_receipt') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const amount = state.data?.amount || 0;
      state.step = 'publishing';

      try {
        return await submitWalletTopupRequest(ctx, userId, amount, photo.file_id);
      } catch (err) {
        console.error('submitWalletTopupRequest error:', err);
        delete userState[userId];
        const topupFailedMsg = await cfg('topup_failed_user_template', '', { error: escapeHtml(err.message || unknownErrText) });
        return replyTracked(
          ctx, userId,
          topupFailedMsg,
          { parse_mode: 'HTML', ...mainKb },
          true
        );
      }
    }

    if (state && state.step === 'client_following_up_inquiry') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const parentId = state.data?.parentInquiryId;
      const defaultPhotoCap = await cfg('follow_up_photo_default_caption', '🖼 صورة مرفقة من العميل');
      const savedFollow = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        ctx.message.caption || defaultPhotoCap,
        null,
        'photo',
        { fileId: photo.file_id, caption: ctx.message.caption || '' },
        parentId || null
      );
      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      const photoSentMsg = await cfg('follow_up_photo_sent_template', '', { follow_ref: followRef });

      return replyTracked(
        ctx,
        userId,
        photoSentMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            [
              getInquiriesMenuLabel(unreadRepliesCount),
              unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
            ],
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
        const warnMsg = await ctx.reply(maxMediaMsg, { parse_mode: 'HTML' });
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
        return;
      }

      state.data.media_items.push({ type: 'photo', file_id: photo.file_id });
      state.data.media_label = await formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId);
    }

    if (state && state.step === 'waiting_for_payment_receipt') {
      const receiptPhoto = ctx.message.photo[ctx.message.photo.length - 1];
      state.step = 'publishing';

      try {
        const publishingText = await cfg('publishing_text', '⏳ جاري المعالجة والحفظ...');
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

        const adminCaption = await cfg('receipt_ad_admin_caption_template', '', {
          request_id: requestId,
          submitted_at: escapeHtml(submittedAt),
          user_id: userId,
          property_type: escapeHtml(state.data.property_type || ''),
          state_name: escapeHtml(state.data.state_name || ''),
          price: formatMoney(numericPrice),
          phone: escapeHtml(cleanPhone),
          photos_count: photosCount,
          videos_count: videosCount,
          description: escapeHtml(state.data.description || '')
        });
        const adminFooter = await cfg('receipt_ad_admin_footer', '👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ قرار:</b>');

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
                `${adminCaption}\n\n${adminFooter}`,
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
        const userReceiptMsg = await cfg('receipt_ad_submitted_user_template', '', {
          request_id: requestId,
          submitted_at: escapeHtml(submittedAt)
        });

        await replyTracked(ctx, userId,
          userReceiptMsg,
          { parse_mode: 'HTML', ...mainKb },
          true
        );
      } catch (err) {
        console.error('Receipt publish error:', err);
        delete userState[userId];
        await replyTracked(ctx, userId, genericErrMsg, mainKb, true);
      }
    }
  });

  bot.on('video', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const maxMediaMsg = await cfg('max_media_msg_template', '⚠️ <b>وصلت للحد الأقصى ({max} ملفات).</b> اضغط زر الإنهاء في الأسفل.', { max: MAX_PROPERTY_IMAGES });

    await safeDeleteUserMessage(ctx);

    if (state && state.step === 'client_following_up_inquiry') {
      const parentId = state.data?.parentInquiryId;
      const defaultVideoCap = await cfg('follow_up_video_default_caption', '🎥 فيديو مرفق من العميل');
      const savedFollow = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        parentId ? `متابعة للاستعلام #${parentId}` : 'متابعة استفسار',
        ctx.message.caption || defaultVideoCap,
        null,
        'video',
        { fileId: ctx.message.video.file_id, caption: ctx.message.caption || '' },
        parentId || null
      );
      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const followRef = savedFollow?.id ? ` (رقم الاستعلام: <code>#${savedFollow.id}</code>)` : '';
      const videoSentMsg = await cfg('follow_up_video_sent_template', '', { follow_ref: followRef });

      return replyTracked(
        ctx,
        userId,
        videoSentMsg,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            [
              getInquiriesMenuLabel(unreadRepliesCount),
              unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل'
            ],
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
        const warnMsg = await ctx.reply(maxMediaMsg, { parse_mode: 'HTML' });
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 2500);
        return;
      }

      state.data.media_items.push({ type: 'video', file_id: video.file_id });
      state.data.media_label = await formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId);
    }
  });

  return { openUserHome };
};
