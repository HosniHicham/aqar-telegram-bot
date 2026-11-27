'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — خاصية تقييم المنصة وإرسال التقييم وعرض الإحصائيات
// يجلب الاسم الحقيقي للمستخدم من جدول users عبر id ويعرض كل تقييم في فقاعة واحدة.
// =========================================================================

const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬';

const STAR_CHOICES = {
  0: '☆☆☆☆☆',
  1: '⭐☆☆☆☆',
  2: '⭐⭐☆☆☆',
  3: '⭐⭐⭐☆☆',
  4: '⭐⭐⭐⭐☆',
  5: '⭐⭐⭐⭐⭐',
  6: '🌟'
};

function isBadName(name) {
  const n = String(name || '').trim();
  return !n || /^مستخدم\s*\d*$/i.test(n) || /^user\s*\d*$/i.test(n) || /^\d+$/.test(n);
}

function buildFullNameFromRecord(obj) {
  if (!obj) return '';
  const full = [obj.first_name, obj.last_name].filter(Boolean).join(' ').trim();
  if (!isBadName(full)) return full;
  if (!isBadName(obj.username)) return String(obj.username).trim();
  return '';
}

module.exports = function registerPlatformRating(bot, core, helpers) {
  const {
    Markup, supabase, userState,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, getAdminIds, getUserRecord,
    formatDateTime, escapeHtml, fitTelegramText
  } = core;

  const { registerFreeTextStep } = helpers;

  if (typeof registerFreeTextStep === 'function') {
    registerFreeTextStep('rating_platform_comment');
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

  async function fetchRealNameByUserId(userId, ctx = null) {
    const id = Number(userId);
    if (!id) return 'مستخدم';

    if (typeof getUserRecord === 'function') {
      try {
        const rec = await getUserRecord(id);
        const fromRec = buildFullNameFromRecord(rec);
        if (fromRec) return fromRec;
      } catch (_) {}
    }

    try {
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, username')
        .eq('id', id)
        .limit(1);
      const row = Array.isArray(data) ? data[0] : data;
      const fromDb = buildFullNameFromRecord(row);
      if (fromDb) return fromDb;
    } catch (_) {}

    if (ctx && Number(ctx.from?.id) === id) {
      const fromCtx = buildFullNameFromRecord(ctx.from);
      if (fromCtx) return fromCtx;
    }

    return 'مستخدم';
  }

  async function enrichReviewsWithRealNames(reviews = []) {
    if (!Array.isArray(reviews) || reviews.length === 0) return [];
    const userIds = [...new Set(reviews.map((r) => Number(r.user_id)).filter(Boolean))];
    const namesMap = {};

    if (userIds.length > 0) {
      try {
        const { data: usersRows } = await supabase
          .from('users')
          .select('id, first_name, last_name, username')
          .in('id', userIds);

        if (Array.isArray(usersRows)) {
          for (const u of usersRows) {
            const full = buildFullNameFromRecord(u);
            if (full) namesMap[Number(u.id)] = full;
          }
        }
      } catch (_) {}
    }

    return reviews.map((r) => ({
      ...r,
      reviewer_full_name: namesMap[Number(r.user_id)] || 'مستخدم'
    }));
  }

  async function getPlatformRatingsSummary() {
    try {
      const { data, error } = await supabase
        .from('platform_reviews')
        .select('id, user_id, rating, comment, created_at, updated_at')
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

      const enrichedReviews = await enrichReviewsWithRealNames(data);

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

  // فقاعة واحدة كاملة تضم الاسم الحقيقي + التقييم + التاريخ + التعليق
  function formatSingleReviewBubble(review, index) {
    const dt = formatDateTime(review.updated_at || review.created_at);
    const fullName = escapeHtml(review.reviewer_full_name || 'مستخدم');
    const stars = formatStarsVisual(review.rating);
    const commentPart = review.comment
      ? `\n💬 ${escapeHtml(review.comment)}`
      : `\n<i>تقييم بالنجوم فقط</i>`;
    const timePart = dt ? `\n🕒 <i>${escapeHtml(dt)}</i>` : '';

    return (
      `<blockquote>` +
      `<b>${index + 1}. 👤 ${fullName} • ${stars}</b>` +
      timePart +
      commentPart +
      `</blockquote>`
    );
  }

  async function notifyAdminsOnPlatformReview(ctx, userId, rating, comment, isUpdate = false) {
    if (typeof getAdminIds !== 'function') return;
    try {
      const adminIds = await getAdminIds();
      if (!Array.isArray(adminIds) || adminIds.length === 0) return;

      const resolvedName = await fetchRealNameByUserId(userId, ctx);
      const fullName = escapeHtml(resolvedName || 'مستخدم');
      const nowText = formatDateTime(new Date());
      const titleBadge = isUpdate ? '✏️ تحديث تقييم للمنصة' : '⭐ تقييم جديد للمنصة';
      const commentLine = comment
        ? `\n💬 ${escapeHtml(comment)}`
        : `\n<i>تقييم بالنجوم فقط</i>`;

      const adminMsg = fitTelegramText(
        `<b>${titleBadge}</b>\n` +
        `${LINE}\n` +
        `<blockquote>` +
        `👤 <b>${fullName}</b> (<code>${userId}</code>)\n` +
        `🌟 <b>${formatStarsVisual(rating)}</b>\n` +
        `🕒 <i>${escapeHtml(nowText)}</i>` +
        commentLine +
        `</blockquote>`,
        false
      );

      for (const adminId of adminIds) {
        await ctx.telegram.sendMessage(adminId, adminMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`✉️ رد على العميل (${userId})`, `support_reply_${userId}`)]
          ])
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

    const stats = await getPlatformRatingsSummary();
    const existingReview = stats.allReviews.find((r) => Number(r.user_id) === Number(userId)) || null;

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
    const prevReview = userState[userId]?.data?.existingReview || null;
    const prevRating = prevReview && Object.prototype.hasOwnProperty.call(STAR_CHOICES, Number(prevReview.rating))
      ? Number(prevReview.rating)
      : null;
    const prevComment = prevReview?.comment ? String(prevReview.comment).trim() : '';

    userState[userId] = {
      step: 'rating_platform_stars',
      data: { rating: prevRating, comment: prevComment, isUpdate: Boolean(prevReview) },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const prevNote = prevRating !== null
      ? `\n<blockquote>` +
        `📌 <b>تقييمك السابق:</b> <b>${formatStarsVisual(prevRating)}</b>` +
        (prevComment ? `\n💬 <b>تعليقك السابق:</b> ${escapeHtml(prevComment)}` : `\n<i>بدون تعليق نصي سابق</i>`) +
        `</blockquote>\n`
      : '';

    await replyTracked(
      ctx, userId,
      `⭐ <b>تقييم منصة عقار الجزائر</b>\n${LINE}${prevNote}\n👇 <i>اختر تقييمك من الأزرار في الأسفل</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [STAR_CHOICES[0], STAR_CHOICES[1], STAR_CHOICES[2]],
          [STAR_CHOICES[3], STAR_CHOICES[4], STAR_CHOICES[5]],
          [STAR_CHOICES[6]],
          ['⬅️ رجوع', '🏠 القائمة الرئيسية']
        ]).resize()
      },
      true
    );
  });

  bot.hears(/^💬 عرض كل الآراء \(\d+\)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const stats = await getPlatformRatingsSummary();

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

  async function submitPlatformReview(ctx, userId, chosenRating, rawComment = null, isUpdate = false) {
    const cleanUserId = Number(userId);
    const cleanRating = Math.min(6, Math.max(0, Number(chosenRating)));
    const cleanComment = rawComment && String(rawComment).trim().length > 0
      ? String(rawComment).trim().slice(0, 400)
      : null;
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('platform_reviews')
      .upsert(
        [
          {
            user_id: cleanUserId,
            rating: cleanRating,
            comment: cleanComment,
            is_visible: true,
            updated_at: nowIso
          }
        ],
        { onConflict: 'user_id' }
      )
      .select('id, user_id, rating, comment, created_at, updated_at')
      .single();

    if (error) {
      console.error('submitPlatformReview error:', error.message);
      await ctx.reply(
        `⚠️ <b>تعذر حفظ تقييمك حالياً:</b>\n<code>${escapeHtml(error.message || 'خطأ غير معروف')}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return showAboutPlatformScreen(ctx, cleanUserId);
    }

    await notifyAdminsOnPlatformReview(ctx, cleanUserId, cleanRating, cleanComment, isUpdate);

    delete userState[cleanUserId];
    await ctx.reply(
      `🎉 <b>شكراً لك! تم حفظ تقييمك للمنصة بنجاح</b>\n🌟 <b>التقييم:</b> <b>${formatStarsVisual(cleanRating)}</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return showAboutPlatformScreen(ctx, cleanUserId);
  }

  async function handlePlatformRatingText(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const state = userState[userId];
    if (!state || !['rating_platform_stars', 'rating_platform_comment'].includes(state.step)) {
      return next();
    }

    const userText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!userText || userText.startsWith('/')) return next();

    if (['⬅️ رجوع', '🏠 القائمة الرئيسية', '❌ إلغاء العملية والعودة'].includes(userText)) {
      return next();
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
      state.step = 'rating_platform_comment';
      state.data = { rating: chosenRating, isUpdate };

      return replyTracked(
        ctx, userId,
        `✅ <b>تم اختيار تقييمك:</b> <b>${formatStarsVisual(chosenRating)}</b>\n\n` +
        `✍️ <i>اكتب الآن تعليقك أو ملاحظتك حول المنصة (اختياري)، أو اضغط "⏭️ تخطّي" لحفظ النجوم فقط</i>`,
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
      const isSkip = userText === '⏭️ تخطّي (الاكتفاء بالنجوم)';
      const cleanComment = isSkip ? null : userText.slice(0, 400);

      return submitPlatformReview(ctx, userId, chosenRating, cleanComment, isUpdate);
    }

    return next();
  }

  bot.on('text', async (ctx, next) => {
    return handlePlatformRatingText(ctx, next);
  });

  return {
    showAboutPlatformScreen,
    getPlatformRatingsSummary
  };
};
