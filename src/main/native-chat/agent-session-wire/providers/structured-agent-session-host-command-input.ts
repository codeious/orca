export type StructuredAgentSessionHostCommandInput = {
  openMcpSignIn?: (url: string) => boolean | Promise<boolean>
  sessionId: string
  fence: number
  name: string
  argument: string
  operationId: string
}
