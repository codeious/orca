import type { CatalogModel, CatalogOption } from './agent-session-option-catalog'

const SPEC_MODE_OPTION: CatalogOption = {
  id: 'planMode',
  label: 'Spec',
  category: 'mode',
  kind: { type: 'boolean', defaultValue: false },
  apply: {}
}

/** Spec belongs to the session, not a model, so every listed model offers it; a provider that
 *  never reports `planMode` gets no toggle. */
export function withSpecModeOption(
  models: readonly CatalogModel[],
  specReported: boolean
): CatalogModel[] {
  return specReported
    ? models.map((model) => ({ ...model, options: [...model.options, SPEC_MODE_OPTION] }))
    : [...models]
}
