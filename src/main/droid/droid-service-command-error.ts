const messages = {
  mcpUnreadable: 'Droid did not return a readable MCP server list.',
  mcpSignInPending: 'MCP sign-in is still pending. Check the server before retrying.',
  mcpSignInStdio: 'This stdio server does not support browser sign-in.',
  mcpSignInFailed: 'MCP sign-in failed.',
  mcpSignInRefused: 'Droid did not confirm MCP sign-in.',
  mcpNotAdded: 'Droid did not add this MCP server.',
  mcpNotOn: 'Droid did not enable this MCP server.',
  mcpNotOff: 'Droid did not disable this MCP server.',
  mcpNotRemoved: 'Droid did not remove this MCP server.',
  mcpStillListed: 'Droid still lists this MCP server.',
  mcpStillOn: 'This MCP server is still enabled.',
  mcpStillOff: 'This MCP server is still disabled.',
  mcpDuplicate: 'Droid already lists this MCP server.',
  mcpUnknown: 'Droid does not list this MCP server.',
  mcpSignInIncomplete: 'MCP sign-in did not finish.',
  mcpSignInCancelled: 'MCP sign-in was cancelled.',
  mcpLinkNotOpened: 'The sign-in link could not be opened on the initiating client.',
  skillsUnreadable: 'Droid did not return a readable skills list.',
  skillUnknown: 'Droid does not list this skill.',
  skillNotOff: 'Droid did not disable this skill.',
  skillNotOn: 'Droid did not enable this skill.',
  skillStillOn: 'This skill is still enabled.',
  skillStillOff: 'This skill is still disabled.'
}
export type DroidServiceErrorKey = keyof typeof messages
export class DroidServiceCommandError extends Error {
  constructor(key: DroidServiceErrorKey, _fields?: Record<string, string>) {
    super(messages[key])
  }
}
