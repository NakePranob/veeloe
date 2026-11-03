// A phone runs one copy of the app, so there is nothing to share. See tab-lock.web.ts.
export const tryHoldDatabase = async (_onTaken: () => Promise<void>) => true;
export const takeOverDatabase = async (_onTaken: () => Promise<void>) => {};
export const retryOpenAfterReload = () => false;
export const openedDatabase = () => {};
