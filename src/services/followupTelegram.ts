import { InlineKeyboard } from 'grammy';
import { escapeHtml } from '../utils/text.js';

export interface FollowupNotification {
  companyName: string; contactName: string; ownerName: string; channel: string;
  stage: number; waitingHours: number; draft: string; conversationUrl: string; preview: boolean; demo?: boolean;
}
export function renderFollowupNotification(value: FollowupNotification) {
  if (!value.draft.trim() || value.draft.length > 256) throw new Error('Invalid copy-text length');
  const link = new URL(value.conversationUrl);
  if (link.protocol !== 'https:' || link.hostname !== 'app.gohighlevel.com') throw new Error('Untrusted conversation link');
  const text = [
    value.preview ? '🧪 <b>ТЕСТ · Follow-up · только Dmitry</b>' : '🔔 <b>Нужно сделать follow-up</b>',
    value.demo ? 'Вымышленная переписка. Кнопка CRM — проверка ссылки на существующий диалог.' : null,
    `<b>${escapeHtml(value.companyName)}</b>`,
    `Клиент: ${escapeHtml(value.contactName)}`, `Ответственный: ${escapeHtml(value.ownerName)}`,
    `Канал: ${escapeHtml(value.channel)}`, `Этап: ${value.stage} из 3`,
    `Клиент не отвечает: ${Math.floor(value.waitingHours)} ч`,
    '\n<b>Предлагаемый ответ на английском:</b>', `<blockquote>${escapeHtml(value.draft)}</blockquote>`,
    '\nСкопируйте текст и отправьте вручную в CRM.'
  ].filter(Boolean).join('\n');
  const keyboard = new InlineKeyboard().copyText('📋 Скопировать', value.draft).row()
    .url('Open Conversation', value.conversationUrl);
  return { text, keyboard };
}
