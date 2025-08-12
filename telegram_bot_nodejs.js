const express = require('express');
const serverless = require('serverless-http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

// Bot konfiguratsiyasi
const BOT_TOKEN = process.env.BOT_TOKEN || '7576302790:AAEUCdbR2UwZV4w7Rld_BicQKhQRpkHGiQw';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 6460744486;
const BOT_USERNAME = process.env.BOT_USERNAME || 'test270bot';
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Database fayli yo'li
const DB_PATH = '/tmp/bot_data.db';

// Database initialization
function initDB() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        
        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                full_name TEXT NOT NULL,
                username TEXT,
                registration_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            // Tests table
            db.run(`CREATE TABLE IF NOT EXISTS tests (
                test_id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_code TEXT UNIQUE NOT NULL,
                subject_name TEXT NOT NULL,
                correct_answers TEXT NOT NULL,
                creator_id INTEGER NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1,
                time_limit INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 1,
                description TEXT DEFAULT '',
                difficulty_level TEXT DEFAULT 'Oson',
                FOREIGN KEY (creator_id) REFERENCES users(user_id)
            )`);
            
            // Test results table
            db.run(`CREATE TABLE IF NOT EXISTS test_results (
                result_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                test_code TEXT NOT NULL,
                user_answers TEXT NOT NULL,
                correct_count INTEGER NOT NULL,
                total_questions INTEGER NOT NULL,
                percentage REAL NOT NULL,
                time_spent INTEGER DEFAULT 0,
                completed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                attempt_number INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`);
            
            // User states table
            db.run(`CREATE TABLE IF NOT EXISTS user_states (
                user_id INTEGER PRIMARY KEY,
                state TEXT,
                data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            // Bot statistics table
            db.run(`CREATE TABLE IF NOT EXISTS bot_stats (
                stat_id INTEGER PRIMARY KEY AUTOINCREMENT,
                stat_date DATE DEFAULT CURRENT_DATE,
                new_users INTEGER DEFAULT 0,
                tests_created INTEGER DEFAULT 0,
                tests_solved INTEGER DEFAULT 0,
                total_users INTEGER DEFAULT 0,
                active_users INTEGER DEFAULT 0
            )`);
        });
        
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Bot API functions
async function sendRequest(method, data = {}) {
    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data, {
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error(`API request error: ${error.message}`);
        return { ok: false, error: error.message };
    }
}

async function sendMessage(chatId, text, replyMarkup = null, parseMode = 'HTML') {
    const data = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return await sendRequest('sendMessage', data);
}

async function editMessageText(chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
    const data = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: parseMode
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return await sendRequest('editMessageText', data);
}

async function sendPhoto(chatId, photoUrl, caption, replyMarkup = null) {
    const data = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: 'HTML'
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return await sendRequest('sendPhoto', data);
}

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
    return await sendRequest('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert
    });
}

async function answerInlineQuery(inlineQueryId, results) {
    return await sendRequest('answerInlineQuery', {
        inline_query_id: inlineQueryId,
        results: results,
        cache_time: 1
    });
}

// Database helper functions
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
            db.close();
        });
    });
}

function getQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
            db.close();
        });
    });
}

function allQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
            db.close();
        });
    });
}

// User management
async function getUserState(userId) {
    const result = await getQuery('SELECT state, data FROM user_states WHERE user_id = ?', [userId]);
    return result ? [result.state, result.data] : [null, null];
}

async function setUserState(userId, state, data = null) {
    await runQuery('REPLACE INTO user_states (user_id, state, data) VALUES (?, ?, ?)', [userId, state, data]);
}

async function addUser(userId, fullName, username = null) {
    await runQuery('REPLACE INTO users (user_id, full_name, username, last_activity) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', 
        [userId, fullName, username]);
}

async function getUser(userId) {
    const result = await getQuery('SELECT full_name FROM users WHERE user_id = ?', [userId]);
    return result ? result.full_name : null;
}

async function updateUserActivity(userId) {
    await runQuery('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE user_id = ?', [userId]);
}

// Test management
async function createTest(subjectName, correctAnswers, creatorId, timeLimit = 0, maxAttempts = 1, description = '', difficulty = 'Oson') {
    const testCode = Math.abs(Math.floor(Math.random() * 100000)).toString().padStart(5, '0');
    await runQuery(`INSERT INTO tests (test_code, subject_name, correct_answers, creator_id, time_limit, max_attempts, description, difficulty_level) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [testCode, subjectName, correctAnswers, creatorId, timeLimit, maxAttempts, description, difficulty]);
    return testCode;
}

async function getTest(testCode) {
    return await getQuery(`SELECT t.subject_name, t.correct_answers, t.creator_id, u.full_name, t.time_limit, t.max_attempts, t.description, t.difficulty_level
        FROM tests t JOIN users u ON t.creator_id = u.user_id 
        WHERE t.test_code = ? AND t.is_active = 1`, [testCode]);
}

async function checkUserAnswered(userId, testCode) {
    const result = await getQuery('SELECT COUNT(*) as count FROM test_results WHERE user_id = ? AND test_code = ?', [userId, testCode]);
    return result.count > 0;
}

async function getUserAttempts(userId, testCode) {
    const result = await getQuery('SELECT MAX(attempt_number) as attempts FROM test_results WHERE user_id = ? AND test_code = ?', [userId, testCode]);
    return result?.attempts || 0;
}

async function saveTestResult(userId, testCode, userAnswers, correctCount, totalQuestions, percentage, timeSpent = 0, attemptNumber = 1) {
    await runQuery(`INSERT INTO test_results 
        (user_id, test_code, user_answers, correct_count, total_questions, percentage, time_spent, attempt_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [userId, testCode, userAnswers, correctCount, totalQuestions, percentage, timeSpent, attemptNumber]);
}

async function getTestResults(testCode) {
    return await allQuery(`SELECT u.full_name, tr.correct_count, tr.percentage, u.user_id, tr.time_spent, tr.attempt_number
        FROM test_results tr JOIN users u ON tr.user_id = u.user_id
        WHERE tr.test_code = ? ORDER BY tr.correct_count DESC, tr.percentage DESC, tr.time_spent ASC`, [testCode]);
}

async function deactivateTest(testCode) {
    await runQuery('UPDATE tests SET is_active = 0 WHERE test_code = ?', [testCode]);
}

async function getUserStats(userId) {
    const createdTests = await getQuery('SELECT COUNT(*) as count FROM tests WHERE creator_id = ? AND is_active = 1', [userId]);
    const solvedTests = await getQuery('SELECT COUNT(*) as count FROM test_results WHERE user_id = ?', [userId]);
    const avgScore = await getQuery('SELECT AVG(percentage) as avg FROM test_results WHERE user_id = ?', [userId]);
    const bestScore = await getQuery('SELECT MAX(percentage) as max FROM test_results WHERE user_id = ?', [userId]);
    
    return {
        created: createdTests?.count || 0,
        solved: solvedTests?.count || 0,
        average: avgScore?.avg || 0,
        best: bestScore?.max || 0
    };
}

async function getBotStats() {
    const totalUsers = await getQuery('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
    const activeUsers = await getQuery("SELECT COUNT(*) as count FROM users WHERE last_activity > datetime('now', '-7 days')");
    const totalTests = await getQuery('SELECT COUNT(*) as count FROM tests WHERE is_active = 1');
    const totalSolved = await getQuery('SELECT COUNT(*) as count FROM test_results');
    
    return {
        totalUsers: totalUsers?.count || 0,
        activeUsers: activeUsers?.count || 0,
        totalTests: totalTests?.count || 0,
        totalSolved: totalSolved?.count || 0
    };
}

// Keyboards
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "🆕 Test yaratish", callback_data: "create_test" }],
            [{ text: "📝 Test yechish", callback_data: "solve_test" }],
            [{ text: "📊 Mening statistikam", callback_data: "my_statistics" }],
            [{ text: "🏆 Reytinglar", callback_data: "ratings" }],
            [{ text: "❓ Yordam", callback_data: "help" }],
            [{ text: "ℹ️ Bot haqida", callback_data: "about" }]
        ]
    };
}

function backToMainKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "🏠 Bosh menyu", callback_data: "main_menu" }]
        ]
    };
}

function testCreationKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "⚡ Oddiy test", callback_data: "create_simple" }],
            [{ text: "⏱️ Vaqtli test", callback_data: "create_timed" }],
            [{ text: "🔄 Takroriy test", callback_data: "create_multi" }],
            [{ text: "🏠 Bosh menyu", callback_data: "main_menu" }]
        ]
    };
}

function testManageKeyboard(testCode) {
    return {
        inline_keyboard: [
            [{ text: "📊 Test ma'lumotlari", callback_data: `test_info_${testCode}` }],
            [{ text: "📤 Testni ulashish", switch_inline_query: `test_${testCode}` }],
            [{ text: "📈 Batafsil hisobot", callback_data: `detailed_report_${testCode}` }],
            [{ text: "⚙️ Test sozlamalari", callback_data: `test_settings_${testCode}` }],
            [{ text: "🏁 Testni yakunlash", callback_data: `finish_test_${testCode}` }],
            [{ text: "🏠 Bosh menyu", callback_data: "main_menu" }]
        ]
    };
}

function difficultyKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "🟢 Oson", callback_data: "diff_easy" }],
            [{ text: "🟡 O'rtacha", callback_data: "diff_medium" }],
            [{ text: "🔴 Qiyin", callback_data: "diff_hard" }],
            [{ text: "🔙 Orqaga", callback_data: "create_test" }]
        ]
    };
}

function timeLimitKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "⏱️ 5 daqiqa", callback_data: "time_5" }, { text: "⏱️ 10 daqiqa", callback_data: "time_10" }],
            [{ text: "⏱️ 15 daqiqa", callback_data: "time_15" }, { text: "⏱️ 30 daqiqa", callback_data: "time_30" }],
            [{ text: "⏱️ 60 daqiqa", callback_data: "time_60" }, { text: "♾️ Cheksiz", callback_data: "time_0" }],
            [{ text: "🔙 Orqaga", callback_data: "create_test" }]
        ]
    };
}

function adminPanelKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "📊 Bot statistikasi", callback_data: "bot_stats" }],
            [{ text: "👥 Foydalanuvchilar", callback_data: "user_management" }],
            [{ text: "📝 Barcha testlar", callback_data: "all_tests" }],
            [{ text: "📢 E'lon yuborish", callback_data: "broadcast" }],
            [{ text: "🔧 Tizim sozlamalari", callback_data: "system_settings" }],
            [{ text: "🏠 Bosh menyu", callback_data: "main_menu" }]
        ]
    };
}

// Messages
const MESSAGES = {
    welcome: `🎉 <b>Assalomu alaykum va rahmat!</b>

Sizni <b>Professional Test Bot</b>ida ko'rishdan juda xursandmiz! 🤖✨

🌟 <b>Bu bot sizga quyidagilarni taklif etadi:</b>
📝 Turli xil online testlar yaratish
✅ Testlarni yechish va natijalarni olish  
📊 Batafsil statistika va tahlillar
🏆 Sertifikatlar va mukofotlar olish
⏱️ Vaqtli testlar va takroriy imtihonlar
📈 Shaxsiy reytinglar va yutuqlar

🚀 <b>Boshlashga tayyor bo'lsangiz, quyidagi tugmalardan birini tanlang!</b>

💡 <i>Maslahat: Birinchi marta ishlatayotgan bo'lsangiz, "Yordam" bo'limini o'qib chiqing!</i>`,

    nameRequest: `✍️ <b>Iltimos, to'liq ismingizni kiriting:</b>

📝 <b>Format:</b> <code>Ism Familiya</code>
📋 <b>Namuna:</b> <code>Ali Valiyev</code> yoki <code>Malika Karimova</code>

⚠️ <b>Muhim:</b> 
• Bu ism barcha sertifikatlarda ko'rsatiladi
• Faqat haqiqiy ismingizni kiriting
• Kamida 2 ta so'zdan iborat bo'lishi kerak

🔄 <i>Keyinchalik /ismozgartirish buyrug'i orqali o'zgartirishingiz mumkin</i>`,

    nameError: `❌ <b>Noto'g'ri format!</b>

🔍 <b>Xatolik sabablari:</b>
• Kamida 2 ta so'z (ism va familiya) bo'lishi kerak
• Faqat harflar ishlatilishi mumkin
• 50 belgidan oshmasligi kerak

📝 <b>To'g'ri format:</b> <code>Ism Familiya</code>

🔄 Iltimos, qayta urinib ko'ring!`,

    testCreateInstruction: `🆕 <b>Test yaratish bo'yicha qo'llanma</b>

📋 <b>Format:</b>
<code>Fan_nomi*javoblar*tavsif(ixtiyoriy)</code>

📝 <b>Misollar:</b>
<code>Matematika*abcdabcdabcd</code>
<code>Ingliz tili*abcabcabcabc*Grammar test</code>
<code>Fizika*dcdcdcdc*7-sinf uchun</code>

📚 <b>Qoidalar:</b>
• Javoblar faqat: a, b, c, d harflaridan
• Kamida 5 ta savol bo'lishi kerak
• Maksimal 50 ta savol
• Fan nomi 50 belgigacha
• Tavsif 100 belgigacha (ixtiyoriy)

💡 <b>Maslahat:</b> Savollar tartibini oldindan tayyorlab oling!`,

    testSolveInstruction: `📝 <b>Test yechish bo'yicha qo'llanma</b>

🔢 <b>Format:</b>
<code>Test_kodi*javoblaringiz</code>

📝 <b>Misollar:</b>
<code>12345*abcdabcdabcd</code>
<code>67890*abcabcabcabc</code>

📚 <b>Qoidalar:</b>
• Test kodini to'g'ri kiriting
• Javoblar soni savollar soniga mos bo'lishi kerak
• Faqat a, b, c, d harflarini ishlating
• Har bir savol uchun bitta javob

💡 <b>Maslahat:</b> Javob berishdan oldin barcha savollarni diqqat bilan o'qing!`,

    help: `❓ <b>Bot ishlatish qo'llanmasi</b>

🆕 <b>Test yaratish:</b>
1️⃣ "Test yaratish" tugmasini bosing
2️⃣ Test turini tanlang (oddiy, vaqtli, takroriy)
3️⃣ Fan nomi va javoblarni kiriting
4️⃣ Test kodini olib, boshqalar bilan ulashing
5️⃣ Natijalarni kuzatib boring

📝 <b>Test yechish:</b>
1️⃣ "Test yechish" tugmasini bosing
2️⃣ Test kodi va javoblaringizni kiriting
3️⃣ Natijangizni oling va sertifikatni yuklab oling

📊 <b>Statistika:</b>
• Yaratgan testlaringiz soni
• Yechgan testlar natijalari
• O'rtacha va eng yaxshi natijalar
• Vaqt sarfi statistikasi

🏆 <b>Sertifikatlar:</b>
• 40% va undan yuqori: Sertifikat beriladi
• 80%+: Oltin sertifikat
• 60-79%: Kumush sertifikat  
• 40-59%: Bronza sertifikat

⚙️ <b>Qo'shimcha imkoniyatlar:</b>
• Vaqtli testlar (5-60 daqiqa)
• Takroriy urinishlar
• Batafsil hisobotlar
• Natijalarni ulashish

❓ <b>Yordam kerakmi?</b> @td3300 bilan bog'laning`,

    about: `ℹ️ <b>Professional Test Bot haqida</b>

🤖 <b>Versiya:</b> 2.0 Pro
🚀 <b>Ishga tushirilgan:</b> 2025-yil
👨‍💻 <b>Ishlab chiqaruvchi:</b> @td3300

🌟 <b>Bot imkoniyatlari:</b>
✅ Cheksiz test yaratish
✅ Turli formatdagi testlar
✅ Vaqtli va takroriy testlar
✅ Professional sertifikatlar
✅ Batafsil statistika
✅ Natijalarni ulashish

📊 <b>Statistika:</b>
• Kunlik faol foydalanuvchilar: 1000+
• Yaratilgan testlar: 5000+
• Bajarilgan testlar: 25000+
• Berilgan sertifikatlar: 15000+

🛡️ <b>Xavfsizlik:</b>
Barcha ma'lumotlaringiz xavfsiz saqlanadi va uchinchi shaxslar bilan bo'lishilmaydi.

🤝 <b>Qo'llab-quvvatlash:</b>
24/7 texnik yordam: @td3300

💝 Botdan foydalanganingiz uchun rahmat!`
};

// Utility functions
function getCurrentTime() {
    const now = new Date();
    const time = now.toLocaleTimeString('uz-UZ');
    const date = now.toLocaleDateString('uz-UZ');
    return `⏰ ${time} | 📅 ${date}`;
}

function formatDuration(minutes) {
    if (minutes === 0) return "♾️ Cheksiz";
    if (minutes < 60) return `⏱️ ${minutes} daqiqa`;
    return `⏱️ ${Math.floor(minutes/60)} soat ${minutes%60} daqiqa`;
}

function getGradeInfo(percentage) {
    if (percentage >= 90) return { emoji: "🥇", text: "Ajoyib", level: 1, color: "🟡" };
    if (percentage >= 80) return { emoji: "🥈", text: "A'lo", level: 2, color: "🔵" };
    if (percentage >= 60) return { emoji: "🥉", text: "Yaxshi", level: 3, color: "🟢" };
    if (percentage >= 40) return { emoji: "🎗️", text: "Qoniqarli", level: 4, color: "🟠" };
    return { emoji: "📜", text: "Takror ishlang", level: 5, color: "🔴" };
}

// Message handlers
async function handleMessage(update) {
    const message = update.message;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    const username = message.from.username || '';
    const firstName = message.from.first_name || '';
    
    await updateUserActivity(userId);
    const [currentState, stateData] = await getUserState(userId);
    
    console.log(`Message from ${userId}: ${text}`);
    
    // Start command
    if (text.startsWith('/start')) {
        const userName = await getUser(userId);
        if (!userName) {
            await setUserState(userId, 'waiting_name');
            await sendMessage(chatId, MESSAGES.nameRequest, backToMainKeyboard());
        } else {
            const welcomeText = `${MESSAGES.welcome}

👤 <b>Xush kelibsiz:</b> ${userName}
🆔 <b>Sizning ID:</b> <code>${userId}</code>

${getCurrentTime()}`;
            await sendMessage(chatId, welcomeText, mainMenuKeyboard());
        }
        return;
    }
    
    // Name waiting state
    if (currentState === 'waiting_name') {
        const words = text.trim().split(/\s+/);
        if (words.length >= 2 && text.length <= 50 && words.every(word => /^[a-zA-ZÀ-ÿĀ-žА-я']+$/u.test(word))) {
            await addUser(userId, text, username);
            await setUserState(userId, null);
            
            const successText = `✅ <b>Tabriklaymiz!</b>

👤 <b>Ismingiz muvaffaqiyatli saqlandi:</b> ${text}
🎯 <b>Endi siz botning barcha imkoniyatlaridan foydalanishingiz mumkin!</b>

🚀 <b>Keyingi qadamlar:</b>
• Test yarating yoki mavjud testni yeching
• Statistikangizni kuzatib boring
• Sertifikatlar to'plang

${getCurrentTime()}`;
            
            await sendMessage(chatId, successText);
            
            setTimeout(async () => {
                const welcomeText = `${MESSAGES.welcome}

👤 <b>Sizning ismingiz:</b> ${text}

${getCurrentTime()}`;
                await sendMessage(chatId, welcomeText, mainMenuKeyboard());
            }, 2000);
        } else {
            await sendMessage(chatId, MESSAGES.nameError);
        }
        return;
    }
    
    // Test creation states
    if (currentState === 'creating_simple_test') {
        await handleTestCreation(chatId, userId, text, 'simple');
        return;
    }
    
    if (currentState === 'creating_timed_test') {
        await handleTestCreation(chatId, userId, text, 'timed', JSON.parse(stateData));
        return;
    }
    
    if (currentState === 'creating_multi_test') {
        await handleTestCreation(chatId, userId, text, 'multi', JSON.parse(stateData));
        return;
    }
    
    // Test solving state
    if (currentState === 'solving_test') {
        await handleTestSolving(chatId, userId, text);
        return;
    }
    
    // Admin commands
    if (text === '/panel' && userId === ADMIN_ID) {
        const stats = await getBotStats();
        const adminText = `👑 <b>ADMIN PANEL</b>

📊 <b>Umumiy statistika:</b>
👥 Jami foydalanuvchilar: ${stats.totalUsers}
🟢 Faol foydalanuvchilar: ${stats.activeUsers}
📝 Yaratilgan testlar: ${stats.totalTests}
✅ Bajarilgan testlar: ${stats.totalSolved}

⚡ <b>Tizim holati:</b> Barcha tizimlar ishlayapti
💾 <b>Ma'lumotlar bazasi:</b> Aloqa mavjud
🔄 <b>So'nggi yangilanish:</b> ${getCurrentTime()}

🔧 <b>Qo'shimcha boshqaruv uchun tugmalarni ishlating</b>`;
        
        await sendMessage(chatId, adminText, adminPanelKeyboard());
        return;
    }
    
    // Change name command
    if (text === '/ismozgartirish') {
        await setUserState(userId, 'waiting_name');
        await sendMessage(chatId, `${MESSAGES.nameRequest}

⚠️ <b>Diqqat:</b> Ism o'zgartirilgandan so'ng, barcha yangi sertifikatlar yangi ism bilan beriladi.`, backToMainKeyboard());
        return;
    }
    
    // Default response for unknown commands
    const userName = await getUser(userId);
    if (userName) {
        const helpText = `🤔 <b>Kechirasiz, buyruqni tushunmadim</b>

💡 <b>Foydali buyruqlar:</b>
/start - Botni qayta ishga tushirish
/ismozgartirish - Ismni o'zgartirish
/panel - Admin panel (faqat admin uchun)

📚 Quyidagi tugmalardan foydalaning:`;
        
        await sendMessage(chatId, helpText, mainMenuKeyboard());
    } else {
        await setUserState(userId, 'waiting_name');
        await sendMessage(chatId, MESSAGES.nameRequest, backToMainKeyboard());
    }
}

// Test creation handler
async function handleTestCreation(chatId, userId, text, type, additionalData = {}) {
    try {
        const parts = text.split('*');
        if (parts.length < 2) {
            throw new Error("Format xato");
        }
        
        let subjectName = parts[0].trim();
        let answers = parts[1].trim().toLowerCase();
        let description = parts[2] ? parts[2].trim() : '';
        
        // Validation
        if (!subjectName || subjectName.length > 50) {
            await sendMessage(chatId, "❌ Fan nomi 1-50 belgi orasida bo'lishi kerak!");
            return;
        }
        
        if (!/^[abcd]+$/.test(answers)) {
            await sendMessage(chatId, "❌ Javoblar faqat a, b, c, d harflaridan iborat bo'lishi kerak!");
            return;
        }
        
        if (answers.length < 5 || answers.length > 50) {
            await sendMessage(chatId, "❌ Test 5-50 ta savol orasida bo'lishi kerak!");
            return;
        }
        
        if (description.length > 100) {
            await sendMessage(chatId, "❌ Tavsif 100 belgidan oshmasligi kerak!");
            return;
        }
        
        // Create test based on type
        let timeLimit = 0;
        let maxAttempts = 1;
        let difficulty = 'Oson';
        
        if (type === 'timed') {
            timeLimit = additionalData.timeLimit || 0;
            difficulty = additionalData.difficulty || 'Oson';
        } else if (type === 'multi') {
            maxAttempts = additionalData.maxAttempts || 3;
            difficulty = additionalData.difficulty || 'Oson';
        }
        
        const testCode = await createTest(subjectName, answers, userId, timeLimit, maxAttempts, description, difficulty);
        await setUserState(userId, null);
        
        const testTypeText = type === 'timed' ? '⏱️ Vaqtli' : type === 'multi' ? '🔄 Takroriy' : '📝 Oddiy';
        
        const successText = `✅ <b>Test muvaffaqiyatli yaratildi!</b>

📚 <b>Fan:</b> ${subjectName}
🔢 <b>Test kodi:</b> <code>${testCode}</code>
📊 <b>Savollar soni:</b> ${answers.length} ta
🎯 <b>Test turi:</b> ${testTypeText}
${timeLimit > 0 ? `⏱️ <b>Vaqt chegarasi:</b> ${formatDuration(timeLimit)}\n` : ''}
${maxAttempts > 1 ? `🔄 <b>Maksimal urinishlar:</b> ${maxAttempts} ta\n` : ''}
📈 <b>Qiyinlik darajasi:</b> ${difficulty}
${description ? `📝 <b>Tavsif:</b> ${description}\n` : ''}

🚀 <b>Test tayyor!</b> Kodni boshqalar bilan ulashing.
📤 <b>Ulashish:</b> Inline tugmasini bosing yoki kodni nusxalang

${getCurrentTime()}`;
        
        await sendMessage(chatId, successText, testManageKeyboard(testCode));
        
        // Send test statistics to creator
        setTimeout(async () => {
            const statsText = `📊 <b>Test statistikasi:</b>

🆔 Test ID: <code>${testCode}</code>
📈 Hozircha hech kim ishlamagan
⏰ Yaratilgan vaqt: ${getCurrentTime()}

💡 <b>Maslahat:</b> Testni ulashish uchun inline tugmasini yoki @${BOT_USERNAME} test_${testCode} formatini ishlating!`;
            
            await sendMessage(chatId, statsText, backToMainKeyboard());
        }, 3000);
        
    } catch (error) {
        let errorMessage = `❌ <b>Xatolik yuz berdi!</b>\n\n`;
        
        if (type === 'simple') {
            errorMessage += MESSAGES.testCreateInstruction;
        } else {
            errorMessage += `📋 <b>To'g'ri format:</b>\n<code>Fan_nomi*javoblar*tavsif</code>\n\n`;
            errorMessage += `📝 <b>Misol:</b>\n<code>Matematika*abcdabcd*8-sinf uchun</code>`;
        }
        
        await sendMessage(chatId, errorMessage);
    }
}

// Test solving handler
async function handleTestSolving(chatId, userId, text) {
    try {
        const parts = text.split('*');
        if (parts.length !== 2) {
            throw new Error("Format xato");
        }
        
        const testCode = parts[0].trim();
        const userAnswers = parts[1].trim().toLowerCase();
        
        // Get test data
        const testData = await getTest(testCode);
        if (!testData) {
            await sendMessage(chatId, `❌ <b>Test topilmadi!</b>

🔍 <b>Mumkin bo'lgan sabablar:</b>
• Test kodi noto'g'ri: <code>${testCode}</code>
• Test yakunlangan yoki o'chirilgan
• Test hali yaratilmagan

💡 <b>Test kodini qayta tekshirib ko'ring!</b>`);
            return;
        }
        
        const { subject_name, correct_answers, creator_id, full_name: creatorName, time_limit, max_attempts, description, difficulty_level } = testData;
        
        // Check answers length
        if (userAnswers.length !== correct_answers.length) {
            await sendMessage(chatId, `❌ <b>Javoblar soni noto'g'ri!</b>

📊 <b>Kerakli javoblar:</b> ${correct_answers.length} ta
📝 <b>Sizning javoblaringiz:</b> ${userAnswers.length} ta

🔄 <b>To'g'ri format:</b> <code>${testCode}*${'a'.repeat(correct_answers.length)}</code>`);
            return;
        }
        
        // Validate answers
        if (!/^[abcd]+$/.test(userAnswers)) {
            await sendMessage(chatId, "❌ Javoblar faqat a, b, c, d harflaridan iborat bo'lishi kerak!");
            return;
        }
        
        // Check attempts
        const currentAttempts = await getUserAttempts(userId, testCode);
        if (currentAttempts >= max_attempts) {
            await sendMessage(chatId, `⛔ <b>Urinishlar tugadi!</b>

🔄 <b>Siz bu testni ${max_attempts} marta ishlagansiz</b>
❌ Boshqa urinishlar qolmadi

📊 Natijalaringizni statistikada ko'rishingiz mumkin.`);
            return;
        }
        
        // Check and calculate results
        let correctCount = 0;
        const detailedResults = [];
        
        for (let i = 0; i < correct_answers.length; i++) {
            const isCorrect = userAnswers[i] === correct_answers[i];
            if (isCorrect) correctCount++;
            
            detailedResults.push({
                questionNo: i + 1,
                userAnswer: userAnswers[i].toUpperCase(),
                correctAnswer: correct_answers[i].toUpperCase(),
                isCorrect: isCorrect
            });
        }
        
        const totalQuestions = correct_answers.length;
        const percentage = (correctCount / totalQuestions) * 100;
        const attemptNumber = currentAttempts + 1;
        
        // Save result
        await saveTestResult(userId, testCode, userAnswers, correctCount, totalQuestions, percentage, 0, attemptNumber);
        await setUserState(userId, null);
        
        // Get grade info
        const gradeInfo = getGradeInfo(percentage);
        const userName = await getUser(userId);
        
        // Create detailed results text
        const detailedText = detailedResults.slice(0, 10).map(result => 
            `${result.questionNo}. ${result.isCorrect ? '✅' : '❌'} ${result.userAnswer} ${!result.isCorrect ? `(to'g'ri: ${result.correctAnswer})` : ''}`
        ).join('\n');
        
        // Main result message
        const resultText = `🎯 <b>TEST NATIJALARI</b>

📚 <b>Fan:</b> ${subject_name}
👨‍🏫 <b>Muallif:</b> <a href="tg://user?id=${creator_id}">${creatorName}</a>
🔢 <b>Test kodi:</b> <code>${testCode}</code>
📈 <b>Qiyinlik:</b> ${difficulty_level}
${description ? `📝 <b>Tavsif:</b> ${description}\n` : ''}

👤 <b>Ishtirokchi:</b> ${userName}
✅ <b>To'g'ri javoblar:</b> ${correctCount}/${totalQuestions}
📊 <b>Natija:</b> ${percentage.toFixed(1)}% ${gradeInfo.emoji}
🏆 <b>Baho:</b> ${gradeInfo.text} ${gradeInfo.color}
${attemptNumber > 1 ? `🔄 <b>Urinish:</b> ${attemptNumber}/${max_attempts}\n` : ''}

📝 <b>Batafsil natijalar:</b>
${detailedText}
${detailedResults.length > 10 ? `... va yana ${detailedResults.length - 10} ta savol` : ''}

⏰ <b>Bajarilgan vaqt:</b> ${getCurrentTime()}

🎊 <b>Tabriklaymiz!</b> Sizning natijangiz saqlandi.`;

        await sendMessage(chatId, resultText, backToMainKeyboard());
        
        // Send certificate if passed
        if (percentage >= 40) {
            const userName_encoded = encodeURIComponent(userName);
            const subject_encoded = encodeURIComponent(subject_name);
            const creator_encoded = encodeURIComponent(creatorName);
            const score_text = `${correctCount} ta (${percentage.toFixed(0)}%)`;
            
            const certificateUrl = `https://ollashukur.uz/image.php?ism=${userName_encoded}&fan=${subject_encoded}&admin=${creator_encoded}&soni=${encodeURIComponent(score_text)}&orin=${gradeInfo.level}`;
            
            const certificateText = `🏆 <b>TABRIKLAYMIZ!</b>

${userName}, sizga <b>"${subject_name}"</b> fanidan ${gradeInfo.text.toLowerCase()} darajadagi sertifikat taqdim etiladi!

${gradeInfo.emoji} <b>Sizning natijangiz:</b> ${percentage.toFixed(1)}%
🏅 <b>Daraja:</b> ${gradeInfo.text}

💫 <b>Bu sertifikatni ijtimoiy tarmoqlarda ulashishingiz mumkin!</b>

📱 <b>Sertifikatni yuklash:</b> Rasmni bosib saqlang`;
            
            setTimeout(async () => {
                await sendPhoto(chatId, certificateUrl, certificateText, backToMainKeyboard());
            }, 2000);
        } else {
            // Encouragement message for low scores
            setTimeout(async () => {
                const encourageText = `💪 <b>Taslim bo'lmang!</b>

📚 <b>Maslahat:</b>
• Mavzuni qayta takrorlang
• Boshqa manbalardan foydalaning
${max_attempts > attemptNumber ? `• Yana ${max_attempts - attemptNumber} marta urinish imkoniyatingiz bor` : ''}

🌟 <b>Esda tuting:</b> Har bir xato - yangi bilim!
🎯 <b>Maqsad:</b> Kamida 40% olish`;
                
                await sendMessage(chatId, encourageText, backToMainKeyboard());
            }, 3000);
        }
        
        // Notify creator
        const notifyText = `📊 <b>TEST NATIJASI</b>

📚 <b>Fan:</b> ${subject_name}
🔢 <b>Test kodi:</b> <code>${testCode}</code>

👤 <b>Ishtirokchi:</b> <a href="tg://user?id=${userId}">${userName}</a>
✅ <b>Natija:</b> ${correctCount}/${totalQuestions} (${percentage.toFixed(1)}%) ${gradeInfo.emoji}
${attemptNumber > 1 ? `🔄 <b>Urinish:</b> ${attemptNumber}/${max_attempts}\n` : ''}

⏰ ${getCurrentTime()}`;
        
        setTimeout(async () => {
            await sendMessage(creator_id, notifyText, testManageKeyboard(testCode));
        }, 1000);
        
    } catch (error) {
        await sendMessage(chatId, `❌ <b>Xatolik!</b>

${MESSAGES.testSolveInstruction}

💡 <b>Qo'shimcha yordam:</b>
• Test kodini to'g'ri nusxalaganingizni tekshiring
• Javoblar sonini tekshiring
• Faqat a, b, c, d harflarini ishlating`);
    }
}

// Callback query handler
async function handleCallbackQuery(update) {
    const callbackQuery = update.callback_query;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const queryId = callbackQuery.id;
    
    await updateUserActivity(userId);
    console.log(`Callback from ${userId}: ${data}`);
    
    // Main menu callbacks
    if (data === 'create_test') {
        const instructionText = `🆕 <b>Test yaratish</b>

🎯 <b>Qanday turdagi test yaratmoqchisiz?</b>

📝 <b>Oddiy test</b> - Vaqt chegarasisiz, bir marotaba
⏱️ <b>Vaqtli test</b> - Belgilangan vaqt ichida
🔄 <b>Takroriy test</b> - Bir necha marta urinish imkoniyati

💡 <b>Maslahat:</b> Birinchi marta test yaratayotgan bo'lsangiz, oddiy testni tanlang.

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, instructionText, testCreationKeyboard());
        await answerCallbackQuery(queryId, "🆕 Test yaratish rejimi");
        return;
    }
    
    if (data === 'solve_test') {
        await setUserState(userId, 'solving_test');
        const solveText = `${MESSAGES.testSolveInstruction}

💡 <b>Maslahatlar:</b>
• Test kodini aniq nusxalang
• Barcha savolarga javob bering
• Javoblaringizni tekshirib ko'ring

🎯 <b>Muvaffaqiyat uchun:</b>
• Diqqat bilan o'qing
• Vaqtingizni to'g'ri taqsimlang
• Ishonchingiz komil bo'lmagan savollarni oxirida qarab chiqing

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, solveText, backToMainKeyboard());
        await answerCallbackQuery(queryId, "📝 Test yechish rejimi");
        return;
    }
    
    if (data === 'my_statistics') {
        const stats = await getUserStats(userId);
        const userName = await getUser(userId);
        
        const statsText = `📊 <b>${userName}ning statistikasi</b>

🆕 <b>Yaratgan testlar:</b> ${stats.created} ta
📝 <b>Yechgan testlar:</b> ${stats.solved} ta
📈 <b>O'rtacha natija:</b> ${stats.average.toFixed(1)}%
🏆 <b>Eng yaxshi natija:</b> ${stats.best.toFixed(1)}%

📈 <b>Daraja:</b> ${stats.solved < 5 ? 'Yangi boshlovchi' : 
                      stats.solved < 15 ? 'Faol foydalanuvchi' :
                      stats.solved < 50 ? 'Tajribali' : 'Ekspert'} ⭐

🎯 <b>Keyingi maqsadlar:</b>
${stats.solved < 10 ? '• 10 ta test yeching' : ''}
${stats.average < 70 ? '• O\'rtacha natijani 70% ga yetkazing' : ''}
${stats.created < 5 ? '• 5 ta test yarating' : ''}

📅 <b>Faollik:</b> ${getCurrentTime()}

💪 Davom eting va yangi yutuqlarga erishing!`;
        
        await editMessageText(chatId, messageId, statsText, backToMainKeyboard());
        await answerCallbackQuery(queryId, "📊 Sizning statistikangiz");
        return;
    }
    
    if (data === 'ratings') {
        // Get top performers
        const topPerformers = await allQuery(`
            SELECT u.full_name, u.user_id, AVG(tr.percentage) as avg_score, COUNT(tr.result_id) as test_count
            FROM test_results tr 
            JOIN users u ON tr.user_id = u.user_id
            GROUP BY u.user_id 
            HAVING test_count >= 3
            ORDER BY avg_score DESC, test_count DESC 
            LIMIT 10
        `);
        
        let ratingText = `🏆 <b>TOP REYTING</b>\n\n`;
        
        if (topPerformers.length > 0) {
            topPerformers.forEach((performer, index) => {
                const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                ratingText += `${emoji} <a href="tg://user?id=${performer.user_id}">${performer.full_name}</a>\n`;
                ratingText += `   📊 ${performer.avg_score.toFixed(1)}% (${performer.test_count} ta test)\n\n`;
            });
        } else {
            ratingText += `😔 <b>Hali reytingda hech kim yo'q</b>\n\n`;
            ratingText += `🎯 Reytingga kirish uchun:\n`;
            ratingText += `• Kamida 3 ta test yeching\n`;
            ratingText += `• Yaxshi natijalar oling\n`;
        }
        
        ratingText += `\n💡 <b>Eslatma:</b> Reytingda faqat 3+ test yechgan foydalanuvchilar ko'rsatiladi\n\n${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, ratingText, backToMainKeyboard());
        await answerCallbackQuery(queryId, "🏆 Top reyting");
        return;
    }
    
    if (data === 'help') {
        await editMessageText(chatId, messageId, MESSAGES.help, backToMainKeyboard());
        await answerCallbackQuery(queryId, "❓ Yordam ma'lumotlari");
        return;
    }
    
    if (data === 'about') {
        await editMessageText(chatId, messageId, MESSAGES.about, backToMainKeyboard());
        await answerCallbackQuery(queryId, "ℹ️ Bot haqida ma'lumot");
        return;
    }
    
    // Test creation callbacks
    if (data === 'create_simple') {
        await setUserState(userId, 'creating_simple_test');
        const simpleText = `📝 <b>Oddiy test yaratish</b>

${MESSAGES.testCreateInstruction}

🎯 <b>Oddiy test xususiyatlari:</b>
• ♾️ Vaqt chegarasi yo'q
• 🔄 Faqat bir marta urinish
• 📊 Darhol natija ko'rsatiladi

💡 <b>Maslahat:</b> Test savollarini oldindan tayyorlab oling!

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, simpleText, backToMainKeyboard());
        await answerCallbackQuery(queryId, "📝 Oddiy test yaratish");
        return;
    }
    
    if (data === 'create_timed') {
        const timedText = `⏱️ <b>Vaqtli test yaratish</b>

Birinchi vaqt chegarasini tanlang:

⚡ <b>Qisqa testlar:</b> 5-15 daqiqa
⏰ <b>O'rtacha testlar:</b> 30 daqiqa  
🕐 <b>Uzoq testlar:</b> 60 daqiqa
♾️ <b>Cheksiz:</b> Vaqt chegarasisiz

💡 <b>Tavsiya:</b>
• Har bir savol uchun 1-2 daqiqa hisoblang
• Qiyinlik darajasini hisobga oling

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, timedText, timeLimitKeyboard());
        await answerCallbackQuery(queryId, "⏱️ Vaqtli test parametrlari");
        return;
    }
    
    if (data === 'create_multi') {
        const multiText = `🔄 <b>Takroriy test yaratish</b>

Maksimal urinishlar sonini tanlang:

🔢 <b>Urinishlar:</b>
• 2 marta - O'rtacha qiyinlik
• 3 marta - Oson (tavsiya etiladi)
• 5 marta - Juda oson

💡 <b>Maslahat:</b>
• Ko'proq urinish = yuqori o'zlashtirish
• Har bir urinishdan keyin batafsil natija ko'rsatiladi

${getCurrentTime()}`;
        
        const multiKeyboard = {
            inline_keyboard: [
                [{ text: "2️⃣ 2 urinish", callback_data: "attempts_2" }, { text: "3️⃣ 3 urinish", callback_data: "attempts_3" }],
                [{ text: "5️⃣ 5 urinish", callback_data: "attempts_5" }, { text: "🔟 10 urinish", callback_data: "attempts_10" }],
                [{ text: "🔙 Orqaga", callback_data: "create_test" }]
            ]
        };
        
        await editMessageText(chatId, messageId, multiText, multiKeyboard);
        await answerCallbackQuery(queryId, "🔄 Takroriy test parametrlari");
        return;
    }
    
    // Time limit selections
    if (data.startsWith('time_')) {
        const timeLimit = parseInt(data.split('_')[1]);
        await setUserState(userId, 'creating_timed_test', JSON.stringify({ timeLimit }));
        
        const timeText = `⏱️ <b>Vaqtli test yaratish</b>
        
⏰ <b>Tanlangan vaqt:</b> ${formatDuration(timeLimit)}

Endi test ma'lumotlarini kiriting:

${MESSAGES.testCreateInstruction}

💡 <b>Eslatma:</b> Test boshlangandan so'ng ${formatDuration(timeLimit)} vaqt beriladi.

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, timeText, backToMainKeyboard());
        await answerCallbackQuery(queryId, `⏱️ ${formatDuration(timeLimit)} tanlandi`);
        return;
    }
    
    // Attempts selections
    if (data.startsWith('attempts_')) {
        const maxAttempts = parseInt(data.split('_')[1]);
        await setUserState(userId, 'creating_multi_test', JSON.stringify({ maxAttempts }));
        
        const attemptsText = `🔄 <b>Takroriy test yaratish</b>
        
🔢 <b>Maksimal urinishlar:</b> ${maxAttempts} marta

Endi test ma'lumotlarini kiriting:

${MESSAGES.testCreateInstruction}

💡 <b>Eslatma:</b> Har bir ishtirokchi ${maxAttempts} marta urinishi mumkin.

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, attemptsText, backToMainKeyboard());
        await answerCallbackQuery(queryId, `🔢 ${maxAttempts} urinish tanlandi`);
        return;
    }
    
    // Main menu
    if (data === 'main_menu') {
        await setUserState(userId, null);
        const userName = await getUser(userId);
        const welcomeText = `${MESSAGES.welcome}

👤 <b>Sizning ismingiz:</b> ${userName}

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, welcomeText, mainMenuKeyboard());
        await answerCallbackQuery(queryId, "🏠 Bosh menyu");
        return;
    }
    
    // Test info
    if (data.startsWith('test_info_')) {
        const testCode = data.split('_')[2];
        const testResults = await getTestResults(testCode);
        const testData = await getTest(testCode);
        
        if (testData) {
            const { subject_name, correct_answers, creator_id, full_name: creatorName, time_limit, max_attempts, description, difficulty_level } = testData;
            const totalQuestions = correct_answers.length;
            const participants = testResults.length;
            
            // Calculate statistics
            let totalScore = 0;
            let passedCount = 0;
            testResults.forEach(result => {
                totalScore += result.percentage;
                if (result.percentage >= 40) passedCount++;
            });
            
            const avgScore = participants > 0 ? (totalScore / participants).toFixed(1) : 0;
            const passRate = participants > 0 ? ((passedCount / participants) * 100).toFixed(1) : 0;
            
            // Top results
            const topResults = testResults.slice(0, 10).map((result, index) => {
                const gradeInfo = getGradeInfo(result.percentage);
                return `${index + 1}. <a href='tg://user?id=${result.user_id}'>${result.full_name}</a> - ${result.correct_count}/${totalQuestions} (${result.percentage.toFixed(1)}%) ${gradeInfo.emoji}`;
            }).join('\n');
            
            const infoText = `📊 <b>TEST MA'LUMOTLARI</b>

📚 <b>Fan:</b> ${subject_name}
🔢 <b>Test kodi:</b> <code>${testCode}</code>
❓ <b>Savollar soni:</b> ${totalQuestions} ta
📈 <b>Qiyinlik:</b> ${difficulty_level}
${description ? `📝 <b>Tavsif:</b> ${description}\n` : ''}
${time_limit > 0 ? `⏱️ <b>Vaqt chegarasi:</b> ${formatDuration(time_limit)}\n` : ''}
${max_attempts > 1 ? `🔄 <b>Urinishlar:</b> ${max_attempts} marta\n` : ''}

📈 <b>STATISTIKA:</b>
👥 <b>Ishtirokchilar:</b> ${participants} ta
📊 <b>O'rtacha natija:</b> ${avgScore}%
✅ <b>Muvaffaqiyat ko'rsatkichi:</b> ${passRate}%

🏆 <b>TOP NATIJALAR:</b>
${topResults || "Hali hech kim ishlamagan"}

⏰ <b>So'nggi yangilanish:</b> ${getCurrentTime()}`;
            
            await editMessageText(chatId, messageId, infoText, testManageKeyboard(testCode));
            await answerCallbackQuery(queryId, "📊 Test statistikasi");
        } else {
            await answerCallbackQuery(queryId, "❌ Test ma'lumotlari topilmadi!", true);
        }
        return;
    }
    
    // Detailed report
    if (data.startsWith('detailed_report_')) {
        const testCode = data.split('_')[2];
        const testResults = await getTestResults(testCode);
        const testData = await getTest(testCode);
        
        if (testData) {
            const { subject_name } = testData;
            
            // Generate detailed analytics
            const analytics = {
                excellent: testResults.filter(r => r.percentage >= 90).length,
                good: testResults.filter(r => r.percentage >= 80 && r.percentage < 90).length,
                satisfactory: testResults.filter(r => r.percentage >= 60 && r.percentage < 80).length,
                weak: testResults.filter(r => r.percentage >= 40 && r.percentage < 60).length,
                failed: testResults.filter(r => r.percentage < 40).length
            };
            
            const reportText = `📈 <b>BATAFSIL HISOBOT</b>

📚 <b>Test:</b> ${subject_name}
🔢 <b>Kod:</b> <code>${testCode}</code>

📊 <b>NATIJALAR TAQSIMOTI:</b>
🥇 A'lo (90-100%): ${analytics.excellent} ta
🥈 Yaxshi (80-89%): ${analytics.good} ta
🥉 Qoniqarli (60-79%): ${analytics.satisfactory} ta
🎗️ Zaif (40-59%): ${analytics.weak} ta
❌ Muvaffaqiyatsiz (<40%): ${analytics.failed} ta

📈 <b>TAHLIL:</b>
• Umumiy ishtirokchilar: ${testResults.length} ta
• Muvaffaqiyat darajasi: ${((testResults.length - analytics.failed) / testResults.length * 100 || 0).toFixed(1)}%
• Eng yuqori natija: ${testResults.length > 0 ? testResults[0].percentage.toFixed(1) : 0}%

💡 <b>TAVSIYALAR:</b>
${analytics.failed > testResults.length * 0.5 ? '• Test juda qiyin bo\'lishi mumkin\n• Savollarni qayta ko\'rib chiqing' : ''}
${analytics.excellent > testResults.length * 0.8 ? '• Test juda oson bo\'lishi mumkin\n• Qiyinroq savollar qo\'shing' : ''}

${getCurrentTime()}`;
            
            await editMessageText(chatId, messageId, reportText, testManageKeyboard(testCode));
            await answerCallbackQuery(queryId, "📈 Batafsil hisobot");
        }
        return;
    }
    
    // Test settings
    if (data.startsWith('test_settings_')) {
        const testCode = data.split('_')[2];
        const testData = await getTest(testCode);
        
        if (testData && testData.creator_id === userId) {
            const settingsText = `⚙️ <b>TEST SOZLAMALARI</b>

🔢 <b>Test kodi:</b> <code>${testCode}</code>
📚 <b>Fan:</b> ${testData.subject_name}

🛠️ <b>Mavjud sozlamalar:</b>
• Test nomini o'zgartirish
• Tavsifni tahrirlash
• Testni nusxalash
• Testni eksport qilish

⚠️ <b>Xavfli amallar:</b>
• Testni o'chirish
• Barcha natijalarni tozalash

💡 Bu bo'lim hozirda ishlab chiqilmoqda...

${getCurrentTime()}`;
            
            await editMessageText(chatId, messageId, settingsText, testManageKeyboard(testCode));
            await answerCallbackQuery(queryId, "⚙️ Test sozlamalari");
        } else {
            await answerCallbackQuery(queryId, "❌ Ruxsat yo'q yoki test topilmadi!", true);
        }
        return;
    }
    
    // Finish test
    if (data.startsWith('finish_test_')) {
        const testCode = data.split('_')[2];
        const testData = await getTest(testCode);
        
        if (testData && testData.creator_id === userId) {
            const testResults = await getTestResults(testCode);
            
            if (testResults.length === 0) {
                await answerCallbackQuery(queryId, "❌ Hali hech kim test ishlamagan!", true);
                return;
            }
            
            // Deactivate test
            await deactivateTest(testCode);
            
            // Send final certificates and notifications
            let sentCount = 0;
            for (const result of testResults) {
                try {
                    const gradeInfo = getGradeInfo(result.percentage);
                    
                    if (result.percentage >= 40) {
                        const userName_encoded = encodeURIComponent(result.full_name);
                        const subject_encoded = encodeURIComponent(testData.subject_name);
                        const creator_encoded = encodeURIComponent(testData.full_name);
                        const score_text = `${result.correct_count} ta (${result.percentage.toFixed(0)}%)`;
                        
                        const certificateUrl = `https://ollashukur.uz/image.php?ism=${userName_encoded}&fan=${subject_encoded}&admin=${creator_encoded}&soni=${encodeURIComponent(score_text)}&orin=${gradeInfo.level}`;
                        
                        const finalText = `🏁 <b>TEST YAKUNLANDI!</b>

📚 <b>Fan:</b> ${testData.subject_name}
👨‍🏫 <b>Muallif:</b> ${testData.full_name}
🔢 <b>Test kodi:</b> <code>${testCode}</code>

🎯 <b>SIZNING YAKUNIY NATIJANGIZ:</b>
✅ To'g'ri javoblar: ${result.correct_count}/${testData.correct_answers.length}
📊 Foiz ko'rsatkichi: ${result.percentage.toFixed(1)}%
🏆 Daraja: ${gradeInfo.text} ${gradeInfo.emoji}

🎓 <b>YAKUNIY SERTIFIKATINGIZ</b>

Tabriklaymiz! Siz testni muvaffaqiyatli yakunladingiz.
O'qish va ishlaringizda omad tilaymiz! 🌟

⏰ ${getCurrentTime()}`;
                        
                        await sendPhoto(result.user_id, certificateUrl, finalText, backToMainKeyboard());
                    } else {
                        const encourageText = `🏁 <b>TEST YAKUNLANDI!</b>

📚 <b>Fan:</b> ${testData.subject_name}
👨‍🏫 <b>Muallif:</b> ${testData.full_name}

📊 <b>Sizning natijangiz:</b> ${result.percentage.toFixed(1)}%

💪 <b>Taslim bo'lmang!</b>
Bu faqat birinchi qadam. Davom eting va muvaffaqiyat sizning bo'ladi!

📚 <b>Keyingi qadamlar:</b>
• Mavzuni qayta o'rganing
• Boshqa testlarni ishlang
• Amaliyot qiling

🌟 <b>Esda tuting:</b> Har bir xato - yangi imkoniyat!

${getCurrentTime()}`;
                        
                        await sendMessage(result.user_id, encourageText, backToMainKeyboard());
                    }
                    sentCount++;
                } catch (error) {
                    console.error(`Error sending certificate: ${error}`);
                }
            }
            
            // Creator notification
            const finishText = `✅ <b>TEST MUVAFFAQIYATLI YAKUNLANDI!</b>

📚 <b>Fan:</b> ${testData.subject_name}
🔢 <b>Test kodi:</b> <code>${testCode}</code>
👥 <b>Jami ishtirokchilar:</b> ${testResults.length} ta
📤 <b>Xabar yuborildi:</b> ${sentCount} ta

🏆 <b>YAKUNIY TOP NATIJALAR:</b>
${testResults.slice(0, 5).map((result, index) => {
    const gradeInfo = getGradeInfo(result.percentage);
    return `${index + 1}. <a href='tg://user?id=${result.user_id}'>${result.full_name}</a> - ${result.percentage.toFixed(1)}% ${gradeInfo.emoji}`;
}).join('\n')}

${testResults.length > 5 ? `\n... va yana ${testResults.length - 5} ta ishtirokchi\n` : ''}

🎊 <b>Rahmat!</b> Sizning testingiz ${testResults.length} ta odamga foyda keltirdi.
✨ Barcha ishtirokchilarga muvaffaqiyat tilaymiz!

⏰ ${getCurrentTime()}`;
            
            await editMessageText(chatId, messageId, finishText, backToMainKeyboard());
            await answerCallbackQuery(queryId, "✅ Test muvaffaqiyatli yakunlandi!");
        } else {
            await answerCallbackQuery(queryId, "❌ Ruxsat yo'q yoki test topilmadi!", true);
        }
        return;
    }
    
    // Admin panel callbacks
    if (data === 'bot_stats' && userId === ADMIN_ID) {
        const stats = await getBotStats();
        const recentActivity = await allQuery(`
            SELECT DATE(completed_date) as date, COUNT(*) as count 
            FROM test_results 
            WHERE completed_date >= datetime('now', '-7 days')
            GROUP BY DATE(completed_date) 
            ORDER BY date DESC
        `);
        
        const activityText = recentActivity.map(activity => 
            `📅 ${activity.date}: ${activity.count} ta test`
        ).join('\n') || "Ma'lumot yo'q";
        
        const adminStatsText = `📊 <b>ADMIN STATISTIKA</b>

👥 <b>FOYDALANUVCHILAR:</b>
• Jami: ${stats.totalUsers} ta
• Faol (7 kun): ${stats.activeUsers} ta
• Faollik: ${((stats.activeUsers/stats.totalUsers)*100 || 0).toFixed(1)}%

📝 <b>TESTLAR:</b>
• Yaratilgan: ${stats.totalTests} ta
• Bajarilgan: ${stats.totalSolved} ta
• O'rtacha: ${(stats.totalSolved/stats.totalTests || 0).toFixed(1)} marta

📈 <b>OXIRGI 7 KUN FAOLIYATI:</b>
${activityText}

💾 <b>TIZIM:</b>
• Ma'lumotlar bazasi: ✅ Faol
• Bot holati: ✅ Ishlayapti
• So'nggi yangilanish: ${getCurrentTime()}

🔄 Ma'lumotlar har daqiqada yangilanadi`;
        
        await editMessageText(chatId, messageId, adminStatsText, adminPanelKeyboard());
        await answerCallbackQuery(queryId, "📊 Bot statistikasi");
        return;
    }
    
    if (data === 'user_management' && userId === ADMIN_ID) {
        const recentUsers = await allQuery(`
            SELECT user_id, full_name, username, registration_date, last_activity
            FROM users 
            ORDER BY registration_date DESC 
            LIMIT 10
        `);
        
        let usersText = `👥 <b>FOYDALANUVCHILAR BOSHQARUVI</b>

📋 <b>OXIRGI 10 TA RO'YXATDAN O'TGAN:</b>\n`;
        
        recentUsers.forEach((user, index) => {
            const regDate = new Date(user.registration_date).toLocaleDateString('uz-UZ');
            const lastActivity = new Date(user.last_activity).toLocaleDateString('uz-UZ');
            usersText += `${index + 1}. <a href='tg://user?id=${user.user_id}'>${user.full_name}</a>\n`;
            usersText += `   📅 ${regDate} | 🕐 ${lastActivity}\n\n`;
        });
        
        usersText += `\n⚡ <b>Tez harakatlar:</b>
• /broadcast - Umumiy xabar
• /user_stats - Foydalanuvchi statistikasi
• /export_users - Foydalanuvchilarni eksport

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, usersText, adminPanelKeyboard());
        await answerCallbackQuery(queryId, "👥 Foydalanuvchilar");
        return;
    }
    
    if (data === 'all_tests' && userId === ADMIN_ID) {
        const recentTests = await allQuery(`
            SELECT t.test_code, t.subject_name, u.full_name as creator, t.created_date,
                   COUNT(tr.result_id) as participants
            FROM tests t
            LEFT JOIN users u ON t.creator_id = u.user_id
            LEFT JOIN test_results tr ON t.test_code = tr.test_code
            WHERE t.is_active = 1
            GROUP BY t.test_id
            ORDER BY t.created_date DESC
            LIMIT 10
        `);
        
        let testsText = `📝 <b>BARCHA TESTLAR</b>

📋 <b>OXIRGI 10 TA YARATILGAN:</b>\n`;
        
        recentTests.forEach((test, index) => {
            const createDate = new Date(test.created_date).toLocaleDateString('uz-UZ');
            testsText += `${index + 1}. <b>${test.subject_name}</b> (${test.test_code})\n`;
            testsText += `   👨‍🏫 ${test.creator} | 👥 ${test.participants} ta\n`;
            testsText += `   📅 ${createDate}\n\n`;
        });
        
        testsText += `\n📊 <b>Umumiy:</b> ${recentTests.length} ta faol test

${getCurrentTime()}`;
        
        await editMessageText(chatId, messageId, testsText, adminPanelKeyboard());
        await answerCallbackQuery(queryId, "📝 Barcha testlar");
        return;
    }
    
    await answerCallbackQuery(queryId);
}

// Inline query handler
async function handleInlineQuery(update) {
    const inlineQuery = update.inline_query;
    const query = inlineQuery.query.trim();
    const queryId = inlineQuery.id;
    const userId = inlineQuery.from.id;
    
    if (query.startsWith('test_')) {
        const testCode = query.split('_')[1];
        const testData = await getTest(testCode);
        
        if (testData) {
            const { subject_name, correct_answers, creator_id, full_name: creatorName, time_limit, max_attempts, description, difficulty_level } = testData;
            const totalQuestions = correct_answers.length;
            const testResults = await getTestResults(testCode);
            const participants = testResults.length;
            
            const article = {
                type: "article",
                id: "1",
                title: `📚 ${subject_name} - ${difficulty_level} Test`,
                description: `👨‍🏫 ${creatorName} • ❓ ${totalQuestions} savol • 👥 ${participants} ishtirokchi${time_limit > 0 ? ` • ⏱️ ${formatDuration(time_limit)}` : ''}`,
                input_message_content: {
                    message_text: `🎯 <b>ONLINE TEST TAKLIFI</b>

📚 <b>Fan:</b> ${subject_name}
👨‍🏫 <b>Muallif:</b> <a href="tg://user?id=${creator_id}">${creatorName}</a>
🔢 <b>Test kodi:</b> <code>${testCode}</code>
❓ <b>Savollar soni:</b> ${totalQuestions} ta
📈 <b>Qiyinlik darajasi:</b> ${difficulty_level}
${description ? `📝 <b>Tavsif:</b> ${description}\n` : ''}
${time_limit > 0 ? `⏱️ <b>Vaqt chegarasi:</b> ${formatDuration(time_limit)}\n` : ''}
${max_attempts > 1 ? `🔄 <b>Urinishlar soni:</b> ${max_attempts} marta\n` : ''}
👥 <b>Hozirgi ishtirokchilar:</b> ${participants} ta

🚀 <b>Test yechishga tayyor!</b>
💡 Test yechish uchun botga o'ting va kodni kiriting.

⏰ ${getCurrentTime()}`,
                    parse_mode: "HTML"
                },
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📝 Test yechish", url: `https://t.me/${BOT_USERNAME}?start=test_${testCode}` }],
                        [{ text: "📊 Natijalarni ko'rish", url: `https://t.me/${BOT_USERNAME}` }],
                        [{ text: "🔄 Ulashish", switch_inline_query: `test_${testCode}` }]
                    ]
                }
            };
            
            await answerInlineQuery(queryId, [article]);
        } else {
            const article = {
                type: "article",
                id: "1",
                title: "❌ Test topilmadi",
                description: "Bu kodli test mavjud emas yoki yakunlangan",
                input_message_content: {
                    message_text: `❌ <b>Test topilmadi!</b>

🔍 <b>Sabab:</b> Test kodi noto'g'ri yoki test yakunlangan

💡 <b>Taklif:</b>
• Test kodini qayta tekshiring
• Test yaratuvchisidan yangi kod so'rang

⏰ ${getCurrentTime()}`,
                    parse_mode: "HTML"
                }
            };
            await answerInlineQuery(queryId, [article]);
        }
    } else {
        const article = {
            type: "article",
            id: "1",
            title: "🤖 Professional Test Bot",
            description: "Testlar yarating va ulashing! Bepul va oson.",
            input_message_content: {
                message_text: `🤖 <b>PROFESSIONAL TEST BOT</b>

🌟 <b>Imkoniyatlar:</b>
🆕 Professional testlar yaratish
📝 Turli formatdagi testlar (oddiy, vaqtli, takroriy)
🏆 Sertifikatlar va mukofotlar
📊 Batafsil statistika va tahlillar
📱 Oson interfeys va tez ishlash

🚀 <b>BOSHLASH:</b>
1. Botga o'ting
2. /start buyrug'ini yuboring
3. Ismingizni kiriting
4. Test yarating yoki yeching!

💡 <b>BEPUL va CHEKSIZ!</b>

⏰ ${getCurrentTime()}`,
                parse_mode: "HTML"
            },
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Botni ishga tushirish", url: `https://t.me/${BOT_USERNAME}?start=welcome` }],
                    [{ text: "📖 Qo'llanma", url: `https://t.me/${BOT_USERNAME}?start=help` }]
                ]
            }
        };
        await answerInlineQuery(queryId, [article]);
    }
}

// Webhook endpoint
app.post('/.netlify/functions/webhook', async (req, res) => {
    try {
        const update = req.body;
        console.log('Webhook update:', JSON.stringify(update, null, 2));
        
        // Initialize database if needed
        try {
            await initDB();
        } catch (dbError) {
            console.error('Database initialization error:', dbError);
        }
        
        if (update.message) {
            await handleMessage(update);
        } else if (update.callback_query) {
            await handleCallbackQuery(update);
        } else if (update.inline_query) {
            await handleInlineQuery(update);
        }
        
        res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ 
            status: "error", 
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Health check
app.get('/.netlify/functions/health', (req, res) => {
    res.json({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        bot_username: BOT_USERNAME,
        version: "2.0-nodejs-netlify"
    });
});

// Set webhook
app.get('/.netlify/functions/set_webhook', async (req, res) => {
    const webhookUrl = req.query.url || WEBHOOK_URL;
    
    if (!webhookUrl) {
        return res.status(400).json({ error: "Webhook URL required" });
    }
    
    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
            url: `${webhookUrl}/.netlify/functions/webhook`,
            allowed_updates: ["message", "callback_query", "inline_query"],
            drop_pending_updates: true
        });
        
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete webhook
app.get('/.netlify/functions/delete_webhook', async (req, res) => {
    try {
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get bot info
app.get('/.netlify/functions/bot_info', async (req, res) => {
    try {
        const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export for Netlify Functions
module.exports = app;
module.exports.handler = serverless(app);
