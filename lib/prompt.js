/**
 * Rewrite modes and the system instruction.
 *
 * Pure functions only — no services, no I/O — so the whole prompt surface can
 * be unit-tested without booting a harness.
 */
/** Refuse absurd payloads instead of silently truncating the draft. */
export const MAX_INPUT_CHARS = 24000;
/** Per-mode rewrite directives. Keys are the wire values the UI sends. */
const MODE_GUIDE = {
    refine: 'Clarify and expand. Turn the vague wish into concrete, checkable requirements: state the real goal, the expected outcome, and the concrete deliverables or steps. Supply the obviously implied context, but never invent facts the author did not imply.',
    constraints: 'Add constraints. Make the implicit boundaries explicit: in scope and out of scope, platform or technical limits, style and compatibility rules, non-goals, and the acceptance criteria the result must satisfy.',
    structure: 'Restructure. Reorganize the whole prompt into a clean, scannable hierarchy (for example: 目标 / 背景 / 输入 / 具体要求 / 输出格式 / 验收标准). Keep every original detail — change the shape, not the content.',
    concise: 'Compress. Remove filler, hedging, and repetition, merge overlapping statements, and keep every distinct fact and requirement. The result must be clearly shorter without losing information.',
};
/** The rewrite modes in presentation order. */
export const MODE_KEYS = ['refine', 'constraints', 'structure', 'concise'];
/** True when the text carries CJK script, used for automatic language choice. */
export function hasCjk(text) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}
/** Narrow an untrusted wire value to a known mode. */
export function normalizeMode(value) {
    return typeof value === 'string' && MODE_KEYS.includes(value)
        ? value
        : 'refine';
}
/** Narrow an untrusted wire value to a known language choice. */
export function normalizeLanguage(value) {
    return value === 'zh' || value === 'en' ? value : 'auto';
}
/** Resolve the requested output language, with `auto` following the draft. */
export function outputLanguage(language, source) {
    if (language === 'zh')
        return 'zh';
    if (language === 'en')
        return 'en';
    return hasCjk(source) ? 'zh' : 'en';
}
/**
 * The system instruction for one rewrite mode and output language.
 *
 * Rules 1–4 protect the user: the model must not answer the prompt, must not
 * invent facts, and must leave placeholders and code blocks untouched.
 *
 * @param mode - the active rewrite mode.
 * @param outLang - the resolved output language.
 * @param gaps - an optional pre-computed gap report from `analyzePrompt`, so the
 *   rewrite targets the dimensions this draft actually lacks instead of
 *   applying the same generic treatment to every draft.
 */
export function buildSystemInstruction(mode, outLang, gaps = '') {
    const guide = MODE_GUIDE[mode] ?? MODE_GUIDE.refine;
    const lines = [
        'You are a senior prompt engineer. Rewrite the draft prompt the user supplies so that an AI coding agent can act on it precisely, without guessing.',
        '',
        'Hard rules:',
        '1. Output ONLY the improved prompt. No preface, no explanation, no meta commentary, and no code fence wrapping the whole answer.',
        '2. Never answer, execute, or critique the draft. Only rewrite it.',
        '3. Preserve every concrete fact: names, numbers, versions, file paths, API names, error text. Never invent files, libraries, or requirements.',
        '4. Keep placeholders and literals untouched: @path references, {variables}, <angle-bracket> slots, TODOs, URLs, and fenced code blocks.',
        `5. Write the improved prompt in ${outLang === 'zh' ? '简体中文' : 'English'}.`,
        '6. Be tight and unambiguous. Headings and bullet lists are welcome when they aid scanning.',
        '7. When a detail is too vague to make concrete, express it inside the prompt as one explicit open question instead of guessing.',
        '8. Do not add a section that merely restates these instructions.',
        '',
        `Rewrite mode — ${guide}`,
    ];
    if (gaps !== '') {
        lines.push('', 'A deterministic analysis of this draft found the following. Close these gaps inside the rewrite:', gaps);
    }
    return lines.join('\n');
}
/** Normalize any thrown value into a printable message. */
export function errorMessage(error) {
    if (error === null || error === undefined)
        return 'unknown error';
    if (typeof error === 'string')
        return error;
    if (typeof error === 'object' && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string' && message !== '')
            return message;
    }
    return String(error);
}
