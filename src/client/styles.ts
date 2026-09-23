/**
 * All CSS the plugin owns, as one string.
 *
 * Every colour is a `--dsw-alias-*` theme variable so light and dark both work
 * from the same sheet. Class names are prefixed `dsh-pw-` because this sheet is
 * global once injected.
 *
 * The floating panel anchors against the composer card: the composer exposes a
 * zero-height overlay anchor at its top edge, so `bottom: calc(100% + 10px)`
 * places the panel directly above the composer without clipping it.
 */
export const WORKBENCH_CSS = `
.dsh-pw-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px; margin: 0;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
  transition: background-color .16s ease, color .16s ease, border-color .16s ease, transform .12s ease;
}
.dsh-pw-trigger:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dsh-pw-trigger:active { transform: scale(.97); }
.dsh-pw-trigger-on {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.dsh-pw-spark { font-size: 12px; line-height: 1; }
.dsh-pw-ring {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: dsh-pw-spin .7s linear infinite;
}
.dsh-pw-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }

.dsh-pw-panel {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 10px);
  margin: 0 auto; max-width: 880px; box-sizing: border-box;
  max-height: min(76vh, 620px); overflow: auto; z-index: 40;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: 0 22px 52px -14px rgba(0, 0, 0, .3), 0 2px 8px rgba(0, 0, 0, .08);
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left;
  animation: dsh-pw-rise .18s cubic-bezier(.2, .8, .3, 1);
}
.dsh-pw-panel-card {
  position: static; inset: auto; margin: 8px 0 2px; max-width: none;
  max-height: 560px; animation: none;
}
.dsh-pw-head {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.dsh-pw-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 6px; max-width: 240px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-pw-spacer { flex: 1 1 auto; }
.dsh-pw-iconbtn {
  width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
}
.dsh-pw-iconbtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-pw-iconbtn:disabled { opacity: .4; cursor: not-allowed; }

.dsh-pw-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 14px 0; }
.dsh-pw-tab {
  height: 26px; padding: 0 11px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background-color .15s ease;
}
.dsh-pw-tab:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-pw-tab-on {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-pw-seg {
  display: inline-flex; align-items: center; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
}
.dsh-pw-seg > button {
  height: 24px; padding: 0 10px; border: 0; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px;
  transition: background-color .15s ease, color .15s ease;
}
.dsh-pw-seg > button:hover { color: var(--dsw-alias-label-primary); }
.dsh-pw-seg > button.dsh-pw-seg-on {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-pw-hint { padding: 7px 14px 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

.dsh-pw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px 14px 0; }
.dsh-pw-pane {
  display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-pane-head {
  display: flex; align-items: center; gap: 6px; padding: 7px 10px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.dsh-pw-body {
  height: 190px; min-height: 190px; box-sizing: border-box; overflow: auto;
  padding: 10px 12px; font-size: 12.5px; line-height: 1.62;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsh-pw-input {
  width: 100%; height: 190px; min-height: 190px; box-sizing: border-box;
  resize: none; border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 12.5px; line-height: 1.62; padding: 10px 12px;
  overflow-wrap: anywhere;
}
.dsh-pw-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .7; }
.dsh-pw-muted { color: var(--dsw-alias-label-secondary); }
.dsh-pw-caret::after {
  content: ''; display: inline-block; width: 2px; height: 1em; margin-left: 2px;
  vertical-align: -.12em; background: var(--dsw-alias-brand-primary);
  animation: dsh-pw-blink 1s steps(2, start) infinite;
}
.dsh-pw-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 24%, transparent); border-radius: 3px; }
.dsh-pw-del {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent);
  border-radius: 3px; text-decoration: line-through; opacity: .72;
}

.dsh-pw-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 14px; }
.dsh-pw-btn {
  height: 30px; padding: 0 13px; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, opacity .15s ease;
}
.dsh-pw-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dsh-pw-btn:disabled { opacity: .45; cursor: not-allowed; }
.dsh-pw-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-pw-btn-primary:hover:not(:disabled) { filter: brightness(1.07); background: var(--dsw-alias-brand-primary); }
.dsh-pw-status { margin-left: auto; font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-pw-msg { padding: 0 14px 10px; font-size: 12px; }
.dsh-pw-msg-err { color: var(--dsw-alias-state-error-primary); }
.dsh-pw-msg-ok { color: var(--dsw-alias-state-success-primary); }

/* Version-drift banner: the halves reload separately, so this is normal. */
.dsh-pw-drift {
  margin: 10px 14px 0; padding: 8px 10px; border-radius: 10px;
  font-size: 11.5px; line-height: 1.55;
  color: var(--dsw-alias-state-warn-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
.dsh-pw-iconbtn-on {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dsh-pw-btn-tiny { height: 24px; padding: 0 8px; font-size: 11px; }
.dsh-pw-msg { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Analysis strip: actionability score, dimension coverage, signal counts. */
.dsh-pw-strip {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px 0; font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.dsh-pw-score b { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dsh-pw-meter {
  display: inline-block; width: 90px; height: 5px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden; flex: 0 0 auto;
}
.dsh-pw-meter-fill {
  display: block; height: 100%; border-radius: 999px;
  background: var(--dsw-alias-brand-primary); transition: width .25s ease;
}
.dsh-pw-dims { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.dsh-pw-dim {
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); opacity: .55;
}
.dsh-pw-dim-on {
  opacity: 1; color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
}
.dsh-pw-signals { font-variant-numeric: tabular-nums; }

/* Restructuring advice. */
.dsh-pw-sugg { padding: 10px 14px 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-pw-sugg-empty {
  font-size: 12px; color: var(--dsw-alias-state-success-primary);
  padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);
}
.dsh-pw-sugg-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-sev { flex: 0 0 auto; width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; }
.dsh-pw-sev-high { background: var(--dsw-alias-state-error-primary); }
.dsh-pw-sev-medium { background: var(--dsw-alias-state-warn-primary); }
.dsh-pw-sev-low { background: var(--dsw-alias-label-secondary); }
.dsh-pw-sugg-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dsh-pw-sugg-title { font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-pw-sugg-detail { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsh-pw-sugg-insert {
  flex: 0 0 auto; height: 24px; padding: 0 10px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; cursor: pointer;
}
.dsh-pw-sugg-insert:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }

/* Formatted result blocks. */
.dsh-pw-block { margin: 0 0 6px; }
.dsh-pw-block:last-child { margin-bottom: 0; }
.dsh-pw-block-h {
  font-weight: 600; color: var(--dsw-alias-label-primary);
  margin: 10px 0 4px; padding-bottom: 3px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-pw-block-h:first-child { margin-top: 0; }
.dsh-pw-block-list { color: var(--dsw-alias-label-primary); }
.dsh-pw-block-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 8px 10px; white-space: pre; overflow-x: auto;
}

/* Outline coverage. */
.dsh-pw-outline-row { padding: 5px 0; font-size: 12px; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.dsh-pw-outline-row:last-child { border-bottom: 0; }
.dsh-pw-ok { color: var(--dsw-alias-state-success-primary); }
.dsh-pw-bad { color: var(--dsw-alias-label-secondary); }

/* Settings. */
.dsh-pw-cfg {
  margin: 10px 14px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-cfg-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-pw-cfg-label { min-width: 84px; color: var(--dsw-alias-label-secondary); }
.dsh-pw-select {
  height: 26px; padding: 0 6px; border-radius: 8px; font: inherit; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay, transparent);
  color: var(--dsw-alias-label-primary);
}

/* Host-side self-diagnosis. */
.dsh-pw-diag {
  margin: 10px 14px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, transparent);
}
.dsh-pw-diag-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
.dsh-pw-diag-head > span { flex: 1 1 auto; }
.dsh-pw-diag-row { font-size: 11.5px; line-height: 1.5; }
.dsh-pw-diag-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }

@keyframes dsh-pw-spin { to { transform: rotate(360deg); } }
@keyframes dsh-pw-blink { 50% { opacity: 0; } }
@keyframes dsh-pw-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 860px) {
  .dsh-pw-grid { grid-template-columns: 1fr; }
  .dsh-pw-body, .dsh-pw-input { height: 150px; min-height: 150px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-pw-panel, .dsh-pw-ring, .dsh-pw-caret::after { animation: none; }
}
`
