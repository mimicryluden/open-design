import { describe, it, expect } from 'vitest';
import {
  repairJsonPrefix,
  parsePartialJson,
  parsePartialAskUserQuestion,
  parseAskUserQuestionInput,
  isStreamingAuqInput,
  AUQ_STREAMING_KEY,
} from '../../src/runtime/ask-user-question';

const FULL =
  '{"questions":[{"header":"DB","question":"Which database?","multiSelect":false,"options":[{"label":"Postgres","description":"Relational"},{"label":"SQLite"}]}]}';

describe('repairJsonPrefix', () => {
  it('closes open containers in a truncated object', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1'))).toEqual({ a: 1 });
    expect(JSON.parse(repairJsonPrefix('{"a":[1,2'))).toEqual({ a: [1, 2] });
  });

  it('closes a string cut off mid-value', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":"hel'))).toEqual({ a: 'hel' });
  });

  it('drops a dangling key with a colon and no value', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1,"b":'))).toEqual({ a: 1 });
  });

  it('drops a bare pending key with no colon', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1,"b'))).toEqual({ a: 1 });
  });

  it('drops a trailing comma', () => {
    expect(JSON.parse(repairJsonPrefix('[1,2,'))).toEqual([1, 2]);
  });

  it('does not mistake an escaped quote for the string end', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":"x\\"y'))).toEqual({ a: 'x"y' });
  });

  it('leaves complete JSON untouched', () => {
    expect(JSON.parse(repairJsonPrefix(FULL))).toEqual(JSON.parse(FULL));
  });
});

describe('parsePartialJson', () => {
  it('returns null for empty / unparseable input', () => {
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('   ')).toBeNull();
  });
});

describe('parsePartialAskUserQuestion (token-by-token stability)', () => {
  it('keeps a question as soon as its prompt text exists, before options arrive', () => {
    const buf = '{"questions":[{"header":"DB","question":"Which database?"';
    const qs = parsePartialAskUserQuestion(buf);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ question: 'Which database?', header: 'DB', options: [] });
  });

  it('does not surface a question before its prompt has any text', () => {
    expect(parsePartialAskUserQuestion('{"questions":[{"header":"DB"')).toHaveLength(0);
    expect(parsePartialAskUserQuestion('{"questions":[{"header":"DB","question":""')).toHaveLength(0);
  });

  it('grows options as they stream in, skipping a half-typed label', () => {
    const afterFirst = parsePartialAskUserQuestion(
      '{"questions":[{"question":"Q","options":[{"label":"Postgres"},{"label":"SQ',
    );
    expect(afterFirst[0]?.options.map((o) => o.label)).toEqual(['Postgres', 'SQ']);

    const labelNotYetStarted = parsePartialAskUserQuestion(
      '{"questions":[{"question":"Q","options":[{"label":"Postgres"},{"lab',
    );
    expect(labelNotYetStarted[0]?.options.map((o) => o.label)).toEqual(['Postgres']);
  });

  it('monotonically converges to the strict parse at completion', () => {
    let sawPrompt = false;
    for (let i = 1; i <= FULL.length; i++) {
      const qs = parsePartialAskUserQuestion(FULL.slice(0, i));
      if (qs.length > 0 && qs[0]!.question === 'Which database?') sawPrompt = true;
      if (sawPrompt && qs.length > 0) {
        expect('Which database?'.startsWith(qs[0]!.question) || qs[0]!.question === 'Which database?').toBe(true);
      }
    }
    expect(parsePartialAskUserQuestion(FULL)).toEqual(parseAskUserQuestionInput(JSON.parse(FULL)));
  });
});

describe('streaming marker', () => {
  it('detects the streaming sentinel', () => {
    expect(isStreamingAuqInput({ questions: [], [AUQ_STREAMING_KEY]: true })).toBe(true);
    expect(isStreamingAuqInput({ questions: [] })).toBe(false);
    expect(isStreamingAuqInput(null)).toBe(false);
  });
});
