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
    chunkButtons
  } = core;

  // جلسة المراسلات لكل مستخدم:
  // { mode: 'list' | 'thread', threadId, propertyId, ownerId, receiverId, otherName, cardMessageId, senderMap }
  const messengerSession = {};

  function getUserDisplayName(from) {
    if (!from) return 'مراسل';
    const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    return full || from.username || 'مراسل';
  }

  // جلب الاسم الحقيقي من جدول users أو من sender_name في messanger بدون أي ID أبداً
  async function resolveCleanSenderName(otherUserId, fallbackSenderName = '') {
    const cleanFallback = String(fallbackSenderName || '')
      .replace(/\b(مستخدم|user|id)\s*#?\s*\d*\b/gi, '')
      .trim();

    if (cleanFallback) {
      return cleanFallback;
    }

    try {
      const { data } = await supabase
        .from('users')
        .select('first_name, last_name, username')
        .eq('id', Number(otherUserId))
        .limit(1);

      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
        if (full) return full;
        if (row.username) return String(row.username).trim();
      }
    } catch (e) {}

    return 'مراسل';
  }

  // توقيت صغير ومختصر داخل سطر الرسالة
  function formatCompactTime(dateInput) {
    const target = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(target.getTime())) return '';
    try {
      const d = target.toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit' });
      const t = target.toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `${d} ${t}`;
    } catch (e) {
      return target.toISOString().slice(5, 16).replace('T', ' ');
    }
  }

  // حساب عدد الرسائل الواردة غير المقروءة للمستخدم الحالي
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

  // نص الزر الرئيسي: يظهر الرقم بين قوسين فقط إذا وُجدت رسائل واردة غير مقروءة
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

    const safeName = String(senderName || 'مراسل')
      .replace(/\b(مستخدم|user|id)\s*#?\s*\d*\b/gi, '')
      .trim() || 'مراسل';

    const { data, error } = await supabase
      .from('messanger')
      .insert([{
        thread_id: threadId,
        property_id: pId,
        owner_id: oId,
        sender_id: sId,
        receiver_id: rId,
        sender_name: safeName,
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

  // جلب قائمة المراسلين للمستخدم الحالي (الاسم فقط بدون أي ID)
  async function fetchSenderThreads(userId) {
    const uid = Number(userId);

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id, thread_id, property_id, owner_id, sender_id, receiver_id, sender_name, is_read, is_closed, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error || !Array.isArray(data)) return [];

      const threadsMap = new Map();

      for (const row of data) {
        const otherId = Number(row.sender_id) === uid ? Number(row.receiver_id) : Number(row.sender_id);
        if (!otherId || otherId === uid) continue;

        const tId = row.thread_id || buildThreadId(row.property_id, row.owner_id, otherId);

        if (!threadsMap.has(tId)) {
          threadsMap.set(tId, {
            threadId: tId,
            propertyId: row.property_id,
            ownerId: row.owner_id,
            otherId,
            rawSenderName: Number(row.sender_id) === otherId ? (row.sender_name || '') : '',
            unreadCount: 0
          });
        }

        const entry = threadsMap.get(tId);
        if (!entry.rawSenderName && Number(row.sender_id) === otherId && row.sender_name) {
          entry.rawSenderName = row.sender_name;
        }
        if (Number(row.receiver_id) === uid && Number(row.sender_id) !== uid && row.is_read === false) {
          entry.unreadCount += 1;
        }
      }

      const list = [];
      for (const t of threadsMap.values()) {
        const cleanName = await resolveCleanSenderName(t.otherId, t.rawSenderName);
        const buttonText = t.unreadCount > 0 ? `🟢 ${cleanName} (${t.unreadCount})` : cleanName;
        list.push({
          ...t,
          cleanName,
          buttonText
        });
      }

      return list;
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

  // تنسيق البطاقة الواحدة بأسلوب Left / Right وتوقيت صغير واسم فقط بدون ID
  function formatSingleThreadCard(userId, messages, meta = {}) {
    const uid = Number(userId);
    const otherRow = messages.find((m) => Number(m.sender_id) !== uid);
    const otherName = (otherRow?.sender_name || meta.otherName || 'مراسل')
      .replace(/\b(مستخدم|user|id)\s*#?\s*\d*\b/gi, '')
      .trim() || 'مراسل';

    const lines = messages.map((m) => {
      const isRight = Number(m.sender_id) === uid;
      const cleanWho = (m.sender_name || otherName)
        .replace(/\b(مستخدم|user|id)\s*#?\s*\d*\b/gi, '')
        .trim() || otherName;
      const smallTime = m.created_at ? ` <small>${escapeHtml(formatCompactTime(m.created_at))}</small>` : '';
      const msgBody = escapeHtml(m.message || '');

      // تقنية Left / Right للرسائل
      if (isRight) {
        return `↪️ <b>${escapeHtml(cleanWho)}</b>${smallTime}\n      <code>${msgBody}</code>`;
      } else {
        return `↩️ <b>${escapeHtml(cleanWho)}</b>${smallTime}\n${msgBody}`;
      }
    });

    const header = `💬 <b>${escapeHtml(otherName)}</b>\n──────────────\n`;
    const body = lines.length > 0 ? lines.join('\n\n') : `<i>ابدأ المحادثة بكتابة رسالة...</i>`;

    return fitTelegramText(header + body, false);
  }

  // عرض قائمة المراسلين كأزرار في لوحة المفاتيح السفلية (اسم فقط بدون عرض رسائل أو ID)
  async function showInboxList(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];

    const threads = await fetchSenderThreads(userId);
    const unreadCount = await getUnreadCount(userId);

    if (!threads.length) {
      delete messengerSession[userId];
      return replyTracked(
        ctx,
        userId,
        '📭 <b>لا توجد رسائل واردة حالياً.</b>',
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    }

    const senderMap = {};
    const buttonLabels = [];
    for (const t of threads) {
      senderMap[t.buttonText] = t;
      buttonLabels.push(t.buttonText);
    }

    messengerSession[userId] = {
      mode: 'list',
      senderMap
    };

    const rows = chunkButtons ? chunkButtons(buttonLabels, 2) : [];
    if (!rows.length) {
      for (let i = 0; i < buttonLabels.length; i += 2) {
        rows.push(buttonLabels.slice(i, i + 2));
      }
    }
    rows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(
      ctx,
      userId,
      '💬 <b>المراسلات</b>',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(rows).resize()
      },
      true
    );
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
    const otherName = meta.otherName || first.sender_name || 'مراسل';

    const cardText = formatSingleThreadCard(userId, messages, {
      ...meta,
      propertyId,
      ownerId,
      receiverId,
      otherName
    });

    const threadKb = Markup.keyboard([
      ['⬅️ قائمة المراسلين'],
      ['🏠 القائمة الرئيسية']
    ]).resize();

    const prevSession = messengerSession[userId] || {};
    let targetMsgId = editMessageId || prevSession.cardMessageId || null;

    if (targetMsgId && ctx.chat?.id) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, undefined, cardText, {
          parse_mode: 'HTML'
        });
        messengerSession[userId] = {
          ...prevSession,
          mode: 'thread',
          threadId,
          propertyId,
          ownerId,
          receiverId,
          otherName,
          cardMessageId: targetMsgId,
          unreadCount
        };
        return targetMsgId;
      } catch (_) {
        await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
      }
    }

    const sent = await replyTracked(
      ctx,
      userId,
      cardText,
      {
        parse_mode: 'HTML',
        ...threadKb
      },
      true
    );

    const newMsgId = sent?.message_id || null;
    messengerSession[userId] = {
      ...prevSession,
      mode: 'thread',
      threadId,
      propertyId,
      ownerId,
      receiverId,
      otherName,
      cardMessageId: newMsgId,
      unreadCount
    };
    return newMsgId;
  }

  // بدء مراسلة جديدة من بطاقة عقار معيّن
  async function startPropertyMessage(ctx, propertyItem) {
    const userId = ctx.from.id;
    const ownerId = Number(propertyItem?.user_id);
    const propertyId = Number(propertyItem?.id);

    if (!propertyId || !ownerId || ownerId === Number(userId)) {
      return;
    }

    const ownerName = await resolveCleanSenderName(ownerId, 'صاحب العقار');
    const threadId = buildThreadId(propertyId, ownerId, userId);

    userState[userId] = {
      step: 'composing_property_message',
      data: {
        threadId,
        propertyId,
        ownerId,
        receiverId: ownerId,
        otherName: ownerName
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
        otherName: ownerName
      });
    }

    const promptText = `💬 <b>${escapeHtml(ownerName)}</b>\n──────────────\nاكتب رسالتك:`;

    const sent = await replyTracked(
      ctx,
      userId,
      promptText,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['🏠 القائمة الرئيسية']]).resize()
      },
      true
    );
    if (sent?.message_id) {
      userState[userId].wizardMsgId = sent.message_id;
    }
  }

  // معالجة نص يكتبه المستخدم (اختيار زر اسم المرسل، أو العودة للقائمة، أو إرسال رسالة في المحادثة)
  async function handleMessengerText(ctx) {
    const userId = ctx.from.id;
    const rawText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!rawText || rawText.startsWith('/')) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];

    if (rawText === '⬅️ قائمة المراسلين') {
      await safeDeleteUserMessage(ctx);
      await showInboxList(ctx);
      return true;
    }

    if (sess && sess.mode === 'list' && sess.senderMap && sess.senderMap[rawText]) {
      await safeDeleteUserMessage(ctx);
      const target = sess.senderMap[rawText];
      await renderActiveThread(ctx, userId, target.threadId, {
        propertyId: target.propertyId,
        ownerId: target.ownerId,
        receiverId: target.otherId,
        otherName: target.cleanName
      });
      return true;
    }

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
    await showInboxList(ctx);
  });

  core.bot.action(/^msg_open:(.+)$/, async (ctx) => {
    const threadId = ctx.match[1];
    const msgId = ctx.callbackQuery?.message?.message_id || null;
    await renderActiveThread(ctx, ctx.from.id, threadId, {}, msgId);
  });

  core.bot.action(/^msg_prop:(\d+):(\d+)$/, async (ctx) => {
    const propertyId = Number(ctx.match[1]);
    const ownerId = Number(ctx.match[2]);
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
