import { describe, expect, it } from 'vitest';
import { renderFollowupNotification } from './followupTelegram.js';
const input = { companyName:'Verona Home',contactName:'Alex <test>',ownerName:'Mary',channel:'SMS',
  stage:1,waitingHours:24,draft:'Hi Alex! Any questions about the options we discussed?',preview:true,
  conversationUrl:'https://app.gohighlevel.com/v2/location/verona/conversations/conversations/alex?category=team-inbox&tab=all'};
describe('follow-up Telegram notification',()=>{
  it('provides a native Copy button for exactly the English draft and the exact CRM link',()=>{
    const rendered=renderFollowupNotification(input);
    expect(rendered.keyboard.inline_keyboard).toEqual([
      [{text:'📋 Скопировать',copy_text:{text:input.draft}}],
      [{text:'Open Conversation',url:input.conversationUrl}]
    ]);
    expect(rendered.text).toContain('только Dmitry');
    expect(rendered.text).toContain('Alex &lt;test&gt;');
  });
  it('rejects unsafe links and drafts exceeding the Telegram copy-text limit',()=>{
    expect(()=>renderFollowupNotification({...input,conversationUrl:'https://example.com'})).toThrow();
    expect(()=>renderFollowupNotification({...input,draft:'x'.repeat(257)})).toThrow();
  });
});
