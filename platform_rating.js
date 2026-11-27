'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — خاصية تقييم المنصة وإرسال التقييم وعرض الإحصائيات
// يحفظ الاسم في عمودين (first_name و last_name) عند التسجيل الأول ويعرضه مباشرة.
// يوجّه أصحاب التقييمات الأقل من 3 نجوم مباشرة إلى قسم الردود والاستفسار والتحسينات.
// يسجّل التقييم في user_inquiries بـ inquiry_type = 'rating' ويعرض كل ردود الإدارة عند التعديل.
// =========================================================================

const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬';
const NAME_CACHE_TTL = 60 * 60 * 1000;
const SUPPORT_BTN_TEXT = '📞 الدعم والإدارة';
const IMPROVEMENT_BTN_TEXT = '💡 اقتراح أو تحسين';

const STAR_CHOICES = {
  0: '☆☆☆☆☆',
  1: '⭐☆☆☆☆',
  2: '⭐⭐☆☆☆',
  3: '⭐⭐⭐☆☆',
  4: '⭐⭐⭐⭐☆',
  5: '⭐⭐⭐⭐⭐',
  6: '🌟'
};

function joinFirstAndLastName(firstName = '', lastName = '') {
  return [firstName, lastName]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractNameFromObj(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const combined = joinFirstAndLastName(obj.first_name, obj.last_name);
  if (combined) return combined;
  if (obj.title && String(obj.title).trim()) return String(obj.title).trim();
  if (obj.full_name && String(obj.full_name).trim()) return String(obj.full_name).trim();
  if (obj.name && String(obj.name).trim()) return String(obj.name).trim();
  if (obj.username && String(obj.username).trim()) return String(obj.username).trim();
  return '';
}

module.exports = function registerPlatformRating(bot, core, helpers) {
  const {
    Markup, supabase, userState,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, getAdminIds, getUserRecord,
    formatDateTime, escapeHtml, fitTelegramText
  } = core;

  const { registerFreeTextStep } = helpers || {};
  const nameCache = new Map();

  if (typeof registerFreeTextStep === 'function') {
    registerFreeTextStep('rating_platform_comment');
    registerFreeTextStep('support_selecting_category');
    registerFreeTextStep('client_following_up_inquiry');
    registerFreeTextStep('rating_user_replying');
  }

  function getSupportDashboardFn() {
    if (typeof helpers?.openSupportDashboard === 'function') return helpers.openSupportDashboard;
    if (typeof core?.openSupportDashboard === 'function') return core.openSupportDashboard;
    return null;
  }

  function getClientInquiryFn() {
    if (typeof helpers?.renderClientInquiryAt === 'function') return helpers.renderClientInquiryAt;
    if (typeof core?.renderClientInquiryAt === 'function') return core.renderClientInquiryAt;
    return null;
  }

  async function getUnreadRepliesCountSafe(userId) {
    try {
      const { data: inquiries } = await supabase
        .from('user_inquiries')
        .select('id')
        .eq('user_id', Number(userId));

      if (!Array.isArray(inquiries) || inquiries.length === 0) return 0;
      const ids = inquiries.map((i) => i.id).filter(Boolean);

      const { data: unreadRows } = await supabase
        .from('inquiry_replies')
        .select('id')
        .in('inquiry_id', ids)
        .eq('is_read', false);

      return Array.isArray(unreadRows) ? unreadRows.length : 0;
    } catch (_) {
      return 0;
    }
  }

  function buildRatingSupportKeyboard(unreadRepliesCount = 0) {
    const inqLabel = unreadRepliesCount > 0
      ? `📨 استعلاماتي وردود الإدارة (${unreadRepliesCount})`
      : '📨 استعلاماتي وردود الإدارة';

    return Markup.keyboard([
      [IMPROVEMENT_BTN_TEXT, '💬 استفسار عام / أخرى'],
      ['💳 مشكلة في الدفع', '🏠 إعلان أو تصفح عقاري'],
      [inqLabel, '🏠 القائمة الرئيسية']
    ]).resize();
  }

  async function openSupportAndImprovementsFlow(ctx, userId, chosenRating = null) {
    const cleanUserId = Number(userId);

    if (core.browsingSession && core.browsingSession[cleanUserId]) {
      delete core.browsingSession[cleanUserId];
    }
    if (core.supportUserSession && core.supportUserSession[cleanUserId]) {
      delete core.supportUserSession[cleanUserId];
    }

    const unreadCount = await getUnreadRepliesCountSafe(cleanUserId);

    userState[cleanUserId] = {
      step: 'support_selecting_category',
      data: { fromLowRating: true, rating: chosenRating },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const ratingNote = chosenRating !== null
      ? `📌 <b>تم تسجيل تقييمك (<b>${formatStarsVisual(chosenRating)}</b>).</b>\n${LINE}\n`
      : '';

    const msg =
      `${ratingNote}` +
      `📞 <b>الردود والاستفسار والتحسينات</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `تم توجيهك مباشرة إلى قسم الردود والاستفسار لتسجيل شكواك أو استفسارك أو إرسال <b>تحسينات</b> للمنصة.\n\n` +
      `👇 <b>اختر من الأزرار في الأسفل (أو اضغط "${IMPROVEMENT_BTN_TEXT}" لتسجيل التحسينات):</b>`;

    const sent = await ctx.reply(msg, {
      parse_mode: 'HTML',
      ...buildRatingSupportKeyboard(unreadCount)
    }).catch(() => null);

    if (sent?.message_id) {
      trackBotMessage(cleanUserId, ctx.chat.id, sent.message_id);
      await clearTrackedBotMessages(ctx, cleanUserId, [sent.message_id]);
    }
  }

  async function openSupportFromRating(ctx, userId) {
    const dashboardFn = getSupportDashboardFn();
    if (dashboardFn) {
      return dashboardFn(ctx, userId);
    }

    const inquiryFn = getClientInquiryFn();
    if (inquiryFn) {
      return inquiryFn(ctx, userId, 0, true, 'all');
    }

    return openSupportAndImprovementsFlow(ctx, userId, null);
  }

  function getTelegramClient(ctx) {
    return bot?.telegram || core.bot?.telegram || ctx?.telegram || null;
  }

  function formatStarsVisual(rating) {
    const n = Number(rating);
    if (Object.prototype.hasOwnProperty.call(STAR_CHOICES, n)) {
      return STAR_CHOICES[n];
    }
    const safeN = Math.min(5, Math.max(0, n || 5));
    return '⭐'.repeat(safeN) + '☆'.repeat(5 - safeN);
  }

  function parseStarSelection(text = '') {
    const clean = String(text).trim();
    if (clean === STAR_CHOICES[6]) return 6;
    if (clean === STAR_CHOICES[0]) return 0;

    for (const [key, label] of Object.entries(STAR_CHOICES)) {
      if (clean === label) return Number(key);
    }

    const filledStars = (clean.match(/⭐/g) || []).length;
    if (filledStars >= 1 && filledStars <= 5) {
      return filledStars;
    }

    const emptyStars = (clean.match(/☆/g) || []).length;
    if (emptyStars === 5 && filledStars === 0) {
      return 0;
    }

    return null;
  }

  async function resolveNamePartsForSubmission(ctx, userId) {
    let firstName = ctx?.from?.first_name ? String(ctx.from.first_name).trim() : '';
    let lastName = ctx?.from?.last_name ? String(ctx.from.last_name).trim() : '';

    if ((!firstName || !lastName) && typeof getUserRecord === 'function') {
      try {
        const rec = await getUserRecord(Number(userId));
        if (rec) {
          if (!firstName && rec.first_name) firstName = String(rec.first_name).trim();
          if (!lastName && rec.last_name) lastName = String(rec.last_name).trim();
        }
      } catch (_) {}
    }

    if ((!firstName || !lastName) && userId) {
      try {
        const { data } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('id', Number(userId))
          .limit(1);
        const row = Array.isArray(data) ? data[0] : data;
        if (row) {
          if (!firstName && row.first_name) firstName = String(row.first_name).trim();
          if (!lastName && row.last_name) lastName = String(row.last_name).trim();
        }
      } catch (_) {}
    }

    return {
      first_name: firstName || null,
      last_name: lastName || null
    };
  }

  async function fetchTelegramFallbackNameById(userId, ctx = null) {
    const rawId = String(userId || '').trim();
    const numId = Number(userId);
    if (!rawId) return '';

    const cached = nameCache.get(rawId);
    if (cached && Date.now() - cached.at < NAME_CACHE_TTL) {
      return cached.name;
    }

    const tg = getTelegramClient(ctx);
    if (tg && typeof tg.getChat === 'function' && !Number.isNaN(numId) && numId > 0) {
      try {
        const chat = await tg.getChat(numId);
        const fromTg = extractNameFromObj(chat);
        if (fromTg) {
          nameCache.set(rawId, { name: fromTg, at: Date.now() });
          return fromTg;
        }
      } catch (_) {}
    }

    return '';
  }

  async function enrichReviewsWithNames(reviews = [], ctx = null) {
    if (!Array.isArray(reviews) || reviews.length === 0) return [];

    const missingIds = [];
    const baseList = reviews.map((r) => {
      const directFull = joinFirstAndLastName(r.first_name, r.last_name);
      if (!directFull && r.user_id) {
        missingIds.push(String(r.user_id).trim());
      }
      return {
        ...r,
        reviewer_full_name: directFull
      };
    });

    const uniqueMissingIds = [...new Set(missingIds.filter(Boolean))];
    const fallbackMap = {};

    if (uniqueMissingIds.length > 0) {
      await Promise.all(
        uniqueMissingIds.map(async (idStr) => {
          const name = await fetchTelegramFallbackNameById(idStr, ctx);
          if (name) fallbackMap[idStr] = name;
        })
      );
    }

    return baseList.map((r) => {
      const key = String(r.user_id || '').trim();
      return {
        ...r,
        reviewer_full_name: r.reviewer_full_name || fallbackMap[key] || ''
      };
    });
  }

  async function syncRatingInquiryRecord(userId, chosenRating, cleanComment, isUpdate = false) {
    const cleanUserId = Number(userId);
    const starsVisual = formatStarsVisual(chosenRating);
    const subjectText = `تقييم المنصة (${starsVisual})`;
    const messageText = cleanComment
      ? `التقييم: ${starsVisual}\nالتعليق: ${cleanComment}`
      : `التقييم: ${starsVisual} (بدون تعليق نصي)`;

    try {
      const { data: existingRows } = await supabase
        .from('user_inquiries')
        .select('id, status')
        .eq('user_id', cleanUserId)
        .eq('inquiry_type', 'rating')
        .order('id', { ascending: false })
        .limit(1);

      const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;

      if (existing && existing.id) {
        const { data: updatedRow, error: updErr } = await supabase
          .from('user_inquiries')
          .update({
            inquiry_type: 'rating',
            target_role: 'general_support',
            subject: subjectText,
            message: messageText,
            status: existing.status === 'closed' ? 'open' : (existing.status || 'open')
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (!updErr && updatedRow) return updatedRow;
      }

      const { data: insertedRow, error: insErr } = await supabase
        .from('user_inquiries')
        .insert([
          {
            user_id: cleanUserId,
            property_id: null,
            property_source: null,
            inquiry_type: 'rating',
            target_role: 'general_support',
            subject: subjectText,
            message: messageText,
            attachment_url: null,
            status: 'open'
          }
        ])
        .select()
        .single();

      if (insErr) {
        console.error('syncRatingInquiryRecord insert error:', insErr.message);
        return null;
      }

      return insertedRow;
    } catch (e) {
      console.error('syncRatingInquiryRecord error:', e.message);
      return null;
    }
  }

  async function fetchAllRatingAdminReplies(userId) {
    const cleanUserId = Number(userId);
    if (!cleanUserId) return { replies: [], latestInquiryId: null };

    try {
      const { data: ratingInquiries } = await supabase
        .from('user_inquiries')
        .select('id, admin_reply, target_role, updated_at, created_at')
        .eq('user_id', cleanUserId)
        .eq('inquiry_type', 'rating')
        .order('id', { ascending: true });

      const inqList = Array.isArray(ratingInquiries) ? ratingInquiries : [];
      if (!inqList.length) return { replies: [], latestInquiryId: null };

      const latestInquiryId = inqList[inqList.length - 1]?.id || null;
      const inquiryIds = inqList.map((i) => i.id).filter(Boolean);
      if (!inquiryIds.length) return { replies: [], latestInquiryId };

      const { data: replies } = await supabase
        .from('inquiry_replies')
        .select('id, inquiry_id, admin_role, reply_message, media_type, attachment_url, created_at')
        .in('inquiry_id', inquiryIds)
        .order('id', { ascending: true });

      const list = Array.isArray(replies) ? [...replies] : [];

      if (list.length === 0) {
        for (const inq of inqList) {
          if (inq.admin_reply && String(inq.admin_reply).trim()) {
            list.push({
              id: `legacy_${inq.id}`,
              inquiry_id: inq.id,
              admin_role: inq.target_role || 'general_support',
              reply_message: String(inq.admin_reply).trim(),
              created_at: inq.updated_at || inq.created_at
            });
          }
        }
      }

      return { replies: list, latestInquiryId };
    } catch (e) {
      console.error('fetchAllRatingAdminReplies error:', e.message);
      return { replies: [], latestInquiryId: null };
    }
  }

  function formatRatingAdminRepliesBlock(replies = []) {
    if (!Array.isArray(replies) || replies.length === 0) return '';

    const formattedItems = replies.map((rep, idx) => {
      const dt = rep.created_at ? formatDateTime(rep.created_at) : '';
      const timeTag = dt ? ` <code>${escapeHtml(dt)}</code>` : '';
      const body = escapeHtml(
        rep.reply_message ||
        (rep.media_type === 'photo' ? '🖼 صورة مرفقة' : rep.media_type === 'video' ? '🎥 فيديو مرفق' : '')
      );
      return `${idx + 1}.${timeTag} ${body}`;
    });

    return (
      `\n<blockquote>` +
      `💬 <b>ردود الإدارة على تقييمك (${replies.length}):</b>\n` +
      `${formattedItems.join('\n')}` +
      `</blockquote>\n`
    );
  }

  async function saveAndSendRatingReplyToAdmins(ctx, userId, payload = {}) {
    const cleanUserId = Number(userId);
    const { text = '', mediaType = null, fileId = null, caption = '' } = payload;

    const { latestInquiryId } = await fetchAllRatingAdminReplies(cleanUserId);
    const reviewRefTag = latestInquiryId ? ` (#${latestInquiryId})` : '';
    const subjectTitle = `رد على التقييم${reviewRefTag}`;

    const attachmentUrl = fileId ? `tg:${fileId}` : null;
    const messageBody = text
      ? text
      : (caption || (mediaType === 'photo' ? '🖼 صورة مرفقة (رد على التقييم)' : '🎥 فيديو مرفق (رد على التقييم)'));

    let savedRecord = null;
    try {
      const { data } = await supabase
        .from('user_inquiries')
        .insert([
          {
            user_id: cleanUserId,
            property_id: null,
            property_source: null,
            inquiry_type: 'rating',
            target_role: 'general_support',
            subject: subjectTitle,
            message: messageBody,
            attachment_url: attachmentUrl,
            status: 'open'
          }
        ])
        .select()
        .single();
      savedRecord = data || null;
    } catch (e) {
      console.error('saveAndSendRatingReplyToAdmins insert error:', e.message);
    }

    const adminIds = typeof getAdminIds === 'function' ? await getAdminIds() : [];
    if (Array.isArray(adminIds) && adminIds.length > 0) {
      const dbUser = typeof getUserRecord === 'function' ? await getUserRecord(cleanUserId) : null;
      const nameParts = await resolveNamePartsForSubmission(ctx, cleanUserId);
      const fullName = escapeHtml(
        joinFirstAndLastName(nameParts.first_name, nameParts.last_name) || dbUser?.first_name || 'مستخدم'
      );
      const nowText = formatDateTime(new Date());
      const recordTag = savedRecord?.id ? ` • سجل <code>#${savedRecord.id}</code>` : '';

      const header =
        `📩 <b>رد على التقييم${escapeHtml(reviewRefTag)}${recordTag}</b>\n` +
        `${LINE}\n` +
        `👤 <b>الاسم:</b> ${fullName}\n` +
        `🆔 <b>الآيدي (ID):</b> <code>${cleanUserId}</code>\n` +
        `🕒 <b>الوقت:</b> <code>${escapeHtml(nowText)}</code>\n`;

      const inlineRows = [];
      if (savedRecord?.id) {
        inlineRows.push([Markup.button.callback(`💬 الرد على الاستعلام (#${savedRecord.id})`, `inq_reply_${savedRecord.id}`)][span_2](start_span)[span_2](end_span)[span_3](start_span)[span_3](end_span));
      }
      inlineRows.push([Markup.button.callback(`✉️ رد على العميل (${cleanUserId})`, `support_reply_${cleanUserId}`)][span_4](start_span)[span_4](end_span)[span_5](start_span)[span_5](end_span));
      const kb = Markup.inlineKeyboard(inlineRows);

      for (const adminId of adminIds) {
        try {
          if (mediaType === 'photo' && fileId) {
            const cap = fitTelegramText(
              header + `\n💬 <b>الرد على التقييم:</b> ${escapeHtml(caption || '🖼 صورة مرفقة')}`,
              true
            );
            await ctx.telegram.sendPhoto(adminId, fileId, { caption: cap, parse_mode: 'HTML', ...kb });
          } else if (mediaType === 'video' && fileId) {
            const cap = fitTelegramText(
              header + `\n💬 <b>الرد على التقييم:</b> ${escapeHtml(caption || '🎥 فيديو مرفق')}`,
              true
            );
            await ctx.telegram.sendVideo(adminId, fileId, { caption: cap, parse_mode: 'HTML', ...kb });
          } else {
            const fullText = fitTelegramText(
              header + `\n💬 <b>الرد على التقييم:</b>\n${escapeHtml(messageBody)}`,
              false
            );
            await ctx.telegram.sendMessage(adminId, fullText, { parse_mode: 'HTML', ...kb });
          }
        } catch (err) {
          console.error(`Error forwarding rating reply to admin ${adminId}:`, err.message);
        }
      }
    }

    delete userState[cleanUserId];
    const unreadCount = await getUnreadRepliesCountSafe(cleanUserId);
    const refLine = savedRecord?.id ? ` (رقم السجل: <code>#${savedRecord.id}</code>)` : '';

    return replyTracked(
      ctx,
      cleanUserId,
      `✅ <b>تم إرسال ردك على التقييم${escapeHtml(reviewRefTag)} إلى الإدارة بنجاح${refLine}.</b>`,
      {
        parse_mode: 'HTML',
        ...buildRatingSupportKeyboard(unreadCount)
      },
      true
    );
  }

  async function getPlatformRatingsSummary(ctx = null) {
    try {
      const { data, error } = await supabase
        .from('platform_reviews')
        .select('id, user_id, first_name, last_name, rating, comment, created_at, updated_at')
        .eq('is_visible', true)
        .order('id', { ascending: false });

      if (error || !Array.isArray(data) || data.length === 0) {
        return {
          total: 0,
          totalStars: 0,
          average: '0.0',
          counts: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
          recentComments: [],
          allReviews: []
        };
      }

      const enrichedReviews = await enrichReviewsWithNames(data, ctx);

      const counts = { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };
      let totalStars = 0;

      for (const row of enrichedReviews) {
        const raw = Number(row.rating);
        const r = Object.prototype.hasOwnProperty.call(STAR_CHOICES, raw)
          ? raw
          : Math.min(5, Math.max(0, raw || 5));
        counts[r] = (counts[r] || 0) + 1;
        totalStars += r;
      }

      const average = (totalStars / enrichedReviews.length).toFixed(1);
      const recentComments = enrichedReviews
        .filter((r) => r.comment && String(r.comment).trim().length > 0)
        .slice(0, 3);

      return {
        total: enrichedReviews.length,
        totalStars,
        average,
        counts,
        recentComments,
        allReviews: enrichedReviews
      };
    } catch (e) {
      return {
        total: 0,
        totalStars: 0,
        average: '0.0',
        counts: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
        recentComments: [],
        allReviews: []
      };
    }
  }

  function formatSingleReviewBubble(review, index) {
    const dt = formatDateTime(review.updated_at || review.created_at);
    const stars = formatStarsVisual(review.rating);
    const displayName = review.reviewer_full_name
      ? `👤 <b>${escapeHtml(review.reviewer_full_name)}</b>`
      : `👤 <b>مستخدم</b>`;
    const commentLine = review.comment
      ? `\n💬 ${escapeHtml(review.comment)}`
      : `\n<i>تقييم بالنجوم فقط</i>`;
    const timeLine = dt ? `\n🕒 <i>${escapeHtml(dt)}</i>` : '';

    return (
      `<blockquote>` +
      `<b>${index + 1}.</b> ${displayName} • <b>${stars}</b>` +
      timeLine +
      commentLine +
      `</blockquote>`
    );
  }

  async function notifyAdminsOnPlatformReview(ctx, userId, rating, comment, nameParts = {}, isUpdate = false, inquiryId = null) {
    if (typeof getAdminIds !== 'function') return;
    try {
      const adminIds = await getAdminIds();
      if (!Array.isArray(adminIds) || adminIds.length === 0) return;

      const resolvedName = joinFirstAndLastName(nameParts.first_name, nameParts.last_name)
        || await fetchTelegramFallbackNameById(userId, ctx);
      const nowText = formatDateTime(new Date());
      const titleBadge = isUpdate ? '✏️ تحديث تقييم للمنصة' : '⭐ تقييم جديد للمنصة';
      const inqTag = inquiryId ? ` • استعلام <code>#${inquiryId}</code>` : '';
      const commentLine = comment
        ? `\n💬 ${escapeHtml(comment)}`
        : `\n<i>تقييم بالنجوم فقط</i>`;

      const adminMsg = fitTelegramText(
        `<b>${titleBadge}${inqTag}</b>\n` +
        `${LINE}\n` +
        `<blockquote>` +
        (resolvedName ? `👤 <b>${escapeHtml(resolvedName)}</b> (<code>${userId}</code>)\n` : `🆔 <code>${userId}</code>\n`) +
        `🌟 <b>${formatStarsVisual(rating)}</b>\n` +
        `🕒 <i>${escapeHtml(nowText)}</i>` +
        commentLine +
        `</blockquote>`,
        false
      );

      const inlineRows = [];
      if (inquiryId) {
        inlineRows.push([Markup.button.callback(`💬 الرد على الاستعلام (#${inquiryId})`, `inq_reply_${inquiryId}`)]);
      }
      inlineRows.push([Markup.button.callback(`✉️ رد على العميل (${userId})`, `support_reply_${userId}`)]);

      for (const adminId of adminIds) {
        await ctx.telegram.sendMessage(adminId, adminMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(inlineRows)
        }).catch(() => {});
      }
    } catch (e) {
      console.error('notifyAdminsOnPlatformReview error:', e.message);
    }
  }

  async function showAboutPlatformScreen(ctx, userId) {
    const aboutMsg = await getSetting(
      'about_text',
      '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة وعروض العقارات.'
    );

    const stats = await getPlatformRatingsSummary(ctx);
    const existingReview = stats.allReviews.find((r) => String(r.user_id) === String(userId)) || null;

    let ratingBlock = `\n\n${LINE}\n📊 <b>تقييم المنصة من المستخدمين</b>\n${LINE}\n`;
    if (stats.total === 0) {
      ratingBlock += `<blockquote><i>لا توجد تقييمات بعد — كن أول من يقيّم تجربته على المنصة!</i></blockquote>`;
    } else {
      ratingBlock +=
        `⭐ <b>مجموع النجوم:</b> <b>${stats.totalStars}</b>  •  📈 <b>المتوسط:</b> <b>${stats.average}</b>  •  👥 <b>التقييمات:</b> <b>${stats.total}</b>\n\n` +
        `<blockquote>` +
        `${STAR_CHOICES[6]}: <b>${stats.counts[6]}</b>  |  ${STAR_CHOICES[5]}: <b>${stats.counts[5]}</b>\n` +
        `${STAR_CHOICES[4]}: <b>${stats.counts[4]}</b>  |  ${STAR_CHOICES[3]}: <b>${stats.counts[3]}</b>\n` +
        `${STAR_CHOICES[2]}: <b>${stats.counts[2]}</b>  |  ${STAR_CHOICES[1]}: <b>${stats.counts[1]}</b>\n` +
        `${STAR_CHOICES[0]}: <b>${stats.counts[0]}</b>` +
        `</blockquote>`;

      if (stats.recentComments.length > 0) {
        ratingBlock += `\n\n💬 <b>أحدث آراء المستخدمين:</b>\n\n` +
          stats.recentComments.map((c, i) => formatSingleReviewBubble(c, i)).join('\n');
      }
    }

    const rateBtnLabel = existingReview ? '✏️ تعديل تقييمي للمنصة' : '⭐ قيّم المنصة الآن';
    const kbRows = [[rateBtnLabel]];
    if (stats.allReviews.length > 0) {
      kbRows.push([`💬 عرض كل الآراء (${stats.allReviews.length})`]);
    }
    kbRows.push(['🏠 القائمة الرئيسية']);

    userState[userId] = {
      step: 'about_platform_hub',
      data: { existingReview },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const fullText = fitTelegramText(`${aboutMsg}${ratingBlock}`, false);
    await replyTracked(ctx, userId, fullText, {
      parse_mode: 'HTML',
      ...Markup.keyboard(kbRows).resize()
    }, true);
  }

  bot.hears('ℹ️ عن المنصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showAboutPlatformScreen(ctx, ctx.from.id);
  });

  bot.hears(/^(?:⭐ قيّم المنصة الآن|✏️ تعديل تقييمي للمنصة)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    let prevReview = userState[userId]?.data?.existingReview || null;

    if (!prevReview) {
      try {
        const { data } = await supabase
          .from('platform_reviews')
          .select('id, user_id, first_name, last_name, rating, comment, created_at, updated_at')
          .eq('user_id', Number(userId))
          .eq('is_visible', true)
          .limit(1);
        prevReview = (Array.isArray(data) ? data[0] : data) || null;
      } catch (_) {}
    }

    const prevRating = prevReview && Object.prototype.hasOwnProperty.call(STAR_CHOICES, Number(prevReview.rating))
      ? Number(prevReview.rating)
      : null;
    const prevComment = prevReview?.comment ? String(prevReview.comment).trim() : '';

    const { replies: adminReplies, latestInquiryId } = await fetchAllRatingAdminReplies(userId);

    userState[userId] = {
      step: 'rating_platform_stars',
      data: {
        rating: prevRating,
        comment: prevComment,
        isUpdate: Boolean(prevReview),
        adminReplies,
        latestInquiryId
      },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const prevNote = prevRating !== null
      ? `\n<blockquote>` +
        `📌 <b>تقييمك السابق:</b> <b>${formatStarsVisual(prevRating)}</b>` +
        (prevComment ? `\n💬 <b>تعليقك السابق:</b> ${escapeHtml(prevComment)}` : `\n<i>بدون تعليق نصي سابق</i>`) +
        `</blockquote>\n`
      : '';

    const repliesBlock = formatRatingAdminRepliesBlock(adminReplies);

    const replyBtnRow = adminReplies.length > 0
      ? [['💬 رد على التقييم']]
      : [];

    await replyTracked(
      ctx, userId,
      fitTelegramText(
        `⭐ <b>تقييم منصة عقار الجزائر</b>\n${LINE}${prevNote}${repliesBlock}\n👇 <i>اختر تقييمك من الأزرار في الأسفل</i>`,
        false
      ),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [STAR_CHOICES[0], STAR_CHOICES[1], STAR_CHOICES[2]],
          [STAR_CHOICES[3], STAR_CHOICES[4], STAR_CHOICES[5]],
          [STAR_CHOICES[6]],
          ...replyBtnRow,
          ['⬅️ رجوع', '🏠 القائمة الرئيسية']
        ]).resize()
      },
      true
    );
  });

  bot.hears('💬 رد على التقييم', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    let latestInquiryId = userState[userId]?.data?.latestInquiryId || null;

    if (!latestInquiryId) {
      const fetched = await fetchAllRatingAdminReplies(userId);
      latestInquiryId = fetched.latestInquiryId;
    }

    userState[userId] = {
      step: 'rating_user_replying',
      data: { latestInquiryId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const refLine = latestInquiryId ? ` <code>#${latestInquiryId}</code>` : '';
    await replyTracked(
      ctx, userId,
      `💬 <b>رد على التقييم${refLine}</b>\n\nاكتب ردك على الإدارة بخصوص تقييمك الآن أو أرفق صورة/فيديو:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ['⬅️ رجوع', '🏠 القائمة الرئيسية']
        ]).resize()
      },
      true
    );
  });

  bot.hears(/^💬 عرض كل الآراء \(\d+\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const stats = await getPlatformRatingsSummary(ctx);

    if (!stats.allReviews.length) {
      return showAboutPlatformScreen(ctx, userId);
    }

    const lines = stats.allReviews.slice(0, 15).map((r, idx) => formatSingleReviewBubble(r, idx));

    const sent = await ctx.reply(
      fitTelegramText(
        `💬 <b>آراء المستخدمين حول المنصة</b>\n` +
        `${LINE}\n` +
        `⭐ <b>مجموع النجوم:</b> <b>${stats.totalStars}</b>  •  📈 <b>المتوسط:</b> <b>${stats.average}</b>  •  👥 <b>الإجمالي:</b> <b>${stats.total}</b>\n` +
        `${LINE}\n\n` +
        `${lines.join('\n')}`,
        false
      ),
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ['⭐ قيّم المنصة الآن', 'ℹ️ عن المنصة'],
          ['🏠 القائمة الرئيسية']
        ]).resize()
      }
    ).catch(() => null);

    const keepIds = sent?.message_id ? [sent.message_id] : [];
    if (sent?.message_id) trackBotMessage(userId, ctx.chat.id, sent.message_id);
    await clearTrackedBotMessages(ctx, userId, keepIds);
  });

  bot.hears(/^📞 الدعم والإدارة(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    return openSupportFromRating(ctx, ctx.from.id);
  });

  async function submitPlatformReview(ctx, userId, chosenRating, rawComment = null, isUpdate = false, adminReplies = []) {
    const cleanUserId = Number(userId);
    const cleanRating = Math.min(6, Math.max(0, Number(chosenRating)));
    const cleanComment = rawComment && String(rawComment).trim().length > 0
      ? String(rawComment).trim().slice(0, 400)
      : null;
    const nowIso = new Date().toISOString();
    const nameParts = await resolveNamePartsForSubmission(ctx, cleanUserId);

    const { error } = await supabase
      .from('platform_reviews')
      .upsert(
        [
          {
            user_id: cleanUserId,
            first_name: nameParts.first_name,
            last_name: nameParts.last_name,
            rating: cleanRating,
            comment: cleanComment,
            is_visible: true,
            updated_at: nowIso
          }
        ],
        { onConflict: 'user_id' }
      )
      .select('id, user_id, first_name, last_name, rating, comment, created_at, updated_at')
      .single();

    if (error) {
      console.error('submitPlatformReview error:', error.message);
      await ctx.reply(
        `⚠️ <b>تعذر حفظ تقييمك حالياً:</b>\n<code>${escapeHtml(error.message || 'خطأ غير معروف')}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return showAboutPlatformScreen(ctx, cleanUserId);
    }

    const syncedInquiry = await syncRatingInquiryRecord(cleanUserId, cleanRating, cleanComment, isUpdate);
    await notifyAdminsOnPlatformReview(ctx, cleanUserId, cleanRating, cleanComment, nameParts, isUpdate, syncedInquiry?.id || null);

    if (cleanRating < 3) {
      return openSupportAndImprovementsFlow(ctx, cleanUserId, cleanRating);
    }

    const fetched = Array.isArray(adminReplies) && adminReplies.length > 0
      ? adminReplies
      : (await fetchAllRatingAdminReplies(cleanUserId)).replies;
    const repliesNote = formatRatingAdminRepliesBlock(fetched);

    delete userState[cleanUserId];
    await ctx.reply(
      fitTelegramText(
        `🎉 <b>شكراً لك! تم حفظ تقييمك للمنصة بنجاح</b>\n🌟 <b>التقييم:</b> <b>${formatStarsVisual(cleanRating)}</b>${repliesNote}`,
        false
      ),
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return showAboutPlatformScreen(ctx, cleanUserId);
  }

  async function handlePlatformRatingText(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const state = userState[userId];
    if (!state || !['rating_platform_stars', 'rating_platform_comment', 'rating_user_replying'].includes(state.step)) {
      return next();
    }

    const userText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!userText || userText.startsWith('/')) return next();

    if (
      ['⬅️ رجوع', '🏠 القائمة الرئيسية', '❌ إلغاء العملية والعودة', IMPROVEMENT_BTN_TEXT, '💬 رد على التقييم'].includes(userText) ||
      /^📞 الدعم والإدارة(?:\s*\(\d+\))?$/.test(userText)
    ) {
      return next();
    }

    if (state.step === 'rating_user_replying') {
      await safeDeleteUserMessage(ctx);
      return saveAndSendRatingReplyToAdmins(ctx, userId, { text: userText });
    }

    if (state.step === 'rating_platform_stars') {
      await safeDeleteUserMessage(ctx);
      const chosenRating = parseStarSelection(userText);
      if (chosenRating === null) {
        return replyTracked(
          ctx, userId,
          `⚠️ <b>يرجى اختيار التقييم من أزرار النجوم في الأسفل:</b>`,
          { parse_mode: 'HTML' },
          true
        );
      }

      const isUpdate = Boolean(state.data?.isUpdate);
      const adminReplies = Array.isArray(state.data?.adminReplies) ? state.data.adminReplies : [];
      const latestInquiryId = state.data?.latestInquiryId || null;
      state.step = 'rating_platform_comment';
      state.data = { rating: chosenRating, isUpdate, adminReplies, latestInquiryId };

      return replyTracked(
        ctx, userId,
        fitTelegramText(
          `✅ <b>تم اختيار تقييمك:</b> <b>${formatStarsVisual(chosenRating)}</b>\n` +
          `${formatRatingAdminRepliesBlock(adminReplies)}\n` +
          `✍️ <i>اكتب الآن تعليقك أو ملاحظتك حول المنصة (اختياري)، أو اضغط "⏭️ تخطّي" لحفظ النجوم فقط</i>`,
          false
        ),
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['⏭️ تخطّي (الاكتفاء بالنجوم)'],
            ['⬅️ رجوع', '🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    if (state.step === 'rating_platform_comment') {
      await safeDeleteUserMessage(ctx);
      const chosenRating = Object.prototype.hasOwnProperty.call(STAR_CHOICES, Number(state.data?.rating))
        ? Number(state.data.rating)
        : 5;
      const isUpdate = Boolean(state.data?.isUpdate);
      const adminReplies = Array.isArray(state.data?.adminReplies) ? state.data.adminReplies : [];
      const isSkip = userText === '⏭️ تخطّي (الاكتفاء بالنجوم)';
      const cleanComment = isSkip ? null : userText.slice(0, 400);

      return submitPlatformReview(ctx, userId, chosenRating, cleanComment, isUpdate, adminReplies);
    }

    return next();
  }

  bot.on('text', async (ctx, next) => {
    return handlePlatformRatingText(ctx, next);
  });

  bot.on('photo', async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || userState[userId]?.step !== 'rating_user_replying') return next();
    await safeDeleteUserMessage(ctx);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    return saveAndSendRatingReplyToAdmins(ctx, userId, {
      mediaType: 'photo',
      fileId: photo.file_id,
      caption: ctx.message.caption || ''
    });
  });

  bot.on('video', async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || userState[userId]?.step !== 'rating_user_replying') return next();
    await safeDeleteUserMessage(ctx);
    return saveAndSendRatingReplyToAdmins(ctx, userId, {
      mediaType: 'video',
      fileId: ctx.message.video.file_id,
      caption: ctx.message.caption || ''
    });
  });

  return {
    showAboutPlatformScreen,
    getPlatformRatingsSummary,
    openSupportAndImprovementsFlow
  };
};
