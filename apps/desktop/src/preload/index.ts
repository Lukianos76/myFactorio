import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only channel between renderer and main. Sandboxed, context-isolated, and deliberately
 * narrow: the renderer asks for the load status, and reports back once it has finished starting.
 */
contextBridge.exposeInMainWorld('myfactorio', {
  status: () => ipcRenderer.invoke('myfactorio:status'),
  report: (payload: unknown) => ipcRenderer.invoke('myfactorio:rendered', payload),
});
