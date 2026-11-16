import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { AgentModelCatalogEntry } from './agent-model-catalog-entry'
import { createAgentModelCatalogFilePersistence } from './agent-model-catalog-persistence'

it('retains a separately configured plan pair and account-defined models across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orca-catalog-round-trip-'))
  try {
    const entry: AgentModelCatalogEntry = {
      agent: 'grok',
      fingerprint: 'account',
      discovered: {
        origin: 'probe',
        at: 1,
        models: [
          { id: 'main', label: 'Main', efforts: [], isDefault: true },
          { id: 'custom:local', label: 'Local', efforts: [], isDefault: false, isCustom: true }
        ]
      },
      live: null,
      models: [],
      origin: 'probe',
      fetchedAt: 1,
      configured: {
        modelId: 'main',
        effort: 'high',
        spec: { model: 'custom:local', effort: 'none' },
        at: 1
      }
    }
    const persistence = createAgentModelCatalogFilePersistence(directory)
    await persistence.load()
    persistence.save(() => [entry])
    await persistence.flush()
    const reopened = createAgentModelCatalogFilePersistence(directory)
    expect(await reopened.load()).toMatchObject([
      {
        configured: {
          modelId: 'main',
          effort: 'high',
          spec: { model: 'custom:local', effort: 'none' }
        },
        models: [{ id: 'main' }, { id: 'custom:local', isCustom: true }]
      }
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
