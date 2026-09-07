import { NextResponse } from 'next/server';
import { queueCommand } from '../../../lib/appsScript';

const ALLOWED = {
  bot: ['restartBot', 'sendTestMessage'],
  tunnel: ['restartTunnel'],
  extension: ['triggerRun']
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { target, command, params } = body || {};

    if (!ALLOWED[target] || !ALLOWED[target].includes(command)) {
      return NextResponse.json({ ok: false, error: 'Unknown target/command combination' }, { status: 400 });
    }

    const result = await queueCommand(target, command, params);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
