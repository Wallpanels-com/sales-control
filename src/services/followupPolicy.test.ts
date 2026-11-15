import { describe, expect, it } from 'vitest';
import { advanceFollowup, followupNoticeKey, followupRecipients, followupWindow, type FollowupEvent } from './followupPolicy.js';
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
  it('starts at stage one after a suppressed historical cycle receives a new real sales message', () => {
    const previous={...advanceFollowup(null,outbound)!,stage:2,status:'suppressed' as const};
    expect(advanceFollowup(previous,{...outbound,id:'new-sales',at:'2026-11-16T12:00:00Z'}))
      .toMatchObject({stage:1,status:'waiting',due_at:'2026-11-17T12:00:00.000Z'});
    expect(advanceFollowup(previous,{...outbound,id:'workflow',at:'2026-11-16T12:00:00Z',human:false})).toBeNull();
    const next=advanceFollowup(previous,{...outbound,id:'new-sales',at:'2026-11-16T12:00:00Z'})!;
    expect(followupNoticeKey('thread',next.cycle_inbound_message_id,next.anchor_message_id,1,'sales'))
      .not.toBe(followupNoticeKey('thread',previous.cycle_inbound_message_id,previous.anchor_message_id,1,'sales'));
  });
});

describe('follow-up delivery freshness', () => {
  const now=Date.parse('2026-11-16T12:00:00Z');
  const baseline=Date.parse('2026-11-01T00:00:00Z');
  const thread=(stage:number,ageHours:number,dueAt=now)=>({stage,
    anchor_at:new Date(now-ageHours*3600_000).toISOString(),due_at:new Date(dueAt).toISOString()});

  it('preserves the three intended 24/48/96 hour deadlines', () => {
    for(const [stage,hours] of [[1,24],[2,48],[3,96]]) {
      expect(followupWindow(thread(stage,hours),baseline,now)).toBe('eligible');
      expect(followupWindow(thread(stage,hours-1),baseline,now)).toBe('not_due');
    }
  });
  it('blocks every stale example in the screenshots, including stage two', () => {
    for(const age of [220,286,310,311,312,482,557]) {
      expect(followupWindow(thread(1,age),0,now)).toBe('expired');
    }
    expect(followupWindow(thread(2,221),0,now)).toBe('expired');
  });
  it('does not make historical reminders fresh by postponing due_at', () => {
    expect(followupWindow(thread(1,312,now),0,now)).toBe('expired');
    expect(followupWindow(thread(1,312,now+30*60_000),0,now)).toBe('expired');
    expect(followupWindow(thread(3,103),0,now)).toBe('expired');
  });
  it('blocks anchors before the recovery baseline and respects bounded delivery delay', () => {
    expect(followupWindow(thread(1,24),now-3600_000,now)).toBe('before_cutover');
    expect(followupWindow(thread(1,30),baseline,now)).toBe('eligible');
    expect(followupWindow(thread(1,30.01),baseline,now)).toBe('expired');
    expect(followupWindow(thread(1,24),null,now)).toBe('invalid');
    expect(followupWindow(thread(4,24),baseline,now)).toBe('invalid');
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
