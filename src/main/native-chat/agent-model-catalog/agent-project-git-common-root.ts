import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** A repository's `.git` directory, not a linked worktree's `.git` file. */
async function isGitDirectory(dir: string): Promise<boolean> {
  const git = join(dir, '.git')
  try {
    const entry = await stat(git)
    return entry.isDirectory() && (await exists(join(git, 'HEAD')))
  } catch {
    return false
  }
}

async function isGitFile(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, '.git'))).isFile()
  } catch {
    return false
  }
}

/**
 * Folders from `cwd` up to its git top-level. A linked worktree nested in its repository still
 * reaches that repository; one checked out elsewhere stops at the worktree. No git root: `cwd` only.
 */
export async function gitCommonRootDirectories(cwd: string): Promise<string[]> {
  const chain: string[] = []
  let linkedWorktree: string | null = null
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    chain.push(dir)
    if (await isGitDirectory(dir)) {
      return chain
    }
    if (linkedWorktree === null && (await isGitFile(dir))) {
      linkedWorktree = dir
    }
    if (dirname(dir) === dir) {
      if (linkedWorktree === null) {
        return [resolve(cwd)]
      }
      const end = chain.indexOf(linkedWorktree)
      return chain.slice(0, end + 1)
    }
  }
}
