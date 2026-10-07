import { describe, expect, it } from 'vitest';
import { messagePreview } from './text.js';

describe('messagePreview', () => {
  it('turns a Gmail HTML reply into readable text and removes quoted history', () => {
    const body = '<div dir="auto">Hey &amp; sure, I&#39;ll be waiting.</div><div><br><div class="gmail_quote gmail_quote_container"><blockquote>old email</blockquote></div></div>';
    expect(messagePreview(body, 'Email')).toBe("Hey & sure, I'll be waiting.");
  });

  it('removes Outlook head markup and reply history', () => {
    const body = '<html><head><style>.x{color:red}</style></head><body><div>Following up once again.</div><div id="ms-outlook-mobile-body-separator-line">old email</div></body></html>';
    expect(messagePreview(body, 'Email')).toBe('Following up once again.');
  });

  it('keeps ordinary message text and safely truncates it', () => {
    expect(messagePreview('Hello <3', 'SMS')).toBe('Hello <3');
    expect(messagePreview('x'.repeat(300), 'SMS')).toHaveLength(260);
  });
});
