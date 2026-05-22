import { RealtimeResponseGate } from '@/lib/client/realtime-response-gate';

describe('RealtimeResponseGate', () => {
  function setup() {
    const sent: string[] = [];
    const gate = new RealtimeResponseGate();
    gate.setSendFn(payload => sent.push(payload));
    return { gate, sent, parse: () => sent.map(s => JSON.parse(s)) };
  }

  test('defers response.create while response is active', () => {
    const { gate, parse } = setup();
    gate.onResponseCreated('resp_1');
    gate.registerFunctionCall('call_a');
    gate.submitToolResult('call_a', { ok: true });

    expect(parse().some(p => p.type === 'response.create')).toBe(false);
    expect(parse().filter(p => p.type === 'conversation.item.create')).toHaveLength(1);
  });

  test('sends one response.create after response.done when tools finished', () => {
    const { gate, parse } = setup();
    gate.onResponseCreated('resp_1');
    gate.registerFunctionCall('call_a');
    gate.submitToolResult('call_a', { ok: true });
    gate.onResponseEnded();

    const creates = parse().filter(p => p.type === 'response.create');
    expect(creates).toHaveLength(1);
  });

  test('batches parallel tool outputs into single response.create', () => {
    const { gate, parse } = setup();
    gate.registerFunctionCall('c1');
    gate.registerFunctionCall('c2');
    gate.registerFunctionCall('c3');
    gate.submitToolResult('c1', { n: 1 });
    gate.submitToolResult('c2', { n: 2 });
    gate.submitToolResult('c3', { n: 3 });

    const outputs = parse().filter(p => p.type === 'conversation.item.create');
    expect(outputs).toHaveLength(3);
    expect(parse().filter(p => p.type === 'response.create')).toHaveLength(1);
  });

  test('requestCompletionResponse fires even when continuationSentForTurn is set', () => {
    const { gate, parse } = setup();
    gate.registerFunctionCall('c1');
    gate.submitToolResult('c1', { ok: true });
    expect(parse().filter(p => p.type === 'response.create')).toHaveLength(1);

    gate.requestCompletionResponse('Confirm all meetings are booked.');
    const creates = parse().filter(p => p.type === 'response.create');
    expect(creates).toHaveLength(2);
    expect(creates[1].response?.instructions).toContain('Confirm all meetings');
  });

  test('requestCompletionResponse waits for active response then fires on response ended', () => {
    const { gate, parse } = setup();
    gate.onResponseCreated('resp_1');
    gate.requestCompletionResponse('All meetings booked.');
    expect(parse().filter(p => p.type === 'response.create')).toHaveLength(0);

    gate.onResponseEnded();
    const creates = parse().filter(p => p.type === 'response.create');
    expect(creates).toHaveLength(1);
    expect(creates[0].response?.instructions).toBe('All meetings booked.');
  });

  test('completion response takes priority over tool flush on response ended', () => {
    const { gate, parse } = setup();
    gate.onResponseCreated('resp_1');
    gate.registerFunctionCall('c1');
    gate.submitToolResult('c1', { ok: true });
    gate.requestCompletionResponse('Done.');
    gate.onResponseEnded();

    const creates = parse().filter(p => p.type === 'response.create');
    expect(creates).toHaveLength(1);
    expect(creates[0].response?.instructions).toBe('Done.');
  });

  test('blocks second response.create while first response still active', () => {
    const { gate, parse } = setup();
    gate.onResponseCreated('resp_1');
    gate.registerFunctionCall('c1');
    gate.submitToolResult('c1', {});
    gate.onResponseEnded();

    gate.onResponseCreated('resp_2');
    gate.requestResponse();
    expect(parse().filter(p => p.type === 'response.create')).toHaveLength(1);

    gate.onResponseEnded();
    gate.requestResponse();
    expect(parse().filter(p => p.type === 'response.create')).toHaveLength(2);
  });
});
