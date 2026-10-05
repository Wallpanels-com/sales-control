import { describe, expect, it } from 'vitest';
import { productionRecipients } from './recipients.js';

const dmitry = { id: 'dmitry', role: 'admin', telegram_chat_id: '1' };
const katherina = { id: 'katherina', role: 'manager', telegram_chat_id: '2' };

describe('production Telegram routing', () => {
  it.each(['mary', 'kit', 'kate', 'anthony'])('routes %s only with the global admin and manager', ownerId => {
    const recipients = productionRecipients(
      { id: ownerId, role: 'sales', telegram_chat_id: `chat-${ownerId}` },
      [dmitry, katherina]
    );
    expect(recipients.map(recipient => recipient.id).sort()).toEqual([ownerId, 'dmitry', 'katherina'].sort());
    expect(recipients.filter(recipient => recipient.role === 'sales')).toHaveLength(1);
  });

  it('keeps global monitoring when the owner is unmapped or unregistered', () => {
    expect(productionRecipients(null, [dmitry, katherina]).map(recipient => recipient.id))
      .toEqual(['dmitry', 'katherina']);
    expect(productionRecipients({ id: 'mary', telegram_chat_id: null }, [dmitry, katherina]).map(recipient => recipient.id))
      .toEqual(['dmitry', 'katherina']);
  });

  it('deduplicates a recipient that is both owner and global monitor', () => {
    expect(productionRecipients(katherina, [dmitry, katherina]).map(recipient => recipient.id))
      .toEqual(['katherina', 'dmitry']);
  });
});
