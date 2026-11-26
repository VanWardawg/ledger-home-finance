// The AI features that don't need Claude's own service can be answered by either of two other models:
// the one in the household's Home Assistant (server/haai.js) or one it runs itself (server/localai.js).
// The features ask here and are not told which.
import { getSetting } from './db.js';
import { viaHa, haAsk, haAskJson, haIsClaude } from './haai.js';
import { viaLocal, localAsk, localAskJson, localModel } from './localai.js';

/** Whether the basic AI features go to a model other than Claude by key. */
export const viaPlain = () => viaLocal() || viaHa();
/** 'local', 'ha', or '' */
export const plainRoute = () => (viaLocal() ? 'local' : viaHa() ? 'ha' : '');
export const plainAsk = (task, instructions, feature, sent) => (viaLocal() ? localAsk : haAsk)(task, instructions, feature, sent);
export const plainAskJson = (task, instructions, feature, sent) => (viaLocal() ? localAskJson : haAskJson)(task, instructions, feature, sent);
/** Whether the model answering says it is Claude. A model of the household's own never is. */
export const plainIsClaude = () => !viaLocal() && haIsClaude();
/** What to call the AI in the app: Claude when Ledger talks to Claude, otherwise a plain word. */
export const aiName = () => (viaPlain() && !plainIsClaude() ? 'your AI' : 'Claude');
/** For the record of what was sent, and the note under an answer: where it went. */
export const plainWhere = () => (viaLocal() ? `your own model (${localModel()})` : viaHa() ? `Home Assistant's AI${getSetting('ai_ha_name') ? ` (${getSetting('ai_ha_name')})` : ''}` : 'Claude');
