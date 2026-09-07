import { NextResponse } from 'next/server';
import { getStatus } from '../../../lib/appsScript';

export async function GET() {
  try {
    const data = await getStatus();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
