'use strict';
// =========================================================================
// 👤 SERVER USERS — كل ما يخص المستخدم
// يستدعيه server.js (الأب) للمستخدمين العاديين، وللأدمن في وضع المعاينة.
// يربط منطق التصفح والمفضلة عبر browse.js.
// =========================================================================

const BTN_RATE_PLATFORM = '⭐ تقييم المنصة';
const BTN_FAVORITES_MENU = '⭐ مفضلاتي';
const registerPlatformRating = require('./platform_rating');
const registerBrowse = require('./browse');

module.exports = function registerUsers(bot, core) {
  const {
    Markup, supabase, app, WEBHOOK_DOMAIN, MAX_PROPERTY_IMAGES,
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

  const FREE_TEXT_STEPS = new Set([
    'payment_issue_writing_detail',
    'topup_waiting_amount',
    'client_following_up_inquiry'
  ]);

  function registerFreeTextStep(stepName) {
    if (stepName) FREE_TEXT_STEPS.add(stepName);
  }

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

    const hintMsg = await ctx.reply(
      '👇 <b>يرجى استعمال الأزرار التفاعلية في الأسفل</b> — هذا الموضع غير مخصص للكتابة اليدوية.',
      { parse_mode: 'HTML' }
    ).catch(() => null);

    if (hintMsg?.message_id) {
      const hintMsgId = hintMsg.message_id;
      buttonHintTimers[userId] = setTimeout(async () => {
        delete buttonHintTimers[userId];
        await ctx.telegram.deleteMessage(chatId, hintMsgId).catch(() => {});
      }, 3500);
    }
  }

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

  const TOPUP_STATUS_TEXT = {
    pending: '⏳ معلق',
    approved: '✅ مقبول',
    rejected: '❌ مرفوض'
  };

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
          [BTN_FAVORITES_MENU, 'ℹ️ عن المنصة'],
          ['🌐 تصفح الموقع الرسمي (البروزر)', BTN_RATE_PLATFORM]
        ]).resize();

    return applySupportBadgeToKeyboard(baseKb, unreadRepliesCount);
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

  const browse = registerBrowse(bot, core, {
    buildUserMainKeyboard,
    getUniqueStatesList
  });

  const platformRating = registerPlatformRating(bot, core, {
    buildUserMainKeyboard,
    registerFreeTextStep
  });

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

  async function submitPropertyWithReceiptRequest(ctx, userId, adData, receiptFileId, topupAmount = null) {
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);

    const publishingText = await getSetting('publishing_text', '⏳ جاري المعالجة وحفظ طلب النشر مع الوصل...');
    await renderWizard(ctx, userId, { footer: publishingText });

    const mediaItems = adData.media_items || [];
    const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
    const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');

    const receiptUrl = await uploadSingleReceiptToStorage(ctx, receiptFileId, userId);

    const numericPrice = sanitizeNumericPrice(adData.price);
    const cleanPhone = String(adData.phone || '').replace(/\D/g, '').trim();

    const { data: insertedRow, error: insertError } = await supabase
      .from('pending_properties')
      .insert([{
        user_id: userId,
        property_type: adData.property_type,
        state_name: adData.state_name,
        price: numericPrice,
        phone: cleanPhone,
        description: adData.description,
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

    const topupNoteLine = topupAmount
      ? `\n💳 <b>طلب شحن مرفق بالنشر (BaridiMob / CCP):</b> <b>${formatMoney(topupAmount)}</b>`
      : '';

    const adminCaption =
      `🚨 <b>طلب إعلان عقاري جديد (#${requestId})</b>${topupNoteLine}\n` +
      `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
      `👤 <b>معرف المستخدم:</b> <code>${userId}</code>\n` +
      `🏠 <b>النوع:</b> ${escapeHtml(adData.property_type || '')}\n` +
      `📍 <b>الولاية:</b> ${escapeHtml(adData.state_name || '')}\n` +
      `💰 <b>السعر:</b> ${formatMoney(numericPrice)}\n` +
      `📞 <b>الهاتف:</b> ${escapeHtml(cleanPhone)}\n` +
      `🖼 <b>عدد الصور:</b> ${photosCount}\n` +
      `🎥 <b>عدد الفيديوهات:</b> ${videosCount}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(adData.description || '')}`;

    const adminButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback(`❌ رفض (#${requestId})`, `reject_${requestId}`),
        Markup.button.callback(`✅ قبول ونشر (#${requestId})`, `approve_${requestId}`)
      ]
    ]);

    const photoSource =
      typeof receiptUrl === 'string' && receiptUrl.startsWith('http') ? receiptUrl : receiptFileId;

    const adminIds = await getAdminIds();

    for (const currentAdminId of adminIds) {
      try {
        await ctx.telegram.sendPhoto(currentAdminId, photoSource, {
          caption: fitTelegramText(
            adminCaption + `\n\n👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ القرار:</b>`,
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
      `⏳ <b>تم إرسال طلب نشر عقارك مرفقاً بالوصل برقم (#${requestId})!</b>\n🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\nالعقار في طور المراجعة والموافقة من طرف الإدارة، وسيتم نشره مباشرة عند الموافقة على الوصل والطلب.`,
      { parse_mode: 'HTML', ...mainKb },
      true
    );
  }

  async function submitWalletTopupRequest(ctx, userId, amount, receiptFileId) {
    const stateData = userState[userId]?.data || {};
    if (stateData.publishAdDraft && stateData.publishAdDraft.property_type) {
      return await submitPropertyWithReceiptRequest(
        ctx,
        userId,
        stateData.publishAdDraft,
        receiptFileId,
        amount
      );
    }

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const cleanAmount = sanitizeNumericPrice(amount);

    if (!cleanAmount || cleanAmount <= 0 || !receiptFileId) {
      delete userState[userId];
      return replyTracked(ctx, userId, '⚠️ البيانات غير مكتملة، يرجى المحاولة مرة أخرى.', {
        parse_mode: 'HTML', ...mainKb
      }, true);
    }

    const receiptUrl = await uploadSingleReceiptToStorage(ctx, receiptFileId, userId);

    const { data: topupRow, error } = await supabase
      .from('wallet_topups')
      .insert([{
        user_id: Number(userId),
        amount: cleanAmount,
        receipt_urls: receiptUrl,
        payment_method: 'BaridiMob / CCP',
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    const topupId = topupRow.id;
    const submittedAt = formatDateTime(topupRow.created_at || new Date());
    const dbUser = await getUserRecord(userId);
    const senderName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
    );

    const adminCaption =
      `💳 <b>طلب شحن محفظة (#${topupId})</b>\n` +
      `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
      `👤 <b>العميل:</b> ${senderName} (<code>${userId}</code>)\n` +
      `💰 <b>مبلغ الشحن:</b> <b>${formatMoney(cleanAmount)}</b>`;

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
            adminCaption + `\n\n👇 <b>يرجى مراجعة وصل الدفع أعلاه واتخاذ القرار:</b>`,
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
    await replyTracked(
      ctx, userId,
      `✨ <b>وصلتنا تفاصيل تحويلك بنجاح (طلب #${topupId})</b>\n\n` +
      `💼 <b>المبلغ:</b> <b>${formatMoney(cleanAmount)}</b>\n` +
      `🕒 <b>التوقيت:</b> <code>${escapeHtml(submittedAt)}</code>\n\n` +
      `سيُضاف الرصيد إلى محفظتك فور تأكيد العملية من فريق المراجعة، لتكون جاهزاً متى شئت.`,
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
    if (/تقييم المنصة/.test(titleText)) return 'rating';
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

  function getFilterModeTitle(mode = 'all') {
    if (mode === 'unread') return '🔔 غير المقروءة';
    if (mode === 'read') return '📖 المقروءة';
    return '📚 الكل';
  }

  function getInquiriesMenuLabel(unreadRepliesCount = 0) {
    return unreadRepliesCount > 0
      ? `📨 استعلاماتي وردود الإدارة (${unreadRepliesCount})`
      : '📨 استعلاماتي وردود الإدارة';
  }

  function buildInquiryIndexButtonLabel(inq, pos, unreadRepCount = 0, totalRepCount = 0) {
    const subj = String(inq.subject || inq.message || 'استفسار').replace(/\s+/g, ' ').trim();
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

  function formatClientInquiryCard(inquiry, replies, idx, total, isMediaCaption = false, mediaSenderLabel = '', filterMode = 'all') {
    const statusText = CLIENT_INQUIRY_STATUS[inquiry.status] || escapeHtml(inquiry.status || 'open');
    const roleText = CLIENT_ROLE_NAMES[inquiry.target_role] || escapeHtml(inquiry.target_role || 'الدعم العام');
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
      ? `✅ <b>الردود:</b> تم الرد (${combinedReplies.length})\n`
      : `⏳ <b>الردود:</b> بانتظار الإدارة\n`;

    let repliesSection = `\n💬 <b>ردود الإدارة (${combinedReplies.length}):</b>\n`;
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

    const headerPart =
      `📨 <b>استعلاماتي (${getFilterModeTitle(filterMode)})</b> • <code>#${inquiry.id}</code> (${idx + 1}/${total})\n` +
      `📊 ${statusText} | 🎯 ${roleText}\n` +
      replyBanner +
      mediaSourceLine +
      propLine +
      `🕒 <code>${escapeHtml(formatDateTime(inquiry.created_at))}</code>\n` +
      subjectLine +
      `📝 <b>استفسارك:</b> ${escapeHtml(inquiry.message || '')}`;

    const limit = isMediaCaption ? 980 : 3950;
    const fullText = headerPart + repliesSection;
    if (fullText.length <= limit) return fullText;

    const maxHeaderLen = Math.max(180, limit - repliesSection.length - 10);
    const trimmedHeader = headerPart.length > maxHeaderLen
      ? headerPart.slice(0, maxHeaderLen) + '…'
      : headerPart;

    const combined = trimmedHeader + repliesSection;
    return combined.length <= limit ? combined : fitTelegramText(combined, isMediaCaption);
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

    const summaryLines = st.items.map((inq, idx) => {
      const unreadRepCount = st.unreadCountByInquiryId[inq.id] || 0;
      const totalRepCount = st.totalCountByInquiryId[inq.id] || 0;
      const lbl = buildInquiryIndexButtonLabel(inq, idx + 1, unreadRepCount, totalRepCount);
      st.labelMap[lbl] = idx;
      const dt = inq.created_at ? ` • <code>${escapeHtml(formatDateTime(inq.created_at))}</code>` : '';
      const repBadge = unreadRepCount > 0
        ? ` • 🔔 جديد <b>(${unreadRepCount})</b>`
        : (totalRepCount > 0 ? ` • 📖 مقروء (${totalRepCount})` : '');
      return `${idx + 1}. <b>#${inq.id}</b> — ${escapeHtml(inq.subject || inq.message || 'استفسار')}${repBadge}${dt}`;
    });

    const buttons = Object.keys(st.labelMap);
    const rows = chunkButtons(buttons, 1);
    rows.push([
      '🔙 رجوع للاستعلام',
      st.unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${st.unreadRepliesCount})` : '⬅️ لوحة العميل'
    ]);
    rows.push(['🏠 القائمة الرئيسية']);

    const sent = await ctx.reply(
      `📑 <b>فهرس الاستعلامات (${getFilterModeTitle(st.filterMode)} • ${st.items.length}):</b>\n\n${summaryLines.join('\n')}\n\n👇 <b>اضغط على زر الاستعلام للانتقال إليه مباشرة:</b>`,
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

    if (!st.items.length) {
      const emptyLabel = getFilterModeTitle(st.filterMode);
      return replyTracked(
        ctx, userId,
        `📭 <b>لا توجد استفسارات ضمن قسم (${emptyLabel}) حالياً.</b>`,
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

    const latestMediaReply = [...replies]
      .reverse()
      .find(r => r.attachment_url && (r.media_type === 'photo' || r.media_type === 'video'));

    const replyAttach = latestMediaReply ? normalizeMediaRef(latestMediaReply.attachment_url) : null;
    const inqAttach = normalizeMediaRef(currentInquiry.attachment_url);

    let attachedMedia = null;
    if (replyAttach) {
      const roleName = CLIENT_ROLE_NAMES[latestMediaReply.admin_role] || 'الإدارة';
      attachedMedia = {
        type: latestMediaReply.media_type === 'video' ? 'video' : 'photo',
        ref: replyAttach,
        senderLabel: `الإدارة (${roleName})`
      };
    } else if (inqAttach) {
      const isVideoAttach = /\.(mp4|mov|webm)(\?|$)/i.test(inqAttach);
      attachedMedia = {
        type: isVideoAttach ? 'video' : 'photo',
        ref: inqAttach,
        senderLabel: 'أنت (العميل)'
      };
    }

    const inlineQuickReply = currentInquiry?.id
      ? Markup.inlineKeyboard([
          [Markup.button.callback(`💬 رد مباشر على الإدارة (#${currentInquiry.id})`, `client_quick_reply_${currentInquiry.id}`)]
        ])
      : undefined;

    let sent = null;
    if (attachedMedia) {
      const mediaCaption = formatClientInquiryCard(
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
          ? await ctx.replyWithVideo(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...(inlineQuickReply || {}), ...kb })
          : await ctx.replyWithPhoto(attachedMedia.ref, { caption: mediaCaption, parse_mode: 'HTML', ...(inlineQuickReply || {}), ...kb });
      } catch (e) {
        console.error('renderClientInquiryAt media card error:', e.message);
      }
    }

    if (!sent) {
      const cardText = formatClientInquiryCard(currentInquiry, replies, safeIdx, st.items.length, false, '', st.filterMode);
      sent = await ctx.reply(cardText, { parse_mode: 'HTML', ...(inlineQuickReply || {}), ...kb }).catch(() => null);
    }

    const keepIds = sent?.message_id ? [sent.message_id] : [];
    if (sent?.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
  }

  async function openClientFollowUpComposer(ctx, userId, parentInquiryId = null) {
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const cleanId = parentInquiryId ? Number(parentInquiryId) : null;

    userState[userId] = {
      step: 'client_following_up_inquiry',
      data: { parentInquiryId: cleanId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const titleLine = cleanId
      ? `💬 <b>الرد المباشر على الإدارة (الاستعلام <code>#${cleanId}</code>)</b>`
      : `💬 <b>إرسال رد أو استفسار جديد للإدارة</b>`;

    await replyTracked(
      ctx, userId,
      `${titleLine}\n\nاكتب ردك الآن أو أرفق صورة/فيديو وسيصل مباشرة إلى الإدارة ويُسجل في استعلاماتك:`,
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

  function buildPsychologyCue(points, publishCost, walletNum) {
    const remaining = Math.max(0, publishCost - points);
    if (points >= publishCost) {
      return `✨ <b>رصيد نقاطك مكتمل الآن!</b> بإمكانك نشر إعلانك القادم دون أي عناء، أو إبقاء رصيدك جاهزاً لوقت الحاجة.`;
    }
    if (walletNum === 0 && remaining <= 50) {
      return `💡 <b>أنت قريب جداً من النشر المجاني!</b> لم يتبقَّ لك سوى <b>${remaining} نقطة</b> لتصل إلى ${publishCost} نقطة — أو يمكنك شحن محفظتك الآن لتكون جاهزاً في أي لحظة دون انتظار.`;
    }
    if (walletNum === 0) {
      return `💡 <b>اختر الإيقاع الذي يناسبك:</b> اجمع نقاطك بهدوء عبر المشاهدة أو الدعوة، أو اشحن رصيدك الآن لتنجز إعلاناتك بسرعة وراحة بال.`;
    }
    return `✨ <b>محفظتك نشطة وجاهزة</b> — استثمر رصيدك أو اجمع نقاطاً إضافية لتوسيع فرصك على المنصة.`;
  }

  async function openWalletTopupScreen(ctx, userId, prefillAmount = null, publishAdDraft = null) {
    const ccpRip = await getSetting('ccp_rip', '00234567890123456789');
    const ccpName = await getSetting('ccp_name', '');
    const nameLine = ccpName ? `\n👤 <b>الاسم:</b> ${escapeHtml(ccpName)}` : '';

    userState[userId] = {
      step: 'topup_waiting_amount',
      data: {
        ...(prefillAmount ? { suggestedAmount: prefillAmount } : {}),
        ...(publishAdDraft ? { publishAdDraft } : {})
      },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const suggestedLine = prefillAmount
      ? `\n💡 <b>المبلغ المقترح للنشر:</b> <b>${formatMoney(prefillAmount)}</b>`
      : '';
    const publishNoteLine = publishAdDraft
      ? `\n🏠 <b>مرتبط بنشر العقار:</b> سيتم إرسال عقارك مرفقاً بالوصل مباشرة للمراجعة والموافقة عند إرسال الوصل.`
      : '';

    const text =
      `💳 <b>شحن الرصيد عبر BaridiMob / CCP</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `حوّل المبلغ الذي يناسبك إلى الحساب التالي:${nameLine}${suggestedLine}${publishNoteLine}\n` +
      `📌 <b>رقم الحساب (RIP):</b>\n<code>${escapeHtml(ccpRip)}</code>\n\n` +
      `👇 <b>اختر مبلغاً جاهزاً أو اكتب المبلغ رقمياً بالدينار الجزائري:</b>`;

    await replyTracked(ctx, userId, text, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['500 دج', '1000 دج', '2000 دج'],
        ['5000 دج'],
        ['⬅️ رجوع', '🏠 القائمة الرئيسية']
      ]).resize()
    }, true);
  }

  async function showWalletAndPointsScreen(ctx, userId) {
    const user = await getUserRecord(userId);
    const points = Number(user?.points || 0);
    const walletNum = sanitizeNumericPrice(user?.wallet_balance || 0);
    const walletBalance = formatMoney(walletNum);
    const rewardPoints = Number(await getSetting('ad_reward_points', '25'));
    const publishCost = Number(await getSetting('publish_cost_points', '100'));

    const botUsername = ctx.botInfo?.username || 'AqarDZ_bot';
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    const cue = buildPsychologyCue(points, publishCost, walletNum);

    const msg =
      `🎁 <b>مساحة رصيدك ونقاطك</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💼 <b>رصيد المحفظة:</b> <b>${walletBalance}</b>\n` +
      `🪙 <b>رصيد النقاط:</b> <b>${points} نقطة</b>\n` +
      `🎯 <b>عتبة النشر بالنقاط:</b> <b>${publishCost} نقطة</b>\n\n` +
      `${cue}\n\n` +
      `🎬 <b>1. مشاهدة إعلان (+${rewardPoints} نقطة):</b>\n` +
      `خطوة سريعة من الزر أدناه تُضاف نقاطها مباشرة إلى رصيدك فور اكتمال العرض.\n\n` +
      `👥 <b>2. دعوة معارفك (+50 نقطة لكل انضمام):</b>\n` +
      `كل صديق ينضم عبر رابطك يقرّبك خطوة إضافية:\n<code>${refLink}</code>\n\n` +
      `💳 <b>3. شحن الرصيد عبر BaridiMob / CCP:</b>\n` +
      `إذا كنت تفضل الجاهزية الفورية وتوفير الوقت، يمكنك شحن رصيدك الآن بخطوات بسيطة.`;

    const keyboardRows = [['💳 شحن الرصيد (CCP / BaridiMob)']];
    if (WEBHOOK_DOMAIN) {
      keyboardRows.push([
        Markup.button.webApp(`🎬 مشاهدة إعلان (+${rewardPoints} نقطة)`, `${WEBHOOK_DOMAIN}/watch-ad?uid=${userId}`)
      ]);
    }
    keyboardRows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(ctx, userId, msg, { parse_mode: 'HTML', ...Markup.keyboard(keyboardRows).resize() }, true);
  }

  async function openUserHome(ctx, prefixNote = '') {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || 'مستخدمنا الكريم';
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const rawWelcomeTpl = await getSetting('welcome_msg_template', 'أهلاً بك يا <b>{name}</b> في <b>منصة عقار الجزائر (Aqar)</b> 🏠\n\nنظام رقمي احترافي لإدارة وعروض العقارات. اختر من القائمة أدناه:');
    const welcomeText = rawWelcomeTpl.replace('{name}', userName).replace(/\\n/g, '\n');
    await replyTracked(ctx, userId, prefixNote + welcomeText, {
      parse_mode: 'HTML',
      ...mainKb
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
  <title>إضافة نقاط إلى رصيدك</title>
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
    <h2>🎁 تعزيز رصيد نقاطك</h2>
    <p style="color:#94A3B8; font-size:14px;">أكمل عرض الفيديو القصير لإضافة +${rewardPoints} نقطة إلى رصيدك.</p>
    <div id="alertBox" class="alert-box">
      ℹ️ <b>يرجى البقاء في الصفحة حتى اكتمال العرض</b> ليتم تسجيل نقاطك تلقائياً في حسابك.
    </div>
    <button id="adBtn" onclick="triggerAd()">▶️ بدء العرض الآن</button>
  </div>
  <script>
    const tg = window.Telegram.WebApp;
    tg.expand();
    const btnEl = document.getElementById('adBtn');
    const alertBox = document.getElementById('alertBox');

    function triggerAd() {
      btnEl.disabled = true;
      btnEl.textContent = '⏳ جاري التحميل... يرجى الانتظار';
      alertBox.style.display = 'block';

      if (typeof show_12268522 === 'function') {
        show_12268522().then(() => {
          claimReward();
        }).catch((e) => {
          alert('العرض غير متاح حالياً، يمكنك المحاولة بعد قليل.');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ بدء العرض الآن';
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
          alert('✨ تم إضافة النقاط إلى رصيدك بنجاح.');
          tg.close();
        } else {
          alert('تعذر إتمام العملية، يرجى المحاولة مجدداً.');
          btnEl.disabled = false;
          btnEl.textContent = '▶️ بدء العرض الآن';
          alertBox.style.display = 'none';
        }
      } catch (e) {
        alert('تعذر الاتصال بالخادم حالياً.');
        btnEl.disabled = false;
        btnEl.textContent = '▶️ بدء العرض الآن';
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
        `✨ <b>تمت إضافة +${rewardPoints} نقطة إلى رصيدك.</b>\n🪙 <b>رصيدك الآن:</b> <b>${newPoints} نقطة</b>`,
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

  async function getStandardReplyKeyboard(state, userId = null) {
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
      const rows = [
        ['💳 الدفع عبر BaridiMob / CCP'],
        [
          `🪙 النشر مجاناً (${publishCost} نقطة)`,
          '🆓 نشر مجاني'
        ],
        [backText, homeText]
      ];
      return Markup.keyboard(rows).resize();
    } else {
      return Markup.keyboard([[backText, homeText], [cancelText]]).resize();
    }
  }

  async function renderWizard(ctx, userId, opts = {}) {
    const state = userState[userId];
    if (!state) return;

    const user = await getUserRecord(userId);
    const currentPoints = user ? (user.points || 0) : 0;
    const currentWallet = sanitizeNumericPrice(user?.wallet_balance || 0);
    const publishCost = await getSetting('publish_cost_points', '100');
    const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);

    if (state.step === 'waiting_for_payment_choice' && !opts.footer) {
      opts.footer =
        `💰 <b>اختر طريقة إتمام ونشر الإعلان:</b>\n\n` +
        `1️⃣ <b>الدفع عبر BaridiMob / CCP:</b> فحص الرصيد (${formatMoney(currentWallet)}) — إظهار الخصم إذا كان كافياً (${formatMoney(walletCost)}) أو التوجه للشحن وربط الوصل مباشرة بطلب النشر إذا كان غير كافٍ.\n` +
        `2️⃣ <b>النشر المجاني بالنقاط:</b> يتطلب <b>${publishCost} نقطة</b>\n` +
        `3️⃣ <b>نشر مجاني:</b> يُرسل إلى قائمة الانتظار والمراجعة الإدارية كإعلان مجاني.\n` +
        `🪙 <b>رصيد النقاط:</b> <b>${currentPoints} نقطة</b>`;
    }

    const text = await buildWizardText(state, opts);

    if (state.step === 'publishing' && !opts.noKeyboard && state.wizardMsgId) {
      try {
        await ctx.telegram.editMessageText(state.chatId, state.wizardMsgId, undefined, text, { parse_mode: 'HTML' });
      } catch (e) {}
      return;
    }

    const replyKeyboard = opts.noKeyboard ? mainKb : await getStandardReplyKeyboard(state, userId);

    const sent = await ctx.reply(text, { parse_mode: 'HTML', ...replyKeyboard });
    const oldId = state.wizardMsgId;
    state.wizardMsgId = sent.message_id;
    state.chatId = ctx.chat.id;
    if (sent.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);

    if (oldId && oldId !== sent.message_id) {
      await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
    }
  }

  async function publishAdByWalletBalance(ctx, userId, state, walletCost) {
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    const adDraftSnapshot = { ...state.data };
    state.data.payment_label = `💼 خصم من الرصيد (${formatMoney(walletCost)})`;
    state.step = 'publishing';

    try {
      const publishingText = await getSetting('publishing_text', '⏳ جاري خصم الرصيد ونشر الإعلان...');
      await renderWizard(ctx, userId, { footer: publishingText });

      const freshUser = await getUserRecord(userId);
      const currentWallet = sanitizeNumericPrice(freshUser?.wallet_balance || 0);
      if (currentWallet < walletCost) {
        return openWalletTopupScreen(ctx, userId, walletCost, adDraftSnapshot);
      }

      const mediaItems = state.data.media_items || [];
      const combinedImagesUrl = await uploadMediaListByType(ctx, mediaItems, 'photo');
      const videoUrl = await uploadMediaListByType(ctx, mediaItems, 'video');

      const newWalletBalance = currentWallet - walletCost;
      const { error: walletErr } = await supabase
        .from('users')
        .update({ wallet_balance: newWalletBalance })
        .eq('id', Number(userId));
      if (walletErr) throw walletErr;

      const numericPrice = sanitizeNumericPrice(state.data.price);
      const cleanPhone = String(state.data.phone || '').replace(/\D/g, '').trim();
      const nowIso = new Date().toISOString();

      const { data: publishedRow, error: pubErr } = await supabase
        .from('test_messages')
        .insert([{
          user_id: Number(userId),
          property_type: state.data.property_type,
          state_name: state.data.state_name,
          price: numericPrice,
          phone: cleanPhone,
          description: state.data.description,
          message: state.data.description,
          image_url: combinedImagesUrl,
          video_url: videoUrl,
          created_at: nowIso
        }])
        .select()
        .single();
      if (pubErr) throw pubErr;

      const adminIds = await getAdminIds();
      const adId = publishedRow?.id || '—';
      const senderName = escapeHtml(
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || freshUser?.first_name || 'مستخدم'
      );
      const adminMsg =
        `💼 <b>تم نشر إعلان جديد عبر خصم الرصيد (#${adId})</b>\n` +
        `🕒 <b>التاريخ والوقت:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>\n\n` +
        `👤 <b>العميل:</b> ${senderName} (<code>${userId}</code>)\n` +
        `💸 <b>المخصوم من الرصيد:</b> <b>${formatMoney(walletCost)}</b>\n` +
        `💼 <b>الرصيد المتبقي:</b> <b>${formatMoney(newWalletBalance)}</b>\n` +
        `🏠 <b>العقار:</b> ${escapeHtml(state.data.property_type || '')} — ${escapeHtml(state.data.state_name || '')}\n` +
        `💰 <b>السعر:</b> ${formatMoney(numericPrice)}`;

      for (const adminId of adminIds) {
        await ctx.telegram.sendMessage(adminId, fitTelegramText(adminMsg, false), { parse_mode: 'HTML' }).catch(() => {});
      }

      delete userState[userId];
      await replyTracked(
        ctx, userId,
        `🎉 <b>تم خصم ${formatMoney(walletCost)} من رصيدك ونشر إعلانك بنجاح!</b>\n\n` +
        `💼 <b>رصيدك المتبقي:</b> <b>${formatMoney(newWalletBalance)}</b>\n` +
        `🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    } catch (err) {
      console.error('Wallet publish error:', err);
      delete userState[userId];
      await replyTracked(ctx, userId, '⚠️ حدث خطأ أثناء الخصم والنشر، يرجى المحاولة مرة أخرى.', mainKb, true);
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
      const mainKb = await buildUserMainKeyboard(userId, unreadCount);
      await replyTracked(ctx, userId, '🎉 <b>تم توثيق حسابك بنجاح!</b>', {
        parse_mode: 'HTML', ...mainKb
      }, true);
    } catch (err) {
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.');
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) return next();
    if (ctx.from && ctx.message && (ctx.message.text?.includes('تصفح') || ctx.message.text?.includes('إضافة') || ctx.message.text?.includes('رصيدي') || ctx.message.text?.includes('مفضلاتي'))) {
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
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    await replyTracked(ctx, userId, '✅ العودة إلى القائمة الرئيسية:', {
      parse_mode: 'HTML', ...mainKb
    }, true);
  });

  bot.hears('⬅️ رجوع', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step === 'publishing') return;

    if (state.step === 'topup_waiting_amount') {
      const draft = state.data?.publishAdDraft;
      delete userState[userId];
      if (draft) {
        userState[userId] = {
          step: 'waiting_for_payment_choice',
          data: draft,
          chatId: ctx.chat.id,
          wizardMsgId: null
        };
        return renderWizard(ctx, userId);
      }
      return showWalletAndPointsScreen(ctx, userId);
    }

    if (state.step === 'topup_waiting_receipt') {
      const keepDraft = state.data?.publishAdDraft || null;
      state.step = 'topup_waiting_amount';
      state.data = keepDraft ? { publishAdDraft: keepDraft } : {};
      return replyTracked(
        ctx, userId,
        `💳 <b>اختر أو أدخل مبلغ الشحن المطلوب (بالدينار الجزائري):</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['500 دج', '1000 دج', '2000 دج'],
            ['5000 دج'],
            ['⬅️ رجوع', '🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    if (state.step === 'waiting_for_payment_receipt' && state.data?.fromWalletChoice) {
      state.step = 'waiting_for_payment_choice';
      delete state.data.fromWalletChoice;
      return renderWizard(ctx, userId);
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

  bot.hears(['💳 شحن الرصيد (CCP / BaridiMob)', '💳 شحن الرصيد'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (state && state.step === 'waiting_for_payment_choice') {
      const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;
      return openWalletTopupScreen(ctx, userId, walletCost, { ...state.data });
    }
    await openWalletTopupScreen(ctx, userId);
  });

  bot.hears(/^💳 شحن المحفظة/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;
    const draft = state?.step === 'waiting_for_payment_choice' ? { ...state.data } : null;
    await openWalletTopupScreen(ctx, userId, walletCost, draft);
  });

  bot.hears(/^(?:💼 )?الخصم من الرصيد/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;
    const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;
    await publishAdByWalletBalance(ctx, userId, state, walletCost);
  });

  bot.hears(/^💼 الخصم من المحفظة/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;
    const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;
    await publishAdByWalletBalance(ctx, userId, state, walletCost);
  });

  bot.hears(['🌐 تصفح الموقع الرسمي (البروزر)', '🌐 تصفح الموقع الرسمي'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
    if (!getWebsiteUrl()) {
      return replyTracked(ctx, userId, '⚠️ الموقع غير متاح حالياً.', { ...mainKb }, true);
    }
    await replyTracked(ctx, userId, '🌐 <b>منصة عقار الجزائر</b>', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.url('🌐 فتح الموقع الرسمي', getWebsiteUrl())]])
    }, true);
    await ctx.reply('👇', { ...mainKb }).then(m => trackBotMessage(userId, ctx.chat.id, m.message_id)).catch(() => {});
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
  });

  bot.hears('الصورة التالية 🖼', async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      await safeDeleteUserMessage(ctx);
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, (own.mediaIndex || 0) + 1);
    }
    return next();
  });

  bot.hears('🖼 الصورة السابقة', async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      await safeDeleteUserMessage(ctx);
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, Math.max((own.mediaIndex || 0) - 1, 0));
    }
    return next();
  });

  bot.hears(/^📸 (صورة|عنصر) \d+ \/ \d+$/, async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') {
      await safeDeleteUserMessage(ctx);
      return renderUserOwnAdBrowser(ctx, userId, own.page || 0, own.mediaIndex || 0);
    }
    return next();
  });

  bot.hears(/^\d+$/, async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads' && own.selectingPage) {
      await safeDeleteUserMessage(ctx);
      own.selectingPage = false;
      const n = parseInt(ctx.message.text.trim(), 10);
      return renderUserOwnAdBrowser(ctx, userId, n - 1, 0);
    }
    return next();
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

    const dbUser = await getUserRecord(userId);
    const walletBalance = sanitizeNumericPrice(dbUser?.wallet_balance || 0);
    const walletCost = sanitizeNumericPrice(await getSetting('publish_cost_wallet', '500')) || 500;

    if (walletBalance < walletCost) {
      return openWalletTopupScreen(ctx, userId, walletCost, { ...state.data });
    }

    state.data.payment_label = `💳 BaridiMob / CCP (الرصيد: ${formatMoney(walletBalance)})`;

    const choicePrompt =
      `💳 <b>عبر BaridiMob / CCP — الرصيد والخصم</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💼 <b>رصيدك الحالي:</b> <b>${formatMoney(walletBalance)}</b>\n` +
      `✅ <b>رصيدك كافٍ للخصم المباشر</b> (تكلفة النشر: <b>${formatMoney(walletCost)}</b>)\n\n` +
      `👇 <b>اضغط على زر الخصم لإتمام النشر:</b>`;

    const sent = await ctx.reply(
      await buildWizardText(state, { footer: choicePrompt }),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [`💼 الخصم من الرصيد (${formatMoney(walletCost)})`],
          ['⬅️ رجوع', '🏠 القائمة الرئيسية']
        ]).resize()
      }
    );
    const oldId = state.wizardMsgId;
    state.wizardMsgId = sent.message_id;
    if (sent.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    if (oldId && oldId !== sent.message_id) {
      await ctx.telegram.deleteMessage(state.chatId, oldId).catch(() => {});
    }
  });

  bot.hears('🆓 نشر مجاني', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || state.step !== 'waiting_for_payment_choice') return;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);
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
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    } catch (err) {
      console.error('Free ad pending publish error:', err);
      delete userState[userId];
      await replyTracked(
        ctx, userId,
        `⚠️ <b>تعذر إرسال الإعلان المجاني إلى قائمة الانتظار:</b>\n<code>${escapeHtml(err.message || 'خطأ غير معروف')}</code>`,
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
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    } catch (err) {
      console.error('Free publish error:', err);
      delete userState[userId];
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', mainKb, true);
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

  function getSupportHubKeyboard(unreadRepliesCount = 0) {
    return Markup.keyboard([
      [getInquiriesMenuLabel(unreadRepliesCount), '📋 إعلاناتي وحالتها'],
      [BTN_FAVORITES_MENU, '👤 ملفي الشخصي ورصيدي'],
      ['🗂 تصفح إعلاناتي الخاصة', '💬 دعم واقتراحات وشكر'],
      ['🏠 القائمة الرئيسية']
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
    const favAds = await browse.fetchUserFavoriteProperties(userId);
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
    const name = escapeHtml(dbUser?.first_name || ctx.from.first_name || 'عميلنا الكريم');
    const supportIntro = (await getSetting('support_text', '')).replace(/\\n/g, '\n');

    supportUserSession[userId] = { mode: 'dashboard', ads: allAds, unreadRepliesCount };
    userState[userId] = { step: 'support_dashboard', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    const alertLine = unreadRepliesCount > 0
      ? `\n🔔 <b>تنبيه الإدارة:</b> لديك <b>(${unreadRepliesCount})</b> رد جديد غير مقروء عبر <b>(${unreadInquiriesCount})</b> استعلام — افتح <b>"${getInquiriesMenuLabel(unreadRepliesCount)}"</b> للاطلاع عليه.`
      : '';

    const text =
      `🎛 <b>لوحة العميل ومركز الدعم</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 أهلاً بك يا <b>${name}</b>\n` +
      `💼 <b>رصيد المحفظة:</b> <b>${walletBalance}</b>\n` +
      `🪙 <b>رصيد النقاط:</b> <b>${points} نقطة</b>\n` +
      `⭐ <b>المفضلة:</b> <b>${favAds.length} عقار</b>\n` +
      `📨 <b>استعلاماتك:</b> الكل <b>${myInquiries.length}</b> | 🔔 غير مقروءة: <b>${unreadInquiriesCount}</b> | 📖 مقروءة: <b>${readInquiriesCount}</b> | 💬 ردود جديدة: <b>(${unreadRepliesCount})</b>\n` +
      `📊 <b>إعلاناتك:</b> إجمالي <b>${allAds.length}</b> | ⏳ معلق: <b>${pendingCount}</b> | ✅ مقبول: <b>${approvedCount}</b> | ❌ مرفوض: <b>${rejectedCount}</b>` +
      alertLine +
      (supportIntro ? `\n\n${supportIntro}` : '') +
      `\n\n👇 <b>اختر "${getInquiriesMenuLabel(unreadRepliesCount)}" لمتابعة استعلاماتك والردود عليها:</b>`;

    await replyTracked(ctx, userId, text, { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) }, true);
  }

  async function renderUserOwnAdBrowser(ctx, userId, adIndex = 0, mediaIndex = 0) {
    const allAds = await fetchUserOwnedAds(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    if (!allAds.length) {
      return replyTracked(ctx, userId, '📭 <b>لا توجد إعلانات مسجلة باسمك حتى الآن.</b>',
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

  async function sendStructuredTicketToAdmins(ctx, senderUserId, ticketTitle, detailText, relatedAd = null, payloadType = 'text', mediaContent = {}, fallbackAdId = null, forcedAttachmentUrl = null) {
    const adminIds = await getAdminIds();
    const dbUser = await getUserRecord(senderUserId);
    const fullName = escapeHtml(
      [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
    );
    const phoneLine = dbUser?.phone_number ? `\n📞 <b>هاتف العميل:</b> <code>${escapeHtml(dbUser.phone_number)}</code>` : '';

    const resolvedAd = await resolvePendingRecordForReview(relatedAd, senderUserId, fallbackAdId);
    const receiptRef = normalizeMediaRef(resolvedAd?.receipt_url || forcedAttachmentUrl);
    const isFreeAd = resolvedAd?.receipt_url === 'FREE_NO_RECEIPT';

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
            fullAdminText + `\n\n🧾 <b>وصل الدفع المرفق داخل الرسالة أعلاه 👆</b>`,
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
    const inqRefLine = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

    await replyTracked(
      ctx, userId,
      `✅ <b>تم إرسال استفسارك (${escapeHtml(actionLabel)}) بخصوص الإعلان <code>#${escapeHtml(String(reqId))}</code> إلى الإدارة.</b>${inqRefLine}`,
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

  bot.action(/^client_quick_reply_(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const inquiryId = Number(ctx.match[1]) || null;
    await ctx.answerCbQuery();
    await openClientFollowUpComposer(ctx, userId, inquiryId);
  });

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
    const parentInquiryId = Number(ctx.match[1]);
    await openClientFollowUpComposer(ctx, ctx.from.id, parentInquiryId);
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

    const text =
      `👤 <b>الملف الشخصي والرصيد</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• <b>الاسم:</b> ${escapeHtml(dbUser?.first_name || ctx.from.first_name || 'غير محدد')}\n` +
      `• <b>رصيد المحفظة:</b> <b>${formatMoney(dbUser?.wallet_balance || 0)}</b>\n` +
      `• <b>رصيد النقاط:</b> <b>${dbUser?.points ?? 0} نقطة</b>\n` +
      `• <b>عدد إعلاناتك المسجلة:</b> <b>${allAds.length}</b>`;

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
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);

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

    await replyTracked(ctx, userId, `🔢 <b>اختر رقم إعلانك للانتقال إليه مباشرة (1 إلى ${total}):</b>`,
      { parse_mode: 'HTML', ...Markup.keyboard(rows).resize() }, true);
  });

  bot.hears('💬 دعم واقتراحات وشكر', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    userState[userId] = { step: 'support_selecting_category', data: {}, chatId: ctx.chat.id, wizardMsgId: null };

    await replyTracked(ctx, userId, `💬 <b>اختر نوع الرسالة أو الملاحظة:</b>`,
      { parse_mode: 'HTML', ...getSupportCategoriesKeyboard(unreadRepliesCount) }, true);
  });

  bot.hears('💳 مشكلة في الدفع', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const topups = await fetchUserWalletTopups(userId);
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);
    const dashBtn = unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل';

    if (!topups || topups.length === 0) {
      userState[userId] = {
        step: 'payment_issue_writing_detail',
        data: { selectedTopup: null },
        chatId: ctx.chat.id,
        wizardMsgId: null
      };

      return replyTracked(
        ctx, userId,
        `💳 <b>مشكلة في الدفع</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `لم نعثر على عمليات شحن سابقة مسجلة لحسابك.\n` +
        `اكتب الآن تفاصيل مشكلة الدفع أو اختر سبباً سريعاً ليتم تسجيلها كاستعلام وإرسالها للإدارة:`,
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
    const summaryLines = topups.map((t, i) => {
      const lbl = formatTopupChoiceLabel(t);
      labelToTopup[lbl] = t;
      const stText = TOPUP_STATUS_TEXT[t.status] || t.status || 'pending';
      const amtText = formatMoney(sanitizeNumericPrice(t.amount || 0));
      const dtText = t.created_at ? ` • <code>${escapeHtml(formatDateTime(t.created_at))}</code>` : '';
      return `${i + 1}. <b>#${t.id}</b> — <b>${amtText}</b> (${stText})${dtText}`;
    });

    userState[userId] = {
      step: 'payment_issue_selecting_topup',
      data: { labelToTopup },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const btnRows = chunkButtons(Object.keys(labelToTopup), 2);
    btnRows.push(['💬 دعم واقتراحات وشكر', dashBtn]);
    btnRows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(
      ctx, userId,
      `💳 <b>مشكلة في الدفع — اختر الدفعة المعنية:</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${summaryLines.join('\n')}\n\n` +
      `👇 <b>اضغط على الدفعة التي تواجه فيها مشكلة لكتابة استعلامك بخصوصها:</b>`,
      { parse_mode: 'HTML', ...Markup.keyboard(btnRows).resize() },
      true
    );
  });

  bot.hears(['🏠 إعلان أو تصفح عقاري', '🪙 النقاط والمكافآت', '💡 اقتراح أو تحسين', '👏 شكر أو ملاحظة إيجابية', '💬 استفسار عام / أخرى'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const chosenCat = ctx.message.text.trim();
    const presetDetail = QUICK_SUPPORT_PRESETS[chosenCat] || chosenCat;

    const savedInq = await sendStructuredTicketToAdmins(ctx, userId, chosenCat, presetDetail, null, 'text');
    delete userState[userId];
    const { unreadRepliesCount } = await getClientRepliesSummary(userId);

    const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام:</b> <code>#${savedInq.id}</code>` : '';
    const confirmMsg = chosenCat === '👏 شكر أو ملاحظة إيجابية'
      ? `👏 <b>شكراً جزيلاً لك على كلماتك الطيبة وثقتك بمنصة عقار الجزائر.</b>${inqTag}`
      : `✅ <b>تم تسجيل طلبك (${escapeHtml(chosenCat)}) وإرساله إلى الإدارة.</b>${inqTag}`;

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

    if (state.step === 'payment_issue_selecting_topup') {
      await safeDeleteUserMessage(ctx);
      const chosenTopup = state.data?.labelToTopup?.[userText];
      if (!chosenTopup) {
        return replyTracked(
          ctx, userId,
          `⚠️ <b>يرجى اختيار إحدى الدفعات من الأزرار الظاهرة في الأسفل:</b>`,
          { parse_mode: 'HTML' },
          true
        );
      }

      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const dashBtn = unreadRepliesCount > 0 ? `⬅️ لوحة العميل (${unreadRepliesCount})` : '⬅️ لوحة العميل';

      state.step = 'payment_issue_writing_detail';
      state.data = { selectedTopup: chosenTopup };

      const amtText = formatMoney(sanitizeNumericPrice(chosenTopup.amount || 0));
      const stText = TOPUP_STATUS_TEXT[chosenTopup.status] || chosenTopup.status || 'pending';
      const dtText = chosenTopup.created_at ? formatDateTime(chosenTopup.created_at) : 'غير مسجل';

      return replyTracked(
        ctx, userId,
        `💳 <b>استعلام حول الدفعة #${chosenTopup.id}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• <b>المبلغ:</b> <b>${amtText}</b>\n` +
        `• <b>حالة الدفعة:</b> <b>${stText}</b>\n` +
        `• <b>تاريخ العملية:</b> <code>${escapeHtml(dtText)}</code>\n\n` +
        `✍️ <b>اكتب الآن استفسارك أو تفاصيل المشكلة بخصوص هذه الدفعة، أو اختر سبباً سريعاً من الأسفل:</b>`,
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

      const subjectTitle = topup
        ? `مشكلة في الدفع — طلب شحن #${topup.id}`
        : 'مشكلة في الدفع';

      const topupContextLine = topup
        ? `[بيانات الدفعة: طلب #${topup.id} | المبلغ: ${formatMoney(sanitizeNumericPrice(topup.amount || 0))} | الحالة الحالية: ${TOPUP_STATUS_TEXT[topup.status] || topup.status || 'pending'} | التاريخ: ${topup.created_at ? formatDateTime(topup.created_at) : 'غير مسجل'}]\n`
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
      const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

      return replyTracked(
        ctx, userId,
        `✅ <b>تم تسجيل استعلامك حول الدفع وإرساله إلى الإدارة بنجاح.</b>${inqTag}`,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

    if (state.step === 'client_following_up_inquiry') {
      await safeDeleteUserMessage(ctx);
      const parentId = state.data?.parentInquiryId || null;
      const subjectTitle = parentId
        ? `متابعة استعلام #${parentId}`
        : 'رد أو استفسار من العميل';

      const savedInq = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        subjectTitle,
        userText,
        null,
        'text',
        {},
        null
      );

      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

      return replyTracked(
        ctx, userId,
        `✅ <b>تم إرسال ردك إلى الإدارة وتسجيله في استعلاماتك بنجاح.</b>${inqTag}`,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

    if (state.step === 'topup_waiting_amount') {
      await safeDeleteUserMessage(ctx);
      const digits = userText.replace(/\D/g, '');
      const amount = sanitizeNumericPrice(digits);
      if (!amount || amount <= 0) {
        return replyTracked(ctx, userId, '⚠️ <b>يرجى اختيار مبلغ جاهز أو كتابة رقم صحيح أكبر من صفر.</b>', {
          parse_mode: 'HTML'
        }, true);
      }
      const keepDraft = state.data?.publishAdDraft || null;
      state.step = 'topup_waiting_receipt';
      state.data = { amount, ...(keepDraft ? { publishAdDraft: keepDraft } : {}) };
      const publishNote = keepDraft
        ? `\n🏠 <b>ملاحظة:</b> سيتم إرسال عقارك مرفقاً بالوصل مباشرة للمراجعة والموافقة فور إرسال صورة الوصل.`
        : '';
      return replyTracked(
        ctx, userId,
        `💳 <b>مبلغ الشحن المحدد:</b> <b>${formatMoney(amount)}</b>${publishNote}\n\n📸 <b>أرسل الآن صورة وصل التحويل (BaridiMob / CCP):</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([['⬅️ رجوع', '🏠 القائمة الرئيسية']]).resize()
        },
        true
      );
    }

    if (state.step === 'waiting_for_type') {
      await safeDeleteUserMessage(ctx);
      state.data.property_type = userText;
      state.step = 'waiting_for_state';
      return renderWizard(ctx, userId);
    }

    if (state.step === 'waiting_for_description') {
      await safeDeleteUserMessage(ctx);
      if (!state.data.features_list) state.data.features_list = [];

      if (userText === '↩️ تراجع عن الأخيرة') {
        if (state.data.features_list.length > 0) {
          state.data.features_list.pop();
          state.data.description = state.data.features_list.join(' | ');
        }
        return renderWizard(ctx, userId);
      }

      if (userText === '🗑️ مسح الكل') {
        state.data.features_list = [];
        state.data.description = null;
        return renderWizard(ctx, userId);
      }

      if (userText === '✅ تأكيد الوصف والانتقال') {
        if (!state.data.description || state.data.description.trim() === '') {
          const warnMsg = await ctx.reply(
            '⚠️ <b>يرجى اختيار ميزة واحدة على الأقل من القائمة في الأسفل قبل الانتقال.</b>',
            { parse_mode: 'HTML' }
          );
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3000);
          return;
        }
        state.step = 'waiting_for_media';
        state.data.media_items = state.data.media_items || [];
        return renderWizard(ctx, userId);
      }

      if (!state.data.features_list.includes(userText)) {
        state.data.features_list.push(userText);
      }
      state.data.description = state.data.features_list.join(' | ');
      return renderWizard(ctx, userId);
    }

    if (state.step === 'waiting_for_media') {
      await safeDeleteUserMessage(ctx);
      const donePrefix = '✅ إنهاء إرفاق الوسائط';
      if (userText.startsWith(donePrefix)) {
        const items = state.data.media_items || [];
        if (items.length === 0) {
          const warnMsg = await ctx.reply(
            '⚠️ <b>يرجى إرفاق صورة أو فيديو واحد على الأقل أولاً.</b>',
            { parse_mode: 'HTML' }
          );
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3000);
          return;
        }
        const pCount = items.filter(i => i.type === 'photo').length;
        const vCount = items.filter(i => i.type === 'video').length;
        const summaryParts = [];
        if (pCount > 0) summaryParts.push(`${pCount} صورة`);
        if (vCount > 0) summaryParts.push(`${vCount} فيديو`);
        state.data.media_label = summaryParts.join(' + ');
        state.step = 'waiting_for_payment_choice';
        return renderWizard(ctx, userId);
      }

      if (userText === '🗑️ مسح الوسائط المرفقة') {
        state.data.media_items = [];
        state.data.media_label = null;
        return renderWizard(ctx, userId, { footer: '🗑️ تم مسح الوسائط المرفقة. أرسل صورك أو فيديوهاتك من جديد:' });
      }

      await notifyUseButtonsHint(ctx, userId);
      return;
    }

    if (state.step === 'waiting_for_price' || state.step === 'waiting_for_phone') {
      await safeDeleteUserMessage(ctx);
      const isPrice = state.step === 'waiting_for_price';
      let current = state.tempInput || '';

      if (/^[0-9]$/.test(userText)) {
        if (current.length < (isPrice ? 12 : 15)) {
          current = current === '0' ? userText : current + userText;
        }
        state.tempInput = current;
        return renderWizard(ctx, userId);
      }

      if (userText === '+مليون' && isPrice) {
        const currentNum = Number(current || '0');
        current = String(currentNum + 1000000);
        state.tempInput = current;
        return renderWizard(ctx, userId);
      }

      if (userText === '⌫') {
        current = current.slice(0, -1);
        state.tempInput = current;
        return renderWizard(ctx, userId);
      }

      if (userText === '🗑️ مسح') {
        state.tempInput = '';
        return renderWizard(ctx, userId);
      }

      if (userText === '✅ [ OK ] تأكيد') {
        const cleanVal = current.trim();
        if (!cleanVal || cleanVal === '0') {
          const warnMsg = await ctx.reply(
            isPrice ? '⚠️ <b>يرجى إدخال قيمة السعر أولاً قبل التأكيد.</b>' : '⚠️ <b>يرجى إدخال رقم الهاتف أولاً قبل التأكيد.</b>',
            { parse_mode: 'HTML' }
          );
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3000);
          return;
        }
        if (!isPrice && cleanVal.length < 8) {
          const warnMsg = await ctx.reply('⚠️ <b>رقم الهاتف قصير، يرجى إكماله ثم الضغط على تأكيد.</b>', { parse_mode: 'HTML' });
          setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 3000);
          return;
        }

        if (isPrice) {
          state.data.price = cleanVal;
          state.step = 'waiting_for_phone';
          state.tempInput = '';
        } else {
          state.data.phone = cleanVal;
          state.step = 'waiting_for_description';
          state.tempInput = '';
          state.data.features_list = state.data.features_list || [];
        }
        return renderWizard(ctx, userId);
      }

      if (userText.startsWith('📥 القيمة الحالية:')) return;

      await notifyUseButtonsHint(ctx, userId);
      return;
    }

    await notifyUseButtonsHint(ctx, userId);
  });

  bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const photoObj = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photoObj.file_id;
    const caption = ctx.message.caption ? ctx.message.caption.trim() : '';

    if (state && state.step === 'client_following_up_inquiry') {
      await safeDeleteUserMessage(ctx);
      const parentId = state.data?.parentInquiryId || null;
      const subjectTitle = parentId
        ? `متابعة استعلام #${parentId} (مرفق صورة)`
        : 'مرفق صورة من العميل';

      const savedInq = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        subjectTitle,
        caption || 'مرفق صورة من العميل',
        null,
        'photo',
        { fileId, caption }
      );

      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

      return replyTracked(
        ctx, userId,
        `✅ <b>تم إرسال الصورة وردك إلى الإدارة وتسجيله في استعلاماتك بنجاح.</b>${inqTag}`,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

    if (state && state.step === 'payment_issue_writing_detail') {
      await safeDeleteUserMessage(ctx);
      const topup = state.data?.selectedTopup || null;
      const subjectTitle = topup
        ? `مشكلة في الدفع — طلب شحن #${topup.id} (مرفق صورة)`
        : 'مشكلة في الدفع (مرفق صورة)';
      const topupContextLine = topup
        ? `[بيانات الدفعة: طلب #${topup.id} | المبلغ: ${formatMoney(sanitizeNumericPrice(topup.amount || 0))} | الحالة الحالية: ${TOPUP_STATUS_TEXT[topup.status] || topup.status || 'pending'}]\n`
        : '';

      const savedInq = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        subjectTitle,
        `${topupContextLine}${caption || 'مرفق صورة بخصوص مشكلة الدفع'}`,
        null,
        'photo',
        { fileId, caption }
      );

      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

      return replyTracked(
        ctx, userId,
        `✅ <b>تم تسجيل استعلامك حول الدفع مع الصورة وإرساله إلى الإدارة.</b>${inqTag}`,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

    if (state && state.step === 'topup_waiting_receipt') {
      await safeDeleteUserMessage(ctx);
      const amount = state.data?.amount;
      return await submitWalletTopupRequest(ctx, userId, amount, fileId);
    }

    if (state && state.step === 'waiting_for_media') {
      await safeDeleteUserMessage(ctx);
      state.data.media_items = state.data.media_items || [];
      if (state.data.media_items.length >= MAX_PROPERTY_IMAGES) {
        return renderWizard(ctx, userId, {
          footer: `⚠️ <b>وصلت إلى الحد الأقصى (${MAX_PROPERTY_IMAGES} ملفات). اضغط "✅ إنهاء إرفاق الوسائط" للمتابعة.</b>`
        });
      }
      state.data.media_items.push({ type: 'photo', file_id: fileId });
      const summary = formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId, { footer: `${summary}\nأرسل ملفات أخرى أو اضغط <b>✅ إنهاء إرفاق الوسائط</b>:` });
    }

    if (state && state.step === 'waiting_for_payment_receipt') {
      await safeDeleteUserMessage(ctx);
      return await submitPropertyWithReceiptRequest(ctx, userId, state.data, fileId);
    }

    await safeDeleteUserMessage(ctx);
  });

  bot.on('video', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const videoId = ctx.message.video.file_id;
    const caption = ctx.message.caption ? ctx.message.caption.trim() : '';

    if (state && state.step === 'client_following_up_inquiry') {
      await safeDeleteUserMessage(ctx);
      const parentId = state.data?.parentInquiryId || null;
      const subjectTitle = parentId
        ? `متابعة استعلام #${parentId} (مرفق فيديو)`
        : 'مرفق فيديو من العميل';

      const savedInq = await sendStructuredTicketToAdmins(
        ctx,
        userId,
        subjectTitle,
        caption || 'مرفق فيديو من العميل',
        null,
        'video',
        { fileId: videoId, caption }
      );

      delete userState[userId];
      const { unreadRepliesCount } = await getClientRepliesSummary(userId);
      const inqTag = savedInq?.id ? `\n🔖 <b>رقم الاستعلام المسجل:</b> <code>#${savedInq.id}</code>` : '';

      return replyTracked(
        ctx, userId,
        `✅ <b>تم إرسال الفيديو وردك إلى الإدارة وتسجيله في استعلاماتك بنجاح.</b>${inqTag}`,
        { parse_mode: 'HTML', ...getSupportHubKeyboard(unreadRepliesCount) },
        true
      );
    }

    if (state && state.step === 'waiting_for_media') {
      await safeDeleteUserMessage(ctx);
      state.data.media_items = state.data.media_items || [];
      if (state.data.media_items.length >= MAX_PROPERTY_IMAGES) {
        return renderWizard(ctx, userId, {
          footer: `⚠️ <b>وصلت إلى الحد الأقصى (${MAX_PROPERTY_IMAGES} ملفات). اضغط "✅ إنهاء إرفاق الوسائط" للمتابعة.</b>`
        });
      }
      state.data.media_items.push({ type: 'video', file_id: videoId });
      const summary = formatMediaSummaryLabel(state.data.media_items);
      return renderWizard(ctx, userId, { footer: `${summary}\nأرسل ملفات أخرى أو اضغط <b>✅ إنهاء إرفاق الوسائط</b>:` });
    }

    await safeDeleteUserMessage(ctx);
  });

  return { openUserHome };
};