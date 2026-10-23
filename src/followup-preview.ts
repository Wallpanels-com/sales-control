import { sendOneFollowupPreview } from './services/followups.js';

sendOneFollowupPreview(process.argv[2],process.argv[3]).catch(() => {
  console.error('Follow-up preview was not confirmed delivered; check configuration/API access before retrying.');
  process.exitCode = 1;
});
