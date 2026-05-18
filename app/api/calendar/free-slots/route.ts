import { NextRequest, NextResponse } from 'next/server';
import { findFreeSlots } from '@/lib/calendar/freebusy';

export async function POST(req: NextRequest) {
  try {
    const { startTime, endTime, duration } = await req.json();

    if (!startTime || !endTime || !duration) {
      return NextResponse.json(
        { error: 'Missing required parameters: startTime, endTime, duration' },
        { status: 400 }
      );
    }

    const slots = await findFreeSlots(startTime, endTime, duration);

    return NextResponse.json({ slots });
  } catch (error) {
    console.error('Free slots API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch free slots' },
      { status: 500 }
    );
  }
}
