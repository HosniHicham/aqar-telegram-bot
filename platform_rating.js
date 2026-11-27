'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — عرض التقييمات والآراء في "عن المنصة" + زر مستقل للتقييم
// =========================================================================

const BTN_RATE_PLATFORM = '⭐ تقييم المنصة';

const STAR_BUTTONS = {
  1: '⭐',
  2: '⭐⭐',
  3: '⭐⭐⭐',
  4: '⭐⭐⭐⭐',
  5: '⭐⭐⭐⭐⭐',
  6: '🌟'
};

module.exports = function registerPlatformRating(bot, core, helpers) {
  const {
    Markup, supabase, userState,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, formatDateTime, escapeHtml, fitTelegramText
  } = core;

  const { buildUserMainKeyboard, registerFreeTextStep } = helpers;

  if (typeof registerFreeTextStep === 'function') {
    registerFreeTextStep('rating_platform_comment');
  }

  function formatStarsVisual(rating) {
    const n = Number(rating);
    if (STAR_BUTTONS[n]) return STAR_BUTTONS[n];
    const safeN = Math.min(5, Math.max(1, n || 5));
    return '⭐'.repeat(safeN);
  }

  function parseStarSelection(text = '') {
    const clean = String(text).trim();
    if (clean === '🌟') return 6;
    const matches = clean.match(/⭐/g);
    if (matches && matches.length >= 1 && matches.length <= 5) {
      return matches.length;
    }
    return null;
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

      const counts = { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let sum = 0;

      for (const row of data) {
        const raw = Number(row.rating);
        const r = STAR_BUTTONS[raw] ? raw : Math.min(5, Math.max(1, raw || 5));
        counts[r] = (counts[r] || 0) + 1;
        sum += r;
      }

      const average = (sum / data.length).toFixed(1);
      const recentComments = data
        .filter(r => r.comment && String(r.comment).trim().length > 0)
        .slice(0, 5);

      return {
        total: data.length,
        average,
        counts,
        recentComments,
        allReviews: data
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

  // شاشة "ℹ️ عن المنصة": تعرض نبذة المنصة + التقييم العام + الإحصائيات + التعليقات
  async function showAboutPlatformScreen(ctx, userId) {
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = await buildUserMainKeyboard(userId, unreadCount);

    const aboutMsg = await getSetting(
      'about_text',
      '🏛 <b>عن منصة عقار الجزائر (Aqar System):</b>\n\nنظام رقمي ذكي ومتطور لإدارة المعاملات العقارية.'
    );

    const stats = await getPlatformRatingsSummary();

    let reviewsBlock = `\n\n━━━━━━━━━━━━━━━━━━━━\n📊 <b>تقييم المنصة وآراء المستخدمين:</b>\n`;
    if (stats.total === 0) {
      reviewsBlock += `<i>لا توجد تقييمات أو تعليقات منشورة بعد.</i>`;
    } else {
      reviewsBlock +=
        `⭐ <b>التقييم العام:</b> <b>${stats.average}</b> (${stats.total} تقييم)\n` +
        `🌟: <b>${stats.counts[6]}</b> | ⭐⭐⭐⭐⭐: <b>${stats.counts[5]}</b> | ⭐⭐⭐⭐: <b>${stats.counts[4]}</b>\n` +
        `⭐⭐⭐: <b>${stats.counts[3]}</b> | ⭐⭐: <b>${stats.counts[2]}</b> | ⭐: <b>${stats.counts[1]}</b>`;

      if (stats.recentComments.length > 0) {
        reviewsBlock += `\n\n💬 <b>تعليقات المستخدمين:</b>\n` + stats.recentComments.map((c, idx) => {
          const dt = formatDateTime(c.updated_at || c.created_at);
          return `${idx + 1}. <b>${formatStarsVisual(c.rating)}</b> • <code>${escapeHtml(dt)}</code>\n   💬 ${escapeHtml(c.comment)}`;
        }).join('\n\n');
      } else {
        reviewsBlock += `\n💬 <i>يوجد تقييمات بالنجوم بدون تعليقات نصية حتى الآن.</i>`;
      }
    }

    const fullText = fitTelegramText(`${aboutMsg}${reviewsBlock}`, false);
    await replyTracked(ctx, userId, fullText, { parse_mode: 'HTML', ...mainKb }, true);
  }

  // زر مستقل لبدء تقييم المنصة
  async function startPlatformRatingFlow(ctx, userId) {
    const stats = await getPlatformRatingsSummary();
    const prevReview = stats.allReviews.find(r => Number(r.user_id) === Number(userId)) || null;
    const prevRating = prevReview?.rating || null;

    userState[userId] = {
      step: 'rating_platform_stars',
      data: { rating: prevRating, prevComment: prevReview?.comment || null },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const prevNote = prevRating
      ? `📌 <b>تقييمك الحالي:</b> <b>${formatStarsVisual(prevRating)}</b>\n` +
        (prevReview?.comment ? `💬 <b>تعليقك الحالي:</b> ${escapeHtml(prevReview.comment)}\n` : '') +
        `يمكنك اختيار تقييم جديد لتحديثه:\n`
      : '';

    await replyTracked(
      ctx, userId,
      `⭐ <b>تقييم منصة عقار الجزائر</b>\n━━━━━━━━━━━━━━━━━━━━\n${prevNote}\nاختر تقييمك للمنصة من الأزرار في الأسفل:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ['⭐', '⭐⭐', '⭐⭐⭐'],
          ['⭐⭐⭐⭐', '⭐⭐⭐⭐⭐', '🌟'],
          ['🏠 القائمة الرئيسية']
        ]).resize()
      },
      true
    );
  }

  bot.hears('ℹ️ عن المنصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showAboutPlatformScreen(ctx, ctx.from.id);
  });

  bot.hears(BTN_RATE_PLATFORM, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await startPlatformRatingFlow(ctx, ctx.from.id);
  });

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

      state.step = 'rating_platform_comment';
      state.data = { rating: chosenRating };

      return replyTracked(
        ctx, userId,
        `✅ اخترت: <b>${formatStarsVisual(chosenRating)}</b>\n\n` +
        `✍️ <b>اكتب الآن تعليقك أو رأيك حول المنصة (اختياري)، أو اضغط "⏭️ تخطّي" لحفظ النجوم فقط:</b>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['⏭️ تخطّي (الاكتفاء بالنجوم)'],
            ['🏠 القائمة الرئيسية']
          ]).resize()
        },
        true
      );
    }

    if (state.step === 'rating_platform_comment') {
      await safeDeleteUserMessage(ctx);
      const chosenRating = Number(state.data?.rating) || 5;
      const isSkip = userText === '⏭️ تخطّي (الاكتفاء بالنجوم)';
      const cleanComment = isSkip ? null : userText.slice(0, 400);

      await supabase
        .from('platform_reviews')
        .upsert([{
          user_id: Number(userId),
          rating: chosenRating,
          comment: cleanComment,
          is_visible: true,
          updated_at: new Date().toISOString()
        }], { onConflict: 'user_id' });

      delete userState[userId];
      const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
      const mainKb = await buildUserMainKeyboard(userId, unreadCount);

      const commentLine = cleanComment ? `\n💬 <b>تعليقك:</b> ${escapeHtml(cleanComment)}` : '';
      return replyTracked(
        ctx, userId,
        `🎉 <b>شكراً لك! تم حفظ تقييمك للمنصة (<b>${formatStarsVisual(chosenRating)}</b>).</b>${commentLine}`,
        { parse_mode: 'HTML', ...mainKb },
        true
      );
    }

    return next();
  }

  bot.on('text', async (ctx, next) => {
    return handlePlatformRatingText(ctx, next);
  });

  return {
    BTN_RATE_PLATFORM,
    showAboutPlatformScreen,
    startPlatformRatingFlow,
    getPlatformRatingsSummary
  };
};
