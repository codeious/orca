export const DROID_MCP_NAME_MAX_LENGTH = 200
export type DroidMcpAction =
  | { kind: 'list' }
  | {
      kind: 'add'
      serverName: string
      server:
        | { type: 'stdio'; command: string; args: string[] }
        | { type: 'http' | 'sse'; url: string }
    }
  | { kind: 'toggle'; serverName: string; enabled: boolean }
  | { kind: 'remove'; serverName: string }
  | { kind: 'sign-in'; serverName: string }
export type DroidMcpServer = {
  name: string
  status: string
  type: 'stdio' | 'http' | 'sse' | null
  toolCount: number | null
  needsSignIn: boolean
}
export type DroidMcpChange = {
  kind: 'added' | 'enabled' | 'disabled' | 'removed' | 'signed-in'
  serverName: string
}
export type DroidServiceCommandResult =
  | { name: 'mcp'; servers: DroidMcpServer[]; changed: DroidMcpChange | null }
  | {
      name: 'skills'
      skills: { name: string; enabled: boolean }[]
      changed: { skillName: string; disabled: boolean } | null
    }
