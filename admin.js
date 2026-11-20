'use strict';

const { Markup } = require('telegraf');

function createAdminHandler({ bot, supabase, getAdminIds }) {
  const adminState = {};
  const adminMsgHistory = {};

  function trackAdminMessage(adminId, chatId, messageId) {
    if (!adminId || !chatId || !messageId) return;
    if (!adminMsgHistory[adminId]) {
      adminMsgHistory[adminId] = { chatId, ids: [] };
    }
    adminMsgHistory[adminId].chatId = chatId;
    if (!adminMsgHistory[adminId].ids.includes(messageId)) {
      adminMsgHistory[adminId].ids.push(messageId);
    }
  }

  async function clearAdminTrackedMessages(ctx, adminId, keepMessageIds = []) {
    const history = adminMsgHistory[adminId];
    const keepSet = new Set(Array.isArray(keepMessageIds) ? keepMessageIds : [keepMessageIds].filter(Boolean));
    const chatId = ctx?.chat?.id || history?.chatId;
    if (!history || !chatId) return;

    const remaining = [];
    for (const msgId of history.ids) {
      if (keepSet.has(msgId)) {
        remaining.push(msgId);
        continue;
      }
      try {
        await ctx.telegram.deleteMessage(chatId, msgId);
      } catch (e) {}
    }
    adminMsgHistory[adminId].ids = remaining;
  }

  async function replyAdminTracked(ctx, adminId, text, extra = {}, cleanPrevious = false, keepIds = []) {
    if (cleanPrevious) {
      await clearAdminTrackedMessages(ctx, adminId, keepIds);
    }
    const sent = await ctx.reply(text, extra);
    if (sent && sent.message_id) {
      trackAdminMessage(adminId, ctx.chat.id, sent.message_id);
    }
    return sent;
  }

  async function safeDeleteAdminMessage(ctx) {
    try {
      if (ctx.message && ctx.message.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
      }
    } catch (e) {}
  }

  function sanitizeNumericPrice(val) {
    if (val === null || val === undefined) return 0;
    const digitsOnly = String(val).replace(/\D/g, '');
    if (!digitsOnly) return 0;
    const num = Number(digitsOnly);
    return Number.isFinite(num) ? num : 0;
  }

  function formatDateTime(dateInput) {
    const target = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(target.getTime())) return String(dateInput || 'غير محدد');
    try {
      return target.toLocaleString('fr-DZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return target.toISOString().replace('T', ' ').slice(0, 16);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function deliverAdminReplyToUser(ctx, adminId, targetUserId, payloadType, content, panelKeyboard) {
    const header = `📩 <b>رد الإدارة:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (payloadType === 'photo') {
      const cap = header + (content.caption ? escapeHtml(content.caption) : '🖼 <b>مرفق صورة من الإدارة</b>');
      await ctx.telegram.sendPhoto(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
    } else if (payloadType === 'video') {
      const cap = header + (content.caption ? escapeHtml(content.caption) : '🎥 <b>مرفق فيديو من الإدارة</b>');
      await ctx.telegram.sendVideo(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
    } else {
      await ctx.telegram.sendMessage(targetUserId, header + escapeHtml(content.text), { parse_mode: 'HTML' });
    }

    delete adminState[adminId];
    await replyAdminTracked(
      ctx,
      adminId,
      `✅ <b>تم إرسال ردك بنجاح إلى العميل</b> <code>${targetUserId}</code>.`,
      { parse_mode: 'HTML', ...panelKeyboard },
      true
    );
  }

  async function processAction(ctx, action, requestId) {
    await ctx.answerCbQuery().catch(() => {});

    try {
      const adminIds = await getAdminIds();
      if (!adminIds.includes(ctx.from.id)) {
        return await ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true }).catch(() => {});
      }

      const { data: pendingItem, error: fetchError } = await supabase
        .from('pending_properties')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError || !pendingItem) {
        return ctx.editMessageCaption(`⚠️ <b>الطلب (#${requestId}) غير موجود أو تم التعامل معه مسبقاً.</b>`, { parse_mode: 'HTML' }).catch(() => {});
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

        await ctx.editMessageCaption(
          `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n🕒 وقت النشر: <code>${escapeHtml(formatDateTime(nowIso))}</code>\n📌 الحالة: <b>مقبول (مُحفظ في جدول test_messages)</b>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      } else {
        await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);

        const rejectUserMsg = isFreeAd
          ? `❌ <b>عذراً، لم تتم الموافقة على نشر إعلانك المجاني رقم (#${requestId}).</b>`
          : `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`;

        await ctx.telegram.sendMessage(
          targetUserId,
          rejectUserMsg,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await ctx.editMessageCaption(
          `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n📌 الحالة: <b>مرفوض</b>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    } catch (err) {
      console.error(`Admin action error #${requestId}:`, err);
      await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`).catch(() => {});
    }
  }

  return {
    handleStart: async (ctx, keyboard) => {
      delete adminState[ctx.from.id];
      await safeDeleteAdminMessage(ctx);
      await replyAdminTracked(ctx, ctx.from.id, '🛡️ <b>لوحة الأدمن</b>', {
        parse_mode: 'HTML',
        ...(keyboard || Markup.keyboard([['👁 معاينة كـ يوزر'], ['🏠 القائمة الرئيسية']]).resize())
      }, true);
    },

    handleCallback: async (ctx) => {
      const data = ctx.callbackQuery?.data || '';
      const adminId = ctx.from.id;

      const replyMatch = data.match(/^support_reply_(\d+)$/);
      if (replyMatch) {
        const targetUserId = Number(replyMatch[1]);
        await ctx.answerCbQuery().catch(() => {});

        const adminIds = await getAdminIds();
        if (!adminIds.includes(adminId)) {
          return await ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true }).catch(() => {});
        }

        adminState[adminId] = {
          step: 'replying_to_support_user',
          data: { targetUserId },
          chatId: ctx.chat.id
        };

        await replyAdminTracked(
          ctx,
          adminId,
          `✉️ <b>وضع الرد على العميل</b> <code>${targetUserId}</code>\n\nاكتب ردك الآن أو أرسل صورة/فيديو (أو اضغط "🏠 القائمة الرئيسية" للإلغاء):`,
          {
            parse_mode: 'HTML',
            ...Markup.keyboard([['🏠 القائمة الرئيسية']]).resize()
          },
          true
        );
        return;
      }

      const approveMatch = data.match(/^approve_(\d+)$/);
      if (approveMatch) {
        return processAction(ctx, 'approve', Number(approveMatch[1]));
      }

      const rejectMatch = data.match(/^reject_(\d+)$/);
      if (rejectMatch) {
        return processAction(ctx, 'reject', Number(rejectMatch[1]));
      }

      await ctx.answerCbQuery().catch(() => {});
    },

    handleText: async (ctx, panelKeyboard) => {
      const adminId = ctx.from.id;
      const userText = ctx.message?.text ? ctx.message.text.trim() : '';
      const state = adminState[adminId];
      const kb = panelKeyboard || Markup.keyboard([['👁 معاينة كـ يوزر'], ['🏠 القائمة الرئيسية']]).resize();

      if (userText === '🏠 القائمة الرئيسية' || userText === '❌ إلغاء العملية والعودة') {
        await safeDeleteAdminMessage(ctx);
        delete adminState[adminId];
        await replyAdminTracked(ctx, adminId, '🛡️ <b>لوحة الأدمن</b>', {
          parse_mode: 'HTML',
          ...kb
        }, true);
        return;
      }

      if (state && state.step === 'replying_to_support_user') {
        await safeDeleteAdminMessage(ctx);
        const targetUserId = state.data?.targetUserId;
        if (!targetUserId) {
          delete adminState[adminId];
          return;
        }
        await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'text', { text: userText }, kb);
        return;
      }

      await safeDeleteAdminMessage(ctx);
      await replyAdminTracked(ctx, adminId, '🛡️ <b>لوحة الأدمن</b>', {
        parse_mode: 'HTML',
        ...kb
      }, true);
    },

    handlePhoto: async (ctx, panelKeyboard) => {
      const adminId = ctx.from.id;
      const state = adminState[adminId];
      const kb = panelKeyboard || Markup.keyboard([['👁 معاينة كـ يوزر'], ['🏠 القائمة الرئيسية']]).resize();
      await safeDeleteAdminMessage(ctx);

      if (state && state.step === 'replying_to_support_user') {
        const targetUserId = state.data?.targetUserId;
        if (!targetUserId) {
          delete adminState[adminId];
          return;
        }
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'photo', {
          fileId: photo.file_id,
          caption: ctx.message.caption || ''
        }, kb);
      }
    },

    handleVideo: async (ctx, panelKeyboard) => {
      const adminId = ctx.from.id;
      const state = adminState[adminId];
      const kb = panelKeyboard || Markup.keyboard([['👁 معاينة كـ يوزر'], ['🏠 القائمة الرئيسية']]).resize();
      await safeDeleteAdminMessage(ctx);

      if (state && state.step === 'replying_to_support_user') {
        const targetUserId = state.data?.targetUserId;
        if (!targetUserId) {
          delete adminState[adminId];
          return;
        }
        await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'video', {
          fileId: ctx.message.video.file_id,
          caption: ctx.message.caption || ''
        }, kb);
      }
    }
  };
}

module.exports = { createAdminHandler };
