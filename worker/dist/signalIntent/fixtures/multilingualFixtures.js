"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTILINGUAL_FIXTURES = exports.PORTUGUESE_TP_UPDATE = exports.JAPANESE_BUY = exports.RUSSIAN_SELL = exports.ENGLISH_BUY_NOW = exports.ARABIC_ENTRY_ZONE = exports.PORTUGUESE_SCALP_SELL = exports.FRENCH_BUY_GOLD = void 0;
exports.FRENCH_BUY_GOLD = {
    name: 'french_buy_gold',
    locale: 'fr',
    rawMessage: `ACHETER OR
Entrée : 3365
SL : 3355
TP1 : 3370
TP2 : 3375
TP3 : 3380`,
    expected: {
        kind: 'entry',
        side: 'BUY',
        symbol: 'XAUUSD',
        entry: [3365],
        sl: 3355,
        tp: [3370, 3375, 3380],
    },
};
exports.PORTUGUESE_SCALP_SELL = {
    name: 'portuguese_scalp_sell',
    locale: 'pt',
    rawMessage: `📊 VAMOS FAZER UM SCALPING

💵 Moeda: XAU-USD
🖐 Análise: Venda (Sell)
🎯 Entrada: 4060
⛔ Stop Loss (SL): 4080

Take Profit (TP):
✅ TP 4055
✅ TP 4050
✅ TP 4040`,
    expected: {
        kind: 'entry',
        side: 'SELL',
        symbol: 'XAUUSD',
        entry: [4060],
        sl: 4080,
        tp: [4055, 4050, 4040],
    },
};
exports.ARABIC_ENTRY_ZONE = {
    name: 'arabic_entry_zone',
    locale: 'ar',
    rawMessage: `بيع الذهب
منطقة الدخول 2650-2655
SL 2665
TP 2640`,
    expected: {
        kind: 'entry',
        side: 'SELL',
        symbol: 'XAUUSD',
        entry: [2650, 2655],
        sl: 2665,
        tp: [2640],
    },
};
exports.ENGLISH_BUY_NOW = {
    name: 'english_buy_now',
    locale: 'en',
    rawMessage: `GOLD BUY NOW
Entry 2650
SL 2640
TP 2660`,
    expected: {
        kind: 'entry',
        side: 'BUY',
        symbol: 'XAUUSD',
        entry: [2650],
        sl: 2640,
        tp: [2660],
    },
};
exports.RUSSIAN_SELL = {
    name: 'russian_sell',
    locale: 'ru',
    rawMessage: `ПРОДАЖА XAUUSD
Вход: 2400
SL: 2410
TP: 2390`,
    expected: {
        kind: 'entry',
        side: 'SELL',
        symbol: 'XAUUSD',
        entry: [2400],
        sl: 2410,
        tp: [2390],
    },
};
exports.JAPANESE_BUY = {
    name: 'japanese_buy',
    locale: 'ja',
    rawMessage: `ゴールド買い
エントリー 2650
SL 2640
TP 2660`,
    expected: {
        kind: 'entry',
        side: 'BUY',
        symbol: 'XAUUSD',
        entry: [2650],
        sl: 2640,
        tp: [2660],
    },
};
exports.PORTUGUESE_TP_UPDATE = {
    name: 'portuguese_tp_hit_update',
    locale: 'pt',
    rawMessage: `📌 ATUALIZAÇÃO
▶️ Status: TP1 ATINGIDO
XAU-USD (Venda 4040) — TP1 (4035) atingido.`,
    expected: {
        kind: 'commentary',
    },
};
exports.MULTILINGUAL_FIXTURES = [
    exports.FRENCH_BUY_GOLD,
    exports.PORTUGUESE_SCALP_SELL,
    exports.ARABIC_ENTRY_ZONE,
    exports.ENGLISH_BUY_NOW,
    exports.RUSSIAN_SELL,
    exports.JAPANESE_BUY,
    exports.PORTUGUESE_TP_UPDATE,
];
