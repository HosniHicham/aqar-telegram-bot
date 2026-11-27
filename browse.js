'use strict';
// =========================================================================
// 🔍 SERVER BROWSE — منطق تصفح العقارات والمفضلة
// يستدعيه users.js ويزوّده بدوال العرض والمفضلة والأزرار.
// =========================================================================

const BTN_CONTACT_OWNER = '📞 اتصل بالمالك';
const BTN_FAVORITES_MENU = '⭐ مفضلاتي';

module.exports = function registerBrowse(bot, core, helpers = {}) {
  const {
    Markup, supabase, browsingSession, supportUserSession,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getSetting, chunkButtons, formatMoney, formatDateTime, escapeHtml, fitTelegramText,
    buildOrderedBrowsingMedia
  } = core;

  const {
    buildUserMainKeyboard,
    getUniqueStatesList
  } = helpers;

  // =========================================================================
  // ⭐ دوال المفضلة (Favorites Helpers)
  // =========================================================================
  async function isPropertyFavorited(userId, propertyId, propertySource = 'test_messages') {
    try {
      const { data, error } = await supabase
        .from('user_favorites')
        .select('id')
        .eq('user_id', Number(userId))
        .eq('property_id', Number(propertyId))
        .eq('property_source', String(propertySource || 'test_messages'))
        .limit(1);

      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    } catch (e) {
      return false;
    }
  }

  async function toggleFavoriteProperty(userId, propertyId, propertySource = 'test_messages') {
    const cleanUserId = Number(userId);
    const cleanPropId = Number(propertyId);
    const cleanSource = String(propertySource || 'test_messages');

    const exists = await isPropertyFavorited(cleanUserId, cleanPropId, cleanSource);

    if (exists) {
      const { error } = await supabase
        .from('user_favorites')
        .delete()
        .eq('user_id', cleanUserId)
        .eq('property_id', cleanPropId)
        .eq('property_source', cleanSource);
      if (error) throw error;
      return { favorited: false };
    }

    const { error } = await supabase
      .from('user_favorites')
      .insert([{
        user_id: cleanUserId,
        property_id: cleanPropId,
        property_source: cleanSource
      }]);
    if (error) throw error;
    return { favorited: true };
  }

  async function fetchUserFavoriteProperties(userId) {
    try {
      const { data: favRows, error } = await supabase
        .from('user_favorites')
        .select('id, property_id, property_source, created_at')
        .eq('user_id', Number(userId))
        .order('id', { ascending: false });

      if (error || !Array.isArray(favRows) || favRows.length === 0) return [];

      const propIds = [...new Set(favRows.map(f => Number(f.property_id)).filter(n => Number.isFinite(n) && n > 0))];
      if (propIds.length === 0) return [];

      const { data: props, error: propErr } = await supabase
        .from('test_messages')
        .select('*')
        .in('id', propIds);

      if (propErr || !Array.isArray(props)) return [];

      const byId = new Map(props.map(p => [Number(p.id), p]));
      const ordered = [];
      for (const fav of favRows) {
        const found = byId.get(Number(fav.property_id));
        if (found) {
          ordered.push({
            ...found,
            _fav_id: fav.id,
            _fav_source: fav.property_source || 'test_messages'
          });
        }
      }
      return ordered;
    } catch (e) {
      console.error('fetchUserFavoriteProperties error:', e.message);
      return [];
    }
  }

  function buildPropertyInlineKeyboard(item, canContactOwner, isFavorited) {
    const rows = [];
    const favLabel = isFavorited ? '💔 إزالة من المفضلة' : '⭐ إضافة للمفضلة';
    const favRow = [Markup.button.callback(favLabel, `toggle_fav_test_messages_${item.id}`)];

    if (canContactOwner) {
      favRow.push(Markup.button.callback('💬 مراسلة المالك', `msg_prop:${item.id}:${item.user_id}`));
    }
    rows.push(favRow);
    return Markup.inlineKeyboard(rows);
  }

  function formatPropertyCardCaption(item, pageIndex, totalCount, sessionState, safeMediaIndex, totalMedia, currentMedia, isFavorited) {
    const mediaTypeLabel = currentMedia ? (currentMedia.type === 'video' ? '🎥 فيديو' : '🖼 صورة') : '';
    const mediaLine = totalMedia > 0 ? `\n${mediaTypeLabel}: <b>${safeMediaIndex + 1} / ${totalMedia}</b>` : '';
    const publishedAtText = item.created_at ? formatDateTime(item.created_at) : 'غير مسجل';
    const scopeLabel = sessionState === 'FAVORITES'
      ? `⭐ المفضلة (${escapeHtml(item.state_name || '')})`
      : escapeHtml(item.state_name || '');
    const favStarBadge = isFavorited ? ' ⭐' : '';

    const rawCaption =
      `🏛 <b>الولاية:</b> ${scopeLabel} (${pageIndex + 1}/${totalCount})\n\n` +
      `🏠 <b>العقار:</b> ${escapeHtml(item.property_type || '')}${favStarBadge}\n` +
      `💰 <b>السعر:</b> ${formatMoney(item.price)}\n` +
      `📞 <b>هاتف المالك:</b> <code>${escapeHtml(item.phone || '')}</code>\n` +
      `🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(publishedAtText)}</code>${mediaLine}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(item.description || item.message || '')}`;

    return fitTelegramText(rawCaption, !!currentMedia);
  }

  function getBrowsingKeyboard(currentIndex, totalCount, mediaIdx = 0, totalMedia = 0, canContactOwner = false, isFavorited = false) {
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

    const actionRow = [isFavorited ? '💔 إزالة من المفضلة' : '⭐ إضافة للمفضلة'];
    if (canContactOwner) {
      actionRow.push(BTN_CONTACT_OWNER);
    }
    rows.push(actionRow);
    rows.push([BTN_FAVORITES_MENU, '📍 تغيير الولاية']);
    rows.push(['🏠 القائمة الرئيسية']);
    return Markup.keyboard(rows).resize();
  }

  async function showStatesMenu(ctx) {
    const userId = ctx.from.id;
    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = typeof buildUserMainKeyboard === 'function'
      ? await buildUserMainKeyboard(userId, unreadCount)
      : Markup.keyboard([['🔍 تصفح العقارات المتاحة', '🏠 القائمة الرئيسية']]).resize();

    try {
      const { data, error } = await supabase.from('test_messages').select('state_name');
      if (error) throw error;
      if (!data || data.length === 0) {
        return replyTracked(ctx, userId, '📭 عذراً، لا توجد أي عقارات مسجلة في المنصة حالياً.', mainKb, true);
      }

      const uniqueStates = [...new Set(data.map(item => item.state_name).filter(Boolean))];
      const stateButtons = uniqueStates.map(state => `📍 ${state}`);
      const chunkedStates = chunkButtons(stateButtons, 4);
      chunkedStates.push(['🌐 الكل', BTN_FAVORITES_MENU], ['🏠 القائمة الرئيسية']);

      const browseTitle = await getSetting('browse_title', '🔍 <b>اختر الولاية المطلوبة لعرض العقارات من الأزرار أسفل الشاشة:</b>');
      await replyTracked(ctx, userId, browseTitle, { parse_mode: 'HTML', ...Markup.keyboard(chunkedStates).resize() }, true);
    } catch (err) {
      console.error('showStatesMenu error:', err);
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', mainKb, true);
    }
  }

  async function renderPropertyPage(ctx, userId, pageIndex, mediaIndex = 0) {
    const session = browsingSession[userId];
    if (!session) return;
    session.selectingPage = false;

    const unreadCount = core.messenger?.getUnreadCount ? await core.messenger.getUnreadCount(userId) : 0;
    const mainKb = typeof buildUserMainKeyboard === 'function'
      ? await buildUserMainKeyboard(userId, unreadCount)
      : Markup.keyboard([['🔍 تصفح العقارات المتاحة', '🏠 القائمة الرئيسية']]).resize();

    try {
      let data = [];
      if (session.state === 'FAVORITES') {
        data = await fetchUserFavoriteProperties(userId);
        if (!data || data.length === 0) {
          delete browsingSession[userId];
          return replyTracked(
            ctx,
            userId,
            `⭐ <b>قائمة مفضلاتك فارغة حالياً.</b>\nاضغط على زر <b>"⭐ إضافة للمفضلة"</b> أثناء تصفح أي عقار لحفظه هنا.`,
            { parse_mode: 'HTML', ...mainKb },
            true
          );
        }
      } else {
        let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
        if (session.state !== 'ALL') query = query.eq('state_name', session.state);

        const res = await query;
        if (res.error) throw res.error;
        data = res.data || [];
        if (data.length === 0) {
          return replyTracked(ctx, userId, '📭 عذراً، لا توجد عقارات مسجلة.', mainKb, true);
        }
      }

      if (pageIndex < 0) pageIndex = 0;
      if (pageIndex >= data.length) pageIndex = data.length - 1;
      session.page = pageIndex;
      session.totalCount = data.length;

      const item = data[pageIndex];
      const canContactOwner = Boolean(item.user_id && Number(item.user_id) !== Number(userId));
      const isFavorited = await isPropertyFavorited(userId, item.id, 'test_messages');
      session.currentProperty = item;

      const orderedMedia = buildOrderedBrowsingMedia(item);
      const totalMedia = orderedMedia.length;

      let safeMediaIndex = Number(mediaIndex) || 0;
      if (safeMediaIndex < 0) safeMediaIndex = 0;
      if (totalMedia > 0 && safeMediaIndex >= totalMedia) safeMediaIndex = totalMedia - 1;
      session.photoIndex = safeMediaIndex;
      session.totalMedia = totalMedia;

      const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIndex] : null;
      const caption = formatPropertyCardCaption(
        item, pageIndex, data.length, session.state, safeMediaIndex, totalMedia, currentMedia, isFavorited
      );
      const replyKb = getBrowsingKeyboard(pageIndex, data.length, safeMediaIndex, totalMedia, canContactOwner, isFavorited);
      const msgInlineKb = buildPropertyInlineKeyboard(item, canContactOwner, isFavorited);

      const cardExtra = {
        caption,
        parse_mode: 'HTML',
        ...msgInlineKb,
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
      await replyTracked(ctx, userId, '⚠️ حدث خطأ، يرجى المحاولة مرة أخرى.', mainKb, true);
    }
  }

  async function refreshCurrentCardFavoriteState(ctx, userId, propId, favorited) {
    const session = browsingSession[userId];
    const prop = session?.currentProperty;
    const canContactOwner = Boolean(prop && Number(prop.id) === Number(propId) && prop.user_id && Number(prop.user_id) !== Number(userId));
    const updatedInlineKb = buildPropertyInlineKeyboard({ id: propId, user_id: prop?.user_id }, canContactOwner, favorited);

    await ctx.editMessageReplyMarkup(updatedInlineKb.reply_markup).catch(() => {});

    if (prop && Number(prop.id) === Number(propId)) {
      const orderedMedia = buildOrderedBrowsingMedia(prop);
      const totalMedia = orderedMedia.length;
      const safeMediaIndex = session.photoIndex || 0;
      const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIndex] : null;
      const pageIndex = session.page || 0;
      const totalCount = session.totalCount || 1;

      const updatedCaption = formatPropertyCardCaption(
        prop, pageIndex, totalCount, session.state || 'ALL', safeMediaIndex, totalMedia, currentMedia, favorited
      );

      if (currentMedia) {
        await ctx.editMessageCaption(updatedCaption, {
          parse_mode: 'HTML',
          ...updatedInlineKb
        }).catch(() => {});
      } else {
        await ctx.editMessageText(updatedCaption, {
          parse_mode: 'HTML',
          ...updatedInlineKb
        }).catch(() => {});
      }
    }

    if (session) {
      const totalCount = session.totalCount || 1;
      const replyKb = getBrowsingKeyboard(
        session.page || 0,
        totalCount,
        session.photoIndex || 0,
        session.totalMedia || 0,
        canContactOwner,
        favorited
      );
      const syncMsg = await ctx.reply(
        favorited ? '⭐ العقار محفوظ في مفضلتك' : '💔 تمت إزالة العقار من مفضلتك',
        { ...replyKb }
      ).catch(() => null);
      if (syncMsg?.message_id) {
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, syncMsg.message_id).catch(() => {});
        }, 1800);
      }
    }
  }

  bot.hears('🔍 تصفح العقارات المتاحة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    delete browsingSession[ctx.from.id];
    delete supportUserSession[ctx.from.id];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[ctx.from.id];
    await showStatesMenu(ctx);
  });

  bot.hears(['📍 تغيير الولاية', 'تغيير الولاية'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    delete browsingSession[ctx.from.id];
    await showStatesMenu(ctx);
  });

  bot.hears(/^📍 (.+)/, async (ctx, next) => {
    const userId = ctx.from.id;
    const selectedState = ctx.match[1].trim();
    if (core.userState?.[userId]?.step === 'waiting_for_state') return next();

    await safeDeleteUserMessage(ctx);
    const stateList = typeof getUniqueStatesList === 'function' ? await getUniqueStatesList() : [];
    if (stateList.includes(selectedState)) {
      delete supportUserSession[userId];
      if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
      browsingSession[userId] = { state: selectedState, page: 0, photoIndex: 0 };
      return renderPropertyPage(ctx, userId, 0, 0);
    }
    return next();
  });

  bot.hears('🌐 الكل', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    delete supportUserSession[userId];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
    browsingSession[userId] = { state: 'ALL', page: 0, photoIndex: 0 };
    return renderPropertyPage(ctx, userId, 0, 0);
  });

  bot.hears(/^⭐ مفضلاتي(?:\s*\(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    delete supportUserSession[userId];
    if (core.messenger?.messengerSession) delete core.messenger.messengerSession[userId];
    browsingSession[userId] = { state: 'FAVORITES', page: 0, photoIndex: 0 };
    return renderPropertyPage(ctx, userId, 0, 0);
  });

  bot.action(/^toggle_fav_([a-zA-Z0-9_]+)_(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCbQuery().catch(() => {});

    const propSource = ctx.match[1];
    const propId = Number(ctx.match[2]);

    try {
      const { favorited } = await toggleFavoriteProperty(userId, propId, propSource);

      await ctx.answerCbQuery(
        favorited ? '⭐ تمت الإضافة إلى المفضلة' : '💔 تمت الإزالة من المفضلة',
        { show_alert: false }
      ).catch(() => {});

      await refreshCurrentCardFavoriteState(ctx, userId, propId, favorited);
    } catch (e) {
      console.error('toggle_fav error:', e.message);
      await ctx.answerCbQuery('⚠️ حدث خطأ أثناء تحديث المفضلة').catch(() => {});
    }
  });

  bot.hears(/^(?:⭐ إضافة للمفضلة|💔 إزالة من المفضلة)$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    let prop = session?.currentProperty || null;

    if (!prop && session) {
      if (session.state === 'FAVORITES') {
        const favList = await fetchUserFavoriteProperties(userId);
        prop = favList[Math.min(Math.max(0, Number(session.page) || 0), Math.max(0, favList.length - 1))] || null;
      } else {
        let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
        if (session.state !== 'ALL') query = query.eq('state_name', session.state);
        const { data } = await query;
        if (Array.isArray(data) && data.length > 0) {
          prop = data[Math.min(Math.max(0, Number(session.page) || 0), data.length - 1)];
        }
      }
    }

    if (!prop?.id) return;

    try {
      const { favorited } = await toggleFavoriteProperty(userId, prop.id, 'test_messages');
      const canContactOwner = Boolean(prop.user_id && Number(prop.user_id) !== Number(userId));
      const totalCount = session?.totalCount || 1;
      const replyKb = getBrowsingKeyboard(
        session?.page || 0,
        totalCount,
        session?.photoIndex || 0,
        session?.totalMedia || 0,
        canContactOwner,
        favorited
      );

      const statusText = favorited
        ? `⭐ <b>العقار <code>#${prop.id}</code> مضاف إلى مفضلتك.</b>`
        : `💔 <b>تم إلغاء العقار <code>#${prop.id}</code> من مفضلتك.</b>`;

      const tempMsg = await ctx.reply(statusText, { parse_mode: 'HTML', ...replyKb }).catch(() => null);
      if (tempMsg?.message_id) {
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, tempMsg.message_id).catch(() => {});
        }, 2000);
      }
    } catch (e) {
      console.error('fav button error:', e.message);
    }
  });

  bot.hears(BTN_CONTACT_OWNER, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    let prop = session?.currentProperty || null;

    if (!prop && session) {
      try {
        let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
        if (session.state !== 'ALL' && session.state !== 'FAVORITES') query = query.eq('state_name', session.state);
        const { data } = await query;
        if (Array.isArray(data) && data.length > 0) {
          const safeIdx = Math.min(Math.max(0, Number(session.page) || 0), data.length - 1);
          prop = data[safeIdx];
        }
      } catch (_) {}
    }

    if (!prop?.id || !prop?.user_id) {
      return replyTracked(
        ctx,
        userId,
        '⚠️ <b>تعذر تحديد بيانات المالك لهذا العقار حالياً.</b>',
        { parse_mode: 'HTML' },
        true
      );
    }

    if (Number(prop.user_id) === Number(userId)) {
      return replyTracked(
        ctx,
        userId,
        'ℹ️ <b>هذا العقار منشور بحسابك.</b>',
        { parse_mode: 'HTML' },
        true
      );
    }

    if (typeof core.messenger?.startPropertyMessage === 'function') {
      await core.messenger.startPropertyMessage(ctx, { id: prop.id, user_id: prop.user_id });
    }
  });

  bot.hears('الصورة التالية 🖼', async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') return next();
    await safeDeleteUserMessage(ctx);
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, (session.photoIndex || 0) + 1);
  });

  bot.hears('🖼 الصورة السابقة', async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') return next();
    await safeDeleteUserMessage(ctx);
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, Math.max((session.photoIndex || 0) - 1, 0));
  });

  bot.hears(/^📸 (صورة|عنصر) \d+ \/ \d+$/, async (ctx, next) => {
    const userId = ctx.from.id;
    const own = supportUserSession[userId];
    if (own && own.mode === 'browsing_own_ads') return next();
    await safeDeleteUserMessage(ctx);
    const session = browsingSession[userId];
    if (!session) return;
    return renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
  });

  bot.hears(/^📄 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (!session) return;

    let totalCount = 0;
    if (session.state === 'FAVORITES') {
      const favs = await fetchUserFavoriteProperties(userId);
      totalCount = favs.length;
    } else {
      let query = supabase.from('test_messages').select('*').order('id', { ascending: false });
      if (session.state !== 'ALL') query = query.eq('state_name', session.state);
      const { data } = await query;
      totalCount = data ? data.length : 0;
    }
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

    await replyTracked(ctx, userId, `🔢 <b>اختر رقم العقار للانتقال إليه مباشرة (من 1 إلى ${totalCount}):</b>`, {
      parse_mode: 'HTML', ...Markup.keyboard(numberButtons).resize()
    }, true);
  });

  bot.hears(/^\d+$/, async (ctx, next) => {
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session && session.selectingPage) {
      await safeDeleteUserMessage(ctx);
      session.selectingPage = false;
      const n = parseInt(ctx.message.text.trim(), 10);
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
      return renderPropertyPage(ctx, userId, session.page, session.photoIndex || 0);
    }
  });

  bot.hears('⬅️ السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session && session.page > 0) return renderPropertyPage(ctx, userId, session.page - 1, 0);
  });

  bot.hears('التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const userId = ctx.from.id;
    const session = browsingSession[userId];
    if (session) return renderPropertyPage(ctx, userId, session.page + 1, 0);
  });

  return {
    showStatesMenu,
    renderPropertyPage,
    isPropertyFavorited,
    toggleFavoriteProperty,
    fetchUserFavoriteProperties
  };
};
