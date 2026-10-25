/** Droid stores its reminders, hook output and sign-in notice as messages nobody typed or reads as the conversation. */
export function isDroidConversationMessage(message: Record<string, unknown> | null): boolean {
  const visibility = message?.visibility
  return visibility !== 'llm_only' && visibility !== 'user_only'
}
