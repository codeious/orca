import { z } from 'zod'
import type { DroidHostCommandResult } from '../../shared/droid-host-command'
import type { DroidSession } from './droid-session'

type Skills = Extract<DroidHostCommandResult, { name: 'skills' }>['skills']

const listedSchema = z.looseObject({
  skills: z.array(z.looseObject({ name: z.string().min(1), enabled: z.boolean() }))
})

const toggledSchema = z.looseObject({ success: z.unknown() })

async function listSkills(session: Pick<DroidSession, 'request'>): Promise<Skills> {
  // Without this Droid sends every skill's full text, which is hundreds of kilobytes.
  const answer = await session.request('droid.list_skills', { includeContent: false })
  const listed = listedSchema.safeParse(answer)
  if (!listed.success) {
    throw new Error('Droid did not list its skills. Try again.')
  }
  return listed.data.skills.map(({ name, enabled }) => ({ name, enabled }))
}

/** Lists Droid's skills; with a `toggle`, turns that skill on or off in the user's settings first. */
export async function runDroidSkills(
  session: Pick<DroidSession, 'request'>,
  toggle: { skillName: string; disabled: boolean } | undefined
): Promise<DroidHostCommandResult> {
  const before = await listSkills(session)
  if (!toggle) {
    return { name: 'skills', skills: before, changed: null }
  }
  const { skillName, disabled } = toggle
  const state = disabled ? 'off' : 'on'
  // Droid accepts any name and records it, so a typo would be written to the settings.
  if (!before.some((skill) => skill.name === skillName)) {
    throw new Error(`Droid has no skill named ${skillName}.`)
  }
  const answer = await session.request('droid.set_skill_disabled', {
    skillName,
    disabled,
    settingsLevel: 'user'
  })
  // An answer with no verdict at all is taken as done; any verdict that is not `true` is a refusal.
  const verdict = toggledSchema.safeParse(answer).data?.success
  if (verdict !== undefined && verdict !== true) {
    throw new Error(`Droid did not turn ${skillName} ${state}.`)
  }
  // A setting at another level can keep a skill as it was, so the new listing is what is believed.
  const skills = await listSkills(session)
  const now = skills.find((skill) => skill.name === skillName)
  if (now && now.enabled === disabled) {
    throw new Error(`Droid still lists ${skillName} as ${now.enabled ? 'on' : 'off'}.`)
  }
  return { name: 'skills', skills, changed: { skillName, disabled } }
}
