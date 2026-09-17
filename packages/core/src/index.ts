export * from "./types";
export * from "./fieldMerge";
export * from "./conflictResolution";

export {
  dominates,
  isConcurrent,
  clocksEqual,
  merge as mergeVectorClocks,
} from "./vectorClock";

export {
  value as pnCounterValue,
  applyDelta as applyPNCounterDelta,
  merge as mergePNCounterStates,
  emptyPNCounter,
} from "./pnCounter";
