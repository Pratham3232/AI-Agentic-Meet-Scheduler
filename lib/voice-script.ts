/**
 * Rule-based voice script generator — zero LLM call, zero latency.
 *
 * Converts a scheduling assistant text response into a short spoken phrase:
 *   - Short text / questions / confirmations → verbatim (markdown stripped)
 *   - Numbered slot lists                   → first 2 times + "listed in chat"
 */

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/#{1,4}\s+/g, '')          // ## headers
    .replace(/✓\s*/g, '')               // ✓ checkmarks
    .replace(/\d\s*–\s*\d/g, m => m.replace('–', 'to'))  // em-dash only between digits (time ranges)
    .replace(/–/g, ',')                 // other em-dashes → comma
    .trim();
}

/** Extract a time string like "8:00 AM" or "8 AM" from a slot line. */
function extractTime(line: string): string | null {
  const match = line.match(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i);
  return match ? match[1] : null;
}

/** Extract a trailing question from the full stripped text (last line ending in ?). */
function extractTrailingQuestion(stripped: string): string {
  const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean);
  const qLine = [...lines].reverse().find(l => l.endsWith('?'));
  return qLine ?? 'Which works for you?';
}

export function generateVoiceScript(text: string): string {
  // Match both numbered lists (1. 2.) and bullet lists (- item)
  const numbered = text.match(/^\d+\.\s+.+$/gm) ?? [];
  const bullets  = text.match(/^[-•*]\s+.+$/gm) ?? [];
  const slotLines = numbered.length >= 2 ? numbered : bullets;

  if (slotLines.length < 2) {
    // Not a slot list — return verbatim stripped text
    return stripMarkdown(text);
  }

  // Extract times from first 2 slots
  const times = slotLines.slice(0, 2).map(extractTime).filter(Boolean) as string[];

  if (times.length < 2) {
    // Can't extract clean times, return stripped full text (will be long but accurate)
    return stripMarkdown(text);
  }

  const total    = slotLines.length;
  const extra    = total - 2;
  const question = extractTrailingQuestion(stripMarkdown(text));
  const more     = extra > 0 ? ` — plus ${extra} more` : '';

  return `I have ${times[0]} and ${times[1]} available${more}. I've listed all the options in the chat. ${question}`;
}
