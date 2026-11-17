const messages = {
  mcpUnreadable: 'Droid did not return a readable MCP server list.',
  mcpUnknown: 'Droid does not list this MCP server.',
  mcpSignInPending: 'MCP sign-in is still pending. Check the server before retrying.',
  mcpSignInStdio: 'This server does not support browser sign-in.',
  mcpSignInFailed: 'MCP sign-in failed.',
  mcpSignInRefused: 'Droid did not confirm MCP sign-in.',
  mcpSignInIncomplete: 'MCP sign-in did not finish.',
  mcpSignInCancelled: 'MCP sign-in was cancelled.',
  mcpCallbackMismatch: "That address doesn't match the sign-in in progress.",
  mcpNoReconnect: 'Droid reconnects MCP servers itself; turn the server off and on instead.',
  mcpNotOn: 'Droid did not enable this MCP server.',
  mcpNotOff: 'Droid did not disable this MCP server.',
  mcpStillOn: 'This MCP server is still enabled.',
  mcpStillOff: 'This MCP server is still disabled.',
  skillsUnreadable: 'Droid did not return a readable skills list.',
  skillUnknown: 'Droid does not list this skill.',
  skillNotOff: 'Droid did not disable this skill.',
  skillNotOn: 'Droid did not enable this skill.',
  skillStillOn: 'This skill is still enabled.',
  skillStillOff: 'This skill is still disabled.'
}
export type DroidServiceErrorKey = keyof typeof messages
export class DroidServiceCommandError extends Error {
  constructor(key: DroidServiceErrorKey) {
    super(messages[key])
  }
}
