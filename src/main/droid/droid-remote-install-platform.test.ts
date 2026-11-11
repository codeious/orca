import { expect, it, vi } from 'vitest'
import { createAgentHookMemorySftp } from '../agent-hooks/installation/remote/testing/agent-hook-memory-sftp.test-fixture'
import { installRemoteManagedAgentHooks } from '../agent-hooks/installation/remote-managed-hook-installers'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-user-data' } }))

it('reports a macOS remote organization restriction through the managed installer', async () => {
  const { sftp } = createAgentHookMemorySftp({
    '/Library/Application Support/Factory/settings.json': '{"allowManagedHooksOnly":true}'
  })
  expect(
    await installRemoteManagedAgentHooks(sftp, '/Users/remote', {
      agents: ['droid'],
      platform: 'darwin'
    })
  ).toMatchObject([
    {
      agent: 'droid',
      state: 'partial',
      configPath: '/Users/remote/.factory/hooks.json',
      managedHooksPresent: true
    }
  ])
})
