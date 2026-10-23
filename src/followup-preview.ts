import { sendOneFollowupPreview } from './services/followups.js';

sendOneFollowupPreview().catch(() => {
  console.error('Follow-up preview was not confirmed delivered; check configuration/API access before retrying.');
  process.exitCode = 1;
});
