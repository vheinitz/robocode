// React-Anbindung an den Geräte-Controller. Die UI liest den Zustand reaktiv
// (useSyncExternalStore) und ruft Aktionen direkt am Singleton auf.

import { useSyncExternalStore } from 'react'
import { device, DeviceState } from './device'

export function useDevice(): DeviceState {
  return useSyncExternalStore(device.subscribe, device.getState)
}

export { device }
