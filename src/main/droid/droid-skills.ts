import { z } from 'zod'
import type { DroidServiceCommandResult } from './droid-service-command-types'
import { DroidServiceCommandError as DroidHostTextError } from './droid-service-command-error'
import type { DroidSession } from './droid-session'

type Skills = Extract<DroidServiceCommandResult, { name: 'skills' }>['skills']

const listedSchema = z.looseObject({
  skills: z.array(z.looseObject({ name: z.string().min(1), enabled: z.boolean() }))
})

const toggledSchema = z.looseObject({ success: z.unknown() })

async function listSkills(session: Pick<DroidSession, 'request'>): Promise<Skills> {
  // Without this Droid sends every skill's full text, which is hundreds of kilobytes.
  const answer = await session.request('droid.list_skills', { includeContent: false })
  const listed = listedSchema.safeParse(answer)
  if (!listed.success) {
    throw new DroidHostTextError('skillsUnreadable')
  }
  return listed.data.skills.map(({ name, enabled }) => ({ name, enabled }))
}

/** Lists Droid's skills; with a `toggle`, turns that skill on or off in the user's settings first. */
export async function runDroidSkills(
  session: Pick<DroidSession, 'request'>,
  toggle: { skillName: string; disabled: boolean } | undefined
): Promise<DroidServiceCommandResult> {
  const before = await listSkills(session)
  if (!toggle) {
    return { name: 'skills', skills: before, changed: null }
  }
  const { skillName, disabled } = toggle
  // Droid accepts any name and records it, so a typo would be written to the settings.
  if (!before.some((skill) => skill.name === skillName)) {
    throw new DroidHostTextError('skillUnknown', { skillName })
  }
  const answer = await session.request('droid.set_skill_disabled', {
    skillName,
    disabled,
    settingsLevel: 'user'
  })
  // An answer with no verdict at all is taken as done; any verdict that is not `true` is a refusal.
  const verdict = toggledSchema.safeParse(answer).data?.success
  if (verdict !== undefined && verdict !== true) {
    throw new DroidHostTextError(disabled ? 'skillNotOff' : 'skillNotOn', { skillName })
  }
  // A setting at another level can keep a skill as it was, so the new listing is what is believed.
  const skills = await listSkills(session)
  const now = skills.find((skill) => skill.name === skillName)
  if (!now || now.enabled === disabled) {
    throw new DroidHostTextError(disabled ? 'skillStillOn' : 'skillStillOff', { skillName })
  }
  return { name: 'skills', skills, changed: { skillName, disabled } }
}
