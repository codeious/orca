import { z } from 'zod'
import {
  getRuntimePathBasename,
  isPathInsideOrEqual,
  resolveRuntimePath
} from '../../shared/cross-platform-path'
import type { DroidHostCommandResult } from '../../shared/droid-host-command'
import type { DroidSession } from './droid-session'

const movedSchema = z.looseObject({ resolvedPath: z.string().min(1).optional() })

type RealPath = (path: string) => Promise<string>

// A part that is not there keeps its name under the real path of its nearest parent that is.
async function realPathBeneathMissing(realpath: RealPath, path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    const parent = resolveRuntimePath(path, '..')
    if (parent === path) {
      return null
    }
    const real = await realPathBeneathMissing(realpath, parent)
    return real === null ? null : resolveRuntimePath(real, getRuntimePathBasename(path))
  }
}

/** A resume refuses a folder outside the workspace, so only a folder inside it is asked of Droid. */
export async function changeDroidWorkingFolder(
  session: Pick<DroidSession, 'request' | 'workspace'>,
  typed: string
): Promise<DroidHostCommandResult> {
  const requested = typed.trim()
  if (requested === '') {
    throw new Error('Give a folder to change to.')
  }
  const { folder, realpath } = session.workspace
  const named = resolveRuntimePath(folder, requested)
  const [root, real] = await Promise.all([
    realpath(folder).catch(() => folder),
    realPathBeneathMissing(realpath, named)
  ])
  const target = real ?? named
  if (!isPathInsideOrEqual(root, target)) {
    throw new Error(`Choose a folder inside this workspace (${folder}). ${target} is outside it.`)
  }
  const answer = await session.request('droid.change_working_directory', {
    workingDirectory: target
  })
  return { name: 'cwd', resolvedPath: movedSchema.safeParse(answer).data?.resolvedPath ?? target }
}
