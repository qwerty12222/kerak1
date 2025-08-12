const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const url = process.env.WEBHOOK_URL; // Railway domain yoki custom domain
const port = process.env.PORT || 3000;

const app = express();
const bot = new TelegramBot(token, { polling: false });

// Middleware
app.use(express.json());

// Telegram webhook
app.post(`/webhook/${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});


// Server ishga tushishi
app.listen(port, () => {
  bot.setWebHook(`${url}/webhook/${token}`);
  console.log(`Bot server ishga tushdi, port: ${port}`);
});
