import { readFileSync } from 'node:fs'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { DROID_HOST_COPY } from '../../shared/droid-host-copy'

const COMMAND_MODULES = [
  'droid-fork-and-rewind.ts',
  'droid-host-commands.ts',
  'droid-mcp-sign-in.ts',
  'droid-mcp.ts',
  'droid-missing-method.ts',
  'droid-session-options.ts',
  'droid-skills.ts',
  'droid-spec-handoff.ts',
  'droid-working-folder.ts',
  '../native-chat/agent-session-wire/structured-agent-session-droid-command.ts'
]

// Provider session names, one log, and an unchanged optionRejected diagnostic are not UI copy.
const REVIEWED_EXCLUSIONS: Readonly<Record<string, readonly string[]>> = {
  'droid-fork-and-rewind.ts': ['Forked conversation', 'Rewound conversation'],
  'droid-mcp-sign-in.ts': [
    'Droid asked to sign in to an MCP server and the link could not be opened'
  ],
  'droid-session-options.ts': ['Droid did not report the mode it holds']
}

function isCallTo(node: ts.Node, names: readonly string[]): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    names.includes(node.expression.text)
  )
}

function keyViolations(key: ts.Expression | undefined): string[] {
  if (!key) {
    return ['missing-key']
  }
  if (ts.isStringLiteral(key)) {
    return Object.hasOwn(DROID_HOST_COPY, key.text) ? [] : ['unknown-key']
  }
  if (ts.isConditionalExpression(key)) {
    return [...keyViolations(key.whenTrue), ...keyViolations(key.whenFalse)]
  }
  // These two forwarding sites take a checked DroidHostCopyKey, not a sentence.
  return ts.isIdentifier(key) && key.text === 'key' ? [] : ['unchecked-key']
}

function hostCopyViolations(source: string, file = 'control.ts'): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const violations: string[] = []
  const excluded = REVIEWED_EXCLUSIONS[file] ?? []
  function visit(node: ts.Node): void {
    if (
      isCallTo(node, ['droidHostText']) ||
      (ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['DroidHostTextError', 'DroidMcpSignInStopped'].includes(node.expression.text))
    ) {
      violations.push(...keyViolations(node.arguments?.[0]))
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === 'ACTIONS' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property)) {
          violations.push(...keyViolations(property.initializer))
        }
      }
    }
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(parsed) === 'kind' &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === 'status'
      )
    ) {
      const keyed = node.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) &&
          isCallTo(property.expression, ['droidHostText', 'compressedWords'])
      )
      const rawText = node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ['text', 'textKey'].includes(property.name.getText(parsed))
      )
      if (!keyed || rawText) {
        violations.push('unkeyed-status')
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Error' &&
      !(
        file === 'droid-session-options.ts' &&
        node.arguments?.[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === 'Droid did not report the mode it holds'
      )
    ) {
      violations.push('unkeyed-error')
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /[a-z].*\s|\s.*[a-z]/i.test(node.text) &&
      !excluded.includes(node.text)
    ) {
      violations.push('unkeyed-english')
    }
    if (ts.isTemplateExpression(node) && /[a-z].*\s|\s.*[a-z]/i.test(node.getText(parsed))) {
      violations.push('unkeyed-english')
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return violations
}

describe('Part 2 Droid host copy coverage', () => {
  it('rejects an unkeyed English error as a positive control', () => {
    expect(hostCopyViolations("throw new Error('A newly added host sentence.')")).toContain(
      'unkeyed-error'
    )
  })

  it('rejects a status whose text bypasses the keyed builder, even via a variable', () => {
    expect(hostCopyViolations("const body = { kind: 'status', text: sentence }")).toContain(
      'unkeyed-status'
    )
    expect(
      hostCopyViolations("const body = { kind: 'status', ...droidHostText('specHandoff') }")
    ).toEqual([])
  })

  it('rejects a missing or unknown catalog key', () => {
    expect(hostCopyViolations('droidHostText()')).toContain('missing-key')
    expect(hostCopyViolations("new DroidHostTextError('unregisteredSentence')")).toContain(
      'unknown-key'
    )
  })

  it.each(COMMAND_MODULES)('keeps %s free of unreviewed English and plain errors', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    expect(hostCopyViolations(source, file)).toEqual([])
  })

  it('guards only the new Droid command entry on the multi-provider router', () => {
    const source = readFileSync(
      new URL(
        '../native-chat/agent-session-wire/structured-agent-session-adapter-router.ts',
        import.meta.url
      ),
      'utf8'
    )
    const parsed = ts.createSourceFile('router.ts', source, ts.ScriptTarget.Latest, true)
    const entries: string[] = []
    function visit(node: ts.Node): void {
      if (ts.isPropertyDeclaration(node) && node.name.getText(parsed) === 'droidCommand') {
        entries.push(node.getText(parsed))
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    expect(entries).toHaveLength(1)
    expect(hostCopyViolations(entries[0]!)).toEqual([])
  })

  it('detects a real command-source mutation and an unkeyed missing-method map', () => {
    const source = readFileSync(new URL('./droid-host-commands.ts', import.meta.url), 'utf8')
    const mutated = source.replace(
      "new DroidHostTextError('renameEmpty')",
      "new Error('An unkeyed replacement sentence.')"
    )
    expect(mutated).not.toBe(source)
    expect(hostCopyViolations(mutated)).toContain('unkeyed-error')
    expect(
      hostCopyViolations("const ACTIONS = { 'droid.rename_session': 'notRegistered' }")
    ).toContain('unknown-key')
  })
})
