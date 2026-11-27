'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — خاصية تقييم المنصة وعرض الإحصائيات والآراء
// ملف مستقل لتسهيل التعديل والصيانة دون التأثير على باقي ملفات المستخدم.
// =========================================================================

module.exports = function registerPlatformRating(bot, core, helpers) {
  const { Markup, supabase, userState, trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage, getSetting, formatDateTime, escapeHtml, fitTelegramText } = core;
  const { buildUserMainKeyboard, registerFreeTextStep } = helpers;

  if (typeof registerFreeTextStep === 'function') {
    registerFreeTextStep('rating_platform_comment');
  }

  function formatStarsVisual(rating) {
    const n = Math.min(5, Math.max(1, Number(rating) || 0));
    return '⭐'.repeat(n);
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
          counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          recentComments: [],
          allReviews: []
        };
      }

      const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let sum = 0;

      for (const row of data) {
        const r = Math.min(5, Math.max(1, Number(row.rating) || 5));
        counts[r] = (counts[r] || 0) + 1;
        sum += r;
      }

      const average = (sum / data.length).toFixed(1);
      const recentComments = data
        .filter(r => r.comment && String(r.comment).trim().length > 0)
        .slice(0, 3);

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
        counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        recentComments: [],
        allReviews: []
      };
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
        `⭐ <b>التقييم العام:</b> <b>${stats.average} / 5</b> (${stats.total} تقييم)\n` +
        `5⭐: <b>${stats.counts[5]}</b> | 4⭐: <b>${stats.counts[4]}</b> | 3⭐: <b>${stats.counts[3]}</b> | 2⭐: <b>${stats.counts[2]}</b> | 1⭐: <b>${stats.counts[1]}</b>`;

      if (stats.recentComments.length > 0) {
        ratingBlock += `\n\n💬 <b>أحدث التعليقات:</b>\n` + stats.recentComments.map((c, i) => {
          const dt = formatDateTime(c.updated_at || c.created_at);
          return `${i + 1}. ${formatStarsVisual(c.rating)} (<code>${escapeHtml(dt)}</code>): ${escapeHtml(c.comment)}`;
        }).join('\n');
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
    const prevRating = userState[userId]?.data?.existingReview?.rating || null;

    userState[userId] = {
      step: 'rating_platform_stars',
      data: { rating: prevRating },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const prevNote = prevRating
      ? `\n📌 تقييمك السابق: <b>${formatStarsVisual(prevRating)} (${prevRating}/5)</b>\n`
      : '';

    await replyTracked(
      ctx, userId,
      `⭐ <b>تقييم منصة عقار الجزائر</b>\n━━━━━━━━━━━━━━━━━━━━\n${prevNote}\nاختر تقييمك للمنصة من 1 إلى 5 نجوم:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          ['⭐ 1', '⭐⭐ 2', '⭐⭐⭐ 3'],
          ['⭐⭐⭐⭐ 4', '⭐⭐⭐⭐⭐ 5'],
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
      return `${idx + 1}. ${formatStarsVisual(r.rating)} (<b>${r.rating}/5</b>) • <code>${escapeHtml(dt)}</code>\n   💬 ${cText}`;
    });

    const sent = await ctx.reply(
      fitTelegramText(
        `💬 <b>آراء المستخدمين حول المنصة</b>\n⭐ <b>المتوسط:</b> <b>${stats.average} / 5</b> (${stats.total} تقييم)\n━━━━━━━━━━━━━━━━━━━━\n\n${lines.join('\n\n')}`,
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
      const starMatch = userText.match(/^(?:⭐){1,5}\s*([1-5])$/);
      if (!starMatch) {
        return replyTracked(
          ctx, userId,
          `⚠️ <b>يرجى اختيار عدد النجوم من الأزرار في الأسفل (1 إلى 5):</b>`,
          { parse_mode: 'HTML' },
          true
        );
      }

      const chosenRating = Number(starMatch[1]);
      state.step = 'rating_platform_comment';
      state.data = { rating: chosenRating };

      return replyTracked(
        ctx, userId,
        `✅ اخترت: <b>${formatStarsVisual(chosenRating)} (${chosenRating}/5)</b>\n\n` +
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
      await ctx.reply(
        `🎉 <b>شكراً لك! تم حفظ تقييمك للمنصة (${chosenRating}/5).</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      return showAboutPlatformScreen(ctx, userId);
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
