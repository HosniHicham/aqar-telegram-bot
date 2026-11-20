'use strict';
// =========================================================================
// 🛡️ SERVER ADMIN — كل ما يخص الأدمن
// يستدعيه server.js (الأب).
// - أزرار التنقل والتحكم في لوحة التحكم السفلية (أسفل خانة الإدخال)
// - أزرار القبول / الرفض / الحذف / المراسلة أسفل بطاقة الإعلان نفسه مع رقم الإعلان
// - تنظيف الرسائل والأوامر غير المهمة
// =========================================================================

module.exports = function registerAdmin(bot, core) {
  const {
    Markup, supabase, userState,
    trackBotMessage, clearTrackedBotMessages, replyTracked, safeDeleteUserMessage,
    getAdminIds, sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml,
    normalizeMediaRef, parseImagesFromImageUrl, parseMediaListFromField,
    getWebsiteButton
  } = core;

  // حالة تصفح الإعلانات للأدمن: adminId -> { filter, index, items }
  const adminBrowseState = {};

  // ------------------------- لوحات المفاتيح السفلية (التحكم والتنقل) -------------------------
  function getAdminMenuKeyboard() {
    const rows = [
      ['⏳ المعلقة', '✅ المنشورة', '❌ المرفوضة'],
      ['📊 الإحصائيات', '👁 معاينة المنصة كمستخدم']
    ];
    const webBtn = getWebsiteButton();
    if (webBtn) rows.push([webBtn]);
    return Markup.keyboard(rows).resize();
  }

  function getAdminBrowsingKeyboard(idx, total, filterType) {
    const navRow = [];
    if (idx > 0) navRow.push('⬅️ السابق');
    navRow.push(`📄 ${idx + 1} / ${total}`);
    if (idx < total - 1) navRow.push('التالي ➡️');

    const rows = [];
    if (navRow.length > 0) rows.push(navRow);
    rows.push(['🎛 لوحة الإدارة', '👁 معاينة المنصة كمستخدم']);

    const webBtn = getWebsiteButton();
    if (webBtn && filterType) rows.push([webBtn]);

    return Markup.keyboard(rows).resize();
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
    const [pending, published, rejected, usersCount] = await Promise.all([
      countRows('pending_properties', ['status', 'pending']),
      countRows('test_messages'),
      countRows('pending_properties', ['status', 'rejected']),
      countRows('users')
    ]);
    return { pending, published, rejected, usersCount };
  }

  async function openAdminHome(ctx, showStatsNotice = false) {
    const adminId = ctx.from.id;
    delete userState[adminId];
    delete adminBrowseState[adminId];
    core.resetSessions(adminId);

    const { pending, published, rejected, usersCount } = await getFullAdminStats();
    const name = escapeHtml(ctx.from.first_name || 'الأدمن');

    const text =
      `🛡 <b>لوحة تحكم الإدارة</b>${showStatsNotice ? ' — <b>تقرير الإحصائيات</b>' : ''}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 أهلاً بك يا <b>${name}</b>\n` +
      `⏳ <b>معلقة:</b> <b>${pending}</b> | ✅ <b>منشورة:</b> <b>${published}</b> | ❌ <b>مرفوضة:</b> <b>${rejected}</b>\n` +
      `👥 <b>المستخدمون:</b> <b>${usersCount}</b>\n\n` +
      `👇 اختر من أزرار التحكم أدناه:`;

    await replyTracked(ctx, adminId, text, { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
  }

  // ------------------------- جلب الإعلانات حسب الفئة -------------------------
  async function fetchAdminAdsByFilter(filterType) {
    if (filterType === 'published') {
      const { data, error } = await supabase
        .from('test_messages')
        .select('*')
        .order('id', { ascending: false })
        .limit(100);
      if (error || !data) return [];
      return data;
    }

    const statusVal = filterType === 'rejected' ? 'rejected' : 'pending';
    const { data, error } = await supabase
      .from('pending_properties')
      .select('*')
      .eq('status', statusVal)
      .order('id', { ascending: filterType === 'pending' })
      .limit(100);

    if (error || !data) return [];
    return filterType === 'rejected' ? data.reverse() : data;
  }

  // ------------------------- أزرار الإجراء أسفل بطاقة الإعلان نفسه -------------------------
  function buildAdInlineButtons(item, filterType) {
    const rows = [];
    const adId = item.id;
    const targetUser = item.user_id || 0;
    const replyCallbackData = `support_reply_${targetUser}_${adId}`;

    if (filterType === 'pending') {
      rows.push([
        Markup.button.callback(`❌ رفض (#${adId})`, `reject_${adId}`),
        Markup.button.callback(`✅ قبول ونشر (#${adId})`, `approve_${adId}`)
      ]);
      if (targetUser) {
        rows.push([Markup.button.callback(`✉️ مراسلة بخصوص إعلان (#${adId})`, replyCallbackData)]);
      }
    } else if (filterType === 'rejected') {
      rows.push([
        Markup.button.callback(`♻️ إعادة للمعلقة (#${adId})`, `requeue_${adId}`),
        Markup.button.callback(`✅ قبول ونشر (#${adId})`, `approve_${adId}`)
      ]);
      if (targetUser) {
        rows.push([Markup.button.callback(`✉️ مراسلة بخصوص إعلان (#${adId})`, replyCallbackData)]);
      }
    } else if (filterType === 'published') {
      const row = [Markup.button.callback(`🗑 حذف (#${adId})`, `del_pub_${adId}`)];
      if (targetUser) {
        row.push(Markup.button.callback(`✉️ مراسلة (#${adId})`, replyCallbackData));
      }
      rows.push(row);
    }

    return Markup.inlineKeyboard(rows);
  }

  function formatAdminAdCaption(item, idx, total, filterType, stats) {
    const titleMap = {
      pending: '⏳ <b>إعلان معلق</b>',
      published: '✅ <b>إعلان منشور</b>',
      rejected: '❌ <b>إعلان مرفوض</b>'
    };
    const isFree = item.receipt_url === 'FREE_NO_RECEIPT';
    const typeBadge = filterType === 'published'
      ? '🌐 منشور'
      : (isFree ? '🆓 مجاني' : '💳 مدفوع');

    const photosCount = parseImagesFromImageUrl(item.image_url).length;
    const videosCount = parseMediaListFromField(item.video_url).length;
    const desc = String(item.description || item.message || '');

    return (
      `${titleMap[filterType] || '📌 <b>إعلان</b>'} — <code>#${item.id}</code> (${idx + 1}/${total})\n` +
      `📊 <b>الإحصائيات:</b> معلق: <b>${stats.pending}</b> | منشور: <b>${stats.published}</b> | مرفوض: <b>${stats.rejected}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷 <b>النوع:</b> <b>${typeBadge}</b>\n` +
      `🕒 <b>التاريخ:</b> <code>${escapeHtml(formatDateTime(item.created_at))}</code>\n` +
      (item.user_id ? `👤 <b>العميل:</b> <code>${item.user_id}</code>\n` : '') +
      `🏠 <b>العقار:</b> ${escapeHtml(item.property_type || '')} — 📍 <b>${escapeHtml(item.state_name || '')}</b>\n` +
      `💰 <b>السعر:</b> ${formatMoney(item.price)} — 📞 <code>${escapeHtml(item.phone || '')}</code>\n` +
      `🖼 <b>صور:</b> ${photosCount} | 🎥 <b>فيديو:</b> ${videosCount}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(desc.length > 320 ? desc.slice(0, 320) + '…' : desc)}`
    );
  }

  async function renderAdminAdAt(ctx, adminId, filterType, index = 0, refreshList = false) {
    const stats = await getFullAdminStats();
    let st = adminBrowseState[adminId];

    if (!st || st.filter !== filterType || refreshList) {
      const items = await fetchAdminAdsByFilter(filterType);
      st = { filter: filterType, items, index: 0 };
      adminBrowseState[adminId] = st;
    }

    if (!st.items || st.items.length === 0) {
      delete adminBrowseState[adminId];
      const emptyLabels = {
        pending: 'لا توجد إعلانات معلقة حالياً',
        published: 'لا توجد إعلانات منشورة حالياً',
        rejected: 'لا توجد إعلانات مرفوضة حالياً'
      };
      return replyTracked(
        ctx, adminId,
        `📭 <b>${emptyLabels[filterType] || 'لا توجد عناصر'}.</b>\n` +
        `📊 <b>الإحصائيات:</b> معلق: <b>${stats.pending}</b> | منشور: <b>${stats.published}</b> | مرفوض: <b>${stats.rejected}</b>`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() },
        true
      );
    }

    let safeIdx = Number(index) || 0;
    if (safeIdx < 0) safeIdx = 0;
    if (safeIdx >= st.items.length) safeIdx = st.items.length - 1;
    st.index = safeIdx;

    const item = st.items[safeIdx];
    const receiptRef = normalizeMediaRef(item.receipt_url);
    const firstPhoto = parseImagesFromImageUrl(item.image_url)[0];
    const firstVideo = parseMediaListFromField(item.video_url)[0];

    const caption = formatAdminAdCaption(item, safeIdx, st.items.length, filterType, stats);
    const inlineKb = buildAdInlineButtons(item, filterType);
    const controlKb = getAdminBrowsingKeyboard(safeIdx, st.items.length, filterType);

    let sentCard = null;
    const mediaPhoto = receiptRef || firstPhoto;

    try {
      if (mediaPhoto) {
        sentCard = await ctx.replyWithPhoto(mediaPhoto, { caption, parse_mode: 'HTML', ...inlineKb });
      } else if (firstVideo) {
        sentCard = await ctx.replyWithVideo(firstVideo, { caption, parse_mode: 'HTML', ...inlineKb });
      } else {
        sentCard = await ctx.reply(caption, { parse_mode: 'HTML', ...inlineKb });
      }
    } catch (e) {
      sentCard = await ctx.reply(caption, { parse_mode: 'HTML', ...inlineKb }).catch(() => null);
    }

    // لوحة التحكم السفلية (التنقل + التحكم + إخفاء لوحة الأحرف الأصلية للهاتف)
    const ctrlMsg = await ctx.reply(
      `🎛 <b>أزرار التنقل والتحكم (${safeIdx + 1} / ${st.items.length})</b>`,
      { parse_mode: 'HTML', ...controlKb }
    ).catch(() => null);

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

  // ------------------------- أوامر وأزرار التحكم السفلية -------------------------
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

  bot.hears(['⏳ المعلقة', '📥 الطلبات المعلقة'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'pending', 0, true);
  });

  bot.hears('✅ المنشورة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'published', 0, true);
  });

  bot.hears('❌ المرفوضة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await renderAdminAdAt(ctx, ctx.from.id, 'rejected', 0, true);
  });

  bot.hears('⬅️ السابق', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, Math.max((st.index || 0) - 1, 0), false);
  });

  bot.hears('التالي ➡️', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, (st.index || 0) + 1, false);
  });

  bot.hears(/^📄 \d+ \/ \d+$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    const st = adminBrowseState[adminId];
    if (!st) return openAdminHome(ctx);
    await renderAdminAdAt(ctx, adminId, st.filter, st.index || 0, false);
  });

  // ------------------------- المراسلة المرتبطة بالإعلان والعميل -------------------------
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
      `✉️ <b>وضع المراسلة مع العميل</b> <code>${targetUserId}</code>${adRefText}\n\nاكتب رسالتك الآن أو أرسل صورة/فيديو (أو اضغط "🎛 لوحة الإدارة" للإلغاء):`,
      { parse_mode: 'HTML', ...Markup.keyboard([['🎛 لوحة الإدارة']]).resize() },
      true
    );
  });

  async function deliverAdminReplyToUser(ctx, adminId, targetUserId, payloadType, content, adId = null) {
    const adLine = adId ? `📌 <b>بخصوص الإعلان رقم:</b> <code>#${adId}</code>\n` : '';
    const header = `📩 <b>رسالة من الإدارة:</b>\n${adLine}━━━━━━━━━━━━━━━━━━━━\n`;

    try {
      if (payloadType === 'photo') {
        const cap = header + (content.caption ? escapeHtml(content.caption) : '🖼 <b>مرفق صورة من الإدارة</b>');
        await ctx.telegram.sendPhoto(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else if (payloadType === 'video') {
        const cap = header + (content.caption ? escapeHtml(content.caption) : '🎥 <b>مرفق فيديو من الإدارة</b>');
        await ctx.telegram.sendVideo(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
      } else {
        await ctx.telegram.sendMessage(targetUserId, header + escapeHtml(content.text), { parse_mode: 'HTML' });
      }
    } catch (e) {
      delete userState[adminId];
      return replyTracked(ctx, adminId,
        `⚠️ تعذر إرسال الرسالة للعميل <code>${targetUserId}</code> (ربما حظر البوت).`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
    }

    delete userState[adminId];
    const kb = core.previewMode[adminId] ? core.getMainMenuKeyboard(adminId) : getAdminMenuKeyboard();
    const doneAdText = adId ? ` (بخصوص الإعلان <code>#${adId}</code>)` : '';
    await replyTracked(ctx, adminId,
      `✅ <b>تم إرسال رسالتك بنجاح إلى العميل</b> <code>${targetUserId}</code>${doneAdText}.`,
      { parse_mode: 'HTML', ...kb }, true);
  }

  bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    const text = ctx.message.text ? ctx.message.text.trim() : '';

    // تنظيف أي رسالة أو أمر يرسله الأدمن خارج السياق
    await safeDeleteUserMessage(ctx);

    if (text.startsWith('/') && text !== '/start') {
      return openAdminHome(ctx);
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
    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      return deliverAdminReplyToUser(ctx, adminId, state.data.targetUserId, 'video', {
        fileId: ctx.message.video.file_id, caption: ctx.message.caption || ''
      }, state.data?.adId || null);
    }
    await safeDeleteUserMessage(ctx);
    return next();
  });

  // ------------------------- قبول / رفض / إعادة / حذف الإعلانات -------------------------
  async function editCard(ctx, text, replyMarkup = undefined) {
    const extra = replyMarkup ? { parse_mode: 'HTML', ...replyMarkup } : { parse_mode: 'HTML' };
    try {
      await ctx.editMessageCaption(text, extra);
    } catch (e) {
      await ctx.editMessageText(text, extra).catch(() => {});
    }
  }

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
        await ctx.answerCbQuery('🗑 تم حذف الإعلان المنشور');
        await editCard(ctx, `🗑 <b>تم حذف الإعلان المنشور (#${requestId}) بنجاح.</b>`);
        return;
      }

      const { data: pendingItem, error: fetchError } = await supabase
        .from('pending_properties').select('*').eq('id', requestId).single();

      if (fetchError || !pendingItem) {
        await ctx.answerCbQuery('⚠️ الطلب غير موجود أو تم التعامل معه', { show_alert: true });
        return editCard(ctx, `⚠️ <b>الطلب (#${requestId}) غير موجود أو تم التعامل معه مسبقاً.</b>`);
      }

      const targetUserId = pendingItem.user_id;
      const isFreeAd = pendingItem.receipt_url === 'FREE_NO_RECEIPT';

      if (action === 'requeue') {
        await supabase.from('pending_properties').update({ status: 'pending' }).eq('id', requestId);
        await ctx.answerCbQuery('♻️ تمت إعادته للمعلقة');
        await editCard(ctx, `♻️ <b>تمت إعادة الطلب (#${requestId}) إلى قائمة المعلقة.</b>`);
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
          `🎉 <b>تم قبول إعلانك رقم (#${requestId}) ونشره بنجاح في المنصة!</b>\n🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await editCard(
          ctx,
          `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n🕒 وقت النشر: <code>${escapeHtml(formatDateTime(nowIso))}</code>\n📌 الحالة: <b>مقبول ومنشور</b>`
        );
      } else {
        await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);
        await ctx.answerCbQuery('❌ تم الرفض');

        const rejectUserMsg = isFreeAd
          ? `❌ <b>عذراً، لم تتم الموافقة على نشر إعلانك المجاني رقم (#${requestId}).</b>`
          : `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`;

        await ctx.telegram.sendMessage(targetUserId, rejectUserMsg, { parse_mode: 'HTML' }).catch(() => {});

        await editCard(
          ctx,
          `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n📌 الحالة: <b>مرفوض</b>`
        );
      }
    } catch (err) {
      console.error(`Admin action error #${requestId}:`, err);
      await ctx.answerCbQuery('⚠️ حدث خطأ', { show_alert: true }).catch(() => {});
      await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`).catch(() => {});
    }
  };

  bot.action(/^approve_(\d+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
  bot.action(/^reject_(\d+)$/, (ctx) => handleAdminAction(ctx, 'reject'));
  bot.action(/^requeue_(\d+)$/, (ctx) => handleAdminAction(ctx, 'requeue'));
  bot.action(/^del_pub_(\d+)$/, (ctx) => handleAdminAction(ctx, 'delete_published'));

  // واجهة عامة يستدعيها الأب
  return { openAdminHome };
};
