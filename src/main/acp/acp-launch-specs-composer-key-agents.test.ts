import { describe, expect, it } from 'vitest'
import { NON_DROID_ACP_AGENTS } from '../../shared/non-droid-composer-key-agents.test-fixture'
import { ACP_LAUNCH_SPECS } from './acp-launch-specs'

// The renderer key tests loop over this list; an ACP agent missing from it would skip them silently.
describe('the non-Droid agents the composer key tests cover', () => {
  it('name every ACP agent this build ships', () => {
    expect([...NON_DROID_ACP_AGENTS].sort()).toEqual(
      ACP_LAUNCH_SPECS.map((spec) => spec.agent).sort()
    )
  })
})
