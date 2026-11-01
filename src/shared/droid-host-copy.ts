// Host fallbacks for older clients; desktop resolves each whole sentence through en.json.
export const DROID_HOST_COPY = {
  newerCompact: 'Compacting the conversation needs a newer Droid. Update Droid and try again.',
  newerFork: 'Forking the conversation needs a newer Droid. Update Droid and try again.',
  newerRewind: 'Rewinding the conversation needs a newer Droid. Update Droid and try again.',
  newerRename: 'Renaming the conversation needs a newer Droid. Update Droid and try again.',
  newerContext: 'Showing context usage needs a newer Droid. Update Droid and try again.',
  newerCwd: 'Changing the working folder needs a newer Droid. Update Droid and try again.',
  newerSkills: 'Listing skills needs a newer Droid. Update Droid and try again.',
  newerSkillToggle: 'Turning a skill on or off needs a newer Droid. Update Droid and try again.',
  newerMcp: 'Listing MCP servers needs a newer Droid. Update Droid and try again.',
  newerMcpAdd: 'Adding an MCP server needs a newer Droid. Update Droid and try again.',
  newerMcpRemove: 'Removing an MCP server needs a newer Droid. Update Droid and try again.',
  newerMcpToggle:
    'Turning an MCP server on or off needs a newer Droid. Update Droid and try again.',
  newerMcpSignIn: 'Signing in to an MCP server needs a newer Droid. Update Droid and try again.',
  newerBug: 'Sending a bug report needs a newer Droid. Update Droid and try again.',
  newerAutonomy: 'Changing the autonomy level needs a newer Droid. Update Droid and try again.',
  compressMoved:
    'Conversation compressed into a new Droid session. The earlier session stays in Session History.',
  compressDone: 'Conversation compressed to free up context.',
  compressOne:
    'Conversation compressed. {{removedCount}} earlier message was summarized to free up context.',
  compressMany:
    'Conversation compressed. {{removedCount}} earlier messages were summarized to free up context.',
  specHandoff: 'Continuing in a new Droid session',
  renameEmpty: 'Give the chat a title to rename it to.',
  renameRefused: 'Droid did not rename the conversation.',
  cwdEmpty: 'Give a folder to change to.',
  cwdOutside: 'Choose a folder inside this workspace ({{folder}}). {{target}} is outside it.',
  skillsUnreadable: 'Droid did not list its skills. Try again.',
  skillUnknown: 'Droid has no skill named {{skillName}}.',
  skillNotOff: 'Droid did not turn {{skillName}} off.',
  skillNotOn: 'Droid did not turn {{skillName}} on.',
  skillStillOff: 'Droid still lists {{skillName}} as off.',
  skillStillOn: 'Droid still lists {{skillName}} as on.',
  forkFailed: 'Droid did not return a new session for the fork. Try again.',
  notStarted: 'Droid did not start for this chat. Send a message and try again.',
  rewindUnknownFiles: 'Droid could not say which files the rewind changes. Nothing was rewound.',
  rewindNoSession:
    'Droid rewound the conversation but did not return a new session. Open Session History to find it.',
  rewindUnknownMessage: 'Droid has no record of this message to rewind to.',
  commandsUnavailable: 'Droid commands are unavailable for this chat.',
  mcpUnreadable: 'Droid did not list its MCP servers. Try again.',
  mcpSignInPending:
    'Sign-in to {{serverName}} has not finished. Finish it in your browser, then run /mcp to check.',
  mcpSignInStdio:
    'Droid could not sign in to {{serverName}}. Sign-in works only for remote (HTTP or SSE) servers that ask for it.',
  mcpSignInFailed: 'Droid could not sign in to {{serverName}}.',
  mcpSignInRefused: 'Droid did not sign in to {{serverName}}.',
  mcpNotAdded: 'Droid did not add {{serverName}}.',
  mcpNotOff: 'Droid did not turn {{serverName}} off.',
  mcpNotOn: 'Droid did not turn {{serverName}} on.',
  mcpNotRemoved: 'Droid did not remove {{serverName}}.',
  mcpStillListed: 'Droid still lists {{serverName}}.',
  mcpStillOn: 'Droid still lists {{serverName}} as on.',
  mcpStillOff: 'Droid still lists {{serverName}} as off.',
  mcpDuplicate: 'Droid already has an MCP server named {{serverName}}.',
  mcpUnknown: 'Droid has no MCP server named {{serverName}}.',
  mcpLinkNotOpened: 'Orca could not open the sign-in link for {{serverName}} on this host.',
  mcpLinkOpened:
    'Orca opened the sign-in link for {{serverName}} in your browser on this computer.',
  mcpSignInCancelled: 'Sign-in to {{serverName}} was cancelled.',
  mcpSignInIncomplete: 'Sign-in to {{serverName}} did not finish.',
  autonomyUnknown: 'Droid has no autonomy level named {{value}}'
} as const

export type DroidHostCopyKey = keyof typeof DROID_HOST_COPY
