import { NextRequest, NextResponse } from 'next/server';
import { createEvent } from '@/lib/calendar/events';

export async function POST(req: NextRequest) {
  try {
    const { summary, startTime, endTime, attendees, description } = await req.json();

    if (!summary || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'Missing required parameters: summary, startTime, endTime' },
        { status: 400 }
      );
    }

    const event = await createEvent(summary, startTime, endTime, attendees, description);

    return NextResponse.json({ event });
  } catch (error) {
    console.error('Create event API error:', error);
    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    );
  }
}
