/**
 * Prompt parsing, analysis, and restructuring advice.
 *
 * This module is the plugin's brain and it is deliberately **pure**: no
 * services, no I/O, no model call. Both halves import it —
 *
 *   - the browser half runs it live on every keystroke (debounced), so the
 *     author sees gaps and advice instantly and for free;
 *   - the host half runs it once per rewrite to tell the model exactly which
 *     gaps to close, which is what makes the rewrite targeted instead of
 *     generic.
 *
 * Because it is pure, it is also directly unit-testable — see
 * `tests/analyze.spec.ts`.
 *
 * @module dsh-prompt-workbench/analyze
 */
/** One dimension a well-formed agent prompt should cover. */
export type DimensionId = 'goal' | 'context' | 'constraints' | 'output' | 'acceptance' | 'examples';
/** A dimension's verdict on the draft. */
export interface Dimension {
    readonly id: DimensionId;
    /** Human-facing label (Chinese, matching the plugin's UI language). */
    readonly label: string;
    /** Whether the draft shows evidence of this dimension. */
    readonly present: boolean;
    /** The matched fragment, trimmed — shown as proof in the UI. */
    readonly evidence?: string;
}
/** How loudly a suggestion should be presented. */
export type Severity = 'high' | 'medium' | 'low';
/** One actionable restructuring suggestion. */
export interface Suggestion {
    readonly id: string;
    readonly severity: Severity;
    readonly title: string;
    readonly detail: string;
    /**
     * A ready-to-insert snippet. The UI offers it as a one-click append, which
     * turns advice into action instead of prose the author has to retype.
     */
    readonly snippet?: string;
}
/** One section of the recommended outline for the active mode. */
export interface OutlineSection {
    readonly id: string;
    readonly heading: string;
    readonly hint: string;
}
/** The draft's dominant script. */
export type DetectedLanguage = 'zh' | 'en' | 'mixed';
/** The complete analysis of one draft. */
export interface PromptAnalysis {
    readonly chars: number;
    readonly lines: number;
    readonly language: DetectedLanguage;
    readonly dimensions: readonly Dimension[];
    /** Fraction of dimensions the draft covers, 0..1. */
    readonly coverage: number;
    /** Vague phrases found, in draft order, deduplicated. */
    readonly vagueness: readonly string[];
    /** Unresolved placeholders such as TODO / TBD / 待定. */
    readonly placeholders: readonly string[];
    /** Count of fenced code blocks. */
    readonly codeBlocks: number;
    /** Count of `@reference` tokens. */
    readonly references: number;
    /** Actionability score, 0..100. */
    readonly score: number;
    /** Ordered advice, highest severity first. */
    readonly suggestions: readonly Suggestion[];
    /** The recommended section skeleton for this draft. */
    readonly outline: readonly OutlineSection[];
}
/** Detect the draft's dominant script. */
export declare function detectLanguage(text: string): DetectedLanguage;
/**
 * The recommended section skeleton for a mode. `concise` has no skeleton on
 * purpose — compression must not add structure the author did not ask for.
 */
export declare function outlineFor(mode: string): OutlineSection[];
/**
 * Analyze one draft.
 *
 * Deterministic and side-effect free: the same draft always yields the same
 * report, which is what lets the UI render it on every keystroke and the tests
 * assert on it.
 *
 * @param text - the raw draft.
 * @param mode - the active rewrite mode; selects the outline template.
 * @returns the full analysis.
 */
export declare function analyzePrompt(text: string, mode: string): PromptAnalysis;
/**
 * Render the analysis as a compact instruction block for the model.
 *
 * This is what makes a rewrite targeted: instead of "improve this", the model
 * is told exactly which dimensions are missing. Kept short so it never crowds
 * out the draft itself.
 *
 * @param analysis - the draft's analysis.
 * @returns a bullet list, or an empty string when the draft already covers everything.
 */
export declare function describeGapsForModel(analysis: PromptAnalysis): string;
