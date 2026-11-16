import type {
  AgentModelCatalogConfiguredChoice,
  AgentModelCatalogConfiguredDefault
} from './agent-model-catalog-entry'

/** Preserve effort for the same model when a session pick obscures its configured value. */
export function configuredDefaultFacts(
  choice:
    | (AgentModelCatalogConfiguredChoice & Pick<AgentModelCatalogConfiguredDefault, 'spec'>)
    | null,
  previous: AgentModelCatalogConfiguredDefault | null = null
): Omit<AgentModelCatalogConfiguredDefault, 'at'> | null {
  if (!choice) {
    return null
  }
  const effort =
    choice.effort === undefined
      ? previous?.modelId === choice.modelId
        ? previous.effort
        : undefined
      : (choice.effort ?? undefined)
  return {
    modelId: choice.modelId,
    ...(choice.sameModelIds?.length ? { sameModelIds: [...choice.sameModelIds] } : {}),
    ...(effort ? { effort } : {}),
    ...((choice.spec ?? previous?.spec) ? { spec: choice.spec ?? previous?.spec } : {})
  }
}
