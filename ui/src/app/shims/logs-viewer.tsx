// argo-ui's component barrel re-exports LogsViewer, which imports xterm. Argo CD
// never uses it (PodsLogsViewer is used instead), but because the barrel has side
// effects webpack cannot tree-shake it, so xterm ends up in the entry bundle.
// webpack.config.js rewrites that one import to this module to break the chain.
export const LogsViewer = (): never => {
    throw new Error('argo-ui LogsViewer is excluded from the Argo CD bundle (see webpack.config.js); use PodsLogsViewer instead.');
};
