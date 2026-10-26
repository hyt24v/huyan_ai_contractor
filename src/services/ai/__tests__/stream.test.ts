import { describe, expect, it } from 'vitest';
import { parseStreamData } from '../client';
import { normalizeModels } from '../../../lib/providers';

describe('parseStreamData · openai-completions', () => {
  it('解析正文增量', () => {
    const d = parseStreamData(
      'openai-completions',
      '{"choices":[{"delta":{"content":"你好"}}]}',
    );
    expect(d).toEqual({ text: '你好' });
  });

  it('解析推理增量（reasoning_content）', () => {
    const d = parseStreamData(
      'openai-completions',
      '{"choices":[{"delta":{"reasoning_content":"先想想"}}]}',
    );
    expect(d).toEqual({ reasoning: '先想想' });
  });

  it('role-only 首帧返回 null', () => {
    expect(
      parseStreamData(
        'openai-completions',
        '{"choices":[{"delta":{"role":"assistant"}}]}',
      ),
    ).toBeNull();
  });

  it('非法 JSON 返回 null 而不抛异常', () => {
    expect(parseStreamData('openai-completions', '{broken')).toBeNull();
  });
});

describe('parseStreamData · openai-responses', () => {
  it('output_text.delta → text', () => {
    const d = parseStreamData(
      'openai-responses',
      '{"type":"response.output_text.delta","delta":"答案"}',
    );
    expect(d).toEqual({ text: '答案' });
  });

  it('reasoning_summary_text.delta → reasoning', () => {
    const d = parseStreamData(
      'openai-responses',
      '{"type":"response.reasoning_summary_text.delta","delta":"思考"}',
    );
    expect(d).toEqual({ reasoning: '思考' });
  });

  it('response.completed → done', () => {
    expect(
      parseStreamData('openai-responses', '{"type":"response.completed"}'),
    ).toEqual({ done: true });
  });

  it('response.failed → failed 信息', () => {
    const d = parseStreamData(
      'openai-responses',
      '{"type":"response.failed","response":{"error":{"message":"quota"}}}',
    );
    expect(d).toEqual({ failed: 'quota' });
  });

  it('未知事件类型返回 null', () => {
    expect(
      parseStreamData('openai-responses', '{"type":"response.created"}'),
    ).toBeNull();
  });
});

describe('parseStreamData · anthropic-messages', () => {
  it('text_delta → text', () => {
    const d = parseStreamData(
      'anthropic-messages',
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
    );
    expect(d).toEqual({ text: 'hi' });
  });

  it('thinking_delta → reasoning', () => {
    const d = parseStreamData(
      'anthropic-messages',
      '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}',
    );
    expect(d).toEqual({ reasoning: 'hmm' });
  });

  it('message_stop → done', () => {
    expect(
      parseStreamData('anthropic-messages', '{"type":"message_stop"}'),
    ).toEqual({ done: true });
  });

  it('error → failed 信息', () => {
    const d = parseStreamData(
      'anthropic-messages',
      '{"type":"error","error":{"message":"overloaded"}}',
    );
    expect(d).toEqual({ failed: 'overloaded' });
  });
});

describe('normalizeModels', () => {
  it('trim、去空、去重保序', () => {
    expect(normalizeModels([' a ', '', 'b', 'a', '  ', 'c'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('全空或 undefined → undefined', () => {
    expect(normalizeModels([])).toBeUndefined();
    expect(normalizeModels([' ', ''])).toBeUndefined();
    expect(normalizeModels(undefined)).toBeUndefined();
  });
});
