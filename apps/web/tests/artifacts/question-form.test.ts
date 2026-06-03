import { describe, expect, it } from 'vitest';

import {
  formatFormAnswers,
  splitOnQuestionForms,
  parsePartialQuestionForm,
} from '../../src/artifacts/question-form';

const VALID_BODY = `{
  "questions": [
    { "id": "platform", "label": "Platform", "type": "radio",
      "options": ["Mobile", "Desktop", "Responsive"], "required": true }
  ]
}`;

describe('splitOnQuestionForms', () => {
  it('normalizes string and object question options', () => {
    const input = [
      '<question-form id="discovery" title="Quick brief">',
      '{',
      '  "questions": [',
      '    {',
      '      "id": "platform",',
      '      "label": "Primary surface",',
      '      "type": "radio",',
      '      "required": true,',
      '      "options": [',
      '        "Responsive",',
      '        { "label": "Mobile (iOS/Android)", "description": "Phone-first app prototype", "value": "mobile" },',
      '        { "label": "Desktop web", "description": "Browser-first prototype" },',
      '        { "description": "Missing label" }',
      '      ]',
      '    }',
      '  ]',
      '}',
      '</question-form>',
    ].join('\n');

    const segments = splitOnQuestionForms(input);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: 'form' });
    if (segments[0]?.kind !== 'form') throw new Error('expected parsed form segment');

    expect(segments[0].form.questions[0]?.options).toEqual([
      { label: 'Responsive', value: 'Responsive' },
      {
        label: 'Mobile (iOS/Android)',
        value: 'mobile',
        description: 'Phone-first app prototype',
      },
      {
        label: 'Desktop web',
        value: 'Desktop web',
        description: 'Browser-first prototype',
      },
    ]);
  });

  it('preserves stable option values when formatting object-option answers', () => {
    const text = formatFormAnswers(
      {
        id: 'discovery',
        title: 'Quick brief',
        questions: [
          {
            id: 'platform',
            label: 'Primary surface',
            type: 'radio',
            options: [
              { label: 'Mobile (iOS/Android)', value: 'mobile' },
              { label: 'Desktop web', value: 'Desktop web' },
            ],
          },
        ],
      },
      { platform: 'mobile' },
    );

    expect(text).toContain('- Primary surface: Mobile (iOS/Android) [value: mobile]');
  });

  it('parses the canonical <question-form> tag', () => {
    const out = splitOnQuestionForms(`prose\n<question-form id="d" title="T">${VALID_BODY}</question-form>\nmore`);
    expect(out.map((s) => s.kind)).toEqual(['text', 'form', 'text']);
    if (out[1]?.kind === 'form') {
      expect(out[1].form.id).toBe('d');
      expect(out[1].form.questions).toHaveLength(1);
    }
  });

  it('accepts <ask-question> as an alias for <question-form> (#1194)', () => {
    const out = splitOnQuestionForms(`<ask-question id="brief" title="Quick brief">${VALID_BODY}</ask-question>`);
    expect(out.map((s) => s.kind)).toEqual(['form']);
    if (out[0]?.kind === 'form') {
      expect(out[0].form.id).toBe('brief');
      expect(out[0].form.title).toBe('Quick brief');
      expect(out[0].form.questions[0]?.id).toBe('platform');
    }
  });

  it('handles mixed casing on the alias (e.g. <Ask-Question>)', () => {
    const out = splitOnQuestionForms(`<Ask-Question>${VALID_BODY}</Ask-Question>`);
    expect(out.map((s) => s.kind)).toEqual(['form']);
  });

  it('does not close one tag with the other tag name', () => {
    const out = splitOnQuestionForms(`<question-form>${VALID_BODY}</ask-question>`);
    expect(out.map((s) => s.kind)).toEqual(['text']);
  });

  it('keeps malformed JSON bodies as raw text', () => {
    const out = splitOnQuestionForms(`<ask-question>not json</ask-question>`);
    expect(out.map((s) => s.kind)).toEqual(['text']);
  });

  it('keeps unterminated tags as prose without swallowing trailing text', () => {
    const out = splitOnQuestionForms(`leading <ask-question>${VALID_BODY}`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'text' });
  });

  it('finds close tags without Unicode index desync (#1194)', () => {
    const out = splitOnQuestionForms(`prefix İ suffix<ask-question id="x">${VALID_BODY}</ask-question>`);
    expect(out.map((s) => s.kind)).toEqual(['text', 'form']);
    if (out[1]?.kind === 'form') {
      expect(out[1].form.id).toBe('x');
    }
  });
});

describe('parsePartialQuestionForm (true token-by-token streaming)', () => {
  it('surfaces a question before its object closes, then grows its options', () => {
    // Open tag + a question whose label has arrived but whose options array is
    // still mid-stream (no closing `}` on the question object yet).
    const midLabel = '<question-form id="discovery">{"questions":[{"id":"platform","label":"Platform"';
    const f1 = parsePartialQuestionForm(midLabel);
    expect(f1?.questions.map((q) => q.label)).toEqual(['Platform']);

    const oneOption =
      '<question-form id="discovery">{"questions":[{"id":"platform","label":"Platform","type":"radio","options":["Mobile"';
    const f2 = parsePartialQuestionForm(oneOption);
    expect(f2?.questions[0]?.options?.map((o) => o.label)).toEqual(['Mobile']);

    const twoOptions =
      '<question-form id="discovery">{"questions":[{"id":"platform","label":"Platform","type":"radio","options":["Mobile","Desktop"';
    const f3 = parsePartialQuestionForm(twoOptions);
    expect(f3?.questions[0]?.options?.map((o) => o.label)).toEqual(['Mobile', 'Desktop']);
  });

  it('holds back a trailing question until its label exists (no id placeholder flicker)', () => {
    // First question complete; second object opened but no label yet.
    const buf =
      '<question-form id="discovery">{"questions":[{"id":"a","label":"First","type":"text"},{"id":"b"';
    const f = parsePartialQuestionForm(buf);
    expect(f?.questions.map((q) => q.label)).toEqual(['First']);
  });

  it('reads title/id from the open tag before any question arrives', () => {
    const f = parsePartialQuestionForm('<question-form id="discovery" title="Quick brief">{"questions":[');
    expect(f?.id).toBe('discovery');
    expect(f?.title).toBe('Quick brief');
    expect(f?.questions).toEqual([]);
  });
});
