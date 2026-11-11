import { useCallback } from 'react'
import { useNativeChatComposerAttachments } from '../attachments/chips/use-native-chat-composer-attachments'
import type { UseNativeChatComposerAttachmentsArgs } from '../attachments/chips/native-chat-composer-attachment-contract'
import { useNativeChatFileDrops } from '../attachments/intake/use-native-chat-file-drops'
import type { NativeChatComposerProps } from './native-chat-composer-types'

type Args = Omit<
  UseNativeChatComposerAttachmentsArgs,
  | 'attachmentScopeKey'
  | 'acceptsImages'
  | 'imageReferences'
  | 'allowWithoutTarget'
  | 'resolveTarget'
> &
  Pick<
    NativeChatComposerProps,
    'paneKey' | 'terminalTabId' | 'targetPtyId' | 'structuredTransport'
  > & { draftScopeKey: string }

export function useNativeChatComposerFileIntake({
  paneKey,
  terminalTabId,
  targetPtyId,
  structuredTransport,
  draftScopeKey,
  ...editor
}: Args) {
  const resolveTarget = useCallback(
    () => (targetPtyId ? { ptyId: targetPtyId } : null),
    [targetPtyId]
  )
  const attachments = useNativeChatComposerAttachments({
    attachmentScopeKey: draftScopeKey,
    allowWithoutTarget: Boolean(structuredTransport),
    acceptsImages: structuredTransport?.acceptsImages !== false,
    imageReferences: Boolean(structuredTransport),
    resolveTarget,
    ...editor
  })
  const fileDrops = useNativeChatFileDrops({
    paneKey,
    draftScopeKey,
    targetPtyId,
    structuredTransport,
    terminalTabId,
    structuredWorktreeId: structuredTransport?.worktreeId,
    structuredSession: structuredTransport,
    disabled: editor.disabled,
    attachResolvedPaths: attachments.attachResolvedPaths,
    pendingChips: attachments.pendingChips,
    setNotice: editor.setNotice
  })
  const attachDisabled =
    editor.disabled ||
    (structuredTransport?.runtime === 'remote' && structuredTransport.sessionPending === true)
  return { attachments, fileDrops, attachDisabled, resolveTarget }
}
