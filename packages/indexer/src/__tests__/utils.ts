import { AnyStateMachine, createActor, Subscription } from 'xstate';

// Helper function to create a controllable promise
export function createControllablePromise<T>() {
  let resolvePromise: (value: T) => void;
  let rejectPromise: (error: Error) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value: T) => resolvePromise!(value),
    reject: (error: Error) => rejectPromise!(error),
  };
}

/**
 * Create and start an actor for a given state machine, tracking state transitions.
 */
export function createAndStartActor<TMachine extends AnyStateMachine, TInput>(
  machine: TMachine,
  input: TInput,
  guards?: Record<string, (...args: unknown[]) => boolean>,
) {
  const providedMachine = guards ? machine.provide({ guards }) : machine;

  const actor = createActor(providedMachine, { input });

  const stateTransitions: unknown[] = [];
  const subscription: Subscription = actor.subscribe((snapshot) => {
    // We only care about the snapshot's value in tests; keep it as unknown for flexibility.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stateTransitions.push((snapshot as any).value);
  });

  actor.start();

  return { actor, stateTransitions, subscription };
}

/**
 * Get the last state from a state transitions array.
 */
export function getLastState<TState>(stateTransitions: TState[]) {
  return stateTransitions[stateTransitions.length - 1];
}

/**
 * Get nested state value from a state object using a dot-delimited path.
 */
export function getNestedState(state: unknown, path: string) {
  const parts = path.split('.');
  let current: unknown = state;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return current;
}
