// A message that says a feature needs something switched on in Settings ends with a link straight to that
// setting (src/go.ts). The messages come from the server as plain words, so the link is added here by
// their wording: keep "AI features switched on in Settings" in such a message and it gets its link.
import { GO, jump } from './go';

export function Hint({ text }: { text?: string | null }) {
  if (!text) return null;
  if (!/AI features switched on in Settings/.test(text)) return <>{text}</>;
  return <>{text} <a href="#connections" onClick={jump(GO.ai)}>Take me there</a></>;
}
