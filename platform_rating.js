'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — خاصية تقييم المنصة وإرسال التقييم وعرض الإحصائيات
// ملف مستقل لتسهيل التعديل والصيانة دون التأثير على باقي ملفات المستخدم.
// يعرض الاسم الأول للمُقيّم لزيادة المصداقية مع حماية الخصوصية.
// =========================================================================

const STAR_CHOICES = {
  1: '⭐☆☆☆☆',
  2: '⭐⭐☆☆☆',
  3: '⭐⭐⭐☆☆',
  4: '⭐⭐⭐⭐☆',
  5: '⭐⭐⭐⭐⭐',
  6: '🌟'
};

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
    if (STAR_CHOICES[n]) return STAR_CHOICES[n];
    const safeN = Math.min(5, Math.max(1, n || 5));
    return '⭐'.repeat(safeN) + '☆'.repeat(5 - safeN);
  }

  function parseStarSelection(text = '') {
    const clean = String(text).trim();
    if (clean === STAR_CHOICES[6]) return 6;
    for (const [key, label] of Object.entries(STAR_CHOICES)) {
      if (clean === label) return Number(key);
    }
    const filledStars = (clean.match(/⭐/g) || []).length;
    if (filledStars >= 1 && filledStars <= 5) {
      return filledStars;
    }
    return null;
  }

  // استخراج الاسم الأول فقط لزيادة المصداقية دون كشف الاسم الكامل
  function formatPublicReviewerName(rawName = '') {
    const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!clean) return 'مستخدم موثق';
    const firstWord = clean.split(' ')[0];
    return firstWord.length > 18 ? firstWord.slice(0, 18) : firstWord;
  }

  async function enrichReviewsWithFirstNames(reviews = []) {
    if (!Array.isArray(reviews) || reviews.length === 0) return [];
    const userIds = [...new Set(reviews.map(r => Number(r.user_id)).filter(Boolean))];
    const namesMap = {};

    if (userIds.length > 0) {
      try {
        const { data: usersRows } = await supabase
          .from('users')
          .select('id, first_name')
          .in('id', userIds);

        if (Array.isArray(usersRows)) {
          for (const u of usersRows) {
            namesMap[Number(u.id)] = formatPublicReviewerName(u.first_name);
          }
        }
      } catch (e) {}
    }

    return reviews.map(r => ({
      ...r,
      reviewer_name: namesMap[Number(r.user_id)] || 'مستخدم موثق'
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
          average: '0.0',
          counts: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          recentComments: [],
          allReviews: []
        };
      }

      const enrichedReviews = await enrichReviewsWithFirstNames(data);

      const counts = { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let sum = 0;

      for (const row of enrichedReviews) {
        const raw = Number(row.rating);
        const r = STAR_CHOICES[raw] ? raw : Math.min(5, Math.max(1, raw || 5));
        counts[r] = (counts[r] || 0) + 1;
        sum += r;
      }

      const average = (sum / enrichedReviews.length).toFixed(1);
      const recentComments = enrichedReviews
        .filter(r => r.comment && String(r.comment).trim().length > 0)
        .slice(0, 3);

      return {
        total: enrichedReviews.length,
        average,
        counts,
        recentComments,
        allReviews: enrichedReviews
      };
    } catch (e) {
      return {
        total: 0,
        average: '0.0',
        counts: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        recentComments: [],
        allReviews: []
      };
    }
  }

  async function notifyAdminsOnPlatformReview(ctx, userId, rating, comment, isUpdate = false) {
    if (typeof getAdminIds !== 'function') return;
    try {
      const adminIds = await getAdminIds();
      if (!Array.isArray(adminIds) || adminIds.length === 0) return;

      const dbUser = typeof getUserRecord === 'function' ? await getUserRecord(userId) : null;
      const fullName = escapeHtml(
        [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || dbUser?.first_name || 'مستخدم'
      );
      const nowText = formatDateTime(new Date());
      const titleBadge = isUpdate ? '✏️ تحديث تقييم للمنصة' : '⭐ تقييم جديد للمنصة';
      const commentLine = comment
        ? `\n💬 <b>التعليق:</b> ${escapeHtml(comment)}`
        : `\n💬 <b>التعليق:</b> <i>تقييم بالنجوم فقط</i>`;

      const adminMsg = fitTelegramText(
        `<b>${titleBadge}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>المستخدم:</b> ${fullName} (<code>${userId}</code>)\n` +
        `🌟 <b>التقييم:</b> <b>${formatStarsVisual(rating)}</b>\n` +
        `🕒 <b>الوقت:</b> <code>${escapeHtml(nowText)}</code>` +
        commentLine,
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
    const existingReview = stats.allReviews.find(r => Number(r.user_id) === Number(userId)) || null;

    let ratingBlock = `\n\n━━━━━━━━━━━━━━━━━━━━\n📊 <b>تقييم المنصة من المستخدمين:</b>\n`;
    if (stats.total === 0) {
      ratingBlock += `<i>لا توجد تقييمات بعد — كن أول من يقيّم تجربته على المنصة!</i>`;
    } else {
      ratingBlock +=
        `⭐ <b>التقييم العام:</b> <b>${stats.average}</b> (${stats.total} تقييم)\n` +
        `${STAR_CHOICES[6]}: <b>${stats.counts[6]}</b> | ${STAR_CHOICES[5]}: <b>${stats.counts[5]}</b> | ${STAR_CHOICES[4]}: <b>${stats.counts[4]}</b>\n` +
        `${STAR_CHOICES[3]}: <b>${stats.counts[3]}</b> | ${STAR_CHOICES[2]}: <b>${stats.counts[2]}</b> | ${STAR_CHOICES[1]}: <b>${stats.counts[1]}</b>`;

      if (stats.recentComments.length > 0) {
        ratingBlock += `\n\n💬 <b>أحدث التعليقات:</b>\n` + stats.recentComments.map((c, i) => {
          const dt = formatDateTime(c.updated_at || c.created_at);
          return `${i + 1}. 👤 <b>${escapeHtml(c.reviewer_name)}</b> • <b>${formatStarsVisual(c.rating)}</b> (<code>${escapeHtml(dt)}</code>)\n   💬 ${escapeHtml(c.comment)}`;
        }).join('\n\n');
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
    const prevRating = prevReview?.rating || null;

    userState[userId] = {
      step: 'rating_platform_stars',
      data: { rating: prevRating, isUpdate: Boolean(prevReview) },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const prevNote = prevRating
      ? `\n📌 تقييمك السابق: <b>${formatStarsVisual(prevRating)}</b>\n`
      : '';

    await replyTracked(
      ctx, userId,
      `⭐ <b>تقييم منصة عقار الجزائر</b>\n━━━━━━━━━━━━━━━━━━━━\n${prevNote}\nاختر تقييمك للمنصة من الأزرار في الأسفل:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [STAR_CHOICES[1], STAR_CHOICES[2], STAR_CHOICES[3]],
          [STAR_CHOICES[4], STAR_CHOICES[5], STAR_CHOICES[6]],
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

    const lines = stats.allReviews.slice(0, 15).map((r, idx) => {
      const dt = formatDateTime(r.updated_at || r.created_at);
      const cText = r.comment ? escapeHtml(r.comment) : '<i>تقييم بالنجوم فقط</i>';
      return `${idx + 1}. 👤 <b>${escapeHtml(r.reviewer_name)}</b> • <b>${formatStarsVisual(r.rating)}</b> • <code>${escapeHtml(dt)}</code>\n   💬 ${cText}`;
    });

    const sent = await ctx.reply(
      fitTelegramText(
        `💬 <b>آراء المستخدمين حول المنصة</b>\n⭐ <b>المتوسط:</b> <b>${stats.average}</b> (${stats.total} تقييم)\n━━━━━━━━━━━━━━━━━━━━\n\n${lines.join('\n\n')}`,
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
    const cleanRating = Math.min(6, Math.max(1, Number(chosenRating) || 5));
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
      `🎉 <b>شكراً لك! تم حفظ تقييمك للمنصة (<b>${formatStarsVisual(cleanRating)}</b>).</b>`,
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
      if (!chosenRating) {
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
        `✅ اخترت: <b>${formatStarsVisual(chosenRating)}</b>\n\n` +
        `✍️ <b>اكتب الآن تعليقك أو ملاحظتك حول المنصة (اختياري)، أو اضغط "⏭️ تخطّي" لحفظ النجوم فقط:</b>`,
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
      const chosenRating = Number(state.data?.rating) || 5;
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
