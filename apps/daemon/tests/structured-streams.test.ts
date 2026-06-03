import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler } from '../src/claude-stream.js';
import { createCopilotStreamHandler } from '../src/copilot-stream.js';
import { mapPiRpcEvent } from '../src/pi-rpc.js';

describe('structured agent stream fixtures', () => {
  it('emits TodoWrite tool_use from Claude Code stream JSON', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));
    handler.feed(`${JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [
          {
            type: 'tool_use',
            id: 'toolu-1',
            name: 'TodoWrite',
            input: {
              todos: [{ content: 'Run QA', status: 'pending' }],
            },
          },
        ],
      },
    })}\n`);
    handler.flush();

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'toolu-1',
      name: 'TodoWrite',
      input: {
        todos: [{ content: 'Run QA', status: 'pending' }],
      },
    });
  });

  it('preserves streamed Claude Code tool input_json_delta payloads', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu-1', name: 'Write' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"admin-dashboard.html",' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"content":"<html></html>"}' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'Write', input: {} }],
      },
    })}\n`);
    handler.flush();

    const toolUses = events.filter((event) => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'tool_use');

    expect(toolUses).toHaveLength(1);
    expect(toolUses).toContainEqual({
      type: 'tool_use',
      id: 'toolu-1',
      name: 'Write',
      input: {
        file_path: 'admin-dashboard.html',
        content: '<html></html>',
      },
    });
  });

  it('streams AskUserQuestion input as tool_use_start + tool_input_delta before the final tool_use', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    const full = '{"questions":[{"question":"Which database?","header":"DB","multiSelect":false,"options":[{"label":"Postgres"},{"label":"SQLite"}]}]}';
    const mid = full.indexOf('"options"');

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-q' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu-q', name: 'AskUserQuestion' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: full.slice(0, mid) },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: full.slice(mid) },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    })}\n`);
    handler.flush();

    const typeOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { type?: string }).type : undefined);

    // The frame announces itself the moment the block opens, before any input.
    expect(events.find((e) => typeOf(e) === 'tool_use_start')).toEqual({
      type: 'tool_use_start',
      id: 'toolu-q',
      name: 'AskUserQuestion',
    });

    // Each partial_json fragment is forwarded verbatim, in order, keyed by id.
    const deltas = events.filter((e) => typeOf(e) === 'tool_input_delta') as Array<{ id: string; delta: string }>;
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.id === 'toolu-q')).toBe(true);
    expect(deltas.map((d) => d.delta).join('')).toBe(full);

    // The authoritative, fully-parsed tool_use still lands at block stop.
    const toolUses = events.filter((e) => typeOf(e) === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      type: 'tool_use',
      id: 'toolu-q',
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which database?' }] },
    });
  });

  it('does not stream input_json_delta fragments for non-AskUserQuestion tools', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-w' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu-w', name: 'Write' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.html","content":"x"}' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    })}\n`);
    handler.flush();

    const typeOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { type?: string }).type : undefined);
    expect(events.some((e) => typeOf(e) === 'tool_use_start')).toBe(false);
    expect(events.some((e) => typeOf(e) === 'tool_input_delta')).toBe(false);
    expect(events.filter((e) => typeOf(e) === 'tool_use')).toHaveLength(1);
  });

  it('preserves Claude Code tool input from content_block_start when no delta arrives', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu-edit-1',
          name: 'Edit',
          input: {
            file_path: 'C:\\Users\\Tetsu\\project\\canvas2-nodes.jsx',
            old_string: 'const nodes = []',
            new_string: 'const nodes = computeNodes()',
          },
        },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [{ type: 'tool_use', id: 'toolu-edit-1', name: 'Edit', input: {} }],
      },
    })}\n`);
    handler.flush();

    const toolUses = events.filter((event) => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'tool_use');

    expect(toolUses).toEqual([
      {
        type: 'tool_use',
        id: 'toolu-edit-1',
        name: 'Edit',
        input: {
          file_path: 'C:\\Users\\Tetsu\\project\\canvas2-nodes.jsx',
          old_string: 'const nodes = []',
          new_string: 'const nodes = computeNodes()',
        },
      },
    ]);
  });

  it('does not duplicate streamed Claude Code text or thinking when final assistant wrapper has no id', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Plan once.' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Write once.' },
      },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 1 },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Plan once.' },
          { type: 'text', text: 'Write once.' },
        ],
      },
    })}\n`);
    handler.flush();

    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'thinking_delta'
    ))).toEqual([{ type: 'thinking_delta', delta: 'Plan once.' }]);
    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'text_delta'
    ))).toEqual([{ type: 'text_delta', delta: 'Write once.' }]);
  });

  it('does not suppress later wrapper-only Claude Code text without an id after streamed output', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Streamed once.' },
      },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Streamed once.' }],
      },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Wrapper only.' }],
      },
    })}\n`);
    handler.flush();

    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'text_delta'
    ))).toEqual([
      { type: 'text_delta', delta: 'Streamed once.' },
      { type: 'text_delta', delta: 'Wrapper only.' },
    ]);
  });

  it('keeps wrapper-only Claude Code text after streamed thinking without an id', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Plan streamed.' },
      },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Plan streamed.' },
          { type: 'text', text: 'Answer from wrapper.' },
        ],
      },
    })}\n`);
    handler.flush();

    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'thinking_delta'
    ))).toEqual([{ type: 'thinking_delta', delta: 'Plan streamed.' }]);
    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'text_delta'
    ))).toEqual([{ type: 'text_delta', delta: 'Answer from wrapper.' }]);
  });

  it('keeps wrapper-only Claude Code thinking after streamed text without an id', () => {
    const events: unknown[] = [];
    const handler = createClaudeStreamHandler((event: unknown) => events.push(event));

    handler.feed(`${JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-1' } },
    })}\n${JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Answer streamed.' },
      },
    })}\n${JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Answer streamed.' },
          { type: 'thinking', thinking: 'Plan from wrapper.' },
        ],
      },
    })}\n`);
    handler.flush();

    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'text_delta'
    ))).toEqual([{ type: 'text_delta', delta: 'Answer streamed.' }]);
    expect(events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { type?: string }).type === 'thinking_delta'
    ))).toEqual([{ type: 'thinking_delta', delta: 'Plan from wrapper.' }]);
  });

  it('emits TodoWrite tool_use from Pi RPC tool_execution events', () => {
    const events: unknown[] = [];
    const send = (_channel: string, payload: unknown) => { events.push(payload); };
    const ctx = { runStartedAt: Date.now(), sentFirstToken: { value: false } };

    mapPiRpcEvent(
      { type: 'tool_execution_start', toolCallId: 'pi-call-1', toolName: 'TodoWrite', args: { todos: [{ content: 'Run QA', status: 'pending' }] } },
      send,
      ctx,
    );
    mapPiRpcEvent(
      { type: 'tool_execution_end', toolCallId: 'pi-call-1', toolName: 'TodoWrite', result: { content: [{ type: 'text', text: 'written' }] }, isError: false },
      send,
      ctx,
    );

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'pi-call-1',
      name: 'TodoWrite',
      input: { todos: [{ content: 'Run QA', status: 'pending' }] },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'pi-call-1',
      content: 'written',
      isError: false,
    });
  });

  it('emits TodoWrite tool_use from GitHub Copilot CLI JSON stream', () => {
    const events: unknown[] = [];
    const handler = createCopilotStreamHandler((event: unknown) => events.push(event));
    handler.feed(`${JSON.stringify({
      type: 'tool.execution_start',
      data: {
        toolCallId: 'call-1',
        toolName: 'TodoWrite',
        arguments: {
          todos: [{ content: 'Run QA', status: 'pending' }],
        },
      },
    })}\n`);
    handler.flush();

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'call-1',
      name: 'TodoWrite',
      input: {
        todos: [{ content: 'Run QA', status: 'pending' }],
      },
    });
  });

  it('emits GitHub Copilot CLI result usage tokens', () => {
    const events: unknown[] = [];
    const handler = createCopilotStreamHandler((event: unknown) => events.push(event));
    handler.feed(`${JSON.stringify({
      type: 'result',
      success: true,
      usage: {
        input_tokens: 21,
        output_tokens: 8,
        sessionDurationMs: 1234,
      },
    })}\n`);
    handler.flush();

    expect(events).toContainEqual({
      type: 'usage',
      usage: {
        input_tokens: 21,
        output_tokens: 8,
        sessionDurationMs: 1234,
      },
      stopReason: 'completed',
      durationMs: 1234,
    });
  });
});
