// Doc 09 §4 — every prompt module has this shape. `version` is written into
// ai_usage and (where applicable) triage_results, which is what makes doc
// 21's safety eval comparable across prompt changes.

export interface PromptModule<Input> {
  version: string;
  system: string;
  build: (input: Input) => string;
}
