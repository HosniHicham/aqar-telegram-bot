'use strict';
// =========================================================================
// 🛡️ SERVER ADMIN — كل ما يخص الأدمن
// يستدعيه server.js (الأب). عدّل هنا فقط عند تطوير لوحة الأدمن.
// =========================================================================

module.exports = function registerAdmin(bot, core) {
  const {
    Markup, supabase, userState,
    replyTracked, safeDeleteUserMessage,
    getAdminIds, getUserRecord,
    sanitizeNumericPrice, formatMoney, formatDateTime, escapeHtml,
    normalizeMediaRef, parseImagesFromImageUrl, parseMediaListFromField,
    getWebsiteButton
  } = core;

  // ------------------------- لوحة مفاتيح الأدمن -------------------------
  function getAdminMenuKeyboard() {
    return Markup.keyboard([
      ['📥 الطلبات المعلقة', '📊 إحصائيات المنصة'],
      ['👁 معاينة المنصة كمستخدم'],
      [getWebsiteButton()]
    ]).resize();
  }

  async function countRows(table, filter) {
    try {
      let q = supabase.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = q.eq(filter[0], filter[1]);
      const { count } = await q;
      return count ?? 0;
    } catch (e) {
      return 0;
    }
  }

  async function openAdminHome(ctx) {
    const adminId = ctx.from.id;
    delete userState[adminId];
    core.resetSessions(adminId);

    const [pending, usersCount, published] = await Promise.all([
      countRows('pending_properties', ['status', 'pending']),
      countRows('users'),
      countRows('test_messages')
    ]);

    const name = escapeHtml(ctx.from.first_name || 'الأدمن');
    const text =
      `🛡 <b>لوحة الإدارة</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 أهلاً بك يا <b>${name}</b>\n` +
      `📥 <b>طلبات معلقة:</b> ${pending}\n` +
      `👥 <b>المستخدمون:</b> ${usersCount}\n` +
      `🏠 <b>إعلانات منشورة:</b> ${published}\n\n` +
      `👇 اختر من الأزرار أدناه:`;

    await replyTracked(ctx, adminId, text, { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
  }

  // ------------------------- الأوامر -------------------------
  bot.start(async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openAdminHome(ctx);
  });

  bot.hears(['🏠 القائمة الرئيسية', '❌ إلغاء العملية والعودة'], async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;
    delete userState[adminId];
    // لو كان في وضع المعاينة وضغط الرئيسية أثناء الرد => نرجعه لصفحة المستخدم
    if (core.previewMode[adminId]) return core.modules.user.openUserHome(ctx);
    return openAdminHome(ctx);
  });

  bot.hears('👁 معاينة المنصة كمستخدم', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await core.enterPreview(ctx);
  });

  bot.hears('📊 إحصائيات المنصة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await openAdminHome(ctx);
  });

  // ------------------------- الطلبات المعلقة -------------------------
  bot.hears('📥 الطلبات المعلقة', async (ctx) => {
    await safeDeleteUserMessage(ctx);
    const adminId = ctx.from.id;

    const { data, error } = await supabase
      .from('pending_properties')
      .select('*')
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(10);

    if (error || !data || data.length === 0) {
      return replyTracked(ctx, adminId, '✅ <b>لا توجد طلبات معلقة حالياً.</b>',
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
    }

    await replyTracked(ctx, adminId, `📥 <b>أقدم ${data.length} طلبات معلقة:</b>`,
      { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);

    for (const item of data) {
      const isFree = item.receipt_url === 'FREE_NO_RECEIPT';
      const receiptRef = normalizeMediaRef(item.receipt_url);
      const firstPhoto = parseImagesFromImageUrl(item.image_url)[0];
      const videosCount = parseMediaListFromField(item.video_url).length;
      const photosCount = parseImagesFromImageUrl(item.image_url).length;
      const desc = String(item.description || '');

      const caption =
        `📥 <b>طلب #${item.id}</b> — ${isFree ? '🆓 مجاني' : '💳 مدفوع'}\n` +
        `🕒 <code>${escapeHtml(formatDateTime(item.created_at))}</code>\n` +
        `👤 <code>${item.user_id}</code>\n` +
        `🏠 ${escapeHtml(item.property_type || '')} — 📍 ${escapeHtml(item.state_name || '')}\n` +
        `💰 ${formatMoney(item.price)} — 📞 <code>${escapeHtml(item.phone || '')}</code>\n` +
        `🖼 ${photosCount} | 🎥 ${videosCount}\n` +
        `📝 ${escapeHtml(desc.length > 300 ? desc.slice(0, 300) + '…' : desc)}`;

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback(`❌ رفض (#${item.id})`, `reject_${item.id}`),
          Markup.button.callback(`✅ قبول ونشر (#${item.id})`, `approve_${item.id}`)
        ],
        [Markup.button.callback(`✉️ رد على العميل (${item.user_id})`, `support_reply_${item.user_id}`)]
      ]);

      const photoSource = receiptRef || firstPhoto;
      try {
        if (photoSource) {
          await ctx.replyWithPhoto(photoSource, { caption, parse_mode: 'HTML', ...buttons });
        } else {
          await ctx.reply(caption, { parse_mode: 'HTML', ...buttons });
        }
      } catch (e) {
        await ctx.reply(caption, { parse_mode: 'HTML', ...buttons }).catch(() => {});
      }
    }
  });

  // ------------------------- الرد على العميل -------------------------
  bot.action(/^support_reply_(\d+)$/, async (ctx) => {
    const adminId = ctx.from.id;
    const targetUserId = Number(ctx.match[1]);

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }
    await ctx.answerCbQuery();

    userState[adminId] = {
      step: 'replying_to_support_user',
      data: { targetUserId },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    await replyTracked(
      ctx, adminId,
      `✉️ <b>وضع الرد على العميل</b> <code>${targetUserId}</code>\n\nاكتب ردك الآن أو أرسل صورة/فيديو (أو اضغط "🏠 القائمة الرئيسية" للإلغاء):`,
      { parse_mode: 'HTML', ...Markup.keyboard([['🏠 القائمة الرئيسية']]).resize() },
      true
    );
  });

  async function deliverAdminReplyToUser(ctx, adminId, targetUserId, payloadType, content) {
    const header = `📩 <b>رد الإدارة:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
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
        `⚠️ تعذر إرسال الرد للعميل <code>${targetUserId}</code> (ربما حظر البوت).`,
        { parse_mode: 'HTML', ...getAdminMenuKeyboard() }, true);
    }

    delete userState[adminId];
    const kb = core.previewMode[adminId] ? core.getMainMenuKeyboard(adminId) : getAdminMenuKeyboard();
    await replyTracked(ctx, adminId,
      `✅ <b>تم إرسال ردك بنجاح إلى العميل</b> <code>${targetUserId}</code>.`,
      { parse_mode: 'HTML', ...kb }, true);
  }

  bot.on('text', async (ctx, next) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      const targetUserId = state.data?.targetUserId;
      if (!targetUserId) { delete userState[adminId]; return; }
      return deliverAdminReplyToUser(ctx, adminId, targetUserId, 'text', { text });
    }
    return next();
  });

  bot.on('photo', async (ctx, next) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      return deliverAdminReplyToUser(ctx, adminId, state.data.targetUserId, 'photo', {
        fileId: photo.file_id, caption: ctx.message.caption || ''
      });
    }
    return next();
  });

  bot.on('video', async (ctx, next) => {
    const adminId = ctx.from.id;
    const state = userState[adminId];
    if (state && state.step === 'replying_to_support_user') {
      await safeDeleteUserMessage(ctx);
      return deliverAdminReplyToUser(ctx, adminId, state.data.targetUserId, 'video', {
        fileId: ctx.message.video.file_id, caption: ctx.message.caption || ''
      });
    }
    return next();
  });

  // ------------------------- قبول / رفض الإعلانات -------------------------
  async function editCard(ctx, text) {
    try {
      await ctx.editMessageCaption(text, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.editMessageText(text, { parse_mode: 'HTML' }).catch(() => {});
    }
  }

  const handleAdminAction = async (ctx, action) => {
    const requestId = Number(ctx.match[1]);

    const adminIds = await getAdminIds();
    if (!adminIds.includes(ctx.from.id)) {
      return ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }
    await ctx.answerCbQuery();

    try {
      const { data: pendingItem, error: fetchError } = await supabase
        .from('pending_properties').select('*').eq('id', requestId).single();

      if (fetchError || !pendingItem) {
        return editCard(ctx, `⚠️ <b>الطلب (#${requestId}) غير موجود أو تم التعامل معه مسبقاً.</b>`);
      }

      const targetUserId = pendingItem.user_id;
      const isFreeAd = pendingItem.receipt_url === 'FREE_NO_RECEIPT';

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

        await ctx.telegram.sendMessage(
          targetUserId,
          `🎉 <b>تم قبول إعلانك رقم (#${requestId}) ونشره بنجاح في المنصة!</b>\n🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await editCard(ctx,
          `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n🕒 وقت النشر: <code>${escapeHtml(formatDateTime(nowIso))}</code>\n📌 الحالة: <b>مقبول (مُحفظ في جدول test_messages)</b>`
        );
      } else {
        await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);

        const rejectUserMsg = isFreeAd
          ? `❌ <b>عذراً، لم تتم الموافقة على نشر إعلانك المجاني رقم (#${requestId}).</b>`
          : `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`;

        await ctx.telegram.sendMessage(targetUserId, rejectUserMsg, { parse_mode: 'HTML' }).catch(() => {});

        await editCard(ctx,
          `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n📌 الحالة: <b>مرفوض</b>`
        );
      }
    } catch (err) {
      console.error(`Admin action error #${requestId}:`, err);
      await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`);
    }
  };

  bot.action(/^approve_(\d+)$/, (ctx) => handleAdminAction(ctx, 'approve'));
  bot.action(/^reject_(\d+)$/, (ctx) => handleAdminAction(ctx, 'reject'));

  // واجهة عامة يستدعيها الأب
  return { openAdminHome };
};
