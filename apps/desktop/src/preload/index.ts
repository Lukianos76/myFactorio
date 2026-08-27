import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only channel between renderer and main. Sandboxed, context-isolated, and deliberately
 * one function wide: the renderer asks for the load status and gets data back.
 */
contextBridge.exposeInMainWorld('myfactorio', {
  status: () => ipcRenderer.invoke('myfactorio:status'),
});
