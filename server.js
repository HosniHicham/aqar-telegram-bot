const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is missing!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🌐 مسار صفحة الـ Mini App
app.get('/miniapp', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>عقار الجزائر - Mini App</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            :root {
                --bg-color: #0F172A;
                --card-bg: #1E293B;
                --accent-color: #0D9488;
                --text-color: #F8FAFC;
                --border-color: #334155;
            }
            body {
                font-family: system-ui, -apple-system, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-color);
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: 480px;
                margin: 0 auto;
                background: var(--card-bg);
                padding: 20px;
                border-radius: 16px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            }
            h2 {
                text-align: center;
                color: #38BDF8;
                margin-bottom: 20px;
                font-size: 22px;
            }
            .form-group {
                margin-bottom: 15px;
            }
            label {
                display: block;
                margin-bottom: 6px;
                font-size: 14px;
                color: #94A3B8;
            }
            input, select, textarea {
                width: 100%;
                padding: 12px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
                background: #0F172A;
                color: #fff;
                font-size: 14px;
                box-sizing: border-box;
            }
            input:focus, select:focus, textarea:focus {
                outline: none;
                border-color: var(--accent-color);
            }
            button {
                width: 100%;
                background: var(--accent-color);
                color: white;
                border: none;
                padding: 14px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                margin-top: 10px;
                transition: background 0.2s;
            }
            button:hover {
                background: #0F766E;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🏠 نشر عقار عبر Mini App</h2>
            <form id="propertyForm">
                <div class="form-group">
                    <label>نوع العقار</label>
                    <select id="property_type" required>
                        <option value="شقة">شقة 🏢</option>
                        <option value="فيلا">فيلا 🏡</option>
                        <option value="قطعة أرض">قطعة أرض 📐</option>
                        <option value="محل تجاري">محل تجاري 🏪</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>الولاية</label>
                    <select id="state_name" required>
                        <option value="الجزائر العاصمة">الجزائر العاصمة 📍</option>
                        <option value="وهران">وهران 📍</option>
                        <option value="مستغانم">مستغانم 📍</option>
                        <option value="قسنطينة">قسنطينة 📍</option>
                        <option value="عنابة">عنابة 📍</option>
                        <option value="البليدة">البليدة 📍</option>
                        <option value="تلمسان">تلمسان 📍</option>
                        <option value="سطيف">سطيف 📍</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>السعر المطلوب</label>
                    <input type="text" id="price" placeholder="مثال: 1.2 مليار" required>
                </div>
                <div class="form-group">
                    <label>رقم الهاتف</label>
                    <input type="text" id="phone" placeholder="0550000000" required>
                </div>
                <div class="form-group">
                    <label>الوصف التفصيلي</label>
                    <textarea id="description" rows="3" placeholder="المساحة، الوثائق، المميزات..." required></textarea>
                </div>
                <button type="submit" id="submitBtn">نشر الإعلان فوراً 🚀</button>
            </form>
        </div>

        <script>
            let tg = window.Telegram.WebApp;
            tg.expand();

            document.getElementById('propertyForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const data = {
                    property_type: document.getElementById('property_type').value,
                    state_name: document.getElementById('state_name').value,
                    price: document.getElementById('price').value,
                    phone: document.getElementById('phone').value,
                    description: document.getElementById('description').value,
                    user_id: tg.initDataUnsafe?.user?.id || 123456
                };

                const btn = document.getElementById('submitBtn');
                btn.innerText = '⏳ جاري الحفظ والإرسال...';
                btn.disabled = true;

                try {
                    const response = await fetch('/api/submit-property', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });

                    const result = await response.json();
                    if(result.success) {
                        tg.showAlert('🎉 تم نشر العقار بنجاح عبر النظام المصغر!');
                        tg.close();
                    } else {
                        alert('⚠️ حدث خطأ أثناء الحفظ.');
                        btn.innerText = 'نشر الإعلان فوراً 🚀';
                        btn.disabled = false;
                    }
                } catch (err) {
                    alert('⚠️ خطأ في الاتصال بالسيرفر.');
                    btn.innerText = 'نشر الإعلان فوراً 🚀';
                    btn.disabled = false;
                }
            });
        </script>
    </body>
    </html>
  `);
});

app.post('/api/submit-property', async (req, res) => {
  try {
    const { property_type, state_name, price, phone, description } = req.body;

    const { error } = await supabase
      .from('test_messages')
      .insert([{ 
        property_type,
        state_name,
        price,
        phone,
        description,
        message: description,
        image_url: 'EMPTY',
        video_url: 'EMPTY' 
      }]);

    if (error) throw new Error(error.message);

    res.json({ success: true });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function getMainMenuKeyboard(lang = 'ar') {
  const isAr = lang === 'ar';
  return Markup.keyboard([
    [isAr ? '🔍 تصفح العقارات' : '🔍 Parcourir', isAr ? '🚀 إضافة عقار (Mini App)' : '🚀 Ajouter (Mini App)'],
    [isAr ? '📞 الدعم والإدارة' : '📞 Support', isAr ? 'ℹ️ عن المنصة' : 'ℹ️ À propos']
  ]).resize();
}

bot.start((ctx) => {
  const userName = ctx.from.first_name || 'مستخدمنا الكريم';
  ctx.reply(
    `أهلاً بك يا <b>${userName}</b> في <b>منصة عقار الجزائر الذكية</b> 🏠✨\n\n` +
    `جرب الآن النظام المرئي المتطور عبر زر الـ Mini App أدناه:`,
    {
      parse_mode: 'HTML',
      ...getMainMenuKeyboard('ar')
    }
  );
});

bot.hears(['🚀 إضافة عقار (Mini App)', '🚀 Ajouter (Mini App)'], (ctx) => {
  if (!WEBHOOK_DOMAIN) {
    return ctx.reply('⚠️ يجدر ضبط متغير WEBHOOK_DOMAIN في السيرفر ليعمل رابط الـ Mini App.');
  }
  ctx.reply('اضغط على الزر أدناه لفتح نافذة النشر الفاخرة:', Markup.inlineKeyboard([
    [Markup.button.webApp('🌐 فتح نافذة النشر الذكية', `${WEBHOOK_DOMAIN}/miniapp`)]
  ]));
});

bot.hears(['📞 الدعم والإدارة', '📞 Support'], (ctx) => {
  ctx.reply('مركز الدعم الفني - تطوير السيد **هشام حسني** (تكنولوشن).', { parse_mode: 'Markdown' });
});

bot.hears(['ℹ️ عن المنصة', 'ℹ️ À propos'], (ctx) => {
  ctx.reply('منصة عقار الجزائر - نظام مؤسسي متطور مدعوم بتقنيات الويب الحديثة والذكاء السحابي.', { parse_mode: 'HTML' });
});

bot.on('photo', async (ctx) => {
  await ctx.reply('📸 أرسلت صورة، يمكنك استخدام زر الـ Mini App بالأعلى لنشر العقارات بكفاءة.');
});

const PORT = process.env.PORT || 3000;

if (WEBHOOK_DOMAIN) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`);
  
  app.get('/', (req, res) => {
    res.send('Aqar Algeria Mini App Engine is online 🚀');
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} with Webhook & Mini App.`);
  });
} else {
  bot.launch();
}
