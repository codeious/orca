type ProviderHookCapabilities = {
  capturesProcessIdentity?: true
}

export const PROVIDER_HOOK_CAPABILITIES: Readonly<Record<string, ProviderHookCapabilities>> = {
  claude: { capturesProcessIdentity: true },
  droid: { capturesProcessIdentity: true }
}
