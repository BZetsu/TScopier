"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramShutdownDrainMs = telegramShutdownDrainMs;
function telegramShutdownDrainMs() {
    return Math.max(0, Math.min(120000, Number(process.env.TELEGRAM_SHUTDOWN_DRAIN_MS ?? 30000)));
}
