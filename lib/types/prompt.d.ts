/**
 * Rewrite modes and the system instruction.
 *
 * Pure functions only — no services, no I/O — so the whole prompt surface can
 * be unit-tested without booting a harness.
 */
/** Refuse absurd payloads instead of silently truncating the draft. */
export declare const MAX_INPUT_CHARS = 24000;
/** The rewrite modes in presentation order. */
export declare const MODE_KEYS: readonly ["refine", "constraints", "structure", "concise"];
/** One accepted rewrite mode. */
export type RewriteMode = (typeof MODE_KEYS)[number];
/** The output language: an explicit choice, or `auto` following the draft. */
export type OutputLanguage = 'auto' | 'zh' | 'en';
/** True when the text carries CJK script, used for automatic language choice. */
export declare function hasCjk(text: string): boolean;
/** Narrow an untrusted wire value to a known mode. */
export declare function normalizeMode(value: unknown): RewriteMode;
/** Narrow an untrusted wire value to a known language choice. */
export declare function normalizeLanguage(value: unknown): OutputLanguage;
/** Resolve the requested output language, with `auto` following the draft. */
export declare function outputLanguage(language: OutputLanguage, source: string): 'zh' | 'en';
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
export declare function buildSystemInstruction(mode: RewriteMode, outLang: 'zh' | 'en', gaps?: string): string;
/** Normalize any thrown value into a printable message. */
export declare function errorMessage(error: unknown): string;
