'use strict';
// =========================================================================
// ⭐ PLATFORM RATING MODULE — خاصية تقييم المنصة وإرسال التقييم وعرض الإحصائيات
// يحفظ الاسم في عمودين (first_name و last_name) عند التسجيل الأول ويعرضه مباشرة.
// يوجّه أصحاب التقييمات الأقل من 3 نجوم إلى قسم الردود والاستفسار لتسجيل الشكاوى.
// =========================================================================

const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬';
const NAME_CACHE_TTL = 60 * 60 * 1000;
const SUPPORT_BTN_TEXT = '📞 الدعم والإدارة';

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

  async function openSupportFromRating(ctx, userId) {
    const dashboardFn = getSupportDashboardFn();
    if (dashboardFn) {
      return dashboardFn(ctx, userId);
    }

    const inquiryFn = getClientInquiryFn();
    if (inquiryFn) {
      return inquiryFn(ctx, userId, 0, true, 'all');
    }

    return replyTracked(
      ctx,
      userId,
      `📞 <b>الردود والاستفسار</b>\n\nاضغط على زر <b>"${SUPPORT_BTN_TEXT}"</b> من القائمة لفتح مركز الدعم والردود.`,
      { parse_mode: 'HTML' },
      true
    );
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

  async function notifyAdminsOnPlatformReview(ctx, userId, rating, comment, nameParts = {}, isUpdate = false) {
    if (typeof getAdminIds !== 'function') return;
    try {
      const adminIds = await getAdminIds();
      if (!Array.isArray(adminIds) || adminIds.length === 0) return;

      const resolvedName = joinFirstAndLastName(nameParts.first_name, nameParts.last_name)
        || await fetchTelegramFallbackNameById(userId, ctx);
      const nowText = formatDateTime(new Date());
      const titleBadge = isUpdate ? '✏️ تحديث تقييم للمنصة' : '⭐ تقييم جديد للمنصة';
      const commentLine = comment
        ? `\n💬 ${escapeHtml(comment)}`
        : `\n<i>تقييم بالنجوم فقط</i>`;

      const adminMsg = fitTelegramText(
        `<b>${titleBadge}</b>\n` +
        `${LINE}\n` +
        `<blockquote>` +
        (resolvedName ? `👤 <b>${escapeHtml(resolvedName)}</b> (<code>${userId}</code>)\n` : `🆔 <code>${userId}</code>\n`) +
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

  async function submitPlatformReview(ctx, userId, chosenRating, rawComment = null, isUpdate = false) {
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

    await notifyAdminsOnPlatformReview(ctx, cleanUserId, cleanRating, cleanComment, nameParts, isUpdate);

    delete userState[cleanUserId];

    // توجيه صاحب التقييم الأقل من 3 نجوم إلى قسم الردود والاستفسار لتسجيل استفساره أو شكواه
    if (cleanRating < 3) {
      const sent = await ctx.reply(
        `📌 <b>تم حفظ تقييمك (<b>${formatStarsVisual(cleanRating)}</b>).</b>\n` +
        `${LINE}\n` +
        `<blockquote>إذا كان لديك استفسار أو شكوى أو واجهتك مشكلة، يُرجى التوجه إلى زر <b>"${SUPPORT_BTN_TEXT}"</b> لتسجيل استفسارك وشكواك ليتمكن فريق الإدارة من متابعتها.</blockquote>`,
        {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            [SUPPORT_BTN_TEXT],
            ['ℹ️ عن المنصة', '🏠 القائمة الرئيسية']
          ]).resize()
        }
      ).catch(() => null);

      if (sent?.message_id) {
        trackBotMessage(cleanUserId, ctx.chat.id, sent.message_id);
        await clearTrackedBotMessages(ctx, cleanUserId, [sent.message_id]);
      }
      return;
    }

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

    if (['⬅️ رجوع', '🏠 القائمة الرئيسية', '❌ إلغاء العملية والعودة'].includes(userText) || /^📞 الدعم والإدارة(?:\s*\(\d+\))?$/.test(userText)) {
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
