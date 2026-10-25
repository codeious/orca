import { realpath as fsRealpath } from 'node:fs/promises'
import { z } from 'zod'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'

type ResolveRealPath = (path: string) => Promise<string>

// `initialize_session` names the session beside a `session` that carries only its messages.
const startedSchema = z.looseObject({
  sessionId: z.string().min(1).optional(),
  session: z.looseObject({ id: z.string().min(1).optional() }).optional(),
  // A load reports the folder the session was recorded in, as a real path.
  cwd: z.string().min(1).optional(),
  // Read leniently by `parseDroidSettings`: an unknown field never costs the start.
  settings: z.unknown().optional()
})

/** The id Droid holds the session under, and what it reported about it. `resume` is the load asked for. */
export async function readStartedSession(
  result: unknown,
  resume: { id: string; cwd: string; realpath: ResolveRealPath | undefined } | null
): Promise<{ id: string; settings: unknown }> {
  const parsed = startedSchema.safeParse(result)
  const started = parsed.success ? parsed.data : undefined
  if (resume) {
    await refuseSessionFromOtherFolder(resume.cwd, started?.cwd, resume.realpath)
  }
  // A load answers with the session's content, never its id, so the one asked for is the one held.
  const id = started?.sessionId ?? started?.session?.id ?? resume?.id
  if (!id) {
    throw new Error('Droid did not name its session')
  }
  if (resume && id !== resume.id) {
    throw new Error('Droid loaded a different session')
  }
  return { id, settings: started?.settings }
}

/** A loaded session runs its tools in the folder it was recorded in, wherever this child
 *  started, so a chat in another workspace would edit a tree the person did not pick. */
async function refuseSessionFromOtherFolder(
  workspace: string,
  reported: string | undefined,
  realpath: ResolveRealPath = fsRealpath
): Promise<void> {
  if (!reported) {
    throw new Error('Droid did not report the folder of the session it loaded')
  }
  // Droid reports real paths, so the workspace is resolved too; a folder that is gone keeps its name.
  const [expected, actual] = await Promise.all([
    realpath(workspace).catch(() => workspace),
    realpath(reported).catch(() => reported)
  ])
  if (normalizeRuntimePathForComparison(expected) !== normalizeRuntimePathForComparison(actual)) {
    throw new Error('Droid loaded the session from another folder than this workspace')
  }
}
