import { realpath as fsRealpath } from 'node:fs/promises'
import { z } from 'zod'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'

type ResolveRealPath = (path: string) => Promise<string>

// `initialize_session` names the session beside a `session` that carries only its messages.
export const startedSchema = z.looseObject({
  sessionId: z.string().min(1).optional(),
  session: z.looseObject({ id: z.string().min(1).optional() }).optional(),
  // A load reports the folder the session was recorded in, as a real path.
  cwd: z.string().min(1).optional()
})

/** A loaded session runs its tools in the folder it was recorded in, wherever this child
 *  started, so a chat in another workspace would edit a tree the person did not pick. */
export async function refuseSessionFromOtherFolder(
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
