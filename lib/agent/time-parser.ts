import OpenAI from 'openai';
import { TimeExpression } from '@/types';
import { format, parseISO, addDays, lastDayOfMonth, startOfDay, endOfDay, setHours } from 'date-fns';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function parseTimeExpression(
  expression: string,
  context: { today: string; timezone: string }
): Promise<TimeExpression> {
  const quickParse = tryQuickParse(expression, context.today);
  if (quickParse) {
    return quickParse;
  }

  return await llmParse(expression, context);
}

function tryQuickParse(expression: string, today: string): TimeExpression | null {
  const lowerExpr = expression.toLowerCase();
  const todayDate = parseISO(today);

  if (lowerExpr.includes('today')) {
    return {
      raw: expression,
      start: startOfDay(todayDate).toISOString(),
      end: endOfDay(todayDate).toISOString(),
      confidence: 1.0,
    };
  }

  if (lowerExpr.includes('tomorrow')) {
    const tomorrow = addDays(todayDate, 1);
    return {
      raw: expression,
      start: startOfDay(tomorrow).toISOString(),
      end: endOfDay(tomorrow).toISOString(),
      confidence: 1.0,
    };
  }

  if (lowerExpr.includes('next week')) {
    const nextWeek = addDays(todayDate, 7);
    return {
      raw: expression,
      start: startOfDay(nextWeek).toISOString(),
      end: endOfDay(addDays(nextWeek, 6)).toISOString(),
      confidence: 0.9,
    };
  }

  const isoMatch = expression.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    const date = parseISO(isoMatch[0]);
    return {
      raw: expression,
      start: startOfDay(date).toISOString(),
      end: endOfDay(date).toISOString(),
      confidence: 1.0,
    };
  }

  return null;
}

async function llmParse(
  expression: string,
  context: { today: string; timezone: string }
): Promise<TimeExpression> {
  const prompt = `Parse this time expression into a start and end ISO datetime:

Expression: "${expression}"
Today's date: ${context.today}
Timezone: ${context.timezone}

Return JSON with:
- start: ISO datetime string
- end: ISO datetime string
- confidence: number between 0 and 1

Examples:
"last weekday of this month" → last non-weekend day of current month
"before my 6pm flight" → end time is 5pm (1 hour buffer)
"a day after the kickoff" → requires context, low confidence

Return only valid JSON, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');

    return {
      raw: expression,
      start: result.start,
      end: result.end,
      confidence: result.confidence || 0.5,
    };
  } catch (error) {
    console.error('LLM time parsing failed:', error);
    
    const fallback = parseISO(context.today);
    return {
      raw: expression,
      start: startOfDay(fallback).toISOString(),
      end: endOfDay(fallback).toISOString(),
      confidence: 0.3,
    };
  }
}
