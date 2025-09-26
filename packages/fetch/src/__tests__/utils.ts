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
