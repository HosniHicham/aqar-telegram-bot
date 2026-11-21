'use strict';

function buildThreadId(propertyId, ownerId, otherUserId) {
  return `p_${Number(propertyId)}_o_${Number(ownerId)}_u_${Number(otherUserId)}`;
}

function createMessengerModule(core) {
  const {
    Markup,
    supabase,
    userState,
    browsingSession,
    supportUserSession,
    trackBotMessage,
    clearTrackedBotMessages,
    replyTracked,
    safeDeleteUserMessage,
    escapeHtml,
    fitTelegramText,
    formatDateTime
  } = core;

  // جلسة المراسلات لكل مستخدم: { mode: 'list' | 'thread', threadId, propertyId, ownerId, receiverId, cardMessageId, listMessageId }
  const messengerSession = {};

  function getUserDisplayName(from) {
    if (!from) return 'مستخدم';
    const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    return full || from.username || `مستخدم ${from.id}`;
  }

  // حساب عدد الرسائل الواردة غير المقروءة للمستخدم (إلى = userId والمرسل ليس userId)
  async function getUnreadCount(userId) {
    const uid = Number(userId);
    if (!uid) return 0;

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id')
        .eq('receiver_id', uid)
        .neq('sender_id', uid)
        .eq('is_read', false)
        .eq('is_closed', false);

      if (error || !Array.isArray(data)) return 0;
      return data.length;
    } catch (e) {
      return 0;
    }
  }

  // نص الزر: يظهر الرقم بين قوسين فقط إذا وُجدت رسائل واردة غير مقروءة
  async function getMessengerButtonLabel(userId) {
    const count = await getUnreadCount(userId);
    return count > 0 ? `💬 المراسلات (${count})` : '💬 المراسلات';
  }

  // حفظ رسالة جديدة في جدول messanger
  async function insertMessage({
    propertyId,
    ownerId,
    senderId,
    receiverId,
    senderName,
    messageType = 'text',
    message
  }) {
    const cleanMsg = String(message || '').trim();
    if (!cleanMsg) return null;

    const pId = Number(propertyId);
    const oId = Number(ownerId);
    const sId = Number(senderId);
    const rId = Number(receiverId);
    const otherId = sId === oId ? rId : sId;
    const threadId = buildThreadId(pId, oId, otherId);

    const { data, error } = await supabase
      .from('messanger')
      .insert([{
        thread_id: threadId,
        property_id: pId,
        owner_id: oId,
        sender_id: sId,
        receiver_id: rId,
        sender_name: String(senderName || 'مستخدم').trim() || 'مستخدم',
        message_type: messageType,
        message: cleanMsg,
        is_read: false,
        is_closed: false,
        created_at: new Date().toISOString(),
        read_at: null
      }])
      .select()
      .single();

    if (error) {
      console.error('messanger insert error:', error);
      return null;
    }
    return data;
  }

  // جلب قائمة المراسلين للمستخدم الحالي (أزرار بأسماء المرسلين)
  async function fetchSenderThreads(userId) {
    const uid = Number(userId);

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id, thread_id, property_id, owner_id, sender_id, receiver_id, sender_name, message, is_read, is_closed, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error || !Array.isArray(data)) return [];

      const threadsMap = new Map();

      for (const row of data) {
        const otherId = Number(row.sender_id) === uid ? Number(row.receiver_id) : Number(row.sender_id);
        if (otherId === uid) continue;

        const tId = row.thread_id || buildThreadId(row.property_id, row.owner_id, otherId);

        if (!threadsMap.has(tId)) {
          threadsMap.set(tId, {
            threadId: tId,
            propertyId: row.property_id,
            ownerId: row.owner_id,
            otherId,
            senderName: Number(row.sender_id) === otherId ? (row.sender_name || `مستخدم ${otherId}`) : null,
            lastMessage: row.message,
            lastTime: row.created_at,
            unreadCount: 0
          });
        }

        const entry = threadsMap.get(tId);
        if (!entry.senderName && Number(row.sender_id) === otherId && row.sender_name) {
          entry.senderName = row.sender_name;
        }
        if (Number(row.receiver_id) === uid && Number(row.sender_id) !== uid && row.is_read === false) {
          entry.unreadCount += 1;
        }
      }

      return Array.from(threadsMap.values()).map((t) => {
        const cleanName = String(t.senderName || `مستخدم ${t.otherId}`).trim();
        const label = t.unreadCount > 0 ? `🟢 ${cleanName} (${t.unreadCount})` : cleanName;
        return { ...t, buttonText: label };
      });
    } catch (e) {
      console.error('fetchSenderThreads error:', e);
      return [];
    }
  }

  // فتح محادثة: تسجيل الرسائل الواردة كمقروءة + حفظ تاريخ الفتح read_at
  async function openThreadMessages(userId, threadId) {
    const uid = Number(userId);
    const nowIso = new Date().toISOString();

    await supabase
      .from('messanger')
      .update({ is_read: true, read_at: nowIso })
      .eq('thread_id', threadId)
      .eq('receiver_id', uid)
      .neq('sender_id', uid)
      .eq('is_read', false);

    const { data, error } = await supabase
      .from('messanger')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    if (error || !Array.isArray(data)) return [];
    return data;
  }

  // تنسيق البطاقة الواحدة التي تجمع رسائل المحادثة وتُحدّث باستمرار
  function formatSingleThreadCard(userId, messages, meta = {}) {
    const uid = Number(userId);
    const otherRow = messages.find((m) => Number(m.sender_id) !== uid);
    const otherName = otherRow?.sender_name || meta.otherName || `مستخدم ${meta.receiverId || ''}`.trim();
    const propId = messages[0]?.property_id || meta.propertyId;

    const lines = messages.map((m) => {
      const mine = Number(m.sender_id) === uid;
      const who = mine ? 'أنت' : escapeHtml(m.sender_name || otherName);
      const timeStr = m.created_at ? ` <code>[${escapeHtml(formatDateTime(m.created_at))}]</code>` : '';
      const icon = mine ? '🟦' : '🟩';
      return `${icon} <b>${who}:</b> ${escapeHtml(m.message)}${timeStr}`;
    });

    const header =
      `💬 <b>محادثة مع ${escapeHtml(otherName)}</b>` +
      (propId ? ` • عقار <code>#${propId}</code>` : '') +
      `\n━━━━━━━━━━━━━━━━━━━━\n`;

    const body = lines.length > 0
      ? lines.join('\n')
      : `<i>لا توجد رسائل بعد. اكتب رسالتك الأولى الآن.</i>`;

    const footer =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `✍️ <i>اكتب رسالتك وسيتم إرسالها وتحديث هذه الرسالة مباشرة.</i>`;

    return fitTelegramText(header + body + footer, false);
  }

  // عرض قائمة المراسلين (فقط عندما يختار المستخدم ذلك)
  async function showInboxList(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];

    const threads = await fetchSenderThreads(userId);
    const unreadCount = await getUnreadCount(userId);
    messengerSession[userId] = { mode: 'list' };

    await clearTrackedBotMessages(ctx, userId, []);

    if (!threads.length) {
      const emptyMsg = await ctx.reply(
        '📭 <b>لا توجد رسائل واردة أو محادثات حالياً.</b>',
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) }
      ).catch(() => null);
      if (emptyMsg?.message_id) trackBotMessage(userId, ctx.chat.id, emptyMsg.message_id);
      return;
    }

    const inlineRows = threads.map((t) => ([
      Markup.button.callback(t.buttonText, `msg_open:${t.threadId}`)
    ]));
    inlineRows.push([Markup.button.callback('🔄 تحديث القائمة', 'msg_list')]);

    const sent = await ctx.reply(
      '💬 <b>المراسلات — اختر اسم المرسل لفتح المحادثة:</b>',
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(inlineRows).reply_markup
      }
    ).catch(() => null);

    if (sent?.message_id) {
      trackBotMessage(userId, ctx.chat.id, sent.message_id);
      messengerSession[userId].listMessageId = sent.message_id;
    }

    const kbMsg = await ctx.reply('👇', {
      ...core.getMainMenuKeyboard(userId, unreadCount)
    }).catch(() => null);

    if (kbMsg?.message_id) {
      trackBotMessage(userId, ctx.chat.id, kbMsg.message_id);
    }
  }

  // عرض / تحديث البطاقة الواحدة للمحادثة النشطة
  async function renderActiveThread(ctx, userId, threadId, meta = {}, editMessageId = null) {
    const messages = await openThreadMessages(userId, threadId);
    const unreadCount = await getUnreadCount(userId);

    const first = messages[0] || {};
    const ownerId = Number(first.owner_id || meta.ownerId);
    const propertyId = Number(first.property_id || meta.propertyId);
    const receiverId = Number(
      meta.receiverId ||
      (Number(first.sender_id) === Number(userId) ? first.receiver_id : first.sender_id) ||
      ownerId
    );

    const cardText = formatSingleThreadCard(userId, messages, {
      ...meta,
      propertyId,
      ownerId,
      receiverId
    });

    const inlineKb = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ قائمة المراسلين', 'msg_list')]
    ]);

    let targetMsgId = editMessageId || messengerSession[userId]?.cardMessageId || null;

    if (targetMsgId && ctx.chat?.id) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, undefined, cardText, {
          parse_mode: 'HTML',
          reply_markup: inlineKb.reply_markup
        });
        messengerSession[userId] = {
          mode: 'thread',
          threadId,
          propertyId,
          ownerId,
          receiverId,
          otherName: meta.otherName || '',
          cardMessageId: targetMsgId
        };
        return targetMsgId;
      } catch (_) {
        await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
      }
    }

    await clearTrackedBotMessages(ctx, userId, []);

    const sent = await ctx.reply(cardText, {
      parse_mode: 'HTML',
      reply_markup: inlineKb.reply_markup
    }).catch(() => null);

    const newMsgId = sent?.message_id || null;
    if (newMsgId) {
      trackBotMessage(userId, ctx.chat.id, newMsgId);
    }

    const kbMsg = await ctx.reply('👇', {
      ...core.getMainMenuKeyboard(userId, unreadCount)
    }).catch(() => null);

    if (kbMsg?.message_id) {
      trackBotMessage(userId, ctx.chat.id, kbMsg.message_id);
    }

    messengerSession[userId] = {
      mode: 'thread',
      threadId,
      propertyId,
      ownerId,
      receiverId,
      otherName: meta.otherName || '',
      cardMessageId: newMsgId
    };
    return newMsgId;
  }

  // بدء مراسلة جديدة من بطاقة عقار معيّن
  async function startPropertyMessage(ctx, propertyItem) {
    const userId = ctx.from.id;
    const ownerId = Number(propertyItem?.user_id);
    const propertyId = Number(propertyItem?.id);
    const unreadCount = await getUnreadCount(userId);

    if (!propertyId || !ownerId) {
      return ctx.answerCbQuery('⚠️ بيانات المالك غير متوفرة لهذا العقار.', { show_alert: true }).catch(() => {});
    }
    if (ownerId === Number(userId)) {
      return ctx.answerCbQuery('ℹ️ هذا العقار منشور بحسابك.', { show_alert: true }).catch(() => {});
    }

    const threadId = buildThreadId(propertyId, ownerId, userId);
    userState[userId] = {
      step: 'composing_property_message',
      data: {
        threadId,
        propertyId,
        ownerId,
        receiverId: ownerId,
        otherName: `مالك العقار #${propertyId}`
      },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const existing = await supabase
      .from('messanger')
      .select('id')
      .eq('thread_id', threadId)
      .limit(1);

    if (Array.isArray(existing.data) && existing.data.length > 0) {
      return renderActiveThread(ctx, userId, threadId, {
        propertyId,
        ownerId,
        receiverId: ownerId,
        otherName: `مالك العقار #${propertyId}`
      });
    }

    const promptText =
      `💬 <b>مراسلة صاحب العقار</b> (عقار <code>#${propertyId}</code>)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `اكتب رسالتك الآن ليتم إرسالها إلى المالك وحفظها في المراسلات:`;

    const sent = await replyTracked(
      ctx,
      userId,
      promptText,
      { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
      true
    );
    if (sent?.message_id) {
      userState[userId].wizardMsgId = sent.message_id;
    }
  }

  // معالجة نص يكتبه المستخدم أثناء وجود محادثة نشطة أو كتابة رسالة لعقار
  async function handleMessengerText(ctx) {
    const userId = ctx.from.id;
    const rawText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!rawText || rawText.startsWith('/')) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];

    if (st && st.step === 'composing_property_message') {
      await safeDeleteUserMessage(ctx);
      const { threadId, propertyId, ownerId, receiverId, otherName, wizardMsgId } = st.data || {};
      delete userState[userId];

      if (wizardMsgId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, wizardMsgId).catch(() => {});
      }

      await insertMessage({
        propertyId,
        ownerId,
        senderId: userId,
        receiverId,
        senderName: getUserDisplayName(ctx.from),
        messageType: 'text',
        message: rawText
      });

      await renderActiveThread(ctx, userId, threadId, { propertyId, ownerId, receiverId, otherName });
      return true;
    }

    if (sess && sess.mode === 'thread' && sess.threadId) {
      await safeDeleteUserMessage(ctx);

      await insertMessage({
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        senderId: userId,
        receiverId: sess.receiverId,
        senderName: getUserDisplayName(ctx.from),
        messageType: 'text',
        message: rawText
      });

      await renderActiveThread(ctx, userId, sess.threadId, {
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        receiverId: sess.receiverId,
        otherName: sess.otherName
      }, sess.cardMessageId);
      return true;
    }

    return false;
  }

  core.bot.hears(/^💬 المراسلات(?: \(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showInboxList(ctx);
  });

  core.bot.action('msg_list', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showInboxList(ctx);
  });

  core.bot.action(/^msg_open:(.+)$/, async (ctx) => {
    const threadId = ctx.match[1];
    const msgId = ctx.callbackQuery?.message?.message_id || null;
    await ctx.answerCbQuery('✅ تم فتح المحادثة').catch(() => {});
    await renderActiveThread(ctx, ctx.from.id, threadId, {}, msgId);
  });

  core.bot.action(/^msg_prop:(\d+):(\d+)$/, async (ctx) => {
    const propertyId = Number(ctx.match[1]);
    const ownerId = Number(ctx.match[2]);
    await ctx.answerCbQuery().catch(() => {});
    await startPropertyMessage(ctx, { id: propertyId, user_id: ownerId });
  });

  return {
    messengerSession,
    buildThreadId,
    getUnreadCount,
    getMessengerButtonLabel,
    insertMessage,
    fetchSenderThreads,
    openThreadMessages,
    formatSingleThreadCard,
    showInboxList,
    renderActiveThread,
    startPropertyMessage,
    handleMessengerText
  };
}

module.exports = { createMessengerModule };
