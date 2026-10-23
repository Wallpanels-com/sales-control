import { sendOneFollowupDemo } from './services/followups.js';
sendOneFollowupDemo().catch(() => {
  console.error('Demo delivery was not confirmed. Check APIs before retrying.');
  process.exitCode = 1;
});
