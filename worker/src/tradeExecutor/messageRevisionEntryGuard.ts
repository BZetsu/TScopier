/**
 * Message-revision / same-signal refresh must not open a second market or
 * broker-pending basket after the first entry already materialized.
 */
export function shouldBlockNewEntryOnRevision(args: {
  sameSignalRefresh: boolean
  blockNewEntry?: boolean
  alreadyMaterialized: boolean
}): boolean {
  if (args.blockNewEntry === true) return true
  return args.sameSignalRefresh === true && args.alreadyMaterialized === true
}
