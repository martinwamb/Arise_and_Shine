// src/api/telegram.js

import https from 'https';

const telegramApiUrl = 'https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/sendMessage';

function sendNow(message) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            chat_id: '<YOUR_CHAT_ID>',
            text: message,
            parse_mode: 'MarkdownV2',
        });

        const req = https.request(
            {
                hostname: 'api.telegram.org',
                path: `/bot<YOUR_TELEGRAM_BOT_TOKEN>/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': postData.length,
                },
            },
            (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    reject(new Error('Failed to send message'));
                }
            }
        );

        req.on('error', (err) => {
            console.error(`Error sending message: ${err.message}`);
            reject(err);
        });

        req.write(postData);
        req.end();
    });
}

export default sendNow;