import { describe, expect, it } from 'vitest';
import { advanceFollowup, followupRecipients, type FollowupEvent } from './followupPolicy.js';
const outbound: FollowupEvent = { id: 'sales-1', at: '2026-10-23T12:00:00Z', direction: 'outbound',
  human: true, channel: 'Instagram', previousInboundId: 'customer-1' };
describe('follow-up chain', () => {
  it('waits 24 hours from the actual human reply and 48/96 hours from actual follow-ups', () => {
    const first = advanceFollowup(null,outbound)!;
    expect(first).toMatchObject({stage:1,status:'waiting',due_at:'2026-10-24T12:00:00.000Z'});
    const second = advanceFollowup({ ...first,status:'reminded',reminded_at:'2026-10-24T12:01:00Z' },
      { ...outbound,id:'followup-1',at:'2026-10-24T15:00:00Z' })!;
    expect(second).toMatchObject({stage:2,status:'waiting',due_at:'2026-10-26T15:00:00.000Z'});
    const third = advanceFollowup({ ...second,status:'reminded',reminded_at:'2026-10-26T15:02:00Z' },
      { ...outbound,id:'followup-2',at:'2026-10-27T09:00:00Z' })!;
    expect(third).toMatchObject({stage:3,status:'waiting',due_at:'2026-10-31T09:00:00.000Z'});
    expect(advanceFollowup({ ...third,status:'reminded',reminded_at:'2026-10-31T09:01:00Z' },
      { ...outbound,id:'followup-3',at:'2026-10-31T12:00:00Z' })?.status).toBe('completed');
  });
  it('cannot advance from Copy, notification delivery, automation, or the passage of time', () => {
    const waiting = advanceFollowup(null,outbound)!;
    const reminded = { ...waiting,status:'reminded' as const,reminded_at:'2026-10-24T12:01:00Z' };
    expect(advanceFollowup(reminded,{...outbound,id:'workflow',at:'2026-10-27T12:00:00Z',human:false})).toBeNull();
    expect(advanceFollowup(reminded,outbound)).toBeNull();
    const late = advanceFollowup(reminded,{...outbound,id:'delayed-event',at:'2026-10-24T11:59:00Z'})!;
    expect(late).toMatchObject({stage:1,status:'reminded'});
  });
  it('cancels on customer reply and starts a new cycle only after sales replies', () => {
    const first = advanceFollowup(null,outbound)!;
    const replied = advanceFollowup(first,{ id:'customer-2',at:'2026-10-23T13:00:00Z',direction:'inbound',human:false,channel:'Email' })!;
    expect(replied.status).toBe('replied');
    expect(advanceFollowup(replied,{...outbound,id:'sales-2',at:'2026-10-23T14:00:00Z',previousInboundId:'customer-2'}))
      .toMatchObject({stage:1,status:'waiting',cycle_inbound_message_id:'customer-2'});
    expect(advanceFollowup(null,{...outbound,previousInboundId:undefined})).toBeNull();
  });
  it('does not interpret multiple parts of one sales reply as multiple follow-ups', () => {
    const first = advanceFollowup(null,outbound)!;
    expect(advanceFollowup(first,{...outbound,id:'sales-1-part2',at:'2026-10-23T12:01:00Z'}))
      .toMatchObject({stage:1,due_at:'2026-10-24T12:01:00.000Z'});
  });
});
describe('follow-up routing safety', () => {
  const owner = {id:'mary',telegram_chat_id:'1'};
  const other = {id:'anthony',telegram_chat_id:'2'};
  const admin = {id:'dmitry',telegram_chat_id:'3'};
  it('routes previews only to Dmitry regardless of real owner and global roles', () => {
    expect(followupRecipients('preview',owner,[admin,other],admin)).toEqual([admin]);
    expect(followupRecipients('preview',owner,[admin],null)).toEqual([]);
    expect(followupRecipients('off',owner,[admin],admin)).toEqual([]);
  });
  it('routes production only to responsible sales and global monitoring, without duplicates', () => {
    expect(followupRecipients('production',owner,[admin,admin],null)).toEqual([owner,admin]);
    expect(followupRecipients('production',owner,[admin],null)).not.toContainEqual(other);
  });
});
