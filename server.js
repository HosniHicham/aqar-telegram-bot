const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN; // مثال: https://your-render-app.onrender.com

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

// 🌐 مسار صفحة الـ Mini App (الواجهة الرسومية التي ستفتح داخل تليجرام)
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
                        <option value="قسنطينة">قسنطينة 
