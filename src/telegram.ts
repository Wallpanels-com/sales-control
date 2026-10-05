import { Bot, InlineKeyboard } from 'grammy';
import { db } from './db.js';
import { env } from './config.js';
import { getStaffByTelegramUserId, getStaffByTelegramUsername } from './services/staff.js';
import { escapeHtml, normalizeUsername, truncate } from './utils/text.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') return ctx.reply('Please register in a private chat with the bot.');
  if (!ctx.from) return;
  const previouslyRegistered = await getStaffByTelegramUserId(ctx.from.id);
  if (previouslyRegistered) {
    const { error } = await db.from('telegram_users').update({
      telegram_chat_id: String(ctx.chat.id),
      telegram_username: normalizeUsername(ctx.from.username) || previouslyRegistered.telegram_username,
      updated_at: new Date().toISOString()
    }).eq('staff_id', previouslyRegistered.id);
    if (error) throw error;
    return ctx.reply(`Registered: ${previouslyRegistered.name}. Notifications are enabled.`);
  }
  const username = normalizeUsername(ctx.from?.username);
  if (!username) {
    await ctx.reply('A Telegram username is required for registration.');
    return;
  }
  const staff = await getStaffByTelegramUsername(username);
  if (!staff) {
    await ctx.reply('Your Telegram account is not on the approved staff list.');
    return;
  }
  const { data: existingRegistration, error: lookupError } = await db.from('telegram_users')
    .select('telegram_user_id').eq('staff_id', staff.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (existingRegistration && String(existingRegistration.telegram_user_id) !== String(ctx.from.id)) {
    return ctx.reply('This staff record is already registered to another Telegram account. Contact Dmitry.');
  }
  const { error } = await db.from('telegram_users').upsert({
    staff_id: staff.id,
    telegram_user_id: String(ctx.from?.id || ''),
    telegram_chat_id: String(ctx.chat.id),
    telegram_username: username,
    registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'staff_id' });
  if (error) throw error;
  await ctx.reply(`Registered: ${staff.name} (${staff.role}). Notifications are enabled.`);
});

bot.command('status', async (ctx) => {
  const staff = ctx.from ? await getStaffByTelegramUserId(ctx.from.id) : null;
  if (!staff) return ctx.reply('Not authorized.');
  const { count, error } = await db.from('sla_incidents')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');
  if (error) throw error;
  const { data: companies, error: companyError } = await db.from('companies').select('id,slug').eq('enabled', true);
  if (companyError) throw companyError;
  const mappingLines: string[] = [];
  for (const company of companies || []) {
    const [{ count: users, error: usersError }, { data: mappings, error: mappedError }, { data: sales, error: salesError }] = await Promise.all([
      db.from('ghl_users').select('*', { count: 'exact', head: true }).eq('company_id', company.id),
      db.from('staff_ghl_map').select('staff_id').eq('company_id', company.id),
      db.from('staff').select('id,name').eq('role', 'sales').eq('active', true)
    ]);
    if (usersError || mappedError || salesError) throw usersError || mappedError || salesError;
    const mappedIds = new Set((mappings || []).map(row => row.staff_id));
    const missingNames = (sales || []).filter(person => !mappedIds.has(person.id)).map(person => person.name);
    mappingLines.push(`${company.slug}: ${mappings?.length || 0} mapped / ${users || 0} CRM users${missingNames.length ? `; sales without mapping: ${missingNames.join(', ')}` : ''}`);
  }
  await ctx.reply(`Service running. Open conversations: ${count || 0}. Test mode: ${env.TEST_MODE ? 'ON' : 'OFF'}.\n${mappingLines.join('\n')}`);
});

bot.command('test_alert', async (ctx) => {
  const staff = ctx.from ? await getStaffByTelegramUserId(ctx.from.id) : null;
  if (!staff || !['admin','manager'].includes(staff.role)) return ctx.reply('Not authorized.');
  await sendSlaAlert({ recipient: staff, companyName: 'Delivery test', contactName: 'Sample client', ownerName: staff.name,
    channel: 'SMS', waitingMinutes: 2, thresholdMinutes: 2, severity: 'waiting', body: 'Telegram delivery is working.' });
});

export async function sendSlaAlert(args: {
  recipient: any;
  companyName: string;
  contactName: string;
  ownerName?: string | null;
  channel?: string | null;
  waitingMinutes: number;
  thresholdMinutes: number;
  severity?: 'waiting' | 'warning' | 'breach';
  body?: string | null;
  conversationUrl?: string | null;
  routingNote?: string | null;
}): Promise<number | null> {
  if (!args.recipient?.telegram_chat_id) return null;

  const severity = args.severity === 'breach' ? '🔴 SLA BREACH' : args.severity === 'warning' ? '🚨 SLA WARNING' : '⚠️ CLIENT WAITING';
  const lines = [
    `<b>${severity} — ${args.thresholdMinutes} MIN</b>`,
    `<b>${escapeHtml(args.companyName)}</b>`,
    escapeHtml(args.contactName || 'Unknown contact'),
    args.ownerName ? `Owner: ${escapeHtml(args.ownerName)}` : null,
    args.channel ? `Channel: ${escapeHtml(args.channel.replace(/^TYPE_/, ''))}` : null,
    `Waiting: ${args.waitingMinutes} min`,
    args.body ? `\n“${escapeHtml(truncate(args.body, 260))}”` : null,
    args.routingNote ? `\n<i>${escapeHtml(args.routingNote)}</i>` : null
  ].filter(Boolean).join('\n');

  const keyboard = new InlineKeyboard();
  if (args.conversationUrl) keyboard.url('Open Conversation', args.conversationUrl);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const sent = await bot.api.sendMessage(Number(args.recipient.telegram_chat_id), lines, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: args.conversationUrl ? keyboard : undefined
      });
      return sent.message_id;
    } catch (error) {
      const e = error as { error_code?: number; parameters?: { retry_after?: number } };
      const retryable = !e.error_code || e.error_code === 429 || e.error_code >= 500;
      if (!retryable || attempt === 3) throw new Error(`Telegram send failed (${e.error_code || 'network'})`);
      const waitMs = (e.parameters?.retry_after || Math.min(2 ** attempt, 10)) * 1000;
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60_000)));
    }
  }
  throw new Error('Telegram send failed');
}

bot.catch((err) => { console.error('Telegram bot update error', err.message); });
